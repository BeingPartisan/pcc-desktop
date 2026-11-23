// Sync: your own devices share tasks, deadlines, evaluation patterns and
// marks, countdowns, message channels, notes, and your name, city and colour.
//
// There's no PCC server. Devices pair with a sync code (Settings > Sync),
// and changes travel through the same public relay as messages (ntfy.sh),
// end-to-end encrypted: the code makes both the channel's name and the key,
// and it never leaves your devices. The relay only ever sees scrambled bytes.
//
// This module is the transport. The renderer (renderer/js/sync.js) decides
// what changed and how to merge what arrives.
//
// On the wire (the protocol the Android app will speak too):
//   channel   'pccsync' + first 24 hex characters of SHA-256(code + '|topic')
//   key       HKDF-SHA256(code, salt 'pcc-sync-salt', info 'pcc-sync-key'), 32 bytes
//   message   JSON -> deflate (raw) -> AES-256-GCM (12-byte IV first, 16-byte tag last) -> base64url,
//             cut into pieces of up to PIECE_CHARS, each sent as the relay message
//             { v: 1, s: <message id>, i: <piece number>, n: <pieces>, d: <piece> }
//   contents  { type: 'hello' | 'changes' | 'snapshot', from: <device id>, name: <device name>, ... }
//
// The relay keeps messages for about 12 hours, so on starting up a device
// reads the last 12 hours and says hello; devices that are on reply with
// everything they have, so one that was off for longer still catches up.

const { app, ipcMain, safeStorage } = require('electron');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PIECE_CHARS = 3000;              // the relay takes up to 4 KB per message
const PIECES_EXPIRE_MS = 2 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I to mix up
const CODE_PATTERN = /^SYNC(-[A-HJ-NP-Z2-9]{4}){6}$/;

