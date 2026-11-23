/* ---------- Sync with PCC on your computer ---------- */
// The same protocol as the desktop app (see sync.js at the top of the repo):
// a sync code makes the relay channel and the encryption key; every message
// is JSON -> deflate-raw -> AES-256-GCM -> base64url, cut into pieces for
// ntfy.sh. Merging is the same too: each item has a fingerprint and the time
// it last changed; the newest wins, deletes included.

const RELAY = 'https://ntfy.sh';
const PIECE_CHARS = 3000;
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_TOMBSTONE_DAYS = 60;
const CODE_PATTERN = /^SYNC(-[A-HJ-NP-Z2-9]{4}){6}$/;

// What syncs, and where it lives here. Same names as on the computer.
const SYNC_COLLECTIONS = {
  tasks:       { kind: 'list', key: 'tasks', newFirst: true },
  agenda:      { kind: 'list', key: 'agenda' },
  notes:       { kind: 'list', key: 'notes', newFirst: true },
  countdowns:  { kind: 'list', key: 'countdowns' },
  channels:    { kind: 'list', key: 'msgChannels' },
  evaluations: { kind: 'map',  key: 'evaluations' },
  profile:     { kind: 'one',  key: 'settings' },
};

const sync = {
  code: Store.get('__syncCode', ''),
  deviceId: Store.get('__syncDevice', '') || (() => { const id = crypto.randomUUID(); Store.set('__syncDevice', id); return id; })(),
  deviceName: Store.get('__syncDeviceName', 'Android phone'),
  devices: Store.get('__syncDevices', {}),
  key: null, topic: null,
  pieces: new Map(), done: new Set(),
  lastEventTime: Store.get('__syncSince', 0),
  stream: null, timer: null, applying: false,
  lastSent: 0, lastReceived: 0,
};

/* ----- Encryption (WebCrypto) ----- */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function bytesFrom(stream){ return new Uint8Array(await new Response(stream).arrayBuffer()); }
const deflate = (bytes) => bytesFrom(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')));
const inflate = (bytes) => bytesFrom(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));

async function useCode(code){
  sync.code = code;
  if(!code){ sync.key = null; sync.topic = null; return; }
  const ikm = await crypto.subtle.importKey('raw', enc.encode(code), 'HKDF', false, ['deriveKey']);
  sync.key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('pcc-sync-salt'), info: enc.encode('pcc-sync-key') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(code + '|topic')));
  sync.topic = 'pccsync' + Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

async function seal(obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sync.key, await deflate(enc.encode(JSON.stringify(obj)))));
  const out = new Uint8Array(12 + body.length); out.set(iv); out.set(body, 12);   // WebCrypto puts the tag at the end, as Node's side expects
  let s = ''; for(let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unseal(text){
  const raw = fromB64url(text);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, sync.key, raw.subarray(12)));
  return JSON.parse(dec.decode(await inflate(plain)));
}

/* ----- Relay ----- */
async function syncSend(obj){
  if(!sync.key) return false;
  try {
    const sealed = await seal({ ...obj, from: sync.deviceId, name: sync.deviceName });
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
    const n = Math.ceil(sealed.length / PIECE_CHARS);
    for(let i = 0; i < n; i++){
      const res = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: sync.topic, message: JSON.stringify({ v: 1, s: id, i, n, d: sealed.slice(i * PIECE_CHARS, (i + 1) * PIECE_CHARS) }) }) });
      if(!res.ok) throw new Error('relay ' + res.status);
    }
    sync.lastSent = Date.now();
    return true;
  } catch(e){ console.warn('Sync: could not send', e); return false; }
}

async function handleEvent(event){
  if(event.event !== 'message' || event.topic !== sync.topic) return;
  if(event.time){ sync.lastEventTime = Math.max(sync.lastEventTime, event.time); Store.set('__syncSince', sync.lastEventTime); }
  let p; try { p = JSON.parse(event.message); } catch(e){ return; }
  if(!p || p.v !== 1 || typeof p.s !== 'string' || typeof p.d !== 'string' || sync.done.has(p.s)) return;
  const entry = sync.pieces.get(p.s) || { n: p.n, got: [] };
  entry.got[p.i] = p.d; sync.pieces.set(p.s, entry);
  if(entry.got.filter(x => x !== undefined).length < entry.n) return;
  sync.pieces.delete(p.s); sync.done.add(p.s);
  let msg; try { msg = await unseal(entry.got.join('')); } catch(e){ console.warn('Sync: could not open a message'); return; }
  if(!msg || msg.from === sync.deviceId) return;
  sync.devices[msg.from] = { name: String(msg.name || 'Another device').slice(0, 60), seen: Date.now() };
  Store.set('__syncDevices', sync.devices);
  await syncReceived(msg);
}

