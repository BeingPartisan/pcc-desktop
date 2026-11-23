/* ---------- Messages ---------- */
// The same channels and the same relay as PCC on the computer (messaging.js
// and renderer/js/messages.js there), so the phone talks with anyone's PCC.
// A channel is a name plus a secret code (PCC-XXXX-XXXX-XXXX-XXXX); whoever
// has the code can read and send on it. Each message on the relay is
//   { v: 1, d: <device id>, f: <sender's name>, t: <text>, k: <kind>, x: <data> }
// with kind '' (a message), 'nudge', 'status' (focus timer) or 'countdowns'.
// Channels sync between your own devices; the chat history stays per device.

const MSG_TOPIC = /^pcc[a-z2-7]{16}$/;
const MSG_LOG_LIMIT = 400;
const NUDGES = ['Thinking of you', "Call me when you're free", 'Studying, talk later', 'Good night', 'On my way'];

const messages = {
  log: Store.get('msgLog', []),           // newest first: { id, channelId, from, text, ts, mine, nudge }
  unread: Store.get('msgUnread', []),     // ids of messages not yet seen
  presence: {},                           // channelId|device -> { from, state, until }
  since: Store.get('__msgSince', 0),      // relay time (s) of the last event seen
  open: null,                             // the channel whose chat is open
  stream: null,
};

function msgDeviceId(){
  let id = localStorage.getItem('__deviceId');
  if(!id){ id = uid() + uid(); localStorage.setItem('__deviceId', id); }
  return id;
}
const topicToCode = (topic) => 'PCC-' + topic.slice(3).toUpperCase().match(/.{4}/g).join('-');
function codeToTopic(code){ const t = String(code).toLowerCase().replace(/[^a-z0-9]/g, ''); return MSG_TOPIC.test(t) ? t : null; }
function newChannelTopic(){
  const letters = 'abcdefghijklmnopqrstuvwxyz234567';
  return 'pcc' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => letters[b % 32]).join('');
}

/* ----- The relay ----- */
async function msgPublish(topic, payload){
  const res = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, message: JSON.stringify(payload) }) });
  if(!res.ok) throw new Error('relay ' + res.status);
}

