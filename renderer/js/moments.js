/* ---------- Moments: nudges, focus status and shared countdowns ---------- */
// Three small things that ride on message channels (messages.js):
//
//   Nudges      One-tap messages ("Thinking of you") sent from the island.
//               The phrases are yours to edit in Settings > Messages.
//   Focus status  If you switch it on for a channel, the people in it see
//               when your focus timer is running and when it ends. Nothing
//               else about what you're doing is shared.
//   Countdowns  Days until a date. A countdown can be private, or shared
//               with a channel so it shows on everyone's island.
//
// Sharing countdowns: each copy keeps the whole list for a channel and
// sends that list whenever it changes and once at startup. Every item
// carries the time it was last changed, and the newer version of an item
// always wins, so two copies end up the same whichever was offline. A
// deleted countdown is kept for a month as a "deleted" marker so it can't
// come back from a copy that hadn't heard.

const COUNTDOWN_LIMIT = 12;                          // per channel, so the list fits in one message
const TOMBSTONE_DAYS = 30;
const COUNTDOWN_SOON_DAYS = 3;                       // this close, it shows on the island's compact line

const moments = {
  countdowns: Store.get('countdowns', []),          // [{ id, title, date 'YYYY-MM-DD', channelId ('' = private), u: changed-at ms, del?: true }]
  presence: {},                                     // "channelId|device" -> { channelId, from, state, until }
  lastStatus: 'idle',                               // what we last told channels about our timer
};

/* ----- Nudges ----- */

function nudgePhrases(){ return (prefs().nudges || []).filter(Boolean).slice(0, 6); }

function saveNudgePhrases(text){
  const lines = String(text).split('\n').map(l => l.trim().slice(0, 40)).filter(Boolean).slice(0, 6);
  setPref('nudges', lines);
}

/* ----- Focus status ----- */

function toggleChannelShare(id, on){
  const channel = msg.channels.find(c => c.id === id);
  if(!channel) return;
  channel.share = !!on;
  saveMessages();
  // Switching off while a session is running tells the channel it ended.
  if(!on && moments.lastStatus !== 'idle') sendStatusTo([channel], { s: 'idle' });
  if(on && pomo.running) sendStatusTo([channel], { s: pomo.mode, until: pomo.endsAt });
}

function sendStatusTo(channels, data){
  for(const channel of channels){
    window.pcc.messagesSend({ topic: channel.topic, from: state.settings.name || 'Someone', kind: 'status', data })
      .catch(e => console.error('Status not sent', e));
  }
}

// Called whenever the timer is redrawn (every second while it runs); only a
// real change (started, paused, switched to a break, reset) sends anything.
function shareFocusStatus(){
  const key = pomo.running ? `${pomo.mode}|${pomo.endsAt}` : 'idle';
  if(key === moments.lastStatus) return;
  moments.lastStatus = key;
  const sharing = msg.channels.filter(c => c.share);
  if(sharing.length && window.pcc && window.pcc.messagesSend) sendStatusTo(sharing, pomo.running ? { s: pomo.mode, until: pomo.endsAt } : { s: 'idle' });
}

function receiveStatus(channel, message){
  const data = message.data || {};
  const key = `${channel.id}|${message.device}`;
  const until = Number(data.until) || 0;
  if((data.s === 'focus' || data.s === 'break') && until > Date.now() && until < Date.now() + 4 * 3600 * 1000){
    moments.presence[key] = { channelId: channel.id, from: message.from, state: data.s, until };
  } else delete moments.presence[key];
  pushIsland(); renderMessagesSettings();
}

// Who is in a session right now. Sessions end by themselves at `until`.
function activePresence(){
  const now = Date.now();
  for(const key of Object.keys(moments.presence)) if(moments.presence[key].until <= now) delete moments.presence[key];
  return Object.values(moments.presence);
}

/* ----- Countdowns ----- */

function saveCountdowns(){
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
  moments.countdowns = moments.countdowns.filter(c => !(c.del && c.u < cutoff));
  Store.set('countdowns', moments.countdowns);
}

function daysUntil(dateStr){
  return Math.round((parseLocalDate(dateStr) - parseLocalDate(todayStr())) / 86400000);
}
function countdownText(days){
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 0 ? `${days} days` : `${-days} day${days === -1 ? '' : 's'} ago`;
}

// Live countdowns, soonest first; ones that have passed go to the end.
function visibleCountdowns(){
  const channelIds = new Set(msg.channels.map(c => c.id));
  return moments.countdowns
    .filter(c => !c.del && (!c.channelId || channelIds.has(c.channelId)))
    .map(c => ({ ...c, days: daysUntil(c.date) }))
    .sort((a, b) => (a.days < 0) - (b.days < 0) || Math.abs(a.days) - Math.abs(b.days));
}

function syncCountdowns(channelId, announce){
  const channel = msg.channels.find(c => c.id === channelId);
  if(!channel || !window.pcc || !window.pcc.messagesSend) return;
  const items = moments.countdowns.filter(c => c.channelId === channelId)
    .map(c => c.del ? { id: c.id, u: c.u, del: 1 } : { id: c.id, title: c.title, date: c.date, u: c.u });
  window.pcc.messagesSend({ topic: channel.topic, from: state.settings.name || 'Someone', kind: 'countdowns', data: { items }, text: announce || '' })
    .then(result => { if(result && !result.ok && announce) showToast(result.error || sayAny('Could not share the countdown', 'Could not share the countdown. It’s only on your PC for now, try again later.')); })
    .catch(e => console.error('Countdowns not sent', e));
}

