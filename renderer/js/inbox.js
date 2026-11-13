/* ---------- Inbox: mail sorted by sender ---------- */
// The main process fetches recent mail (see "Mail scan" in main.js). This
// file decides what each message means, entirely on this computer:
//
//   1. Sender labels. The first time a sender appears their mail sits under
//      "New senders". The user labels the sender once (Important,
//      Opportunity, For information or Ignore) and every message from that
//      address is sorted that way from then on.
//   2. Course tags. A message that names one of the current courses is
//      tagged with it, and is promoted to Important whatever its sender's
//      label, so a course notice sent through an unusual list isn't missed.
//   3. Dates. A date mentioned in the message is picked out so it can be
//      added to Deadlines after the user checks it.
//
// Stored under "inbox": { messages, rules, lastScan, hadScan }. A message is
// kept compact (no body text): { key, messageId, fromName, fromAddress,
// subject, date, snippet, seen, course, due, done, deadlineAdded }.

const MAIL_CATEGORIES = {
  important:   { label: 'Important',       short: 'Important' },
  opportunity: { label: 'Opportunities',   short: 'Opportunity' },
  info:        { label: 'For information', short: 'Information' },
  new:         { label: 'New senders',     short: 'Unsorted' },
  ignore:      { label: 'Ignored',         short: 'Ignore' },
};
const SENDER_LABELS = ['important', 'opportunity', 'info', 'ignore']; // what a sender can be labelled
const INBOX_KEEP_DAYS = 45;
const INBOX_RESCAN_MS = 15 * 60 * 1000;
const TODAY_MAIL_LIMIT = 4;

let inbox = { messages: [], rules: {}, lastScan: 0, hadScan: false, ...Store.get('inbox', {}) };
let inboxTab = 'important';
let inboxShowDone = false;
let inboxError = null;       // last scan problem, shown at the top of the page
let inboxScanning = false;
let inboxAccount = { email: '', gmail: false }; // for "Open in Gmail" links

function saveInbox(){ Store.set('inbox', inbox); }

/* ----- Courses ----- */

// The current courses, from the Digiicampus sync when there is one.
function inboxCourses(){
  const data = campus.data;
  if(!data) return [];
  if(data.attendance && data.attendance.courses.length) return data.attendance.courses.map(c => ({ name: c.name, code: c.code }));
  return [...new Set((data.sessions || []).map(s => s.subject))].map(name => ({ name, code: '' }));
}

// A pattern that finds a course however it's commonly written: "Corporate
// Law II", "Corp. Law 2", or its code. Long words match on their first four
// letters; a roman numeral also matches its digit and must end the match, so
// "Corporate Law II" never matches "Corporate Law I" or "III".
function courseMatcher(course){
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  const SKIP = new Set(['and', 'of', 'the', 'with', 'in', 'to', 'for', 'a', 'an']);
  const words = course.name.replace(/\(.*?\)/g, ' ').split(/[^A-Za-z0-9]+/).filter(w => w && !SKIP.has(w.toLowerCase()));
  const parts = words.map(w => {
    if(ROMAN[w.toUpperCase()]) return `(?:${w}|${ROMAN[w.toUpperCase()]})`;
    return w.length >= 6 ? `${w.slice(0, 4)}[a-z]*\\.?` : w;
  });
  if(!parts.length) return null;
  const named = `\\b${parts.join('[\\s,&:/-]*(?:(?:and|of|the)\\s+)?')}(?![A-Za-z0-9])`;
  const coded = course.code ? `|\\b${course.code.replace(/[^A-Za-z0-9]/g, '')}\\b` : '';
  return new RegExp(named + coded, 'i');
}

function detectCourse(text){
  for(const course of inboxCourses()){
    const re = courseMatcher(course);
    if(re && re.test(text)) return course.name;
  }
  return '';
}

/* ----- Dates ----- */

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEADLINE_CUE = /\b(deadline|due|last date|submit|submission|apply|applications?|register|registration|rsvp|closes?|closing|by|before|till|until|no later than)\b/i;