async function msgListen(){
  if(messages.stream) messages.stream.abort();
  const topics = data.msgChannels.map(c => c.topic).filter(t => MSG_TOPIC.test(t));
  if(!topics.length) return;
  const mine = messages.stream = new AbortController();
  const since = messages.since || '12h';
  try {
    const res = await fetch(`${RELAY}/${topics.join(',')}/json?since=${since}`, { signal: mine.signal });
    const reader = res.body.getReader();
    let buffer = '';
    for(;;){
      const { value, done } = await reader.read();
      if(done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for(const line of lines) if(line.trim()) { try { msgEvent(JSON.parse(line)); } catch(e){} }
    }
  } catch(e){ if(mine.signal.aborted) return; }
  if(!mine.signal.aborted) setTimeout(msgListen, 5000);
}

function msgEvent(event){
  if(event.event !== 'message') return;
  if(event.time){ messages.since = Math.max(messages.since, event.time); Store.set('__msgSince', messages.since); msgTellNative(); }
  const channel = data.msgChannels.find(c => c.topic === event.topic);
  if(!channel || messages.log.some(m => m.id === event.id)) return;
  let p; try { p = JSON.parse(event.message); } catch(e){ return; }
  if(!p || p.v !== 1 || p.d === msgDeviceId()) return;
  const from = String(p.f || 'Someone').slice(0, 40);
  if(p.k === 'status'){
    const key = channel.id + '|' + p.d, until = Number(p.x && p.x.until) || 0;
    if(p.x && (p.x.s === 'focus' || p.x.s === 'break') && until > Date.now()) messages.presence[key] = { channelId: channel.id, from, state: p.x.s, until };
    else delete messages.presence[key];
    render(); return;
  }
  if(p.k === 'countdowns') msgReceiveCountdowns(channel, p.x);
  if(typeof p.t !== 'string' || !p.t) return;
  const entry = { id: event.id, channelId: channel.id, from, text: p.t.slice(0, 500), ts: (event.time || 0) * 1000 || Date.now(), nudge: p.k === 'nudge' };
  messages.log.unshift(entry); messages.log = messages.log.slice(0, MSG_LOG_LIMIT); Store.set('msgLog', messages.log);
  if(!(page === 'messages' && messages.open === channel.id)){ messages.unread.push(entry.id); Store.set('msgUnread', messages.unread); }
  if(document.visibilityState === 'visible'){ toast(`${from}: ${entry.text}`); try { window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' }); } catch(e){} }
  else msgNotify(entry, channel);   // the app is in the background but still connected: it has to show the notification itself
  render();
}

function msgNotify(entry, channel){
  const ln = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if(!ln) return;
  let id = 0; for(const ch of entry.id) id = (id * 31 + ch.charCodeAt(0)) | 0;
  ln.schedule({ notifications: [{ id: Math.abs(id) || 1, title: `${entry.from} · ${channel.name}`, body: entry.text, smallIcon: 'ic_message' }] }).catch(() => {});
}

// Countdowns shared on a channel: keep the newer version of each (as on the computer).
function msgReceiveCountdowns(channel, x){
  const items = x && Array.isArray(x.items) ? x.items.slice(0, 60) : [];
  let changed = false;
  for(const raw of items){
    const id = String(raw.id || '').slice(0, 24), u = Number(raw.u) || 0;
    if(!id || !u || u > Date.now() + 86400000) continue;
    const incoming = raw.del ? { id, channelId: channel.id, del: true, u }
      : /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && raw.title ? { id, channelId: channel.id, title: String(raw.title).slice(0, 40), date: raw.date, u } : null;
    if(!incoming) continue;
    const mine = data.countdowns.find(c => c.id === id);
    if(!mine){ data.countdowns.push(incoming); changed = true; }
    else if(mine.channelId === channel.id && u > mine.u){ Object.assign(mine, { title: undefined, date: undefined, del: undefined }, incoming); changed = true; }
  }
  if(changed) save('countdowns');
}

async function msgSend(channelId, text, kind){
  const channel = data.msgChannels.find(c => c.id === channelId);
  const body = String(text || '').trim().slice(0, 500);
  if(!channel || !body) return false;
  try { await msgPublish(channel.topic, { v: 1, d: msgDeviceId(), f: data.settings.name || 'Someone', t: body, ...(kind ? { k: kind } : {}) }); }
  catch(e){ toast("Couldn't send. Check your connection."); return false; }
  messages.log.unshift({ id: uid(), channelId, from: 'You', text: body, ts: Date.now(), mine: true, nudge: kind === 'nudge' });
  Store.set('msgLog', messages.log);
  render();
  return true;
}

/* ----- Channels ----- */
function msgJoin(){
  const code = document.getElementById('join-code').value, name = document.getElementById('join-name').value.trim();
  const topic = codeToTopic(code);
  if(!topic){ toast("That code doesn't look right. It starts with PCC and has 16 more characters."); return; }
  if(data.msgChannels.some(c => c.topic === topic)){ toast('You already have this channel'); return; }
  data.msgChannels.push({ id: uid(), name: (name || 'Friends').slice(0, 30), topic });
  save('msgChannels'); msgRestart(); toast('Joined'); render();
}
function msgCreate(){
  const name = document.getElementById('join-name').value.trim();
  if(!name){ toast('Give the channel a name first'); return; }
  const channel = { id: uid(), name: name.slice(0, 30), topic: newChannelTopic() };
  data.msgChannels.push(channel);
  save('msgChannels'); msgRestart();
  messages.open = channel.id; render();
  msgCopyCode(channel.id);
}
async function msgCopyCode(id){
  const c = data.msgChannels.find(x => x.id === id); if(!c) return;
  try { await navigator.clipboard.writeText(topicToCode(c.topic)); toast('Code copied. Send it to the person you want in this channel.'); }
  catch(e){ toast(topicToCode(c.topic)); }
}
function msgLeave(id){
  const c = data.msgChannels.find(x => x.id === id);
  if(!c || !confirm(`Leave "${c.name}"? You can join again with its code.`)) return;
  data.msgChannels = data.msgChannels.filter(x => x.id !== id);
  save('msgChannels'); messages.open = null; msgRestart(); render();
}

function msgRestart(){ msgListen(); msgTellNative(); }

// Hands the channels to Android, which checks for new messages while the app is closed.
function msgTellNative(){
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Messages;
  if(!p) return;
  p.setChannels({ channels: data.msgChannels.map(c => ({ topic: c.topic, name: c.name })), deviceId: msgDeviceId(), since: String(messages.since || 0) }).catch(() => {});
}

/* ----- The page ----- */
const presenceIn = (channelId) => Object.values(messages.presence).filter(p => p.channelId === channelId && p.until > Date.now());
const unreadIn = (channelId) => messages.log.filter(m => m.channelId === channelId && messages.unread.includes(m.id)).length;
const msgTime = (ts) => { const d = new Date(ts); return d.toDateString() === new Date().toDateString() ? timeText(ts) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

function openChannel(id){
  messages.open = id;
  const ids = new Set(messages.log.filter(m => m.channelId === id).map(m => m.id));
  messages.unread = messages.unread.filter(x => !ids.has(x)); Store.set('msgUnread', messages.unread);
  render();
  setTimeout(() => { const t = document.getElementById('thread'); if(t) t.scrollTop = t.scrollHeight; }, 30);
}

function renderMessages(){
  const el = document.getElementById('messages-body');
  const channel = data.msgChannels.find(c => c.id === messages.open);
  if(channel) return renderThread(el, channel);
  messages.open = null;
  const rows = data.msgChannels.map(c => {
    const last = messages.log.find(m => m.channelId === c.id);
    const unread = unreadIn(c.id);
    const here = presenceIn(c.id).map(p => `${esc(p.from)} is ${p.state === 'break' ? 'on a break' : 'focusing'}`).join(', ');
    return `<button class="row chan" onclick="openChannel('${c.id}')">
      <div class="avatar">${esc(c.name.charAt(0).toUpperCase())}</div>
      <div class="txt"><div class="title">${esc(c.name)}</div><div class="sub">${here || (last ? esc((last.mine ? 'You: ' : last.from + ': ') + last.text) : 'No messages yet')}</div></div>
      ${unread ? `<span class="count">${unread}</span>` : last ? `<span class="side">${msgTime(last.ts)}</span>` : ''}</button>`;
  }).join('');
  el.innerHTML = `
    ${data.msgChannels.length ? `<div class="card">${rows}</div>` : '<div class="card empty-card"><b>Message your friends</b><div class="note" style="margin-top:6px;">Join a channel with a code someone gave you, or create one and send them its code. Channels you have on your computer appear here when you sync.</div></div>'}
    <div class="section-head"><h2>Join or create</h2></div>
    <div class="card form-card">
      <label>Name<input id="join-name" type="text" maxlength="30" placeholder="Godfather" /></label>
      <label>Code (to join)<input id="join-code" type="text" placeholder="PCC-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" /></label>
      <div style="display:flex; gap:8px;"><button class="btn primary" onclick="msgJoin()">Join</button><button class="btn" onclick="msgCreate()">Create new</button></div>
      <div class="note">Messages pass through a public relay (ntfy.sh). Treat a channel like a postcard: fine for "call me", not for anything private.</div>
    </div>`;
}

function renderThread(el, c){
  const items = messages.log.filter(m => m.channelId === c.id).slice(0, 80).reverse();
  const here = presenceIn(c.id).map(p => `${esc(p.from)} is ${p.state === 'break' ? 'on a break' : 'focusing'} until ${timeText(p.until)}`).join(' · ');
  el.innerHTML = `
    <div class="thread-head"><button class="link" onclick="messages.open=null; render()">‹ Chats</button><b>${esc(c.name)}</b>
      <button class="link" onclick="msgCopyCode('${c.id}')">Code</button></div>
    ${here ? `<div class="presence">${here}</div>` : ''}
    <div class="thread" id="thread">${items.length ? items.map(m => `<div class="bubble ${m.mine ? 'mine' : ''} ${m.nudge ? 'nudge' : ''}">
      ${m.mine ? '' : `<div class="who">${esc(m.from)}</div>`}${esc(m.text)}<div class="when">${msgTime(m.ts)}</div></div>`).join('') : '<div class="empty" style="text-align:center;">Say hello.</div>'}</div>
    <div class="chips">${NUDGES.map(n => `<button onclick="msgSend('${c.id}', this.textContent, 'nudge')">${esc(n)}</button>`).join('')}</div>
    <form class="add-row compose" onsubmit="event.preventDefault(); const i=document.getElementById('compose'); msgSend('${c.id}', i.value).then(ok => { if(ok){ i.value=''; openChannel('${c.id}'); } });">
      <input id="compose" type="text" placeholder="Message ${esc(c.name)}" autocomplete="off" enterkeyhint="send" />
      <button class="btn primary" type="submit">Send</button></form>
    <button class="link leave" onclick="msgLeave('${c.id}')">Leave this channel</button>`;
}

function renderMessagesBadge(){
  const n = messages.unread.length;
  const tab = document.querySelector('.tabs button[data-page="messages"]');
  if(!tab) return;
  let badge = tab.querySelector('.badge-dot');
  if(!badge){ badge = document.createElement('span'); badge.className = 'badge-dot'; tab.appendChild(badge); }
  badge.textContent = n > 9 ? '9+' : n; badge.hidden = !n;
}
