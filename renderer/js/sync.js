/* ---------- Sync between your own devices ---------- */
// The main process (sync.js) pairs devices and carries encrypted messages;
// this file decides what changed here and merges what arrives.
//
// What syncs: tasks, deadlines (with their ticks), evaluation patterns and
// marks, countdowns, message channels, notes, and your name, city and colour.
// Passwords, the Digiicampus session and this computer's own settings
// (island, visualiser, Desktop mode, Performance) stay on each device.
//
// How: every synced item (a task, a deadline, one course's evaluation...)
// gets a fingerprint and the time it last changed, kept in SYNC_META_KEY.
// Whenever one of the synced lists is saved, they're compared with those
// fingerprints; what's new, edited or deleted is sent. Arriving items replace
// ours only if they changed more recently (deletes too, so nothing comes
// back). A device saying hello gets everything we have, and anything it
// turns out to be missing from us is sent back to it.

const SYNC_META_KEY = '__syncMeta';        // { [collection]: { [id]: { h: fingerprint, t: changed at, del?: true } } }
const SYNC_PENDING_KEY = '__syncPending';  // changes that couldn't be sent yet (offline), sent on the next start
const SYNC_DEBOUNCE_MS = 2500;
const SYNC_TOMBSTONE_DAYS = 60;

// Each synced collection: where it lives in the app, how to save it, what to redraw.
// list: an array of items with ids. map: an object keyed by name (evaluations). one: a single item.
const SYNC_COLLECTIONS = {
  tasks:      { kind: 'list', store: 'tasks',       get: () => state.tasks,       set: v => { state.tasks = v; },       redraw: () => renderTasks(), newFirst: true },
  agenda:     { kind: 'list', store: 'agenda',      get: () => state.agenda,      set: v => { state.agenda = v; },      redraw: () => renderAgenda() },
  notes:      { kind: 'list', store: 'notes',       get: () => state.notes,       set: v => { state.notes = v; },       redraw: () => renderNotes(), newFirst: true },
  countdowns: { kind: 'list', store: 'countdowns',  get: () => moments.countdowns, set: v => { moments.countdowns = v; }, redraw: () => { renderCountdowns(); pushIsland(); } },
  channels:   { kind: 'list', store: 'msgChannels', get: () => msg.channels,      set: v => { msg.channels = v; },      redraw: () => { configureMessages(); pushIsland(); } },
  evaluations:{ kind: 'map',  store: 'evaluations', get: () => evaluations,       set: v => { evaluations = v; },       redraw: () => { renderEvaluation(); renderAgenda(); } },
  profile:    { kind: 'one',  store: 'settings',
    get: () => ({ name: state.settings.name || '', weatherCity: state.settings.weatherCity || '', accent: prefs().accent, accentFromWindows: !!prefs().accentFromWindows }),
    set: v => {
      state.settings.name = v.name || ''; state.settings.weatherCity = v.weatherCity || '';
      if(v.accent) prefs().accent = v.accent;
      prefs().accentFromWindows = !!v.accentFromWindows;
    },
    redraw: () => {
      applyAppearance(); renderAppearanceSettings(); renderGreeting();
      const n = document.getElementById('set-name'), c = document.getElementById('set-city');
      if(n) n.value = state.settings.name; if(c) c.value = state.settings.weatherCity;
      pushIsland();
    } },
};
const SYNC_STORE_KEYS = new Set(Object.values(SYNC_COLLECTIONS).map(c => c.store));

let syncState = { paired: false, devices: [], deviceId: '', deviceName: '', lastSent: 0, lastReceived: 0 };
let syncTimer = null;
let syncApplying = false;   // while merging what arrived: don't treat it as our own change

/* ----- Fingerprints ----- */

function syncHash(value){
  // FNV-1a over the JSON: enough to notice that something changed.
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// The collection's items as a Map of id -> value.
function syncItems(name){
  const col = SYNC_COLLECTIONS[name];
  const value = col.get();
  if(col.kind === 'list') return new Map((value || []).filter(x => x && x.id).map(x => [x.id, x]));
  if(col.kind === 'map') return new Map(Object.entries(value || {}));
  return new Map([['me', value]]);
}

const syncMeta = () => Store.get(SYNC_META_KEY, {});
const saveSyncMeta = (meta) => Store.set(SYNC_META_KEY, meta);

// Compare with the fingerprints; returns the items that changed, stamped `stamp` (now, usually).
function syncDetect(stamp = Date.now()){
  const meta = syncMeta();
  const changes = [];
  const cutoff = Date.now() - SYNC_TOMBSTONE_DAYS * 86400000;
  for(const name of Object.keys(SYNC_COLLECTIONS)){
    const m = meta[name] || (meta[name] = {});
    const items = syncItems(name);
    for(const [id, v] of items){
      const h = syncHash(v);
      if(!m[id] || m[id].h !== h || m[id].del){ m[id] = { h, t: stamp }; changes.push({ c: name, id, t: stamp, v }); }
    }
    for(const [id, entry] of Object.entries(m)){
      if(entry.del){ if(entry.t < cutoff) delete m[id]; continue; }   // remembered deletes are forgotten after two months
      if(!items.has(id)){ m[id] = { h: '', t: stamp, del: true }; changes.push({ c: name, id, t: stamp, del: true }); }
    }
  }
  saveSyncMeta(meta);
  return changes;
}

// Everything we have, deletes included: the reply to a hello.
function syncSnapshot(){
  syncDetect();
  const meta = syncMeta();
  const items = [];
  for(const name of Object.keys(SYNC_COLLECTIONS)){
    const current = syncItems(name);
    for(const [id, entry] of Object.entries(meta[name] || {})){
      if(entry.del) items.push({ c: name, id, t: entry.t, del: true });
      else if(current.has(id)) items.push({ c: name, id, t: entry.t, v: current.get(id) });
    }
  }
  return items;
}

/* ----- Sending ----- */

// Called (via Store.set below) whenever one of the synced lists is saved.
function syncSoon(){
  if(!syncState.paired || syncApplying) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncFlush, SYNC_DEBOUNCE_MS);
}

