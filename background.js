// Background service worker: worker-pool campaign orchestration.
//
// Design: up to `concurrency` chat tabs load in parallel (each cold load is
// ~25s), so their dead load time overlaps. But the actual SEND is globally
// throttled — only one message goes out per minDelay..maxDelay window — so the
// outbound rate still looks human and stays under TikTok's spam radar.
//
// All state lives in chrome.storage.local and every mutation runs under a
// simple promise-chain mutex, because concurrent tabs fire events at once.

const DEFAULTS = {
  template:
    "Hi {first_name}!\n\nWe're Tiksly - an official TikTok Shop Partner Agency. We think your audience would love our products.\n\nWant to earn while doing what you already do? \u{1F4B0} It would be great to collaborate with you, and we would love to build a long-term working relationship together.\n\nOpen to a long-term collab? \u{1F60A}\n\nTiksly Team!",
  minDelay: 30, // seconds between actual sends (global throttle)
  maxDelay: 60,
  dailyCap: 500,
  concurrency: 3, // parallel loading tabs
  serverUrl: "", // e.g. https://yourdomain.com/server/api.php (empty = local only)
  employee: "", // this operator's name; must match their panel username
  serverToken: "", // shared secret, must equal API_TOKEN in server/config.php
  serverConnected: false,
};

// Talk to the shared PHP/MySQL backend. Returns {ok:false, offline:true} when
// no server is configured, so callers can fall back to local-only behaviour.
async function serverFetch(settings, action, payload) {
  if (!settings.serverUrl) return { ok: false, offline: true };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(settings.serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        employee: settings.employee || "unknown",
        token: settings.serverToken || "",
        ...payload,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 140) };
  }
}

const TICK_ALARM = "ttbm-tick";
const TAB_TIMEOUT_MS = 180000; // 3 min per tab (cold load ~25s + send)

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ---- state helpers ---------------------------------------------------------

async function readState() {
  const s = await chrome.storage.local.get({
    settings: DEFAULTS,
    queue: [],
    campaign: { running: false, workers: {}, nextSendAt: 0 },
    stats: { date: todayKey(), sentToday: 0 },
    log: [],
    sentIds: {}, // creator_id -> timestamp; persists so pages can highlight
  });
  s.settings = { ...DEFAULTS, ...s.settings };
  if (!s.campaign.workers) s.campaign.workers = {};
  if (s.stats.date !== todayKey()) s.stats = { date: todayKey(), sentToday: 0 };
  return s;
}

// Promise-chain mutex so overlapping tab events can't corrupt storage.
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(() => fn());
  lockChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function log(s, type, msg) {
  s.log.unshift({ ts: Date.now(), type, msg });
  s.log = s.log.slice(0, 300);
}

function renderTemplate(tpl, item) {
  const first = (item.nickname || item.handle || "").trim().split(/\s+/)[0] || "";
  return tpl
    .replaceAll("{handle}", item.handle || "")
    .replaceAll("{nickname}", item.nickname || item.handle || "")
    .replaceAll("{first_name}", first);
}

async function updateBadge(s) {
  chrome.action.setBadgeText({ text: String(s.stats.sentToday || "") });
  chrome.action.setBadgeBackgroundColor({ color: s.campaign.running ? "#0d9488" : "#9ca3af" });
}

// ---- pool orchestration (always called with a fresh state `s`) -------------

function workerCount(s) {
  return Object.keys(s.campaign.workers).length;
}

function pickDelayMs(s) {
  const { minDelay, maxDelay } = s.settings;
  const sec = minDelay + Math.random() * Math.max(0, maxDelay - minDelay);
  return Math.max(1000, sec * 1000);
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(Number(tabId));
  } catch (e) {}
}