// Finds the first upcoming date mentioned in a message. `receivedIso` anchors
// words like "today" and a date written without a year. Returns
// { date: 'YYYY-MM-DD', time: 'HH:MM' | null, cue } or null. Numeric dates
// are read day-first. Dates already past when the mail arrived, or more
// than six months ahead, are ignored as unlikely to be a deadline.
function detectDue(text, receivedIso){
  const base = new Date(receivedIso);
  base.setHours(0, 0, 0, 0);
  const found = []; // { index, date }
  const add = (index, date) => { if(date && !isNaN(date)) found.push({ index, date }); };
  const build = (day, month, year) => {
    if(month < 0 || month > 11 || day < 1 || day > 31) return null;
    let y = year;
    if(y !== null && y < 100) y += 2000;
    if(y === null){ y = base.getFullYear(); if(new Date(y, month, day) < base) y++; }
    const d = new Date(y, month, day);
    return d.getMonth() === month && d.getDate() === day ? d : null; // rejects 31 Feb
  };
  const monthIndex = (word) => MONTH_NAMES.indexOf(word.slice(0, 3).toLowerCase());
  const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  let m;

  // 20/11 or 20/11/2026, and 20-11-2026 (a bare 10-12 is more often a range)
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g;
  while((m = numeric.exec(text))) add(m.index, m[1] ? build(+m[1], +m[2] - 1, m[3] ? +m[3] : null) : build(+m[4], +m[5] - 1, +m[6]));

  // 20th November, 20 Nov 2026
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?`, 'gi');
  while((m = dayMonth.exec(text))) add(m.index, build(+m[1], monthIndex(m[2]), m[3] ? +m[3] : null));

  // November 20th, Nov 20, 2026
  const monthDay = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi');
  while((m = monthDay.exec(text))) add(m.index, build(+m[2], monthIndex(m[1]), m[3] ? +m[3] : null));

  // today / tonight / tomorrow
  const relative = /\b(today|tonight|tomorrow)\b/gi;
  while((m = relative.exec(text))){ const d = new Date(base); if(/tomorrow/i.test(m[1])) d.setDate(d.getDate() + 1); add(m.index, d); }

  // by Friday, this Friday, next Monday: only when introduced, since a bare weekday is usually just narrative
  const weekday = new RegExp(`\\b(by|on|this|next|coming|before|till|until)\\s+(${WEEKDAYS.join('|')})\\b`, 'gi');
  while((m = weekday.exec(text))){
    const d = new Date(base);
    const ahead = (WEEKDAYS.indexOf(m[2].toLowerCase()) - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (ahead === 0 || /next/i.test(m[1]) ? ahead + 7 : ahead));
    add(m.index, d);
  }

  const limit = new Date(base); limit.setDate(limit.getDate() + 183);
  const usable = found.filter(f => f.date >= base && f.date <= limit).sort((a, b) => a.index - b.index);
  if(!usable.length) return null;
  const pick = usable[0];

  // The clock time written closest to that date, if there is one nearby.
  let time = null, best = 90;
  const clock = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  while((m = clock.exec(text))){
    const distance = Math.abs(m.index - pick.index);
    if(distance >= best) continue;
    let h, min;
    if(m[3]){ h = +m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0); min = +(m[2] || 0); if(+m[1] > 12) continue; }
    else { h = +m[4]; min = +m[5]; }
    best = distance;
    time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return { date: todayStr(pick.date), time, cue: DEADLINE_CUE.test(text) };
}

/* ----- Sorting ----- */

// Where a message belongs, and why if that differs from its sender's label.
function mailCategory(msg){
  const label = inbox.rules[msg.fromAddress] || 'new';
  if(msg.course && label !== 'important') return { category: 'important', label, promoted: `Mentions ${msg.course}` };
  return { category: label, label, promoted: '' };
}

function setSenderLabel(address, label){
  if(!SENDER_LABELS.includes(label)) delete inbox.rules[address];
  else inbox.rules[address] = label;
  saveInbox();
  renderInbox();
}

function setMailDone(key, done){
  const msg = inbox.messages.find(m => m.key === key);
  if(!msg) return;
  msg.done = done;
  saveInbox();
  renderInbox();
}

function addMailDeadline(key){
  const msg = inbox.messages.find(m => m.key === key);
  const input = document.querySelector(`[data-due-for="${key}"]`);
  if(!msg || !input || !input.value) return showToast('Pick a date first');
  state.agenda.push({ id: uid(), title: msg.subject, date: input.value });
  Store.set('agenda', state.agenda);
  msg.deadlineAdded = true;
  saveInbox();
  renderAgenda(); // also refreshes Today's deadlines
  renderInbox();
  showToast('Added to Deadlines');
}

function openMail(key){
  const msg = inbox.messages.find(m => m.key === key);
  if(!msg || !msg.messageId) return;
  const id = msg.messageId.replace(/^<|>$/g, '');
  window.pcc.launchItem('url', `https://mail.google.com/mail/?authuser=${encodeURIComponent(inboxAccount.email)}#search/rfc822msgid%3A${encodeURIComponent(id)}`);
}

