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

  // Wait for textarea using MutationObserver (not throttled in background tabs).
  // Falls back to polling if MutationObserver misses an already-present element.
  function waitForChat(timeoutMs) {
    return new Promise((resolve) => {
      // Check immediately — textarea might already be in DOM.
      const existing = getTextarea();
      if (existing) return resolve(existing);
      if (getFatalState()) return resolve(null);

      let settled = false;
      const settle = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(val);
      };

      // MutationObserver fires synchronously on DOM change — not throttled.
      const observer = new MutationObserver(() => {
        const ta = getTextarea();
        if (ta) return settle(ta);
        if (getFatalState()) settle(null);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Fallback polling (handles edge cases where MutationObserver fires before
      // React finishes rendering the element's attributes).
      const poll = setInterval(() => {
        const ta = getTextarea();
        if (ta) { clearInterval(poll); settle(ta); return; }
        if (getFatalState()) { clearInterval(poll); settle(null); }
      }, 2000);

      const timer = setTimeout(() => {
        clearInterval(poll);
        settle(null);
      }, timeoutMs);
    });
  }

  function setReactValue(ta, text) {
    // Use the native setter so React's synthetic event system picks it up.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input",  { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true })); // required by some React versions
    ta.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    ta.dispatchEvent(new KeyboardEvent("keyup",   { bubbles: true, key: "a" }));
  }

  // Invoke the button's React onClick directly (synthetic clicks are ignored by TikTok).
  function reactClick(btn) {
    const fakeEvent = {
      preventDefault() {},
      stopPropagation() {},
      nativeEvent: new MouseEvent("click"),
      currentTarget: btn,
      target: btn,
      bubbles: true,
      type: "click",
    };

    // Try __reactProps$ first (React 17+).
    const pk = Object.keys(btn).find(
      (k) => k.startsWith("__reactProps$") || k.startsWith("__reactEventHandlers$")
    );
    if (pk && btn[pk] && typeof btn[pk].onClick === "function") {
      btn[pk].onClick(fakeEvent);
      return true;
    }

    // Walk fiber tree (React 16 / 17 / 18).
    const fk = Object.keys(btn).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    let fiber = fk ? btn[fk] : null;
    let hops = 0;
    while (fiber && hops < 20) {
      const p = fiber.memoizedProps || fiber._currentElement?.props;
      if (p && typeof p.onClick === "function") {
        p.onClick(fakeEvent);
        return true;
      }
      fiber = fiber.return || fiber._hostParent;
      hops++;
    }

    // Last resort: native click (may not trigger React but worth trying).
    btn.click();
    return true; // optimistic — let textarea-clear check decide success
  }

  async function send(text) {
    const fatal = getFatalState();
    if (fatal) return { success: false, detail: fatal };

    const ta = await waitForChat(90000); // extended for slow Windows machines
    if (!ta) {
      return { success: false, detail: getFatalState() || "chat did not open in time (creator unreachable or 5-msg limit)" };
    }

    // Set value and allow React to process it.
    setReactValue(ta, text);
    await sleep(1500); // longer wait for slow machines

    // If text wasn't accepted, try once more with focus events.
    if (ta.value !== text) {
      ta.focus();
      await sleep(300);
      setReactValue(ta, text);
      await sleep(1000);
    }
    if (ta.value !== text) return { success: false, detail: "could not set message text in textarea" };

    const btn = await waitFor(getSendButton, 12000); // longer for slow render
    if (!btn) return { success: false, detail: "Send button not found or still disabled" };

    reactClick(btn);

    // Wait for textarea to clear — primary success signal.
    const cleared = await waitFor(() => {
      const cur = getTextarea();
      return cur && cur.value === "";
    }, 15000, 300); // extended from 8s → 15s for Windows

    await sleep(1500);

    const toast = getErrorToast();
    if (toast) return { success: false, detail: "TikTok error: " + toast };

    if (!cleared) {
      // Textarea didn't clear but no error toast — message may have still sent.
      // Check if the message text appears in the thread as a fallback.
      const inThread = document.body.innerText.includes(text.slice(0, 40));
      if (inThread) return { success: true, detail: "sent (confirmed in thread)" };
      return { success: false, detail: "textarea not cleared — send may have failed" };
    }

    const confirmed = document.body.innerText.includes(text.slice(0, 40));
    return { success: true, detail: confirmed ? "visible in thread" : "sent" };
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