// One streaming connection while the app is open; reconnects when it drops.
async function syncListen(){
  if(!sync.topic) return;
  if(sync.stream) sync.stream.abort();
  const mine = sync.stream = new AbortController();
  const since = sync.lastEventTime ? sync.lastEventTime : '12h';
  try {
    const res = await fetch(`${RELAY}/${sync.topic}/json?since=${since}`, { signal: mine.signal });
    const reader = res.body.getReader();
    let buffer = '';
    for(;;){
      const { value, done } = await reader.read();
      if(done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for(const line of lines) if(line.trim()) { try { await handleEvent(JSON.parse(line)); } catch(e){} }
    }
  } catch(e){ if(mine.signal.aborted) return; }
  if(!mine.signal.aborted) setTimeout(syncListen, 5000);
}

/* ----- Fingerprints and merging (as on the computer) ----- */
function syncHash(value){
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function profileOf(){ const s = data.settings; return { name: s.name || '', weatherCity: s.weatherCity || '', accent: s.prefs.accent, accentFromWindows: !!s.prefs.accentFromWindows }; }

function syncItems(name){
  const col = SYNC_COLLECTIONS[name];
  if(col.kind === 'list') return new Map((data[col.key] || []).filter(x => x && x.id).map(x => [x.id, x]));
  if(col.kind === 'map') return new Map(Object.entries(data[col.key] || {}));
  return new Map([['me', profileOf()]]);
}

function syncWrite(name, items){
  const col = SYNC_COLLECTIONS[name];
  if(col.kind === 'one'){
    const v = items.get('me') || {};
    data.settings.name = v.name || ''; data.settings.weatherCity = v.weatherCity || '';
    if(v.accent) data.settings.prefs.accent = v.accent;
    data.settings.prefs.accentFromWindows = !!v.accentFromWindows;
  } else if(col.kind === 'map') data[col.key] = Object.fromEntries(items);
  else {
    const before = data[col.key] || [];
    const kept = before.filter(x => items.has(x.id)).map(x => items.get(x.id));
    const known = new Set(kept.map(x => x.id));
    const added = [...items.values()].filter(x => !known.has(x.id));
    data[col.key] = col.newFirst ? [...added, ...kept] : [...kept, ...added];
  }
  Store.set(col.key, data[col.key]);
}

const syncMeta = () => Store.get('__syncMeta', {});
const saveSyncMeta = (m) => Store.set('__syncMeta', m);

function syncDetect(stamp = Date.now()){
  const meta = syncMeta(), changes = [], cutoff = Date.now() - SYNC_TOMBSTONE_DAYS * 86400000;
  for(const name of Object.keys(SYNC_COLLECTIONS)){
    const m = meta[name] || (meta[name] = {});
    const items = syncItems(name);
    for(const [id, v] of items){
      const h = syncHash(v);
      if(!m[id] || m[id].h !== h || m[id].del){ m[id] = { h, t: stamp }; changes.push({ c: name, id, t: stamp, v }); }
    }
    for(const [id, e] of Object.entries(m)){
      if(e.del){ if(e.t < cutoff) delete m[id]; continue; }
      if(!items.has(id)){ m[id] = { h: '', t: stamp, del: true }; changes.push({ c: name, id, t: stamp, del: true }); }
    }
  }
  saveSyncMeta(meta);
  return changes;
}

function syncSnapshot(){
  syncDetect();
  const meta = syncMeta(), items = [];
  for(const name of Object.keys(SYNC_COLLECTIONS)){
    const current = syncItems(name);
    for(const [id, e] of Object.entries(meta[name] || {})){
      if(e.del) items.push({ c: name, id, t: e.t, del: true });
      else if(current.has(id)) items.push({ c: name, id, t: e.t, v: current.get(id) });
    }
  }
  return items;
}

function syncApply(items){
  syncDetect();
  const meta = syncMeta(), touched = new Set(), incoming = new Map(), working = new Map();
  for(const it of items || []){
    if(!SYNC_COLLECTIONS[it.c] || typeof it.id !== 'string' || typeof it.t !== 'number') continue;
    incoming.set(it.c + ':' + it.id, it);
    const m = (meta[it.c] = meta[it.c] || {});
    if(m[it.id] && m[it.id].t >= it.t) continue;
    if(!working.has(it.c)) working.set(it.c, syncItems(it.c));
    const current = working.get(it.c);
    if(it.del){ current.delete(it.id); m[it.id] = { h: '', t: it.t, del: true }; }
    else { current.set(it.id, it.v); m[it.id] = { h: syncHash(it.v), t: it.t }; }
    touched.add(it.c);
  }
  sync.applying = true;
  for(const [name, current] of working) syncWrite(name, current);
  sync.applying = false;
  saveSyncMeta(meta);
  if(touched.size){ sync.lastReceived = Date.now(); render(); }
  const back = [];
  for(const name of Object.keys(SYNC_COLLECTIONS)){
    const current = syncItems(name);
    for(const [id, e] of Object.entries(meta[name] || {})){
      const theirs = incoming.get(name + ':' + id);
      if(theirs && theirs.t >= e.t) continue;
      if(e.del) back.push({ c: name, id, t: e.t, del: true });
      else if(current.has(id)) back.push({ c: name, id, t: e.t, v: current.get(id) });
    }
  }
  return back;
}

async function syncReceived(msg){
  if(msg.type === 'hello'){ setTimeout(() => syncSend({ type: 'snapshot', items: syncSnapshot() }), 800 + Math.random() * 2000); return; }
  if(msg.type === 'changes' || msg.type === 'snapshot'){
    const back = syncApply(msg.items);
    if(msg.type === 'snapshot' && back.length) syncSend({ type: 'changes', items: back });
  }
}

/* ----- Our own changes ----- */
// Every save goes through Store.set; changes to synced things are sent a moment later.
const SYNC_KEYS = new Set(Object.values(SYNC_COLLECTIONS).map(c => c.key));
(function watchSaves(){
  const original = Store.set.bind(Store);
  Store.set = (key, value) => { const ok = original(key, value); if(SYNC_KEYS.has(key) && sync.key && !sync.applying) syncSoon(); return ok; };
})();

function syncSoon(){ clearTimeout(sync.timer); sync.timer = setTimeout(syncFlush, SYNC_DEBOUNCE_MS); }

async function syncFlush(){
  const pending = Store.get('__syncPending', []);
  const changes = [...pending, ...syncDetect()];
  if(!changes.length) return;
  const latest = new Map(); for(const c of changes) latest.set(c.c + ':' + c.id, c);
  const items = [...latest.values()];
  Store.set('__syncPending', (await syncSend({ type: 'changes', items })) ? [] : items);
  renderSyncCard();
}

/* ----- Pairing ----- */
async function syncJoin(code){
  const clean = String(code || '').toUpperCase().replace(/\s+/g, '').replace(/^SYNC(?!-)/, 'SYNC-');
  if(!CODE_PATTERN.test(clean)) return "That doesn't look like a sync code. It starts with SYNC- and has six groups of four.";
  Store.set('__syncMeta', {}); syncDetect(1);           // what's on the phone counts as older than the group's
  Store.set('__syncCode', clean); Store.set('__syncSince', 0); sync.lastEventTime = 0; sync.devices = {}; Store.set('__syncDevices', {});
  await useCode(clean);
  syncListen();
  await syncSend({ type: 'hello' });
  return '';
}

async function syncLeave(){
  if(sync.stream) sync.stream.abort();
  await useCode('');
  ['__syncCode', '__syncMeta', '__syncPending', '__syncSince', '__syncDevices'].forEach(k => localStorage.removeItem(k));
  sync.devices = {}; sync.lastEventTime = 0;
}

async function initSync(){
  if(!sync.code) return;
  await useCode(sync.code);
  syncListen();
  syncFlush();
  syncSend({ type: 'hello' });
}