// Open new tabs until the pool is full or there's nothing left to send.
async function refillPool(s) {
  if (!s.campaign.running) return;
  while (
    workerCount(s) < s.settings.concurrency &&
    s.stats.sentToday + inflightCount(s) < s.settings.dailyCap
  ) {
    const item = s.queue.find((q) => q.status === "pending");
    if (!item) break;
    item.status = "inflight";

    const base = item.origin || "https://partner.us.tiktokshop.com";
    const url =
      base + "/partner/im?creator_id=" + item.id + "&market=" + (item.market || "100");
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (e) {
      item.status = "pending";
      break;
    }
    s.campaign.workers[tab.id] = {
      itemId: item.id,
      phase: "loading",
      deadline: Date.now() + TAB_TIMEOUT_MS,
    };
  }
}

function inflightCount(s) {
  // Workers currently occupying a send slot but not yet counted in sentToday.
  return Object.values(s.campaign.workers).filter((w) => w.phase === "sending").length;
}

// Release one ready worker to actually send, if the throttle window is open.
async function dispatch(s) {
  if (!s.campaign.running) return;

  const now = Date.now();
  if (now < s.campaign.nextSendAt) {
    scheduleTick(s.campaign.nextSendAt - now);
    return;
  }
  if (s.stats.sentToday >= s.settings.dailyCap) {
    await stopCampaign(s, "daily cap reached (" + s.settings.dailyCap + ")");
    return;
  }

  const entry = Object.entries(s.campaign.workers).find(([, w]) => w.phase === "ready");
  if (!entry) return; // nothing ready yet; a CHAT_READY event will retry
  const [tabId, worker] = entry;
  const item = s.queue.find((q) => q.id === worker.itemId);
  if (!item) {
    delete s.campaign.workers[tabId];
    await closeTab(tabId);
    return;
  }

  worker.phase = "sending";
  worker.deadline = now + TAB_TIMEOUT_MS;
  s.campaign.nextSendAt = now + pickDelayMs(s); // reserve the next slot now
  await chrome.storage.local.set({ campaign: s.campaign });

  const text = renderTemplate(s.settings.template, item);
  chrome.tabs.sendMessage(Number(tabId), { type: "DO_SEND", text }, (res) => {
    const result = res || { success: false, detail: "no response from chat tab" };
    withLock(async () => {
      const st = await readState();
      await onSendComplete(st, tabId, result);
      await chrome.storage.local.set({
        queue: st.queue,
        campaign: st.campaign,
        stats: st.stats,
        log: st.log,
      });
      await updateBadge(st);
    });
  });

  // A send is in flight; let the next dispatch wait for the reserved slot.
  scheduleTick(s.campaign.nextSendAt - now);
}

async function onSendComplete(s, tabId, result) {
  const worker = s.campaign.workers[tabId];
  delete s.campaign.workers[tabId];
  await closeTab(tabId);

  if (worker) {
    const item = s.queue.find((q) => q.id === worker.itemId);
    if (item) {
      item.status = result.success ? "sent" : "failed";
      item.detail = result.detail || "";
      item.ts = Date.now();
      if (result.success) {
        s.stats.sentToday += 1;
        s.sentIds[item.id] = Date.now();
        // Persist immediately so highlighting survives regardless of caller.
        await chrome.storage.local.set({ sentIds: s.sentIds });
      }
      // Report the outcome to the shared server (fire and forget).
      serverFetch(s.settings, result.success ? "mark_sent" : "mark_failed", {
        creator: { id: item.id, handle: item.handle, nickname: item.nickname },
        detail: result.detail || "",
      });
      await log(
        s,
        result.success ? "sent" : "failed",
        "@" + item.handle + " — " + (result.success ? "sent" : "failed") +
          (result.detail ? " (" + result.detail + ")" : "")
      );
    }
  }

  await refillPool(s);
  if (s.campaign.running && workerCount(s) === 0 && !s.queue.some((q) => q.status === "pending")) {
    await stopCampaign(s, "queue empty — all done ✅");
    return;
  }
  await dispatch(s);
}

// Reap tabs that hung (never opened chat / send never returned).
async function reap(s) {
  const now = Date.now();
  for (const [tabId, w] of Object.entries(s.campaign.workers)) {
    if (now > w.deadline) {
      const item = s.queue.find((q) => q.id === w.itemId);
      if (item) {
        item.status = "failed";
        item.detail = "timeout — chat didn't open / no response";
        await log(s, "failed", "@" + (item ? item.handle : "?") + " — timeout");
      }
      delete s.campaign.workers[tabId];
      await closeTab(tabId);
    }
  }
}