module.exports = function registerSync({ logEvent, getMainWindow, messaging }) {
  const FILE = path.join(app.getPath('userData'), 'sync.json');
  let saved = load();          // { code, deviceId, deviceName, devices: { id: { name, seen } } }
  let key = null, topic = null;
  const pieces = new Map();    // message id -> { n, got: [], at }
  const done = new Set();      // message ids already delivered
  let started = false;

  function load() {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
    if (data.codeSecret && safeStorage.isEncryptionAvailable()) {
      try { data.code = safeStorage.decryptString(Buffer.from(data.codeSecret, 'base64')); } catch (e) { data.code = ''; }
    }
    return { code: data.code || '', deviceId: data.deviceId || crypto.randomUUID(), deviceName: data.deviceName || os.hostname(), devices: data.devices || {} };
  }

  function save() {
    // The code is the key to everything synced, so it's stored encrypted by Windows.
    const out = { deviceId: saved.deviceId, deviceName: saved.deviceName, devices: saved.devices };
    if (saved.code) {
      if (safeStorage.isEncryptionAvailable()) out.codeSecret = safeStorage.encryptString(saved.code).toString('base64');
      else out.code = saved.code;
    }
    try { fs.writeFileSync(FILE, JSON.stringify(out, null, 2)); } catch (e) { logEvent('warn', 'Sync: could not save its settings', String(e)); }
  }

  function useCode(code) {
    key = code ? crypto.hkdfSync('sha256', code, 'pcc-sync-salt', 'pcc-sync-key', 32) : null;
    key = key ? Buffer.from(key) : null;
    topic = code ? 'pccsync' + crypto.createHash('sha256').update(code + '|topic').digest('hex').slice(0, 24) : null;
  }
  useCode(saved.code);

  const toRenderer = (channel, payload) => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };
  const deviceList = () => Object.entries(saved.devices).map(([id, d]) => ({ id, name: d.name, seen: d.seen })).sort((a, b) => b.seen - a.seen);

  // --- Encryption ---

  function seal(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(zlib.deflateRawSync(Buffer.from(JSON.stringify(obj)))), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
  }

  function open(text) {
    const raw = Buffer.from(text, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
    return JSON.parse(zlib.inflateRawSync(plain).toString('utf8'));
  }

  // --- Sending and receiving ---

  async function send(obj) {
    if (!key) return { ok: false, error: 'Not syncing' };
    const sealed = seal({ ...obj, from: saved.deviceId, name: saved.deviceName });
    const id = crypto.randomBytes(6).toString('hex');
    const n = Math.ceil(sealed.length / PIECE_CHARS);
    try {
      for (let i = 0; i < n; i++) await messaging.publish(topic, { v: 1, s: id, i, n, d: sealed.slice(i * PIECE_CHARS, (i + 1) * PIECE_CHARS) });
      return { ok: true };
    } catch (e) {
      logEvent('warn', 'Sync: could not reach the relay', String(e.message || e));
      return { ok: false, error: 'Could not reach the relay' };
    }
  }

  function handle(event) {
    if (!key || event.topic !== topic) return;
    let p;
    try { p = JSON.parse(event.message); } catch (e) { return; }
    if (!p || p.v !== 1 || typeof p.s !== 'string' || typeof p.d !== 'string' || !(p.n >= 1 && p.n <= 200) || done.has(p.s)) return;
    const now = Date.now();
    for (const [id, entry] of pieces) if (now - entry.at > PIECES_EXPIRE_MS) pieces.delete(id);
    const entry = pieces.get(p.s) || { n: p.n, got: [], at: now };
    entry.got[p.i] = p.d;
    pieces.set(p.s, entry);
    if (entry.got.filter((x) => x !== undefined).length < entry.n) return;
    pieces.delete(p.s);
    done.add(p.s);
    if (done.size > 2000) done.delete(done.values().next().value);
    let msg;
    try { msg = open(entry.got.join('')); } catch (e) { logEvent('warn', 'Sync: a message could not be opened (a different sync code?)'); return; }
    if (!msg || msg.from === saved.deviceId) return;   // our own, coming back
    saved.devices[msg.from] = { name: String(msg.name || 'Another device').slice(0, 60), seen: Date.now() };
    save();
    toRenderer('sync-devices', deviceList());
    toRenderer('sync-received', msg);
  }

  messaging.setExtra({ topics: () => (topic ? [topic] : []), handles: (t) => !!topic && t === topic, handle });

  // Once the app has loaded: catch up on the last 12 hours, then say hello.
  async function start() {
    if (!topic || started) return;
    started = true;
    messaging.refresh();
    try {
      for (const event of await messaging.poll(topic, '12h')) handle(event);
    } catch (e) { logEvent('warn', 'Sync: could not catch up', String(e.message || e)); }
    await send({ type: 'hello' });
    logEvent('info', 'Sync: connected');
  }

  function newCode() {
    const bytes = crypto.randomBytes(24);
    const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return 'SYNC-' + chars.match(/.{4}/g).join('-');
  }

  const status = () => ({ paired: !!saved.code, deviceId: saved.deviceId, deviceName: saved.deviceName, devices: deviceList() });

  // --- From the app ---

  ipcMain.handle('sync-status', () => status());
  ipcMain.handle('sync-start', async () => { await start(); return status(); });
  ipcMain.handle('sync-send', (event, obj) => send(obj && typeof obj === 'object' ? obj : {}));
  ipcMain.handle('sync-show-code', () => saved.code);

  ipcMain.handle('sync-create', async () => {
    saved.code = newCode(); saved.devices = {};
    useCode(saved.code); save(); started = false;
    logEvent('info', 'Sync: started a new sync group');
    await start();
    return { ...status(), code: saved.code };
  });

  ipcMain.handle('sync-join', async (event, code) => {
    const clean = String(code || '').toUpperCase().replace(/\s+/g, '').replace(/^SYNC(?!-)/, 'SYNC-');
    if (!CODE_PATTERN.test(clean)) return { ok: false, error: "That doesn't look like a sync code. It starts with SYNC- and has six groups of four." };
    saved.code = clean; saved.devices = {};
    useCode(clean); save(); started = false;
    logEvent('info', 'Sync: joined a sync group');
    await start();
    return { ok: true, ...status() };
  });

  ipcMain.handle('sync-leave', () => {
    saved.code = ''; saved.devices = {};
    useCode(''); save(); started = false;
    messaging.refresh();
    logEvent('info', 'Sync: stopped on this device');
    return status();
  });

  ipcMain.handle('sync-rename', (event, name) => {
    const clean = String(name || '').trim().slice(0, 40);
    if (clean) { saved.deviceName = clean; save(); }
    return status();
  });

  return { status };
};
