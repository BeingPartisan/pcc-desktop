/* ---------- Messages page ---------- */
// The chats, outside Settings: a list of channels on the left, the chosen
// conversation on the right. It draws from the same data as messages.js
// (msg.channels, msg.log, msg.unread); sending, receiving and the relay are
// all there. Settings > Messages keeps the one-off things: one-tap phrases,
// notifications, and the developer's broadcast box.

const ANNOUNCEMENTS = '__announcements'; // the built-in channel for messages from the developer
let openChat = null;                    // channel id shown on the right, or ANNOUNCEMENTS
let chatForm = null;                    // 'new' | 'join' | null: the small form under the chat list

function chatMessages(id){
  const list = id === ANNOUNCEMENTS ? msg.log.filter(m => m.broadcast) : msg.log.filter(m => m.channelId === id);
  return list.slice().reverse(); // oldest first
}

function chatList(){
  const chats = msg.channels.map(c => ({ id: c.id, name: c.name, channel: c }));
  if(msg.log.some(m => m.broadcast)) chats.push({ id: ANNOUNCEMENTS, name: 'Announcements', channel: null });
  // Most recent conversation first; chats with nothing in them keep their order at the end.
  const lastTs = (id) => { const m = chatMessages(id); return m.length ? m[m.length - 1].ts : 0; };
  return chats.map(c => ({ ...c, last: chatMessages(c.id).slice(-1)[0], unread: msg.unread.filter(u => id(u) === c.id).length }))
    .sort((a, b) => lastTs(b.id) - lastTs(a.id));
  function id(u){ return u.broadcast || (!u.channelId && u.channel === 'Announcement') ? ANNOUNCEMENTS : u.channelId; }
}

function openChatWith(id){
  openChat = id;
  chatForm = null;
  // Opening a conversation counts as reading it.
  if(id === ANNOUNCEMENTS){
    const before = msg.unread.length;
    msg.unread = msg.unread.filter(u => !u.broadcast);
    if(msg.unread.length !== before){ Store.set('msgUnread', msg.unread); pushIsland(); }
  } else dismissUnread({ channelId: id });
  renderChats();
  const input = document.getElementById('chat-input');
  if(input && id !== ANNOUNCEMENTS) input.focus();
}

function showChatForm(form){ chatForm = chatForm === form ? null : form; renderChats(); const f = document.querySelector('#chat-form input'); if(f) f.focus(); }

// The page's own create / join forms reuse the Settings ones' logic.
function createChatFromPage(){
  const name = document.getElementById('chat-new-name').value.trim();
  if(!name){ showToast(sayAny('Give it a name first', 'Give it a name first. “Untitled chat” is not a vibe.')); return; }
  document.getElementById('msg-new-name').value = name;
  createChannel();
  openChatWith(msg.channels[msg.channels.length - 1].id);
}

function joinChatFromPage(){
  document.getElementById('msg-join-name').value = document.getElementById('chat-join-name').value;
  document.getElementById('msg-join-code').value = document.getElementById('chat-join-code').value;
  const before = msg.channels.length;
  joinChannel();
  if(msg.channels.length > before) openChatWith(msg.channels[msg.channels.length - 1].id);
}

async function sendChat(text, kind){
  const input = document.getElementById('chat-input');
  const body = (text != null ? text : input.value).trim();
  if(!body || !openChat || openChat === ANNOUNCEMENTS) return;
  // Empty the box straight away (the page may be redrawn while sending); put the text back if it fails.
  if(text == null) input.value = '';
  const sent = await sendMessage(openChat, body, kind);
  const box = document.getElementById('chat-input');
  if(box){
    if(!sent && text == null && !box.value) box.value = body;
    box.focus();
  }
}

function chatTime(ts){
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24Hour() });
  if(todayStr(d) === todayStr()) return time;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + time;
}