async function stopCampaign(s, reason) {
  await chrome.alarms.clear(TICK_ALARM);
  for (const tabId of Object.keys(s.campaign.workers)) await closeTab(tabId);
  s.campaign = { running: false, workers: {}, nextSendAt: 0 };
  // Any inflight items that never resolved go back to pending.
  for (const q of s.queue) if (q.status === "inflight") q.status = "pending";
  if (reason) await log(s, "info", "Campaign stopped: " + reason);
}

function scheduleTick(delayMs) {
  const mins = Math.max(0.5, (delayMs || 0) / 60000); // alarms floor ~30s
  chrome.alarms.create(TICK_ALARM, { delayInMinutes: mins });
}

// ---- event wiring ----------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  withLock(async () => {
    const s = await readState();
    if (!s.campaign.running) return;
    await reap(s);
    await refillPool(s);
    if (workerCount(s) === 0 && !s.queue.some((q) => q.status === "pending")) {
      await stopCampaign(s, "queue empty — all done ✅");
    } else {
      await dispatch(s);
      scheduleTick(30000); // heartbeat
    }
    await chrome.storage.local.set({ queue: s.queue, campaign: s.campaign, stats: s.stats, log: s.log });
    await updateBadge(s);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only campaign control + status here; DO_SEND replies are handled by chat.js.
  withLock(async () => {
    const s = await readState();

    if (msg.type === "ADD_TO_QUEUE") {
      const creators = (msg.creators || []).filter((c) => c.id);
      let accepted = creators;
      let rejected = [];

      // Claim on the shared server first so two employees can't grab the same
      // creator. Only newly-claimed creators get queued locally.
      const claim = await serverFetch(s.settings, "claim", {
        creators: creators.map((c) => ({ id: c.id, handle: c.handle, nickname: c.nickname })),
      });

      if (claim && claim.ok) {
        const acc = new Set((claim.accepted || []).map(String));
        accepted = creators.filter((c) => acc.has(String(c.id)));
        rejected = claim.rejected || [];
      } else if (!(claim && claim.offline)) {
        // Server configured but unreachable — refuse to add, otherwise the
        // shared dedup guarantee breaks and duplicates could be messaged.
        sendResponse({
          ok: false,
          error: "Server unreachable — duplicate detection off, nothing added. Please check Server URL/connection.",
        });
        return;
      }

      let added = 0;
      for (const c of accepted) {
        if (s.queue.some((q) => q.id === c.id)) continue;
        s.queue.push({ ...c, status: "pending", ts: Date.now() });
        added++;
      }
      await chrome.storage.local.set({ queue: s.queue });
      sendResponse({
        ok: true,
        added,
        total: s.queue.length,
        rejected: rejected.length,
        offline: !!(claim && claim.offline),
      });
      return;
    }

    if (msg.type === "GET_STATUS") {
      const count = (st) => s.queue.filter((q) => q.status === st).length;
      sendResponse({
        ok: true,
        running: s.campaign.running,
        pending: count("pending") + count("inflight"),
        sent: count("sent"),
        failed: count("failed"),
        active: workerCount(s),
        sentToday: s.stats.sentToday,
        dailyCap: s.settings.dailyCap,
        settings: s.settings,
        log: s.log.slice(0, 50),
      });
      return;
    }

    if (msg.type === "START_CAMPAIGN") {
      if (s.campaign.running) return sendResponse({ ok: false, error: "already running" });
      s.campaign = { running: true, workers: {}, nextSendAt: 0 };
      await log(s, "info", "Campaign started (pool of " + s.settings.concurrency + ")");
      await refillPool(s);
      await dispatch(s);
      scheduleTick(30000);
      await chrome.storage.local.set({ queue: s.queue, campaign: s.campaign, log: s.log });
      await updateBadge(s);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "STOP_CAMPAIGN") {
      await stopCampaign(s, "stopped by user");
      await chrome.storage.local.set({ queue: s.queue, campaign: s.campaign, log: s.log });
      await updateBadge(s);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SAVE_SETTINGS") {
      const changed = (msg.settings.serverUrl !== undefined && s.settings.serverUrl !== msg.settings.serverUrl) ||
                      (msg.settings.employee !== undefined && s.settings.employee !== msg.settings.employee) ||
                      (msg.settings.serverToken !== undefined && s.settings.serverToken !== msg.settings.serverToken);
      s.settings = { ...s.settings, ...msg.settings };
      if (changed) {
        s.settings.serverConnected = false;
      }
      await chrome.storage.local.set({ settings: s.settings });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "CLEAR_QUEUE") {
      await stopCampaign(s);
      serverFetch(s.settings, "clear_queued", {}); // fire-and-forget: remove queued/failed from server
      await chrome.storage.local.set({ queue: [], log: [], campaign: s.campaign });
      await updateBadge(s);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "GET_SENT") {
      let sentIds = Object.keys(s.sentIds);
      let queuedIds = s.queue
        .filter((q) => q.status === "pending" || q.status === "inflight")
        .map((q) => String(q.id));

      // Prefer the shared server so all employees see the same highlights.
      const st = await serverFetch(s.settings, "status", {});
      let synced = false;
      if (st && st.ok) {
        sentIds = st.sent || [];
        queuedIds = st.queued || [];
        synced = true;
      }
      sendResponse({ ok: true, sentIds, queuedIds, synced });
      return;
    }

    if (msg.type === "CLEAR_SENT") {
      await chrome.storage.local.set({ sentIds: {} });
      await serverFetch(s.settings, "reset", {});
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "TEST_SERVER") {
      const r = await serverFetch(s.settings, "ping", {});
      const ok = !!(r && r.ok);
      s.settings.serverConnected = ok;
      await chrome.storage.local.set({ settings: s.settings });
      sendResponse({ ok, detail: r && r.error ? r.error : (r && r.offline ? "no server URL set" : "connected") });
      return;
    }

    if (msg.type === "RETRY_FAILED") {
      for (const q of s.queue) if (q.status === "failed") q.status = "pending";
      await chrome.storage.local.set({ queue: s.queue });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "CHAT_READY") {
      // A pool tab finished loading its chat and is ready to send on command.
      const tabId = sender.tab && sender.tab.id;
      const worker = tabId != null ? s.campaign.workers[tabId] : null;
      if (s.campaign.running && worker) {
        worker.phase = "ready";
        worker.deadline = Date.now() + TAB_TIMEOUT_MS;
        await chrome.storage.local.set({ campaign: s.campaign });
        await dispatch(s);
        sendResponse({ ok: true, ack: true });
      } else {
        // Not one of our pool tabs (user browsing manually) — do nothing.
        sendResponse({ ok: true, ack: false });
      }
      return;
    }

    if (msg.type === "CHAT_FATAL") {
      // Chat page detected an unrecoverable state (e.g. server error).
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null && s.campaign.workers[tabId]) {
        await onSendComplete(s, tabId, { success: false, detail: msg.detail || "chat error" });
        await chrome.storage.local.set({ queue: s.queue, campaign: s.campaign, stats: s.stats, log: s.log });
        await updateBadge(s);
      }
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "unknown message" });
  });
  return true; // async sendResponse
});

// If a pool tab is closed manually, free its slot and move on.
chrome.tabs.onRemoved.addListener((tabId) => {
  withLock(async () => {
    const s = await readState();
    if (s.campaign.workers[tabId]) {
      const w = s.campaign.workers[tabId];
      const item = s.queue.find((q) => q.id === w.itemId);
      if (item && item.status === "inflight") {
        item.status = "failed";
        item.detail = "tab closed";
      }
      delete s.campaign.workers[tabId];
      if (s.campaign.running) {
        await refillPool(s);
        await dispatch(s);
      }
      await chrome.storage.local.set({ queue: s.queue, campaign: s.campaign });
    }
  });
});

withLock(async () => updateBadge(await readState()));
