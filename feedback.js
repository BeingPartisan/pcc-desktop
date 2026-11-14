// Feedback: bug reports and suggestions from any copy of PCC to the developer.
//
// Reports travel over the same public relay as messages (see messaging.js),
// on a channel whose name is in this file and therefore public. Two things
// make that workable:
//
//   Only the developer can read them. Each report is encrypted on the
//   sender's computer to FEEDBACK_PUBLIC_KEY. The matching private key is a
//   file in the developer's app data folder and is never in the repository.
//   (A fresh one-time key is made for every report; it and the public key
//   give a shared secret that only the private key can also work out, and
//   the report is sealed with that.)
//
//   Reports survive the developer's computer being off. The relay only
//   keeps messages for about 12 hours, so the sender keeps each report in
//   an outbox file and sends it again once a day until the developer's copy
//   confirms it. A confirmation is a list of report ids signed with the
//   developer's broadcast key, so nobody else can make a copy stop trying.
//
// What travels:
//   report:        { v: 1, fb: 1, id, e: <one-time public key>, n: <nonce>, c: <sealed report>, g: <seal check> }
//   confirmation:  { v: 1, ack: [ids], ts, sig }
// Inside a report: { id, type, text, name, version, os, sentAt, log? }, compressed.

const { ipcMain, app } = require('electron');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Development runs can use separate channels (PCC_FEEDBACK_TEST=anything), so trying
// the feature out doesn't put test reports in the real inbox. The installed app ignores this.
const TEST = !app.isPackaged && process.env.PCC_FEEDBACK_TEST ? '-' + String(process.env.PCC_FEEDBACK_TEST).replace(/[^a-z0-9]/gi, '').slice(0, 20) : '';
const FEEDBACK_TOPIC = 'pcc-feedback-54a53c2824e13c25' + TEST;
const ACK_TOPIC = 'pcc-feedback-ack-06c454cf4053cc1c' + TEST;
const FEEDBACK_PUBLIC_KEY = 'MCowBQYDK2VuAyEA5U14SeaW+qhYLeykKnSIkmDrbOe/HB01ymtksukMp0k='; // X25519, SPKI DER, base64
const TYPES = ['bug', 'idea', 'other'];
const MAX_TEXT = 1200;
const MAX_MESSAGE = 3800;                      // the relay rejects messages over 4 KB
const RESEND_AFTER_MS = 20 * 60 * 60 * 1000;   // an unconfirmed report is sent again after this long
const GIVE_UP_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const ACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_REPORTS_PER_HOUR = 60;               // on the receiving side, against a flood of junk