async function syncFlush(){
  const changes = [...Store.get(SYNC_PENDING_KEY, []), ...syncDetect()];
  if(!changes.length) return;
  // Only the latest of each item.
  const latest = new Map();
  for(const ch of changes) latest.set(ch.c + ':' + ch.id, ch);
  const items = [...latest.values()];
  const result = await window.pcc.syncSend({ type: 'changes', items });
  if(result.ok){ Store.set(SYNC_PENDING_KEY, []); syncState.lastSent = Date.now(); }
  else Store.set(SYNC_PENDING_KEY, items);   // offline: try again on the next start or change
  renderSyncSettings();
}

/* ----- Receiving ----- */

// Merge items from another device. Returns those it has older versions of (or lacks), to send back.
function syncApply(items){
  syncDetect();   // our own unsent edits get their stamp first, so they're weighed fairly
  const meta = syncMeta();
  const touched = new Set();
  const incoming = new Map();
  const working = new Map();   // collection -> its items, merged; each list is written back once, in the order things arrived
  for(const it of items || []){
    const col = SYNC_COLLECTIONS[it.c];
    if(!col || typeof it.id !== 'string' || typeof it.t !== 'number') continue;
    incoming.set(it.c + ':' + it.id, it);
    const m = (meta[it.c] = meta[it.c] || {});
    const mine = m[it.id];
    if(mine && mine.t >= it.t) continue;   // ours is as new or newer
    if(!working.has(it.c)) working.set(it.c, syncItems(it.c));
    const current = working.get(it.c);
    if(it.del){ current.delete(it.id); m[it.id] = { h: '', t: it.t, del: true }; }
    else { current.set(it.id, it.v); m[it.id] = { h: syncHash(it.v), t: it.t }; }
    touched.add(it.c);
  }
  for(const [name, current] of working) syncWrite(name, current);
  saveSyncMeta(meta);
  syncApplying = true;
  try {
    for(const name of touched){
      const col = SYNC_COLLECTIONS[name];
      Store.set(col.store, col.store === 'settings' ? state.settings : col.get());
      try { col.redraw(); } catch(e){ console.error('Sync: redraw failed for ' + name, e); }
    }
  } finally { syncApplying = false; }
  if(touched.size){ syncState.lastReceived = Date.now(); renderSyncSettings(); }

  // What they're missing or have older: everything of ours newer than theirs.
  const back = [];
  for(const name of Object.keys(SYNC_COLLECTIONS)){
    const current = syncItems(name);
    for(const [id, entry] of Object.entries(meta[name] || {})){
      const theirs = incoming.get(name + ':' + id);
      if(theirs && theirs.t >= entry.t) continue;
      back.push(entry.del ? { c: name, id, t: entry.t, del: true } : { c: name, id, t: entry.t, v: current.get(id) });
    }
  }
  return back.filter(b => b.del || b.v !== undefined);
}

// Put a collection's merged items back where the app keeps them, keeping the order it had.
function syncWrite(name, items){
  const col = SYNC_COLLECTIONS[name];
  if(col.kind === 'one'){ col.set(items.get('me') || {}); return; }
  if(col.kind === 'map'){ col.set(Object.fromEntries(items)); return; }
  const before = col.get() || [];
  const kept = before.filter(x => items.has(x.id)).map(x => items.get(x.id));
  const known = new Set(kept.map(x => x.id));
  const added = [...items.values()].filter(x => !known.has(x.id));
  col.set(col.newFirst ? [...added, ...kept] : [...kept, ...added]);
}

async function syncReceived(message){
  if(!message || !syncState.paired) return;
  if(message.type === 'hello'){
    // Another device has just started: send it everything, after a moment so several replies don't collide.
    setTimeout(() => window.pcc.syncSend({ type: 'snapshot', items: syncSnapshot() }), 800 + Math.random() * 2000);
    return;
  }
  if(message.type === 'changes' || message.type === 'snapshot'){
    const back = syncApply(message.items);
    // After a full snapshot, they may lack things we have: send just those.
    if(message.type === 'snapshot' && back.length) window.pcc.syncSend({ type: 'changes', items: back });
  }
}

