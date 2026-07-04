// Runs in the chat page's MAIN world. TikTok's Send button ignores synthetic
// DOM clicks (isTrusted check), so the send must go through React's own
// onClick handler — which is only reachable from the page's world.
// chat.js (isolated world) asks for a send via the 'ttbm-send' CustomEvent
// and gets a 'ttbm-send-result' CustomEvent back. Payloads are JSON strings.

(() => {
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

  function getSendButton() {
    return [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Send" && !b.disabled
    );
  }

  function getErrorToast() {
    const toast = document.querySelector(".arco-message-error, .arco-notification-error");
    return toast ? toast.textContent.trim().slice(0, 120) : null;
  }

  // Fatal states where waiting further is pointless (e.g. invalid creator).
  function getFatalState() {
    const body = document.body.innerText;
    if (/Server error/i.test(body)) return "server error (creator not reachable)";
    return null;
  }

  // Fresh tabs take ~25s for the IM system to auto-open the chat, so we wait
  // generously. Bail early only on a fatal server error.
  async function waitForChat(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ta = getTextarea();
      if (ta) return ta;
      if (getFatalState()) return null;
      await sleep(500);
    }
    return null;
  }

  function setReactValue(ta, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Invoke the button's React onClick directly (synthetic clicks are ignored).
  function reactClick(btn) {
    const fakeEvent = {
      preventDefault() {},
      stopPropagation() {},
      currentTarget: btn,
      target: btn,
    };
    const pk = Object.keys(btn).find((k) => k.startsWith("__reactProps$"));
    if (pk && btn[pk] && typeof btn[pk].onClick === "function") {
      btn[pk].onClick(fakeEvent);
      return true;
    }
    const fk = Object.keys(btn).find((k) => k.startsWith("__reactFiber$"));
    let fiber = fk ? btn[fk] : null;
    let hops = 0;
    while (fiber && hops < 10) {
      const p = fiber.memoizedProps;
      if (p && typeof p.onClick === "function") {
        p.onClick(fakeEvent);
        return true;
      }
      fiber = fiber.return;
      hops++;
    }
    return false;
  }

  async function send(text) {
    const fatal = getFatalState();
    if (fatal) return { success: false, detail: fatal };

    const ta = await waitForChat(75000);
    if (!ta) {
      return { success: false, detail: getFatalState() || "chat did not open in time (5-msg limit?)" };
    }

    setReactValue(ta, text);
    await sleep(800);
    if (ta.value !== text) return { success: false, detail: "could not set message text" };

    const btn = await waitFor(getSendButton, 8000);
    if (!btn) return { success: false, detail: "Send button not found/disabled" };

    if (!reactClick(btn)) return { success: false, detail: "React onClick handler not found" };

    // Success = textarea cleared by the app and no error toast.
    const cleared = await waitFor(() => {
      const cur = getTextarea();
      return cur && cur.value === "";
    }, 8000, 300);
    await sleep(1200);

    const toast = getErrorToast();
    if (toast) return { success: false, detail: toast };
    if (!cleared) return { success: false, detail: "textarea not cleared after send" };

    const confirmed = document.body.innerText.includes(text.slice(0, 40));
    return { success: true, detail: confirmed ? "visible in thread" : "sent (not yet visible)" };
  }

  let busy = false;
  document.addEventListener("ttbm-send", async (e) => {
    if (busy) return;
    busy = true;
    let payload = {};
    try {
      payload = JSON.parse((e && e.detail) || "{}");
    } catch (_) {}
    const res = await send(String(payload.text || ""));
    busy = false;
    document.dispatchEvent(new CustomEvent("ttbm-send-result", { detail: JSON.stringify(res) }));
  });

  // Marker so chat.js knows the MAIN-world bridge is ready.
  document.documentElement.dataset.ttbmMain = "1";
})();