function addCountdown(){
  const title = document.getElementById('countdown-title').value.trim().slice(0, 40);
  const date = document.getElementById('countdown-date').value;
  const channelId = document.getElementById('countdown-channel').value;
  if(!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)){ showToast(sayAny('Give it a name and a date', 'Give it a name and a date. Counting down to nothing is just waiting, bro.')); return; }
  if(moments.countdowns.filter(c => c.channelId === channelId && !c.del).length >= COUNTDOWN_LIMIT){ showToast(sayAny(`That's the limit of ${COUNTDOWN_LIMIT} here. Remove one first.`, `That's the limit of ${COUNTDOWN_LIMIT} here. Too many things to look forward to, yaar. Remove one first.`)); return; }
  moments.countdowns.push({ id: uid(), title, date, channelId, u: Date.now() });
  document.getElementById('countdown-title').value = '';
  saveCountdowns(); renderCountdowns(); pushIsland();
  if(channelId) syncCountdowns(channelId, `New countdown: ${title} (${parseLocalDate(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })})`);
}

function removeCountdown(id){
  const item = moments.countdowns.find(c => c.id === id);
  if(!item) return;
  if(item.channelId){
    const channel = msg.channels.find(c => c.id === item.channelId);
    const where = channel ? channel.name : 'the channel';
    if(!confirm(say(`Remove "${item.title}"?\n\nIt is shared, so it will be removed for everyone in ${where}.`,
      `Remove "${item.title}"? Cancelling plans, bro?\n\nIt is shared, so it will be removed for everyone in ${where}.`))) return;
    Object.assign(item, { del: true, u: Date.now() }); // kept as a marker so it's removed on the other copies too
    syncCountdowns(item.channelId);
  } else moments.countdowns = moments.countdowns.filter(c => c.id !== id);
  saveCountdowns(); renderCountdowns(); pushIsland();
}

// Another copy sent its list for a channel: keep the newer version of each item.
function receiveCountdowns(channel, message){
  const items = message.data && Array.isArray(message.data.items) ? message.data.items.slice(0, COUNTDOWN_LIMIT * 3) : [];
  let changed = false;
  const theirs = new Map();
  for(const raw of items){
    const id = String(raw.id || '').slice(0, 24), u = Number(raw.u) || 0;
    if(!id || !u || u > Date.now() + 86400000) continue; // a clock far in the future would win every merge
    theirs.set(id, u);
    const incoming = raw.del ? { id, channelId: channel.id, del: true, u }
      : /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && raw.title ? { id, channelId: channel.id, title: String(raw.title).slice(0, 40), date: raw.date, u } : null;
    if(!incoming) continue;
    const mine = moments.countdowns.find(c => c.id === id);
    if(mine && mine.channelId !== channel.id) continue;
    if(!mine){ moments.countdowns.push(incoming); changed = true; }
    else if(u > mine.u){ Object.assign(mine, { title: undefined, date: undefined, del: undefined }, incoming); changed = true; }
  }
  if(changed){ saveCountdowns(); renderCountdowns(); pushIsland(); }
  // If we know something they don't (or a newer version), send our list back once.
  const ahead = moments.countdowns.some(c => c.channelId === channel.id && (theirs.get(c.id) || 0) < c.u);
  if(ahead) syncCountdowns(channel.id);
}

function renderCountdowns(){
  const body = document.getElementById('countdowns-body');
  if(!body) return;
  const select = document.getElementById('countdown-channel');
  const chosen = select.value;
  select.innerHTML = '<option value="">Just me</option>' + msg.channels.map(c => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>Shared with ${esc(c.name)}</option>`).join('');
  const list = visibleCountdowns();
  body.innerHTML = list.length ? list.map(c => {
    const channel = msg.channels.find(ch => ch.id === c.channelId);
    return `
    <div class="countdown-tile ${c.days < 0 ? 'past' : ''}">
      <div class="countdown-days">${c.days === 0 ? 'Today' : Math.abs(c.days)}</div>
      <div style="min-width:0; flex:1;">
        <div class="setting-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.title)}</div>
        <div class="setting-desc">${esc(c.days === 0 ? say('It\'s today', 'It’s today! Let’s gooo') :c.days > 0 ? `day${c.days === 1 ? '' : 's'} to go` : `day${c.days === -1 ? '' : 's'} ago`)} · ${esc(parseLocalDate(c.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}${channel ? ' · shared with ' + esc(channel.name) : ''}</div>
      </div>
      <button class="btn btn-icon" onclick="removeCountdown('${c.id}')" aria-label="Remove ${esc(c.title)}">&times;</button>
    </div>`; }).join('')
    : `<div class="empty">${say('Nothing to count down to yet. Add a trip, the last exam, a birthday.', 'Nothing to count down to yet? Go make some plans, bro. Add a trip, the last exam, a birthday.', 'Nothing to look forward to yet. Add a trip, the last exam, a birthday, anything.')}</div>`;
}

// What the island shows: the soonest three that haven't passed.
function islandCountdowns(){
  return visibleCountdowns().filter(c => c.days >= 0).slice(0, 3)
    .map(c => ({ title: c.title, days: c.days, text: countdownText(c.days), shared: !!c.channelId, soon: c.days <= COUNTDOWN_SOON_DAYS }));
}

// Called once at startup, after the channels are connected: offer our lists so copies that were offline catch up.
function syncAllCountdowns(){
  for(const channel of msg.channels){
    if(moments.countdowns.some(c => c.channelId === channel.id)) syncCountdowns(channel.id);
  }
}

hookRender('renderPomo', shareFocusStatus);
// Day counts change at midnight, and sessions end by themselves.
setInterval(() => { renderCountdowns(); }, 30 * 60 * 1000);