module.exports = function registerFeedback({ logEvent, getMainWindow, getLog, messaging, broadcastPublicKey }) {
  const dir = app.getPath('userData');
  const KEY_FILE = path.join(dir, 'pcc-feedback-key.pem');          // developer only
  const SIGN_KEY_FILE = path.join(dir, 'pcc-broadcast-key.pem');     // developer only; signs confirmations
  const OUTBOX_FILE = path.join(dir, 'pcc-feedback-outbox.json');
  const INBOX_DIR = path.join(dir, 'feedback');
  const REPORTS_FILE = path.join(INBOX_DIR, 'reports.jsonl');        // one report per line
  const DONE_FILE = path.join(INBOX_DIR, 'done.json');

  const isDeveloper = () => fs.existsSync(KEY_FILE);
  const toWindow = (channel, payload) => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return fallback; } };

  /* ---------- Sending (every copy) ---------- */

  let outbox = readJson(OUTBOX_FILE, []);   // [{ id, payload, createdAt, lastSent }]
  const saveOutbox = () => { try { fs.writeFileSync(OUTBOX_FILE, JSON.stringify(outbox)); } catch (e) { logEvent('warn', 'Feedback: could not save the outbox', String(e)); } };

  function seal(report) {
    const recipient = crypto.createPublicKey({ key: Buffer.from(FEEDBACK_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
    const oneTime = crypto.generateKeyPairSync('x25519');
    const secret = crypto.diffieHellman({ privateKey: oneTime.privateKey, publicKey: recipient });
    const key = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'pcc-feedback', 32));
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const sealed = Buffer.concat([cipher.update(zlib.deflateRawSync(Buffer.from(JSON.stringify(report)))), cipher.final()]);
    return {
      v: 1, fb: 1, id: report.id,
      e: oneTime.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      n: nonce.toString('base64'), c: sealed.toString('base64'), g: cipher.getAuthTag().toString('base64'),
    };
  }

  // Recent log lines, with email addresses blanked out.
  function logTail(maxChars) {
    const lines = getLog().slice(-40).map((e) => `${new Date(e.timestamp).toISOString().slice(11, 19)} ${e.level} ${e.message}${e.meta ? ' ' + (typeof e.meta === 'string' ? e.meta : JSON.stringify(e.meta)) : ''}`);
    return lines.join('\n').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').slice(-maxChars);
  }

  async function trySend(item) {
    try {
      await messaging.publish(FEEDBACK_TOPIC, item.payload);
      item.lastSent = Date.now();
      saveOutbox();
      return true;
    } catch (e) {
      logEvent('warn', 'Feedback: could not send yet, will retry', String(e.message || e));
      return false;
    }
  }

  // Sends again anything not confirmed for a day; forgets reports after two weeks.
  async function resendPending() {
    const now = Date.now();
    const before = outbox.length;
    outbox = outbox.filter((item) => now - item.createdAt < GIVE_UP_AFTER_MS);
    if (outbox.length !== before) saveOutbox();
    for (const item of outbox) {
      if (!item.lastSent || now - item.lastSent > RESEND_AFTER_MS) await trySend(item);
    }
  }

  ipcMain.handle('feedback-send', async (event, input) => {
    const text = String((input && input.text) || '').trim().slice(0, MAX_TEXT);
    if (!text) return { ok: false, error: 'Write something first' };
    const report = {
      id: crypto.randomBytes(9).toString('base64url'),
      type: TYPES.includes(input.type) ? input.type : 'other',
      text,
      name: String(input.name || '').trim().slice(0, 40),
      version: app.getVersion(),
      os: `${os.type()} ${os.release()}`,
      sentAt: Date.now(),
    };
    // The log is optional and the first thing to shrink if the report is too big for one message.
    let payload;
    for (let logChars = input.includeLog ? 4000 : 0; ; logChars = Math.floor(logChars / 2)) {
      if (logChars >= 200) report.log = logTail(logChars); else delete report.log;
      payload = seal(report);
      if (JSON.stringify(payload).length <= MAX_MESSAGE || !report.log) break;
    }
    if (JSON.stringify(payload).length > MAX_MESSAGE) return { ok: false, error: 'That is too long to send. Try a shorter description.' };

    const item = { id: report.id, payload, createdAt: Date.now(), lastSent: 0 };
    outbox.push(item);
    saveOutbox();
    messaging.refresh(); // start listening for the confirmation
    const sent = await trySend(item);
    logEvent('info', sent ? 'Feedback sent' : 'Feedback saved, will be sent when the relay is reachable');
    return { ok: true, sent, pending: outbox.length };
  });

  ipcMain.handle('feedback-status', () => ({ pending: outbox.length, developer: isDeveloper() }));

  function handleAck(payload) {
    try {
      if (!Array.isArray(payload.ack) || typeof payload.ts !== 'number' || typeof payload.sig !== 'string') return;
      if (Math.abs(Date.now() - payload.ts) > ACK_MAX_AGE_MS) return;
      const ids = payload.ack.map(String).slice(0, 50);
      const key = crypto.createPublicKey({ key: Buffer.from(broadcastPublicKey, 'base64'), format: 'der', type: 'spki' });
      if (!crypto.verify(null, Buffer.from(`ack|${payload.ts}|${ids.join(',')}`), key, Buffer.from(payload.sig, 'base64'))) return;
      const before = outbox.length;
      outbox = outbox.filter((item) => !ids.includes(item.id));
      if (outbox.length !== before) {
        saveOutbox();
        logEvent('info', 'Feedback was received by the developer');
        toWindow('feedback-delivered', { pending: outbox.length });
        if (!outbox.length) messaging.refresh(); // nothing left to wait for
      }
    } catch (e) { /* not a confirmation we can use */ }
  }

  /* ---------- Receiving (the developer's copy only) ---------- */

  const known = new Set();        // report ids already saved
  let toConfirm = [];
  let confirmTimer = null;
  let recentArrivals = [];

  function loadReports() {
    let lines = [];
    try { lines = fs.readFileSync(REPORTS_FILE, 'utf-8').split('\n').filter(Boolean); } catch (e) { /* none yet */ }
    const reports = [];
    for (const line of lines) { try { reports.push(JSON.parse(line)); } catch (e) { /* skip a damaged line */ } }
    return reports;
  }

  function open(payload) {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
    const oneTime = crypto.createPublicKey({ key: Buffer.from(payload.e, 'base64'), format: 'der', type: 'spki' });
    const secret = crypto.diffieHellman({ privateKey, publicKey: oneTime });
    const key = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'pcc-feedback', 32));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.n, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.g, 'base64'));
    const packed = Buffer.concat([decipher.update(Buffer.from(payload.c, 'base64')), decipher.final()]);
    return JSON.parse(zlib.inflateRawSync(packed, { maxOutputLength: 64 * 1024 }).toString());
  }

  // Tell senders their reports arrived: one signed message for everything from the last few seconds.
  function confirmSoon(id) {
    toConfirm.push(id);
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(async () => {
      const ids = [...new Set(toConfirm)].slice(0, 50);
      toConfirm = [];
      if (!fs.existsSync(SIGN_KEY_FILE)) { logEvent('warn', 'Feedback: no signing key here, so senders are not told their reports arrived'); return; }
      try {
        const ts = Date.now();
        const sig = crypto.sign(null, Buffer.from(`ack|${ts}|${ids.join(',')}`), crypto.createPrivateKey(fs.readFileSync(SIGN_KEY_FILE))).toString('base64');
        await messaging.publish(ACK_TOPIC, { v: 1, ack: ids, ts, sig });
      } catch (e) { logEvent('warn', 'Feedback: could not confirm receipt', String(e.message || e)); }
    }, 2500);
  }

  function handleReport(payload) {
    if (!isDeveloper() || payload.fb !== 1) return;
    let report;
    try { report = open(payload); } catch (e) { return; } // junk, or not sealed to our key
    if (!report || typeof report.text !== 'string' || typeof report.id !== 'string') return;
    const id = report.id.slice(0, 24);
    if (known.has(id)) return confirmSoon(id); // a resend: the sender missed our confirmation
    const now = Date.now();
    recentArrivals = recentArrivals.filter((t) => now - t < 3600 * 1000);
    if (recentArrivals.length >= MAX_REPORTS_PER_HOUR) return;
    recentArrivals.push(now);

    const clean = {
      id, type: TYPES.includes(report.type) ? report.type : 'other',
      text: report.text.slice(0, MAX_TEXT), name: String(report.name || '').slice(0, 40),
      version: String(report.version || '').slice(0, 20), os: String(report.os || '').slice(0, 60),
      sentAt: Number(report.sentAt) || now, receivedAt: now,
      log: typeof report.log === 'string' ? report.log.slice(0, 5000) : '',
    };
    try {
      fs.mkdirSync(INBOX_DIR, { recursive: true });
      fs.appendFileSync(REPORTS_FILE, JSON.stringify(clean) + '\n');
    } catch (e) { logEvent('error', 'Feedback: could not save a report', String(e)); return; }
    known.add(id);
    logEvent('info', `Feedback received (${clean.type})`);
    toWindow('feedback-received', clean);
    confirmSoon(id);
  }

  ipcMain.handle('feedback-list', () => {
    if (!isDeveloper()) return { reports: [], done: [], folder: '' };
    return { reports: loadReports().slice(-300).reverse(), done: readJson(DONE_FILE, []), folder: INBOX_DIR };
  });

  ipcMain.handle('feedback-mark', (event, { id, done }) => {
    if (!isDeveloper()) return { ok: false };
    const list = new Set(readJson(DONE_FILE, []));
    if (done) list.add(String(id)); else list.delete(String(id));
    try { fs.mkdirSync(INBOX_DIR, { recursive: true }); fs.writeFileSync(DONE_FILE, JSON.stringify([...list])); } catch (e) { return { ok: false }; }
    return { ok: true };
  });

  // Reports sent while this computer was off are still on the relay for about 12 hours.
  async function catchUp() {
    if (!isDeveloper()) return;
    try {
      for (const event of await messaging.poll(FEEDBACK_TOPIC, '12h')) {
        try { handleReport(JSON.parse(event.message)); } catch (e) { /* not a report */ }
      }
    } catch (e) { logEvent('warn', 'Feedback: could not check for reports', String(e.message || e)); }
  }

  /* ---------- Wiring ---------- */

  if (isDeveloper()) for (const report of loadReports()) known.add(report.id);

  // messaging.js keeps the one connection to the relay; this adds our channels to it.
  messaging.setExtra({
    topics: () => [...(isDeveloper() ? [FEEDBACK_TOPIC] : []), ...(outbox.length ? [ACK_TOPIC] : [])],
    handles: (topic) => topic === FEEDBACK_TOPIC || topic === ACK_TOPIC,
    handle: (event) => {
      let payload;
      try { payload = JSON.parse(event.message); } catch (e) { return; }
      if (!payload || payload.v !== 1) return;
      if (event.topic === ACK_TOPIC) handleAck(payload); else handleReport(payload);
    },
  });

  app.whenReady().then(() => {
    setTimeout(() => { catchUp(); resendPending(); }, 20 * 1000);
    setInterval(resendPending, 3 * 60 * 60 * 1000);
  });

  return { resendPending, catchUp };
};
