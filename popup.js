function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function refresh() {
  const res = await send({ type: "GET_STATUS" });
  if (!res || !res.ok) return;

  document.getElementById("stats").innerHTML =
    `Status: <b>${res.running ? "🟢 Running" : "⚪ Idle"}</b>` +
    (res.active ? ` · ${res.active} tabs loading` : "") +
    `<br>Queue pending: <b>${res.pending}</b> · Sent: <b>${res.sent}</b> · Failed: <b>${res.failed}</b><br>` +
    `Aaj bheje gaye: <b>${res.sentToday}/${res.dailyCap}</b>`;

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
  const settings = {
    template: document.getElementById("template").value,
    minDelay: Math.max(30, Number(document.getElementById("minDelay").value) || 30),
    maxDelay: Math.max(30, Number(document.getElementById("maxDelay").value) || 60),
    dailyCap: Math.max(1, Number(document.getElementById("dailyCap").value) || 500),
    concurrency: Math.min(5, Math.max(1, Number(document.getElementById("concurrency").value) || 3)),
    serverUrl: document.getElementById("serverUrl").value.trim(),
    employee: document.getElementById("employee").value.trim(),
    serverToken: document.getElementById("serverToken").value.trim(),
  };
  if (settings.maxDelay < settings.minDelay) settings.maxDelay = settings.minDelay;
  await send({ type: "SAVE_SETTINGS", settings });
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
  await send({ type: "RETRY_FAILED" });
  refresh();
});

document.getElementById("clearQueue").addEventListener("click", async () => {
  if (confirm("Queue aur log dono clear ho jayenge. Sure?")) {
    await send({ type: "CLEAR_QUEUE" });
    refresh();
  }
});

document.getElementById("clearSent").addEventListener("click", async () => {
  if (confirm('Sabhi "Messaged" highlights reset ho jayenge (server + local). Sure?')) {
    await send({ type: "CLEAR_SENT" });
    refresh();
  }
});

document.getElementById("testServer").addEventListener("click", async () => {
  const el = document.getElementById("serverStatus");
  el.textContent = "Testing…";
  // Save current URL/name first so the test uses them.
  await send({
    type: "SAVE_SETTINGS",
    settings: {
      serverUrl: document.getElementById("serverUrl").value.trim(),
      employee: document.getElementById("employee").value.trim(),
      serverToken: document.getElementById("serverToken").value.trim(),
    },
  });
  const res = await send({ type: "TEST_SERVER" });
  el.textContent = res && res.ok ? "✅ Connected to server" : "❌ " + ((res && res.detail) || "failed");
  el.className = "server-status " + (res && res.ok ? "ok" : "err");
});

refresh();
setInterval(refresh, 3000);
