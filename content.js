// Task Auto-Claimer - Content Script
// Monitors the "Available work" tab for new tasks and claims the first one.

(function () {
  "use strict";

  const DASHBOARD_URL =
    "https://feather.openai.com/campaigns/2072efd0-e22f-482e-bc2d-01617ce23d23";

  // Polling interval in ms (default 10 seconds)
  const DEFAULT_POLL_INTERVAL = 10000;

  // State
  let isMonitoring = false;
  let pollTimer = null;
  let claimInProgress = false;

  // ── Logging ──────────────────────────────────────────────────────────

  function log(msg, ...args) {
    console.log(`[TaskClaimer] ${msg}`, ...args);
  }

  function logError(msg, ...args) {
    console.error(`[TaskClaimer] ${msg}`, ...args);
  }

  // ── Status badge ─────────────────────────────────────────────────────

  let statusBadge = null;

  function createStatusBadge() {
    if (statusBadge) return;
    statusBadge = document.createElement("div");
    statusBadge.id = "task-claimer-badge";
    document.body.appendChild(statusBadge);
    updateBadge("idle");
  }

  function updateBadge(state, text) {
    if (!statusBadge) createStatusBadge();
    const states = {
      idle: { label: "Claimer: OFF", cls: "tc-idle" },
      monitoring: { label: "Claimer: Watching...", cls: "tc-monitoring" },
      found: { label: "Claimer: Task found!", cls: "tc-found" },
      claiming: { label: "Claimer: Claiming...", cls: "tc-claiming" },
      claimed: { label: "Claimer: Claimed!", cls: "tc-claimed" },
      error: { label: `Claimer: Error`, cls: "tc-error" },
    };
    const s = states[state] || states.idle;
    statusBadge.textContent = text || s.label;
    statusBadge.className = `tc-badge ${s.cls}`;
  }

  // ── DOM helpers ──────────────────────────────────────────────────────

  function findAvailableWorkTab() {
    // Look for the "Available work" tab button/link
    const allElements = document.querySelectorAll(
      'button, a, [role="tab"], div[class*="tab"]'
    );
    for (const el of allElements) {
      if (el.textContent.trim().toLowerCase().includes("available work")) {
        return el;
      }
    }
    return null;
  }

  function isOnAvailableWorkTab() {
    const tab = findAvailableWorkTab();
    if (!tab) return false;
    // Check if the tab is active/selected
    const isActive =
      tab.getAttribute("aria-selected") === "true" ||
      tab.classList.contains("active") ||
      tab.dataset.state === "active" ||
      window.location.href.includes("tasks-tab=unclaimed");
    return isActive;
  }

  function ensureAvailableWorkTab() {
    if (isOnAvailableWorkTab()) return true;
    const tab = findAvailableWorkTab();
    if (tab) {
      log("Clicking Available work tab");
      tab.click();
      return true;
    }
    return false;
  }

  function getNoTasksMessage() {
    // Check for the "No tasks that match your search criteria" message
    const allText = document.body.innerText;
    return allText.includes("No tasks that match your search criteria");
  }

  function findTaskRows() {
    // Look for table rows in the task list.
    // The dashboard shows tasks in a table with columns: UPDATED AT, TITLE, STAGE, etc.
    const rows = [];

    // Strategy 1: Look for table rows (tr) inside a tbody
    const tableRows = document.querySelectorAll("tbody tr");
    for (const row of tableRows) {
      // Skip header rows or empty rows
      if (
        row.querySelector("th") ||
        row.cells?.length === 0 ||
        row.textContent.trim() === ""
      ) {
        continue;
      }
      rows.push(row);
    }

    // Strategy 2: If no table rows, look for clickable list items/cards
    if (rows.length === 0) {
      const cards = document.querySelectorAll(
        '[class*="task-row"], [class*="TaskRow"], [class*="task-card"], [class*="TaskCard"], [data-testid*="task"]'
      );
      for (const card of cards) {
        rows.push(card);
      }
    }

    // Strategy 3: Look for any row-like elements with task data in the main content area
    if (rows.length === 0) {
      const links = document.querySelectorAll('a[href*="/tasks/"]');
      for (const link of links) {
        // Get the closest row-like parent
        const row =
          link.closest("tr") || link.closest('[role="row"]') || link;
        if (!rows.includes(row)) {
          rows.push(row);
        }
      }
    }

    return rows;
  }

  function clickFirstTask(rows) {
    if (rows.length === 0) return false;

    const firstRow = rows[0];
    log("Found task row, attempting to click:", firstRow.textContent.trim().substring(0, 100));

    // Try clicking a link inside the row first
    const link = firstRow.querySelector("a");
    if (link) {
      link.click();
      return true;
    }

    // Otherwise click the row itself
    firstRow.click();
    return true;
  }

  function findClaimButton() {
    // Look for a "Claim" button on the task detail page
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === "claim" || text === "claim task") {
        return btn;
      }
    }

    // Also check for links styled as buttons
    const links = document.querySelectorAll("a");
    for (const link of links) {
      const text = link.textContent.trim().toLowerCase();
      if (text === "claim" || text === "claim task") {
        return link;
      }
    }

    return null;
  }

  // ── Core logic ───────────────────────────────────────────────────────

  async function waitFor(conditionFn, timeoutMs = 10000, intervalMs = 500) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const result = conditionFn();
        if (result) return resolve(result);
        if (Date.now() - start > timeoutMs)
          return reject(new Error("Timeout waiting for condition"));
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  async function checkAndClaimTask() {
    if (claimInProgress) return;

    try {
      // Make sure we're on the Available work tab
      ensureAvailableWorkTab();

      // Short wait for content to render after tab switch
      await new Promise((r) => setTimeout(r, 1500));

      // Check if there are no tasks
      if (getNoTasksMessage()) {
        log("No tasks available yet.");
        return;
      }

      // Look for task rows
      const rows = findTaskRows();
      if (rows.length === 0) {
        log("No task rows found.");
        return;
      }

      // Task found!
      claimInProgress = true;
      updateBadge("found");
      log(`Found ${rows.length} task(s). Claiming first one...`);

      // Send notification
      chrome.runtime.sendMessage({
        type: "TASK_FOUND",
        count: rows.length,
      });

      // Click the first task
      const clicked = clickFirstTask(rows);
      if (!clicked) {
        logError("Failed to click task row");
        claimInProgress = false;
        updateBadge("error", "Claimer: Click failed");
        return;
      }

      updateBadge("claiming");

      // Wait for the task detail page / modal to load and find the Claim button
      try {
        const claimBtn = await waitFor(findClaimButton, 15000, 500);
        log("Found Claim button, clicking...");
        claimBtn.click();

        updateBadge("claimed");
        log("Task claimed successfully!");

        chrome.runtime.sendMessage({ type: "TASK_CLAIMED" });

        // Stop monitoring after a successful claim
        stopMonitoring();
      } catch {
        logError("Claim button not found within timeout. Retrying on next poll...");
        updateBadge("error", "Claimer: No claim button");
        // Navigate back so we can retry
        window.history.back();
        await new Promise((r) => setTimeout(r, 2000));
        claimInProgress = false;
      }
    } catch (err) {
      logError("Error during check:", err);
      updateBadge("error", "Claimer: Error");
      claimInProgress = false;
    }
  }

  // ── Monitoring control ───────────────────────────────────────────────

  function startMonitoring(intervalMs) {
    if (isMonitoring) return;
    const interval = intervalMs || DEFAULT_POLL_INTERVAL;
    isMonitoring = true;
    claimInProgress = false;
    log(`Starting monitoring (every ${interval / 1000}s)`);
    updateBadge("monitoring");

    // Immediate first check
    checkAndClaimTask();

    pollTimer = setInterval(() => {
      if (isMonitoring && !claimInProgress) {
        // Refresh the page to get fresh data, then check
        log("Refreshing page to check for new tasks...");
        location.reload();
      }
    }, interval);
  }

  function stopMonitoring() {
    isMonitoring = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    updateBadge("idle");
    log("Monitoring stopped.");
  }

  // ── Message handling ─────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "START_MONITORING":
        startMonitoring(msg.interval);
        sendResponse({ ok: true, status: "monitoring" });
        break;
      case "STOP_MONITORING":
        stopMonitoring();
        sendResponse({ ok: true, status: "stopped" });
        break;
      case "GET_STATUS":
        sendResponse({
          ok: true,
          isMonitoring,
          claimInProgress,
        });
        break;
      case "CHECK_NOW":
        checkAndClaimTask();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
    return true; // keep channel open for async
  });

  // ── Auto-resume after page reload ────────────────────────────────────

  chrome.storage.local.get(["monitoring", "pollInterval"], (data) => {
    if (data.monitoring) {
      log("Resuming monitoring after page reload...");
      // Wait a bit for page to fully load
      setTimeout(() => {
        isMonitoring = true;
        claimInProgress = false;
        createStatusBadge();
        updateBadge("monitoring");

        // Check for tasks immediately after reload
        checkAndClaimTask();

        // Set up the next reload cycle
        const interval = data.pollInterval || DEFAULT_POLL_INTERVAL;
        pollTimer = setInterval(() => {
          if (isMonitoring && !claimInProgress) {
            log("Refreshing page to check for new tasks...");
            location.reload();
          }
        }, interval);
      }, 3000);
    } else {
      createStatusBadge();
    }
  });
})();
