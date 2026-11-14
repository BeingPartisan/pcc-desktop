/* ---------- Messages between devices ---------- */
// Short messages between copies of PCC, sent through a public relay (see
// messaging.js in the main process for how and why). This file keeps the
// list of channels, the recent messages, and the Settings > Messages pane.
//
// A channel is a name plus a secret code. Whoever has the code can read and
// send on it, so two people share a channel by one of them creating it and
// giving the other the code.

const MSG_LOG_LIMIT = 40;
const CHANNEL_TOPIC = /^pcc[a-z2-7]{16}$/;

const msg = {
  channels: Store.get('msgChannels', []),   // [{ id, name, topic, share? }]  share: send my focus status here (moments.js)
  log: Store.get('msgLog', []),             // newest first: { id, channelId, channel, from, text, ts, mine, broadcast }
  unread: null,                             // the latest incoming message not yet dismissed (shown on the island)
  canBroadcast: false,                      // true only on the developer's computer
};

// Identifies this installation so our own messages aren't shown back to us.
function deviceId(){
  let id = localStorage.getItem('__deviceId');
  if(!id){ id = uid() + uid(); localStorage.setItem('__deviceId', id); }
  return id;
}

function newChannelTopic(){
  const letters = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'pcc' + Array.from(bytes, b => letters[b % 32]).join('');
}
// pccabcdefgh... <-> PCC-ABCD-EFGH-...  (the form people copy and type)
function topicToCode(topic){ return 'PCC-' + topic.slice(3).toUpperCase().match(/.{4}/g).join('-'); }
function codeToTopic(code){
  const topic = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  return CHANNEL_TOPIC.test(topic) ? topic : null;
}

function saveMessages(){
  Store.set('msgChannels', msg.channels);
  Store.set('msgLog', msg.log.slice(0, MSG_LOG_LIMIT));
}

// Tell the main process which channels to listen on.
async function configureMessages(){
  if(!window.pcc || !window.pcc.messagesConfigure) return;
  try {
    const result = await window.pcc.messagesConfigure({ topics: msg.channels.map(c => c.topic), deviceId: deviceId() });
    msg.canBroadcast = !!(result && result.canBroadcast);
  } catch(e){ console.error('Messages setup failed', e); }
  renderMessagesSettings();
}

function createChannel(){
  const input = document.getElementById('msg-new-name');
  const name = input.value.trim();
  if(!name){ showToast('Give the channel a name first'); return; }
  msg.channels.push({ id: uid(), name: name.slice(0, 30), topic: newChannelTopic() });
  input.value = '';
  saveMessages(); configureMessages(); pushIsland();
  showToast('Channel created. Share its code with the other person.');
}

function joinChannel(){
  const nameInput = document.getElementById('msg-join-name');
  const codeInput = document.getElementById('msg-join-code');
  const topic = codeToTopic(codeInput.value);
  if(!topic){ showToast('That code doesn\'t look right. It starts with PCC and has 16 more characters.'); return; }
  if(msg.channels.some(c => c.topic === topic)){ showToast('You already have this channel'); return; }
  msg.channels.push({ id: uid(), name: (nameInput.value.trim() || 'Channel').slice(0, 30), topic });
  nameInput.value = ''; codeInput.value = '';
  saveMessages(); configureMessages(); pushIsland();
  showToast('Joined');
}

function removeChannel(id){
  const channel = msg.channels.find(c => c.id === id);
  if(!channel || !confirm(`Leave "${channel.name}"?\n\nYou'll stop receiving its messages. You can join again with the code.`)) return;
  msg.channels = msg.channels.filter(c => c.id !== id);
  saveMessages(); configureMessages(); pushIsland();
}

async function copyChannelCode(id){
  const channel = msg.channels.find(c => c.id === id);
  if(!channel) return;
  await navigator.clipboard.writeText(topicToCode(channel.topic));
  showToast('Code copied. Anyone with it can read and send on this channel.');
}

function logMessage(entry){
  msg.log.unshift(entry);
  msg.log = msg.log.slice(0, MSG_LOG_LIMIT);
  saveMessages();
  renderMessagesSettings();
}

// kind is '' for an ordinary message or 'nudge' for a one-tap phrase.
async function sendMessage(channelId, text, kind){
  const channel = msg.channels.find(c => c.id === channelId);
  const body = String(text || '').trim();
  if(!channel || !body) return false;
  const result = await window.pcc.messagesSend({ topic: channel.topic, text: body, from: state.settings.name || 'Someone', kind: kind === 'nudge' ? 'nudge' : '' });
  if(!result.ok){ showToast(result.error || 'Could not send'); return false; }
  logMessage({ id: uid(), channelId: channel.id, channel: channel.name, from: 'You', text: body, ts: Date.now(), mine: true });
  return true;
}

