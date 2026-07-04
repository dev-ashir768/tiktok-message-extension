// Isolated-world side of the chat page (one per pool tab).
//
// 1. Waits for TikTok's chat pane to open (cold load ~25s).
// 2. Tells the background it's ready (CHAT_READY).
// 3. Waits for the background's throttled DO_SEND command, then delegates the
//    actual send to chat-main.js (MAIN world) — TikTok's Send button only
//    responds to React's own onClick, reachable only from the page world.

(() => {
  const params = new URLSearchParams(location.search);
  if (!params.get("creator_id")) return;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(fn, timeoutMs, intervalMs = 400) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = fn();
      if (v) return v;
      await sleep(intervalMs);
    }
    return null;
  }

  function getTextarea() {
    return (
      document.querySelector('textarea[placeholder="Send a message"]') ||
      document.querySelector('textarea[class*="textarea"]')
    );
  }

  function serverError() {
    return /Server error/i.test(document.body.innerText);
  }

  function sendViaMainWorld(text) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        document.removeEventListener("ttbm-send-result", onResult);
        resolve({ success: false, detail: "main-world send timed out" });
      }, 60000);

      function onResult(e) {
        clearTimeout(timer);
        document.removeEventListener("ttbm-send-result", onResult);
        let res = { success: false, detail: "bad result payload" };
        try {
          res = JSON.parse(e.detail || "{}");
        } catch (_) {}
        resolve(res);
      }

      document.addEventListener("ttbm-send-result", onResult);
      document.dispatchEvent(new CustomEvent("ttbm-send", { detail: JSON.stringify({ text }) }));
    });
  }

  // Background sends DO_SEND when this tab wins a throttle slot.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "DO_SEND") return;
    (async () => {
      const result = await sendViaMainWorld(msg.text);
      sendResponse(result);
    })();
    return true; // async response
  });

  async function run() {
    // Wait for the chat pane + the MAIN-world bridge. Bail on server error.
    const ready = await waitFor(() => getTextarea() || serverError(), 75000);
    if (!ready || serverError()) {
      chrome.runtime.sendMessage({
        type: "CHAT_FATAL",
        detail: serverError() ? "server error (creator not reachable)" : "chat did not open",
      });
      return;
    }
    await waitFor(() => document.documentElement.dataset.ttbmMain === "1", 10000);
    await sleep(800);

    // Announce readiness; the background will DO_SEND when the slot opens.
    chrome.runtime.sendMessage({ type: "CHAT_READY" });
  }

  if (document.readyState === "complete") run();
  else window.addEventListener("load", run);
})();