/* ----- Watching saves ----- */
// Every save of a synced list goes through Store.set; that's where we notice changes.
(function watchSaves(){
  const original = Store.set;
  Store.set = (key, value) => {
    const ok = original(key, value);
    if(SYNC_STORE_KEYS.has(key)) syncSoon();
    return ok;
  };
})();

/* ----- Starting, pairing, leaving ----- */

async function initSync(){
  if(!window.pcc || !window.pcc.syncStatus) return;
  window.pcc.onSyncReceived(syncReceived);
  window.pcc.onSyncDevices((devices) => { syncState.devices = devices; renderSyncSettings(); });
  Object.assign(syncState, await window.pcc.syncStatus());
  if(syncState.paired){
    Object.assign(syncState, await window.pcc.syncStart());
    syncFlush();   // anything changed while we were offline
  }
  renderSyncSettings();
}

// Start a new sync group here. Everything on this device counts as current.
async function syncCreate(){
  Store.set(SYNC_META_KEY, {});
  syncDetect(Date.now());
  const result = await window.pcc.syncCreate();
  Object.assign(syncState, result);
  renderSyncSettings(result.code);
}

// Join with a code from another device. What's already here is kept and merged,
// but where both have a version, the group's wins (ours count as old).
async function syncJoin(){
  const input = document.getElementById('sync-join-code');
  const status = document.getElementById('sync-join-status');
  Store.set(SYNC_META_KEY, {});
  syncDetect(1);
  const result = await window.pcc.syncJoin(input.value);
  if(!result.ok){ status.textContent = result.error; status.className = 'mail-test bad'; return; }
  input.value = '';
  Object.assign(syncState, result);
  showToast(sayAny('Syncing. Your other devices will send what they have in a moment.', 'Syncing. Your other devices will send what they have in a moment. Family reunion loading…', 'You’re in. Your other devices will send their stuff over in a moment.'));
  renderSyncSettings();
}

async function syncLeave(){
  if(!confirm(say('Stop syncing on this device?\n\nEverything stays here as it is; it just stops being shared. Your other devices keep syncing with each other.', 'Leaving the group chat, huh? Stop syncing on this device?\n\nEverything stays here as it is; it just stops being shared. Your other devices keep syncing with each other.'))) return;
  Object.assign(syncState, await window.pcc.syncLeave());
  Store.set(SYNC_META_KEY, {}); Store.set(SYNC_PENDING_KEY, []);
  renderSyncSettings();
}

async function syncNow(){
  await syncFlush();
  await window.pcc.syncSend({ type: 'hello' });
  showToast(sayAny('Asked your other devices for their latest', 'Asked your other devices for their latest. They’d better reply.', 'Poked your other devices for their latest.'));
}

async function syncRevealCode(copy){
  const code = await window.pcc.syncShowCode();
  if(!code) return;
  if(copy){ await navigator.clipboard.writeText(code); showToast(sayAny('Sync code copied. Only enter it on your own devices.', 'Sync code copied. Only enter it on your own devices. Not your bestie’s, not your cousin’s. Yours.', 'Copied. Only enter it on your own devices, bro. It unlocks everything synced.')); }
  else document.getElementById('sync-code').textContent = code;
}

async function syncRenameDevice(name){
  Object.assign(syncState, await window.pcc.syncRename(name));
  renderSyncSettings();
}

/* ----- Settings > Sync ----- */

function syncAgo(ms){
  if(!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if(s < 60) return 'just now';
  if(s < 3600) return `${Math.round(s / 60)} min ago`;
  if(s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function renderSyncSettings(newCode){
  const off = document.getElementById('sync-off'), on = document.getElementById('sync-on');
  if(!off || !on) return;
  off.hidden = syncState.paired; on.hidden = !syncState.paired;
  if(!syncState.paired) return;
  document.getElementById('sync-device-name').value = syncState.deviceName || '';
  document.getElementById('sync-code').textContent = newCode || 'SYNC-••••-••••-••••-••••-••••-••••';
  document.getElementById('sync-new-note').hidden = !newCode;
  const devices = syncState.devices || [];
  document.getElementById('sync-devices').innerHTML = devices.length
    ? devices.map(d => `<div class="sync-device"><span>${esc(d.name)}</span><span>seen ${syncAgo(d.seen)}</span></div>`).join('')
    : `<div class="setting-desc">${say('No other device yet. Enter the code on your other device to pair it.', 'No other device yet. Lonely in here. Enter the code on your other device to pair it.')}</div>`;
  const pending = Store.get(SYNC_PENDING_KEY, []).length;
  document.getElementById('sync-last').textContent =
    `Sent ${syncAgo(syncState.lastSent)} · received ${syncAgo(syncState.lastReceived)}` + (pending ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting for a connection` : '');
}
