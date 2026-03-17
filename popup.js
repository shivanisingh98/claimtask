// Popup script for Task Auto-Claimer

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const checkNowBtn = document.getElementById("checkNowBtn");
const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");
const claimedCount = document.getElementById("claimedCount");
const intervalSelect = document.getElementById("intervalSelect");
const logArea = document.getElementById("logArea");

const DASHBOARD_PATTERN = "feather.openai.com";

function addLog(text, type = "") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  entry.textContent = `[${time}] ${text}`;
  logArea.appendChild(entry);
  logArea.scrollTop = logArea.scrollHeight;

  // Persist log
  chrome.storage.local.get(["logs"], (data) => {
    const logs = data.logs || [];
    logs.push({ text, type, time: Date.now() });
    // Keep only last 50 entries
    if (logs.length > 50) logs.splice(0, logs.length - 50);
    chrome.storage.local.set({ logs });
  });
}

function setUIState(monitoring) {
  if (monitoring) {
    statusDot.className = "status-dot dot-active";
    statusLabel.className = "status-value status-active";
    statusLabel.textContent = "Monitoring";
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusDot.className = "status-dot dot-inactive";
    statusLabel.className = "status-value status-inactive";
    statusLabel.textContent = "Inactive";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function sendToContentScript(msg, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes(DASHBOARD_PATTERN)) {
      chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (chrome.runtime.lastError) {
          addLog("Cannot reach dashboard tab. Ensure the page is loaded.", "error");
          callback && callback(null);
          return;
        }
        callback && callback(response);
      });
    } else {
      addLog("Please open the Feather dashboard first.", "warn");
      callback && callback(null);
    }
  });
}

// Start monitoring
startBtn.addEventListener("click", () => {
  const interval = parseInt(intervalSelect.value, 10);
  chrome.storage.local.set({ monitoring: true, pollInterval: interval });

  sendToContentScript(
    { type: "START_MONITORING", interval },
    (res) => {
      if (res && res.ok) {
        setUIState(true);
        addLog(`Monitoring started (every ${interval / 1000}s)`, "success");
      }
    }
  );
});

// Stop monitoring
stopBtn.addEventListener("click", () => {
  chrome.storage.local.set({ monitoring: false });

  sendToContentScript({ type: "STOP_MONITORING" }, (res) => {
    setUIState(false);
    addLog("Monitoring stopped.", "warn");
  });
});

// Check now (one-shot)
checkNowBtn.addEventListener("click", () => {
  sendToContentScript({ type: "CHECK_NOW" }, (res) => {
    if (res && res.ok) {
      addLog("Manual check triggered.");
    }
  });
});

// ── Initialize popup state ─────────────────────────────────────────────

chrome.storage.local.get(
  ["monitoring", "pollInterval", "claimedCount", "logs"],
  (data) => {
    setUIState(!!data.monitoring);

    if (data.pollInterval) {
      intervalSelect.value = String(data.pollInterval);
    }

    claimedCount.textContent = data.claimedCount || 0;

    // Restore logs
    if (data.logs && data.logs.length > 0) {
      logArea.innerHTML = "";
      for (const entry of data.logs) {
        const div = document.createElement("div");
        div.className = `log-entry ${entry.type}`;
        const time = new Date(entry.time).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        div.textContent = `[${time}] ${entry.text}`;
        logArea.appendChild(div);
      }
      logArea.scrollTop = logArea.scrollHeight;
    }
  }
);

// Listen for messages from background/content scripts
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOG") {
    addLog(msg.text, msg.level || "");
  }
  if (msg.type === "TASK_CLAIMED") {
    chrome.storage.local.get(["claimedCount"], (data) => {
      const count = (data.claimedCount || 0) + 1;
      chrome.storage.local.set({ claimedCount: count });
      claimedCount.textContent = count;
    });
    addLog("Task claimed successfully!", "success");
  }
  if (msg.type === "TASK_FOUND") {
    addLog(`Task(s) found! (${msg.count} available)`, "success");
  }
});
