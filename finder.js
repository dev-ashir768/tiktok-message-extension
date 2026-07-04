// Runs on the "Find creators" page.
// Injects a checkbox on every creator row and a floating panel to queue them.

// Reload the page if the extension is unloaded/reloaded so stale injected UI is cleared.
// Only reload if the port was alive for at least 2s — avoids reload loops on first install
// when the service worker hasn't warmed up yet.
try {
  const _port = chrome.runtime.connect({ name: "ttbm-keepalive" });
  let _alive = false;
  setTimeout(() => { _alive = true; }, 2000);
  _port.onDisconnect.addListener(() => { if (_alive) location.reload(); });
} catch (_) {}

(() => {
  const SELECTED = new Set(); // creator ids selected on this page session
  const ROW_DATA = new Map(); // creator id -> {id, handle, nickname}
  let SENT_IDS = new Set(); // creators already messaged (persisted)
  let QUEUED_IDS = new Set(); // creators currently waiting in the queue
  let isInitialized = false;
  let currentMarket = "100";
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
        market: currentMarket,
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
      if (sent) {
        if (cb) cb.remove();
        SELECTED.delete(id);
      } else {
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
  }

  // ---- Floating panel -------------------------------------------------------

  let panel;

  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "ttbm-panel";
    panel.innerHTML = `
      <div class="ttbm-header">
        <div class="ttbm-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <span class="ttbm-title">Bulk Messenger</span>
        <span class="ttbm-dot" id="ttbm-dot"></span>
      </div>

      <div class="ttbm-stats">
        <div class="ttbm-stat">
          <span class="ttbm-stat-val" id="ttbm-stat-queue">0</span>
          <span class="ttbm-stat-lbl">Queue</span>
        </div>
        <div class="ttbm-stat">
          <span class="ttbm-stat-val" id="ttbm-stat-sent">0</span>
          <span class="ttbm-stat-lbl">Sent</span>
        </div>
        <div class="ttbm-stat">
          <span class="ttbm-stat-val" id="ttbm-stat-failed">0</span>
          <span class="ttbm-stat-lbl">Failed</span>
        </div>
      </div>

      <div class="ttbm-sel-row">
        <span class="ttbm-count" id="ttbm-count">0 selected</span>
        <button class="ttbm-btn ttbm-btn-ghost" id="ttbm-select-all" aria-label="Select all on page">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
          All
        </button>
        <button class="ttbm-btn ttbm-btn-ghost" id="ttbm-clear" aria-label="Clear selection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <button class="ttbm-btn ttbm-btn-primary" id="ttbm-add" aria-label="Add selected to queue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add to queue
      </button>

      <div class="ttbm-status" id="ttbm-status">Idle — select creators to start</div>

      <div class="ttbm-row">
        <button class="ttbm-btn ttbm-btn-start" id="ttbm-start" aria-label="Start campaign">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          Start
        </button>
        <button class="ttbm-btn ttbm-btn-stop" id="ttbm-stop" aria-label="Stop campaign">
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
          Stop
        </button>
      </div>

      <div class="ttbm-hint">Settings &amp; template → extension popup</div>
      <div class="ttbm-credit">Built by <a href="https://ashirarif.com" target="_blank" rel="noopener" class="ttbm-credit-link">ashirarif.com</a></div>
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
          setStatus(`${res.added} added to queue · total: ${res.total}${dup}${off}`);
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
    if (!panel) return;
    const el = panel.querySelector("#ttbm-status");
    if (el) el.textContent = txt;
  }

  function refreshPanel() {
    if (!panel) return;
    const el = panel.querySelector("#ttbm-count");
    if (el) el.textContent = `${SELECTED.size} selected`;
  }

  function pollStatus() {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      if (!res || !res.ok) return;
      if (!panel) return;

      // Update stat strip
      const qEl = panel.querySelector("#ttbm-stat-queue");
      const sEl = panel.querySelector("#ttbm-stat-sent");
      const fEl = panel.querySelector("#ttbm-stat-failed");
      if (qEl) qEl.textContent = res.pending ?? 0;
      if (sEl) sEl.textContent = res.sent ?? 0;
      if (fEl) fEl.textContent = res.failed ?? 0;

      // Live dot
      const dot = panel.querySelector("#ttbm-dot");
      if (dot) dot.classList.toggle("active", !!res.running);

      // Status text
      if (res.running) {
        setStatus(`Running · ${res.active || 0} tab${res.active === 1 ? "" : "s"} active · today ${res.sentToday}/${res.dailyCap}`);
      } else {
        setStatus(res.pending > 0 ? `Idle · ${res.pending} in queue` : "Idle — select creators to start");
      }
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
    currentMarket = new URLSearchParams(location.search).get("market") || "100";

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

    clearTimeout(observer._t);
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
    if (areaName === "local" && changes.queue && isInitialized) {
      refreshHighlights();
    }
  });

  if (document.readyState === "complete") setTimeout(checkAndToggle, 1500);
  else window.addEventListener("load", () => setTimeout(checkAndToggle, 1500));
})();
