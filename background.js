// Background service worker for Task Auto-Claimer

const DASHBOARD_URL =
  "https://feather.openai.com/campaigns/2072efd0-e22f-482e-bc2d-01617ce23d23";

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "TASK_FOUND") {
    chrome.notifications.create("task-found", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Task Available!",
      message: `${msg.count} task(s) found. Attempting to claim...`,
      priority: 2,
    });
  }

  if (msg.type === "TASK_CLAIMED") {
    // Increment claimed count
    chrome.storage.local.get(["claimedCount"], (data) => {
      const count = (data.claimedCount || 0) + 1;
      chrome.storage.local.set({ claimedCount: count });
    });

    chrome.notifications.create("task-claimed", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Task Claimed!",
      message: "Successfully claimed a task. Happy working!",
      priority: 2,
    });

    // Stop monitoring after claim
    chrome.storage.local.set({ monitoring: false });
  }

  if (msg.type === "LOG") {
    console.log(`[TaskClaimer] ${msg.text}`);
  }
});

// Keep the dashboard tab alive by checking periodically
chrome.alarms.create("keepalive", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") {
    chrome.storage.local.get(["monitoring"], (data) => {
      if (!data.monitoring) return;

      // Find the dashboard tab and ensure it's still there
      chrome.tabs.query({ url: "https://feather.openai.com/*" }, (tabs) => {
        if (tabs.length === 0) {
          console.log("[TaskClaimer] Dashboard tab not found. Opening one...");
          chrome.tabs.create({ url: DASHBOARD_URL, active: false });
        }
      });
    });
  }
});