function renderChats(){
  const page = document.getElementById('chats-page');
  if(!page) return;
  const chats = chatList();
  if(openChat && !chats.some(c => c.id === openChat)) openChat = null;
  if(!openChat && chats.length) openChat = chats[0].id;

  // --- Left: the list ---
  const presence = activePresence();
  document.getElementById('chat-list').innerHTML = chats.length ? chats.map(c => {
    const busy = presence.find(p => p.channelId === c.id);
    const preview = c.last ? `${c.last.mine ? 'You: ' : ''}${c.last.text}` : say('No messages yet', 'No messages yet. Awkward silence.', 'No messages yet. Make the first move.');
    return `
      <button class="chat-item ${c.id === openChat ? 'active' : ''} ${c.unread ? 'has-unread' : ''}" onclick="openChatWith('${c.id}')">
        <span class="chat-avatar" style="background:${c.channel ? colorForSubject(c.name) : 'var(--accent)'}">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="chat-item-main">
          <span class="chat-item-top"><span class="chat-name">${esc(c.name)}</span><span class="chat-when">${c.last ? esc(chatTime(c.last.ts)) : ''}</span></span>
          <span class="chat-preview">${busy ? `<span class="chat-busy">${busy.state === 'break' ? 'On a break' : 'Focusing'}</span> · ` : ''}${esc(preview)}</span>
        </span>
        ${c.unread ? `<span class="chat-badge">${c.unread}</span>` : ''}
      </button>`;
  }).join('') : '';

  document.getElementById('chat-form').innerHTML = chatForm === 'new' ? `
      <div class="field-note">${say('Name the chat, then send its code to the other person.', 'Name the chat, then send its code to the other person. No code, no convo.')}</div>
      <div class="row-form"><input id="chat-new-name" type="text" maxlength="30" placeholder="${esc(say('Their name', 'Their name (or what you call them, e.g. Champ)'))}" onkeydown="if(event.key==='Enter')createChatFromPage()" /><button class="btn btn-primary" onclick="createChatFromPage()">Create</button></div>`
    : chatForm === 'join' ? `
      <div class="field-note">${say('Paste the code someone sent you.', 'Paste the code someone sent you. Ctrl+V, you know the drill.')}</div>
      <input id="chat-join-code" type="text" placeholder="PCC-XXXX-XXXX-XXXX-XXXX" style="font-family:var(--mono);" onkeydown="if(event.key==='Enter')joinChatFromPage()" />
      <div class="row-form"><input id="chat-join-name" type="text" maxlength="30" placeholder="Name for this chat" onkeydown="if(event.key==='Enter')joinChatFromPage()" /><button class="btn btn-primary" onclick="joinChatFromPage()">Join</button></div>`
    : '';
  document.getElementById('chat-new-btn').classList.toggle('active', chatForm === 'new');
  document.getElementById('chat-join-btn').classList.toggle('active', chatForm === 'join');

  // --- Right: the conversation ---
  const view = document.getElementById('chat-view');
  if(!chats.length){
    view.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-title">Message your friends' PCC</div>
        <div class="setting-desc">${say('Messages show up on their floating island, even while PCC is hidden. Start a chat and send them its code, or join one with a code they sent you.', 'Messages pop up on their floating island, even while PCC is hidden, so they can’t pretend they didn’t see it. Start a chat and send them its code, or join one with a code they sent you.')}</div>
        <div class="row-form" style="justify-content:center;"><button class="btn btn-primary" onclick="showChatForm('new')">Start a chat</button><button class="btn" onclick="showChatForm('join')">Join with a code</button></div>
        <div class="field-note">Messages go through a public relay (ntfy.sh). Fine for "call me" or "class moved", not for anything private.</div>
      </div>`;
    return;
  }
  const chat = chats.find(c => c.id === openChat);
  const channel = chat.channel;
  const busy = presence.filter(p => p.channelId === chat.id);
  const items = chatMessages(chat.id);
  const status = busy.length ? busy.map(p => `${p.from} is ${p.state === 'break' ? 'on a break' : 'focusing'}`).join(', ')
    : channel ? say('Messages arrive on their island', 'Messages land right on their island. No escape.') : say('From the person who makes PCC', 'Straight from the guy who makes PCC');

  let lastDay = '';
  const bubbles = items.map(m => {
    const day = todayStr(new Date(m.ts));
    const divider = day !== lastDay ? `<div class="chat-day">${esc(day === todayStr() ? 'Today' : new Date(m.ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</div>` : '';
    lastDay = day;
    return `${divider}<div class="chat-bubble ${m.mine ? 'mine' : ''} ${m.nudge ? 'nudge' : ''}">
      ${!m.mine && channel && chat.name !== m.from ? `<div class="chat-from">${esc(m.from)}</div>` : ''}
      <div class="chat-text">${esc(m.text)}</div>
      <div class="chat-meta">${esc(chatTime(m.ts))}</div>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="chat-head">
      <span class="chat-avatar" style="background:${channel ? colorForSubject(chat.name) : 'var(--accent)'}">${esc(chat.name.charAt(0).toUpperCase())}</span>
      <div style="min-width:0; flex:1;"><div class="chat-head-name">${esc(chat.name)}</div><div class="chat-head-status ${busy.length ? 'busy' : ''}">${esc(status)}</div></div>
      ${channel ? `
        <label class="msg-share" title="People in this chat see when your focus timer is running and when it ends"><input type="checkbox" ${channel.share ? 'checked' : ''} onchange="toggleChannelShare('${channel.id}', this.checked)" /> Share focus status</label>
        <button class="btn" onclick="copyChannelCode('${channel.id}')" title="Anyone with the code can join this chat">Copy code</button>
        <button class="btn btn-icon" onclick="removeChannel('${channel.id}'); renderChats();" title="Leave this chat" aria-label="Leave this chat">&times;</button>` : ''}
    </div>
    <div class="chat-scroll" id="chat-scroll">${bubbles || `<div class="chat-none">${channel
      ? say(`No messages yet. Say hello, or copy the code and send it to ${esc(chat.name)} if they haven't joined.`,
          `No messages yet. Don't be shy, say hello. If ${esc(chat.name)} hasn't joined, copy the code and send it to them.`,
          `Dead chat, bro. Say hello, or copy the code and send it to ${esc(chat.name)} if they haven't joined.`)
      : say('Nothing yet.', 'Nothing yet. The boss is busy cooking.')}</div>`}</div>
    ${channel ? `
      <div class="chat-nudges">${nudgePhrases().map(n => `<button class="chip" onclick="sendChat(${esc(JSON.stringify(n))}, 'nudge')">${esc(n)}</button>`).join('')}</div>
      <div class="chat-compose">
        <input id="chat-input" type="text" maxlength="500" placeholder="${esc(say(`Message ${chat.name}`, `Say something nice to ${chat.name}`, `Message ${chat.name}, keep it classy`))}" onkeydown="if(event.key==='Enter')sendChat()" />
        <button class="btn btn-primary" onclick="sendChat()">Send</button>
      </div>` : ''}`;
  const scroll = document.getElementById('chat-scroll');
  scroll.scrollTop = scroll.scrollHeight;
}

// The number on the rail's Messages button.
function renderChatBadge(){
  const badge = document.getElementById('rail-chat-badge');
  if(!badge) return;
  const n = msg.unread.filter(u => u.channelId || u.broadcast).length;
  badge.textContent = n > 9 ? '9+' : n;
  badge.style.display = n ? '' : 'none';
}

// Keep the page and the badge current. pushIsland() runs whenever anything
// the island shows changes (every second while the timer runs), so the page
// is only redrawn when something about the chats actually changed.
let chatsDrawn = '';
function chatsSignature(){
  return JSON.stringify([msg.log.length, msg.log[0] && msg.log[0].id, msg.unread.map(u => u.id), msg.channels.map(c => c.id + c.name + !!c.share),
    activePresence().map(p => p.channelId + p.state), nudgePhrases(), openChat, chatForm]);
}

function refreshChats(force){
  renderChatBadge();
  if(currentPage !== 'messages') return;
  // Reading the open chat while it's on screen clears its unread straight away.
  if(openChat && openChat !== ANNOUNCEMENTS && msg.unread.some(u => u.channelId === openChat)){
    msg.unread = msg.unread.filter(u => u.channelId !== openChat);
    Store.set('msgUnread', msg.unread);
    renderChatBadge();
  }
  const sig = chatsSignature();
  if(!force && sig === chatsDrawn) return;
  const active = document.activeElement;
  if(!force && active && active.closest && active.closest('#chat-form')) return; // don't wipe a half-typed name or code
  const draft = document.getElementById('chat-input');
  const keep = draft ? { value: draft.value, focused: active === draft } : null;
  renderChats();
  const again = document.getElementById('chat-input');
  if(keep && again){ again.value = keep.value; if(keep.focused) again.focus(); }
}

hookRender('pushIsland', () => refreshChats(false));
hookRender('renderChats', () => { chatsDrawn = chatsSignature(); });
