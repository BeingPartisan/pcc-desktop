// Messages between copies of PCC on different computers.
//
// Two laptops on different networks can't reach each other directly, so
// messages go through a public relay, ntfy.sh. It needs no account: anyone
// who knows a channel's name can post to it and listen on it. That makes the
// channel code the only secret. Messages pass through that third-party
// service, so this is for short notes, not for anything private.
//
// Channels (set up in Settings > Messages, held by the renderer):
//   - Shared channels: a random code two or more people enter. Everyone
//     with the code can send and receive.
//   - The broadcast channel: built in, the same for every copy of the app.
//     Its name is public, so each announcement carries a signature made
//     with the developer's private key, and every copy checks it against
//     BROADCAST_PUBLIC_KEY before showing anything. Only someone holding
//     the key file (kept in the developer's app data folder, never in the
//     repository) can broadcast.
//
// What travels: a small JSON object in the message body.
//   chat:      { v: 1, d: <sender's device id>, f: <sender's name>, t: <text> }
//   broadcast: { v: 1, b: 1, t: <text>, ts: <ms>, sig: <base64 signature of "ts|text"> }

const { ipcMain, net, app } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const RELAY = 'https://ntfy.sh';
const BROADCAST_TOPIC = 'pcc-announce-7f3k9q2m8x4w';
const BROADCAST_PUBLIC_KEY = 'MCowBQYDK2VwAyEAtwAu9rPlfsh8uPJ8nkcCBFNDLX6wqFjoOizf/wn6t4g='; // Ed25519, SPKI DER, base64
const BROADCAST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // older announcements are ignored, so one can't be replayed later
const MAX_TEXT = 500;
const CATCH_UP_SECONDS = 10 * 60;                 // on connecting, also fetch what arrived in the last 10 minutes
const TOPIC_PATTERN = /^pcc[a-z2-7]{16}$/;

module.exports = function registerMessaging({ logEvent, getMainWindow }) {
  const KEY_FILE = path.join(app.getPath('userData'), 'pcc-broadcast-key.pem');
  let topics = [];           // shared channels to listen on
  let deviceId = '';
  let controller = null;     // aborts the current listening connection
  let reconnectTimer = null;
  let retryDelay = 5000;
  let lastEventTime = 0;     // seconds; where to resume from after a dropped connection
  const seen = new Set();    // event ids already delivered

  const deliver = (message) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('message-received', message);
  };

  function verifyBroadcast(payload) {
    try {
      if (typeof payload.t !== 'string' || typeof payload.ts !== 'number' || typeof payload.sig !== 'string') return false;
      if (Math.abs(Date.now() - payload.ts) > BROADCAST_MAX_AGE_MS) return false;
      const key = crypto.createPublicKey({ key: Buffer.from(BROADCAST_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, Buffer.from(`${payload.ts}|${payload.t}`), key, Buffer.from(payload.sig, 'base64'));
    } catch (e) {
      return false;
    }
  }

  // One relay event -> a message for the app, or nothing if it isn't ours to show.
  function handleEvent(event) {
    if (event.event !== 'message' || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    lastEventTime = Math.max(lastEventTime, event.time || 0);

    let payload;
    try { payload = JSON.parse(event.message); } catch (e) { return; }
    if (!payload || payload.v !== 1 || typeof payload.t !== 'string') return;
    const text = payload.t.slice(0, MAX_TEXT);

    if (event.topic === BROADCAST_TOPIC) {
      if (!verifyBroadcast(payload)) { logEvent('warn', 'Ignored a broadcast with a missing or wrong signature'); return; }
      deliver({ id: event.id, topic: event.topic, broadcast: true, from: 'PCC', text, ts: payload.ts });
    } else if (topics.includes(event.topic)) {
      if (payload.d && payload.d === deviceId) return; // our own message coming back
      deliver({ id: event.id, topic: event.topic, broadcast: false, from: String(payload.f || 'Someone').slice(0, 40), text, ts: (event.time || 0) * 1000 });
    }
  }

  // Keeps one streaming connection open to the relay for all channels. The
  // relay sends one JSON object per line; a dropped connection is retried,
  // waiting a little longer each time, and resumes where it left off.
  async function listen() {
    stopListening();
    const all = [BROADCAST_TOPIC, ...topics];
    const since = lastEventTime ? lastEventTime : Math.floor(Date.now() / 1000) - CATCH_UP_SECONDS;
    controller = new AbortController();
    const mine = controller;
    try {
      const res = await net.fetch(`${RELAY}/${all.join(',')}/json?since=${since}`, { signal: mine.signal });
      if (!res.ok || !res.body) throw new Error(`Relay answered ${res.status}`);
      retryDelay = 5000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try { handleEvent(JSON.parse(line)); } catch (e) { /* not a complete event */ }
        }
      }
    } catch (e) {
      if (mine.signal.aborted) return; // stopped on purpose
      logEvent('warn', 'Messages: connection to the relay dropped', String(e.message || e));
    }
    if (mine.signal.aborted) return;
    reconnectTimer = setTimeout(listen, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  }

  function stopListening() {
    clearTimeout(reconnectTimer);
    if (controller) controller.abort();
    controller = null;
  }

  async function publish(topic, payload) {
    const res = await net.fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, message: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
  }

  // --- IPC ---

  // From the renderer: which channels to listen on, and this device's id.
  ipcMain.handle('messages-configure', (event, config) => {
    const next = (Array.isArray(config.topics) ? config.topics : []).filter((t) => TOPIC_PATTERN.test(t));
    const changed = next.join(',') !== topics.join(',') || !controller;
    topics = next;
    deviceId = String(config.deviceId || '');
    if (changed) listen();
    return { ok: true, canBroadcast: fs.existsSync(KEY_FILE) };
  });

  ipcMain.handle('messages-send', async (event, { topic, text, from }) => {
    const body = String(text || '').trim().slice(0, MAX_TEXT);
    if (!TOPIC_PATTERN.test(topic) || !body) return { ok: false, error: 'Nothing to send' };
    try {
      await publish(topic, { v: 1, d: deviceId, f: String(from || '').slice(0, 40), t: body });
      return { ok: true };
    } catch (e) {
      logEvent('warn', 'Messages: could not send', String(e.message || e));
      return { ok: false, error: 'Could not reach the relay. Check your connection.' };
    }
  });

  // Developer only: works when the private key file is present on this computer.
  ipcMain.handle('messages-broadcast', async (event, text) => {
    const body = String(text || '').trim().slice(0, MAX_TEXT);
    if (!body) return { ok: false, error: 'Nothing to send' };
    if (!fs.existsSync(KEY_FILE)) return { ok: false, error: 'This computer does not hold the broadcast key.' };
    try {
      const ts = Date.now();
      const sig = crypto.sign(null, Buffer.from(`${ts}|${body}`), crypto.createPrivateKey(fs.readFileSync(KEY_FILE))).toString('base64');
      await publish(BROADCAST_TOPIC, { v: 1, b: 1, t: body, ts, sig });
      logEvent('info', 'Broadcast sent');
      return { ok: true };
    } catch (e) {
      logEvent('error', 'Broadcast failed', String(e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  });

  return { stop: stopListening };
};
