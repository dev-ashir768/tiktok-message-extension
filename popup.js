function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(res);
    });
  });
}

async function refresh() {
  const res = await send({ type: "GET_STATUS" });
  if (!res || !res.ok) return;

  document.getElementById("stats").innerHTML =
    `Status: <b>${res.running ? "🟢 Running" : "⚪ Idle"}</b>` +
    (res.active ? ` · ${res.active} tabs loading` : "") +
    `<br>Queue pending: <b>${res.pending}</b> · Sent: <b>${res.sent}</b> · Failed: <b>${res.failed}</b><br>` +
    `Sent today: <b>${res.sentToday}/${res.dailyCap}</b>`;

  const tpl = document.getElementById("template");
  if (document.activeElement !== tpl && !tpl.dataset.dirty) tpl.value = res.settings.template;
  for (const k of ["minDelay", "maxDelay", "dailyCap", "concurrency", "serverUrl", "employee", "serverToken"]) {
    const el = document.getElementById(k);
    if (document.activeElement !== el && !el.dataset.dirty) el.value = res.settings[k] ?? "";
  }

  document.getElementById("log").innerHTML = (res.log || [])
    .map((l) => {
      const t = new Date(l.ts).toLocaleTimeString();
      return `<div class="${l.type}">${t} — ${escapeHtml(l.msg)}</div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

for (const id of ["template", "minDelay", "maxDelay", "dailyCap", "concurrency", "serverUrl", "employee", "serverToken"]) {
  document.getElementById(id).addEventListener("input", (e) => (e.target.dataset.dirty = "1"));
}

document.getElementById("save").addEventListener("click", async () => {
  const saveBtn = document.getElementById("save");
  const origText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  let urlVal = document.getElementById("serverUrl").value.trim();
  if (urlVal && !urlVal.match(/^https?:\/\//)) {
    urlVal = "https://" + urlVal;
    document.getElementById("serverUrl").value = urlVal;
  }

  const settings = {
    template:    document.getElementById("template").value,
    minDelay:    Math.max(30, Number(document.getElementById("minDelay").value) || 30),
    maxDelay:    Math.max(30, Number(document.getElementById("maxDelay").value) || 60),
    dailyCap:    Math.max(1,  Number(document.getElementById("dailyCap").value) || 500),
    concurrency: Math.min(5, Math.max(1, Number(document.getElementById("concurrency").value) || 3)),
    serverUrl:   urlVal,
    employee:    document.getElementById("employee").value.trim(),
    serverToken: document.getElementById("serverToken").value.trim(),
  };

  const res = await send({ type: "SAVE_SETTINGS", settings }).catch((e) => ({ ok: false, error: e.message }));

  saveBtn.disabled = false;
  if (!res || !res.ok) {
    saveBtn.textContent = "⚠ Save failed — " + (res && res.error ? res.error : "try again");
    setTimeout(() => { saveBtn.innerHTML = origText; }, 3000);
    return;
  }

  saveBtn.textContent = "✓ Saved";
  setTimeout(() => { saveBtn.innerHTML = origText; }, 1500);

  for (const id of ["template", "minDelay", "maxDelay", "dailyCap", "concurrency", "serverUrl", "employee", "serverToken"]) {
    delete document.getElementById(id).dataset.dirty;
  }
  refresh();
});

document.getElementById("start").addEventListener("click", async () => {
  await send({ type: "START_CAMPAIGN" });
  refresh();
});

document.getElementById("stop").addEventListener("click", async () => {
  await send({ type: "STOP_CAMPAIGN" });
  refresh();
});

document.getElementById("retryFailed").addEventListener("click", async () => {
  const btn = document.getElementById("retryFailed");
  btn.disabled = true;
  const res = await send({ type: "RETRY_FAILED" }).catch(() => null);
  btn.disabled = false;
  if (res && res.retried > 0) {
    btn.textContent = `↺ Retrying ${res.retried}…`;
    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg> Retry failed'; }, 2000);
  }
  refresh();
});

document.getElementById("clearQueue").addEventListener("click", async () => {
  if (confirm("Queue and log will both be cleared. Are you sure?")) {
    await send({ type: "CLEAR_QUEUE" });
    refresh();
  }
});

document.getElementById("clearSent").addEventListener("click", async () => {
  if (confirm('All "Messaged" highlights will be reset (both on server and locally). Are you sure?')) {
    await send({ type: "CLEAR_SENT" });
    refresh();
  }
});

document.getElementById("testServer").addEventListener("click", async () => {
  const el = document.getElementById("serverStatus");
  const urlInput = document.getElementById("serverUrl");
  const tok = document.getElementById("serverToken").value.trim();

  // Auto-fix missing protocol
  let url = urlInput.value.trim();
  if (url && !url.match(/^https?:\/\//)) {
    url = "https://" + url;
    urlInput.value = url;
  }

  if (!url || !tok) {
    el.textContent = "❌ Enter Server URL and token first";
    el.className = "server-status err";
    return;
  }
  el.textContent = "Testing…";
  el.className = "server-status";
  const res = await send({
    type: "SAVE_SETTINGS",
    settings: {
      serverUrl: url,
      employee: document.getElementById("employee").value.trim(),
      serverToken: tok,
    },
  }).catch(() => null);
  if (!res) {
    el.textContent = "❌ Extension error — try reloading";
    el.className = "server-status err";
    return;
  }
  const tr = await send({ type: "TEST_SERVER" }).catch(() => null);
  if (!tr) {
    el.textContent = "❌ No response from extension background";
    el.className = "server-status err";
    return;
  }
  el.textContent = tr.ok ? "✅ Connected to server" : "❌ " + (tr.detail || "connection failed");
  el.className = "server-status " + (tr.ok ? "ok" : "err");
});

refresh();
setInterval(refresh, 3000);
