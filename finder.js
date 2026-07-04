// Runs on the "Find creators" page.
// Injects a checkbox on every creator row and a floating panel to queue them.

(() => {
  const SELECTED = new Set(); // creator ids selected on this page session
  const ROW_DATA = new Map(); // creator id -> {id, handle, nickname}
  let SENT_IDS = new Set(); // creators already messaged (persisted)
  let QUEUED_IDS = new Set(); // creators currently waiting in the queue
  let isInitialized = false;
  let pollIntervalId = null;
  let highlightIntervalId = null;
  let injectIntervalId = null;

  // Creator data is extracted by finder-main.js (MAIN world) and exposed
  // as data-ttbm-* attributes on each row.
  function getRecord(rowEl) {
    if (!rowEl || !rowEl.dataset.ttbmId) return null;
    return {
      creator_oecuid: rowEl.dataset.ttbmId,
      handle: rowEl.dataset.ttbmHandle || "",
      nickname: rowEl.dataset.ttbmNick || "",
    };
  }

  // ---- Row discovery & checkbox injection ----------------------------------

  function findRows() {
    return [...document.querySelectorAll("tr")].filter((r) =>
      [...r.querySelectorAll("button")].some((b) => b.textContent.trim() === "Invite")
    );
  }

  function injectCheckboxes() {
    for (const row of findRows()) {
      const rec = getRecord(row);
      if (!rec) continue;

      const id = String(rec.creator_oecuid);
      ROW_DATA.set(id, {
        id,
        handle: rec.handle || "",
        nickname: rec.nickname || "",
        market: new URLSearchParams(location.search).get("market") || "100",
        origin: location.origin,
      });

      // Highlight already-messaged / queued creators.
      const sent = SENT_IDS.has(id);
      const queued = QUEUED_IDS.has(id);
      row.classList.toggle("ttbm-sent-row", sent);
      row.classList.toggle("ttbm-queued-row", !sent && queued);
      let badge = row.querySelector(".ttbm-badge");
      if (sent || queued) {
        if (!badge) {
          const nameCell = row.querySelector("td");
          if (nameCell) {
            badge = document.createElement("span");
            badge.className = "ttbm-badge";
            nameCell.appendChild(badge);
          }
        }
        if (badge) {
          badge.textContent = sent ? "✓ Messaged" : "⏳ Queued";
          badge.classList.toggle("ttbm-badge-sent", sent);
          badge.classList.toggle("ttbm-badge-queued", !sent);
        }
      } else if (badge) {
        badge.remove();
      }

      let cb = row.querySelector(".ttbm-check");
      if (!cb) {
        const firstCell = row.querySelector("td");
        if (!firstCell) continue;
        cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "ttbm-check";
        // Read the id at click time — React reuses row nodes, so the
        // creator under this checkbox can change.
        cb.addEventListener("click", (e) => {
          e.stopPropagation();
          const liveId = row.dataset.ttbmId;
          if (!liveId) return;
          if (cb.checked) SELECTED.add(liveId);
          else SELECTED.delete(liveId);
          refreshPanel();
        });
        firstCell.style.position = "relative";
        firstCell.prepend(cb);
      }
      // Keep the visual state in sync with the (possibly re-tagged) row.
      cb.checked = SELECTED.has(id);
    }
  }

  // ---- Floating panel -------------------------------------------------------

  let panel;

  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "ttbm-panel";
    panel.innerHTML = `
      <div class="ttbm-title">📨 Bulk Messenger</div>
      <div class="ttbm-row">
        <button class="ttbm-btn" id="ttbm-select-all">Select page</button>
        <button class="ttbm-btn" id="ttbm-clear">Clear</button>
      </div>
      <div class="ttbm-count" id="ttbm-count">0 selected</div>
      <button class="ttbm-btn ttbm-primary" id="ttbm-add">➕ Add to queue</button>
      <div class="ttbm-status" id="ttbm-status"></div>
      <div class="ttbm-row">
        <button class="ttbm-btn ttbm-start" id="ttbm-start">▶ Start</button>
        <button class="ttbm-btn ttbm-stop" id="ttbm-stop">⏸ Stop</button>
      </div>
      <div class="ttbm-hint">Template & settings: extension popup icon</div>
    `;
    document.body.appendChild(panel);

    panel.querySelector("#ttbm-select-all").addEventListener("click", () => {
      injectCheckboxes();
      for (const cb of document.querySelectorAll(".ttbm-check")) {
        const row = cb.closest("tr");
        const rec = row && getRecord(row);
        if (!rec) continue;
        const id = String(rec.creator_oecuid);
        // Skip creators already messaged or already queued.
        if (SENT_IDS.has(id) || QUEUED_IDS.has(id)) continue;
        cb.checked = true;
        SELECTED.add(id);
      }
      refreshPanel();
    });

    panel.querySelector("#ttbm-clear").addEventListener("click", () => {
      SELECTED.clear();
      document.querySelectorAll(".ttbm-check").forEach((cb) => (cb.checked = false));
      refreshPanel();
    });

    panel.querySelector("#ttbm-add").addEventListener("click", () => {
      const creators = [...SELECTED].map((id) => ROW_DATA.get(id)).filter(Boolean);
      if (!creators.length) return setStatus("Please select creators first");
      chrome.runtime.sendMessage({ type: "ADD_TO_QUEUE", creators }, (res) => {
        if (res && res.ok) {
          const dup = res.rejected ? ` · ${res.rejected} already taken` : "";
          const off = res.offline ? " (local only)" : "";
          setStatus(`${res.added} added · queue total: ${res.total}${dup}${off}`);
          SELECTED.clear();
          document.querySelectorAll(".ttbm-check").forEach((cb) => (cb.checked = false));
          refreshPanel();
          refreshHighlights();
        } else {
          setStatus("⚠ " + ((res && res.error) || "add failed"));
        }
      });
    });

    panel.querySelector("#ttbm-start").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "START_CAMPAIGN" }, (res) => {
        setStatus(res && res.ok ? "Campaign started ✅" : "Error: " + (res && res.error));
      });
    });

    panel.querySelector("#ttbm-stop").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "STOP_CAMPAIGN" }, () => setStatus("Stopped"));
    });
  }

  function setStatus(txt) {
    const el = panel.querySelector("#ttbm-status");
    if (el) el.textContent = txt;
  }

  function refreshPanel() {
    const el = panel.querySelector("#ttbm-count");
    if (el) el.textContent = `${SELECTED.size} selected`;
  }

  function pollStatus() {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      if (!res || !res.ok) return;
      const running = res.running ? "🟢 running" : "⚪ idle";
      setStatus(
        `${running} · queue: ${res.pending} · sent: ${res.sent} · failed: ${res.failed} · today: ${res.sentToday}/${res.dailyCap}`
      );
    });
  }

  function refreshHighlights() {
    chrome.runtime.sendMessage({ type: "GET_SENT" }, (res) => {
      if (!res || !res.ok) return;
      SENT_IDS = new Set(res.sentIds || []);
      QUEUED_IDS = new Set(res.queuedIds || []);
      injectCheckboxes();
    });
  }

  // Re-inject checkboxes when the table re-renders (pagination, filters).
  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(injectCheckboxes, 400);
  });

  function start() {
    if (isInitialized) return;
    isInitialized = true;

    buildPanel();
    injectCheckboxes();
    observer.observe(document.body, { childList: true, subtree: true });

    pollIntervalId = setInterval(pollStatus, 5000);
    highlightIntervalId = setInterval(refreshHighlights, 8000);
    injectIntervalId = setInterval(injectCheckboxes, 1500);

    pollStatus();
    refreshHighlights();
  }

  function stop() {
    if (!isInitialized) return;
    isInitialized = false;

    if (panel) {
      panel.remove();
      panel = null;
    }

    if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null; }
    if (highlightIntervalId) { clearInterval(highlightIntervalId); highlightIntervalId = null; }
    if (injectIntervalId) { clearInterval(injectIntervalId); injectIntervalId = null; }

    observer.disconnect();

    document.querySelectorAll(".ttbm-check").forEach((cb) => cb.remove());
    document.querySelectorAll(".ttbm-badge").forEach((badge) => badge.remove());
    document.querySelectorAll("tr").forEach((row) => {
      row.classList.remove("ttbm-sent-row", "ttbm-queued-row");
    });

    SELECTED.clear();
    ROW_DATA.clear();
  }

  function checkAndToggle() {
    chrome.storage.local.get({ settings: {} }, (res) => {
      const isConnected = !!(res && res.settings && res.settings.serverConnected);
      if (isConnected) {
        start();
      } else {
        stop();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.settings) {
      checkAndToggle();
    }
  });

  if (document.readyState === "complete") setTimeout(checkAndToggle, 1500);
  else window.addEventListener("load", () => setTimeout(checkAndToggle, 1500));
})();