async function sendFromSettings(){
  const input = document.getElementById('msg-compose-text');
  if(await sendMessage(document.getElementById('msg-compose-channel').value, input.value)) input.value = '';
}

async function sendBroadcast(){
  const input = document.getElementById('msg-broadcast-text');
  const text = input.value.trim();
  if(!text || !confirm(`Send this to everyone using PCC?\n\n"${text}"`)) return;
  const result = await window.pcc.messagesBroadcast(text);
  if(result.ok){ input.value = ''; showToast('Broadcast sent'); }
  else showToast(result.error || 'Could not send the broadcast');
}

// A message arrived from the relay (already checked by the main process).
function receiveMessage(message){
  const channel = msg.channels.find(c => c.topic === message.topic);
  if(!message.broadcast && !channel) return;
  if(msg.log.some(m => m.id === message.id)) return; // seen before a restart
  // Status and countdown lists update things quietly (moments.js); a countdown
  // list that comes with text ("New countdown: ...") is also shown as a message.
  if(message.kind === 'status') return receiveStatus(channel, message);
  if(message.kind === 'countdowns'){ receiveCountdowns(channel, message); if(!message.text) return; }
  const entry = {
    id: message.id, channelId: channel ? channel.id : '', channel: message.broadcast ? 'Announcement' : channel.name,
    from: message.from, text: message.text, ts: message.ts || Date.now(), broadcast: !!message.broadcast,
    nudge: message.kind === 'nudge',
  };
  logMessage(entry);
  msg.unread = { ...entry, at: Date.now() };
  showToast(`${entry.from}: ${entry.text}`);
  // With the island off there's nothing on screen while PCC is hidden, so use a Windows notification.
  if(prefs().msgNotify && !prefs().islandEnabled){
    try { new Notification(`${entry.from} · ${entry.channel}`, { body: entry.text }); } catch(e){ /* notifications unavailable */ }
  }
  pushIsland();
}

function markMessageRead(){ msg.unread = null; pushIsland(); }

function clearMessageLog(){ msg.log = []; msg.unread = null; saveMessages(); renderMessagesSettings(); pushIsland(); }

function renderMessagesSettings(){
  const list = document.getElementById('msg-channels');
  if(!list) return;
  list.innerHTML = msg.channels.length ? msg.channels.map(c => `
    <div class="msg-channel">
      <div style="min-width:0; flex:1;">
        <div class="setting-name">${esc(c.name)}</div>
        <div class="msg-code">${esc(topicToCode(c.topic))}</div>
        ${(() => { const p = activePresence().filter(x => x.channelId === c.id); return p.length ? `<div class="msg-presence">${esc(p.map(x => `${x.from} is ${x.state === 'break' ? 'on a break' : 'focusing'}`).join(', '))}</div>` : ''; })()}
      </div>
      <label class="msg-share" title="People in this channel see when your focus timer is running and when it ends"><input type="checkbox" ${c.share ? 'checked' : ''} onchange="toggleChannelShare('${c.id}', this.checked)" /> Share focus status</label>
      <button class="btn" onclick="copyChannelCode('${c.id}')">Copy code</button>
      <button class="btn" onclick="removeChannel('${c.id}')">Leave</button>
    </div>`).join('')
    : '<div class="empty">No channels yet. Create one and share its code, or join with a code someone gave you.</div>';

  document.getElementById('msg-compose').style.display = msg.channels.length ? '' : 'none';
  const select = document.getElementById('msg-compose-channel');
  const chosen = select.value;
  select.innerHTML = msg.channels.map(c => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  document.getElementById('msg-broadcast').style.display = msg.canBroadcast ? '' : 'none';
  const nudges = document.getElementById('msg-nudges');
  if(document.activeElement !== nudges) nudges.value = nudgePhrases().join('\n');
  renderCountdowns(); // its "share with" list follows the channels

  const time = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: !use24Hour() });
  document.getElementById('msg-log').innerHTML = msg.log.length ? msg.log.map(m => `
    <div class="msg-item ${m.mine ? 'mine' : ''}">
      <div class="msg-meta">${esc(m.from)} · ${esc(m.channel)} · ${esc(time(m.ts))}</div>
      <div class="msg-body">${esc(m.text)}</div>
    </div>`).join('')
    : '<div class="empty">Nothing yet.</div>';
  document.getElementById('msg-clear-btn').style.display = msg.log.length ? '' : 'none';
}

if(window.pcc && window.pcc.onMessage) window.pcc.onMessage(receiveMessage);
