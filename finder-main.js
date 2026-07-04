// Runs in the page's MAIN world (content scripts can't see React fiber data
// from the isolated world). Extracts each creator row's record and writes it
// onto the row as data-* attributes for finder.js to read.

(() => {
  // TikTok wraps every record field in {value, status, is_authorized}.
  function val(x) {
    if (x && typeof x === "object" && "value" in x) return x.value;
    return x;
  }

  function getFiber(el) {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    return key ? el[key] : null;
  }

  // Walk up the fiber tree from the row, but STOP as soon as we reach a host
  // fiber for an ancestor element (tbody/table) — anything above that is
  // shared between rows and would give every row the same record.
  function getRecord(rowEl) {
    let fiber = getFiber(rowEl);
    let hops = 0;
    while (fiber && hops < 40) {
      const sn = fiber.stateNode;
      if (sn instanceof Element && sn !== rowEl && sn.contains(rowEl)) return null;
      const p = fiber.memoizedProps;
      if (p) {
        for (const key of ["record", "rowData", "data", "item"]) {
          const v = p[key];
          if (v && typeof v === "object" && !Array.isArray(v) && (v.creator_oecuid || v.creator_id)) {
            return v;
          }
        }
      }
      fiber = fiber.return;
      hops++;
    }
    return null;
  }

  function tagRow(row) {
    const rec = getRecord(row);
    if (!rec) return;
    const id = String(val(rec.creator_oecuid) || val(rec.creator_id) || "");
    const handle = String(val(rec.handle) || "");
    if (!id || id === "[object Object]") return;
    row.dataset.ttbmId = id;
    row.dataset.ttbmHandle = handle;
    row.dataset.ttbmNick = String(val(rec.nickname) || "");
  }

  function tagRows() {
    const rows = [...document.querySelectorAll("tr")].filter((r) =>
      [...r.querySelectorAll("button")].some((b) => b.textContent.trim() === "Invite")
    );
    for (const row of rows) {
      // Re-tag if untagged OR stale (React reuses row nodes when the list
      // changes, so the displayed creator can differ from the tagged one).
      if (!row.dataset.ttbmId || (row.dataset.ttbmHandle && !row.textContent.includes(row.dataset.ttbmHandle))) {
        tagRow(row);
      }
    }
  }

  setInterval(tagRows, 1000);
  tagRows();
})();