/* ----- Scanning ----- */

function ingestMail(messages){
  const fresh = [];
  for(const m of messages){
    if(inbox.messages.some(x => x.key === m.key)) continue;
    const text = `${m.subject}. ${m.text}`;
    const record = {
      key: m.key, messageId: m.messageId, fromName: m.fromName, fromAddress: m.fromAddress,
      subject: m.subject, date: m.date, snippet: m.text.slice(0, 220), seen: m.seen,
      course: detectCourse(text), due: detectDue(text, m.date), done: false, deadlineAdded: false,
    };
    inbox.messages.push(record);
    fresh.push(record);
  }
  const cutoff = Date.now() - INBOX_KEEP_DAYS * 86400000;
  inbox.messages = inbox.messages.filter(m => new Date(m.date).getTime() >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
  return fresh;
}

async function scanMail(manual){
  if(inboxScanning || !window.pcc || !window.pcc.scanEmail) return;
  inboxScanning = true;
  renderInbox();
  try{
    const result = await window.pcc.scanEmail(inbox.messages.map(m => m.key));
    if(result.error){
      inboxError = result.notConfigured ? 'not-configured' : result.error;
      if(manual) showToast(result.notConfigured ? 'Set up mail in Settings first' : 'Could not read mail');
    } else {
      inboxError = null;
      const fresh = ingestMail(result.messages || []);
      const important = fresh.filter(m => mailCategory(m).category === 'important');
      // Don't announce the first scan: it brings in two weeks of mail at once.
      if(inbox.hadScan && important.length && window.pcc.showNotification){
        window.pcc.showNotification(important.length === 1 ? 'New important mail' : `${important.length} new important emails`,
          important.length === 1 ? important[0].subject : important.slice(0, 3).map(m => m.subject).join(' · '));
      }
      inbox.hadScan = true;
      inbox.lastScan = Date.now();
      saveInbox();
      if(manual) showToast(fresh.length ? `${fresh.length} new email${fresh.length === 1 ? '' : 's'}` : 'No new mail');
      // A first scan can hold more mail than one pass downloads; keep going until it's all in.
      if(result.more) setTimeout(() => scanMail(false), 1500);
    }
  } catch(e){
    inboxError = 'Mail scan failed: ' + (e.message || e);
    if(manual) showToast('Mail scan failed');
  } finally {
    inboxScanning = false;
    renderInbox();
  }
}

// Runs once at startup: account details for "Open in Gmail", and the senders
// named in the old keyword scan's settings, which are carried over as Important.
async function loadInbox(){
  if(!window.pcc || !window.pcc.getMailConfig) return;
  const cfg = await window.pcc.getMailConfig();
  inboxAccount = { email: cfg.email, gmail: /gmail|google/i.test(cfg.imapHost || '') };
  if(cfg.legacyImportantSenders && cfg.legacyImportantSenders.length){
    for(const address of cfg.legacyImportantSenders){
      const key = address.toLowerCase().trim();
      if(key && !inbox.rules[key]) inbox.rules[key] = 'important';
    }
    saveInbox();
    await window.pcc.clearLegacyMailSenders();
  }
  renderInbox();
  scanMail(false);
  setInterval(() => scanMail(false), INBOX_RESCAN_MS);
}

/* ----- Drawing ----- */

function mailWhen(iso){
  const d = new Date(iso);
  const days = Math.round((parseLocalDate(todayStr()) - parseLocalDate(todayStr(d))) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24Hour() });
  if(days === 0) return time;
  if(days === 1) return 'Yesterday';
  if(days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.getDate() + ' ' + d.toLocaleDateString(undefined, { month: 'short' });
}

function dueLabel(due){
  const when = describeDaysAway(due.date);
  return `${when.text}${due.time ? ', ' + formatClock(due.time) : ''}`;
}

function inboxCounts(){
  const counts = { important: 0, opportunity: 0, info: 0, new: 0, ignore: 0 };
  for(const m of inbox.messages) if(!m.done) counts[mailCategory(m).category]++;
  return counts;
}

function mailRowHtml(msg, compact){
  const sort = mailCategory(msg);
  const name = msg.fromName || msg.fromAddress;
  const upcoming = msg.due && msg.due.date >= todayStr(); // a date that has passed is shown, but not offered as a deadline
  const tags = [
    msg.course ? `<span class="pill" style="background:color-mix(in srgb, ${colorForSubject(msg.course)} 18%, transparent); color:color-mix(in srgb, ${colorForSubject(msg.course)} 65%, var(--ink));">${esc(msg.course)}</span>` : '',
    msg.due ? `<span class="pill ${upcoming ? describeDaysAway(msg.due.date).cls : ''}" title="Date found in the email">${esc(dueLabel(msg.due))}</span>` : '',
    sort.promoted && sort.label !== 'new' ? `<span class="mail-note">Moved up from ${esc(MAIL_CATEGORIES[sort.label].label)}</span>` : '',
  ].filter(Boolean).join('');

  if(compact){
    return `
      <div class="mail-row compact ${msg.seen ? '' : 'unread'}" onclick="navigate('inbox')" role="button" tabindex="0">
        <div class="mail-main">
          <div class="mail-top"><span class="mail-from">${esc(name)}</span><span class="mail-when">${esc(mailWhen(msg.date))}</span></div>
          <div class="mail-subject">${esc(msg.subject)}</div>
          ${tags ? `<div class="mail-tags">${tags}</div>` : ''}
        </div>
      </div>`;
  }

  const unsorted = !inbox.rules[msg.fromAddress];
  const sorter = unsorted
    ? `<div class="mail-sorter"><span>Sort mail from this sender as</span>
        ${SENDER_LABELS.map(l => `<button class="btn" onclick="setSenderLabel('${esc(msg.fromAddress)}', '${l}')">${MAIL_CATEGORIES[l].short}</button>`).join('')}</div>`
    : '';
  const deadline = upcoming && !msg.deadlineAdded
    ? `<input type="date" data-due-for="${esc(msg.key)}" value="${esc(msg.due.date)}" aria-label="Deadline date" />
       <button class="btn" onclick="addMailDeadline('${esc(msg.key)}')">Add deadline</button>`
    : (msg.deadlineAdded ? '<span class="mail-note">In Deadlines</span>' : '');

  return `
    <div class="mail-row ${msg.seen ? '' : 'unread'} ${msg.done ? 'done' : ''}">
      <div class="mail-main">
        <div class="mail-top"><span class="mail-from" title="${esc(msg.fromAddress)}">${esc(name)}</span><span class="mail-when">${esc(mailWhen(msg.date))}</span></div>
        <div class="mail-subject">${esc(msg.subject)}</div>
        <div class="mail-snippet">${esc(msg.snippet)}</div>
        ${tags ? `<div class="mail-tags">${tags}</div>` : ''}
        ${sorter}
        <div class="mail-actions">
          ${deadline}
          <span class="mail-actions-right">
            ${inboxAccount.gmail && msg.messageId ? `<button class="btn" onclick="openMail('${esc(msg.key)}')">Open in Gmail</button>` : ''}
            <button class="btn ${msg.done ? '' : 'btn-success'}" onclick="setMailDone('${esc(msg.key)}', ${!msg.done})">${msg.done ? 'Not done' : 'Done'}</button>
          </span>
        </div>
      </div>
    </div>`;
}

function renderInboxSenders(){
  const known = {}; // address -> { name, count }
  for(const m of inbox.messages){
    const s = known[m.fromAddress] || (known[m.fromAddress] = { name: m.fromName || m.fromAddress, count: 0 });
    s.count++;
  }
  for(const address of Object.keys(inbox.rules)) if(!known[address]) known[address] = { name: address, count: 0 };
  const rows = Object.entries(known).sort((a, b) => b[1].count - a[1].count);
  if(!rows.length) return '<div class="empty">Senders appear here once mail has been scanned.</div>';
  return rows.map(([address, s]) => `
    <div class="item-row">
      <div class="txt"><div style="font-weight:500;">${esc(s.name)}</div><div class="mail-note">${esc(address)} · ${s.count} email${s.count === 1 ? '' : 's'}</div></div>
      <select onchange="setSenderLabel('${esc(address)}', this.value)" aria-label="Label for ${esc(s.name)}">
        <option value="" ${inbox.rules[address] ? '' : 'selected'}>Not sorted</option>
        ${SENDER_LABELS.map(l => `<option value="${l}" ${inbox.rules[address] === l ? 'selected' : ''}>${MAIL_CATEGORIES[l].short}</option>`).join('')}
      </select>
    </div>`).join('');
}

function renderInbox(){
  const body = document.getElementById('inbox-body');
  if(!body) return;
  const counts = inboxCounts();

  document.getElementById('inbox-tabs').innerHTML = [...Object.keys(MAIL_CATEGORIES), 'senders'].map(tab => `
    <button class="inbox-tab ${tab === inboxTab ? 'active' : ''}" onclick="showInboxTab('${tab}')">
      ${tab === 'senders' ? 'Senders' : MAIL_CATEGORIES[tab].label}${counts[tab] ? `<span>${counts[tab]}</span>` : ''}
    </button>`).join('');
  document.getElementById('inbox-refresh-btn').textContent = inboxScanning ? 'Checking…' : 'Check now';
  document.getElementById('inbox-status').textContent = inbox.lastScan ? `Checked ${describeAgo(inbox.lastScan)}` : '';
  document.getElementById('inbox-done-toggle').style.display = inboxTab === 'senders' ? 'none' : '';
  document.getElementById('inbox-show-done').checked = inboxShowDone;

  let notice = '';
  if(inboxError === 'not-configured'){
    notice = `<div class="pending-error">Mail isn't set up yet. <a href="#" onclick="openSettingsAt('mail'); return false;">Open mail settings</a></div>`;
  } else if(inboxError){
    notice = `<div class="pending-error">${esc(inboxError)}</div>`;
  }

  if(inboxTab === 'senders'){
    body.innerHTML = notice + renderInboxSenders();
  } else {
    const list = inbox.messages.filter(m => mailCategory(m).category === inboxTab && (inboxShowDone || !m.done));
    const hint = inboxTab === 'new' && list.length
      ? '<div class="mail-hint">Label a sender once and all their mail, past and future, is sorted for you.</div>' : '';
    const empty = {
      important: 'Nothing important waiting.',
      opportunity: 'No opportunities waiting.',
      info: 'Nothing here.',
      new: 'Every sender is sorted.',
      ignore: 'Nothing ignored.',
    }[inboxTab];
    body.innerHTML = notice + hint + (list.length ? list.map(m => mailRowHtml(m, false)).join('') : (inboxError ? '' : `<div class="empty">${empty}</div>`));
  }
  renderTodayMail(counts);
}

function showInboxTab(tab){ inboxTab = tab; renderInbox(); }
function toggleInboxDone(show){ inboxShowDone = show; renderInbox(); }

// The Mail card on Today: the newest important items, and a nudge when
// there are senders waiting to be sorted.
function renderTodayMail(counts){
  const el = document.getElementById('today-mail');
  if(!el) return;
  document.getElementById('today-mail-count').textContent = counts.important || '';
  if(inboxError === 'not-configured'){
    el.innerHTML = `<div class="empty">Connect your mail to see what needs attention.</div>
      <div><button class="btn" onclick="openSettingsAt('mail')">Set up mail</button></div>`;
    return;
  }
  const top = inbox.messages.filter(m => !m.done && mailCategory(m).category === 'important').slice(0, TODAY_MAIL_LIMIT);
  const more = counts.important - top.length;
  const nudge = counts.new ? `<a href="#" class="more-link" onclick="navigate('inbox'); showInboxTab('new'); return false;">${counts.new} email${counts.new === 1 ? '' : 's'} from senders you haven't sorted</a>` : '';
  el.innerHTML = (top.length ? top.map(m => mailRowHtml(m, true)).join('') : '<div class="empty">Nothing important waiting.</div>')
    + (more > 0 ? `<a href="#" class="more-link" onclick="navigate('inbox'); showInboxTab('important'); return false;">+ ${more} more</a>` : '')
    + nudge;
}
