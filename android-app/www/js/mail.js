/* ---------- Mail ---------- */
// Read-only, like PCC on the computer: Gmail's IMAP with an app password
// (MailPlugin.java does the reading; the password is encrypted on the phone).
// The last fetch is kept here ('mailCache') so the page opens instantly.
//   To you   addressed to you personally (not a list or a big group): 'direct' or 'cc'
//   Courses  mentions one of your Digiicampus courses
//   All      the last two weeks

const MAIL_REFRESH_MS = 10 * 60 * 1000;
const mail = { view: 'you', busy: false, error: '', status: null, showRead: false };
// Mail you've dealt with: read in Gmail (its own flag), opened from here, or ticked here.
// Only hidden in PCC; nothing changes in Gmail. 'mailCleared' holds the ticked and opened ones.
const mailCleared = () => new Set(Store.get('mailCleared', []));
const isCleared = (m) => m.seen || mailCleared().has(m.key);
function mailClear(key){
  const list = Store.get('mailCleared', []);
  if(!list.includes(key)){ list.push(key); Store.set('mailCleared', list.slice(-500)); }
  render();
}
const mailPlugin = () => ((window.Capacitor && window.Capacitor.Plugins) || {}).Mail;
const mailCache = () => Store.get('mailCache', { fetchedAt: 0, messages: [] });

async function mailStatus(){
  const p = mailPlugin();
  mail.status = p ? await p.status().catch(() => null) : null;
  return mail.status;
}

async function mailRefresh(manual){
  const p = mailPlugin();
  if(!p || mail.busy || !(mail.status && mail.status.configured)) return;
  mail.busy = true; mail.error = ''; render();
  try {
    const { messages } = await p.fetch({ daysBack: 14, limit: 80 });
    Store.set('mailCache', { fetchedAt: Date.now(), messages });
    if(manual) toast('Mail updated');
  } catch(e){ mail.error = (e && e.message) || "Couldn't reach your mail."; }
  finally { mail.busy = false; render(); }
}

function mailMaybeRefresh(){ if(Date.now() - mailCache().fetchedAt > MAIL_REFRESH_MS) mailRefresh(false); }

async function mailSave(){
  const p = mailPlugin();
  const email = document.getElementById('mail-email').value.trim(), password = document.getElementById('mail-pass').value;
  const note = document.getElementById('mail-note');
  if(!p){ note.textContent = 'Mail works in the installed app.'; return; }
  note.className = 'note'; note.textContent = 'Checking the sign-in…';
  try {
    await p.save({ email, password });
    await mailStatus();
    const { messages } = await p.fetch({ daysBack: 14, limit: 80 });
    Store.set('mailCache', { fetchedAt: Date.now(), messages });
    document.getElementById('mail-pass').value = '';
    toast('Signed in. Your mail is here.');
    mail.error = '';
  } catch(e){
    note.className = 'note bad'; note.textContent = (e && e.message) || "Couldn't sign in.";
    return;
  }
  render();
}

async function mailForget(){
  if(!confirm('Remove your mail sign-in from this phone?')) return;
  await mailPlugin().forget(); localStorage.removeItem('mailCache'); await mailStatus(); render();
}

function mailOpen(key){
  const m = mailCache().messages.find(x => x.key === key);
  if(m && m.messageId) mailPlugin().open({ messageId: m.messageId });
  mailClear(key);   // opened, so it's been read
}

/* ----- Sorting ----- */
const courseNames = () => [...new Set(((Store.get('campus', null) || {}).attendance || { courses: [] }).courses.map(c => c.name)
  .concat(((Store.get('campus', null) || {}).sessions || []).map(s => s.subject)))].filter(Boolean);
// "Corporate Law II" also matches "Corporate Law 2" and "Corporate Law".
function mentionedCourse(subject){
  const s = String(subject || '').toLowerCase();
  for(const name of courseNames()){
    const base = name.toLowerCase().replace(/\s+(i{1,3}|iv|v|vi|[1-6])$/, '').trim();
    if(base.length >= 6 && s.includes(base)) return name;
  }
  return '';
}
const toYou = (m) => m.audience === 'direct' || m.audience === 'cc';

function mailList(view, includeRead = mail.showRead){
  const all = mailCache().messages.filter(m => includeRead || !isCleared(m));
  if(view === 'you') return all.filter(toYou);
  if(view === 'courses') return all.filter(m => mentionedCourse(m.subject));
  return all;
}

function mailWhen(ms){
  const d = new Date(ms), now = new Date();
  if(d.toDateString() === now.toDateString()) return timeText(ms);
  const days = Math.round((parseLocalDate(todayStr()) - parseLocalDate(todayStr(d))) / 86400000);
  return days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function mailRow(m){
  const course = mentionedCourse(m.subject);
  const tag = m.audience === 'direct' ? '<span class="tag">To you</span>' : m.audience === 'cc' ? '<span class="tag">Cc you</span>' : course ? `<span class="tag soft">${esc(course)}</span>` : '';
  return `<button class="row mail-row" onclick="mailOpen('${esc(m.key)}')">
    <div class="avatar">${esc((m.fromName || m.fromAddress || '?').trim().charAt(0).toUpperCase())}</div>
    <div class="txt"><div class="title">${tag}${esc(m.subject)}</div><div class="sub">${esc(m.fromName || m.fromAddress)}</div></div>
    <span class="side">${mailWhen(m.date)}</span>
    ${isCleared(m) ? '' : `<span class="tick" role="button" aria-label="Clear" onclick="event.stopPropagation(); mailClear('${esc(m.key)}')">${CHECK_SVG}</span>`}</button>`;
}

/* ----- Today's card and the page ----- */
function renderTodayMail(){
  const head = document.getElementById('mail-head'), el = document.getElementById('today-mail');
  const configured = mail.status && mail.status.configured;
  head.hidden = el.hidden = !configured;
  if(!configured) return;
  const recent = mailList('you').filter(m => Date.now() - m.date < 3 * 86400000);
  document.getElementById('mail-side').textContent = recent.length ? `${recent.length} to you` : '';
  el.innerHTML = recent.length ? recent.slice(0, 3).map(mailRow).join('') : '<div class="empty">Nothing addressed to you in the last few days.</div>';
}

function renderMail(){
  const el = document.getElementById('mail-body');
  const configured = mail.status && mail.status.configured;
  if(!configured){
    el.innerHTML = `<div class="card form-card">
      <b>Read your mail here</b>
      <div class="note">PCC reads your mail (never sends or changes it) and picks out what's addressed to you and what mentions your courses. It signs in with a Gmail <b>app password</b>, not your normal password:</div>
      <ol class="steps">
        <li>Turn on 2-Step Verification for your Google account, if it isn't already.</li>
        <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank">Google app passwords</a>, create one called "PCC", and copy it.</li>
        <li>Paste it below. It's encrypted on this phone.</li></ol>
      <label>Email<input id="mail-email" type="email" placeholder="you@nls.ac.in" autocomplete="email" /></label>
      <label>App password<input id="mail-pass" type="password" placeholder="16 letters" autocomplete="off" /></label>
      <button class="btn primary" onclick="mailSave()">Check and save</button>
      <div class="note" id="mail-note"></div></div>`;
    return;
  }
  // First load: the shape of the list while the mail comes.
  if(mail.busy && !mailCache().fetchedAt){
    el.innerHTML = `<div class="seg mail-seg"><button class="on">To you</button><button>Courses</button><button>All</button></div>
      <div class="campus-status"><span>Checking your mail…</span></div><div class="card">${skeletonRows(5, true)}</div>`;
    return;
  }
  const list = mailList(mail.view);
  const counts = { you: mailList('you').length, courses: mailList('courses').length, all: mailList('all').length };
  el.innerHTML = `
    <div class="seg mail-seg">${[['you', 'To you'], ['courses', 'Courses'], ['all', 'All']].map(([v, l]) => `<button class="${mail.view === v ? 'on' : ''}" onclick="mail.view='${v}'; render()">${l} <small>${counts[v]}</small></button>`).join('')}</div>
    <div class="campus-status ${mail.error ? 'bad' : ''}"><span>${mail.busy ? 'Checking your mail…' : mail.error ? esc(mail.error) : `Updated ${ago(mailCache().fetchedAt)}`}</span><button class="link" onclick="mailRefresh(true)">Refresh</button></div>
    <div class="card">${list.length ? list.map(mailRow).join('') : `<div class="empty">${!mail.showRead && mailList(mail.view, true).length ? 'All read. Nice.' : mail.view === 'you' ? 'Nothing addressed to you personally in the last two weeks.' : mail.view === 'courses' ? 'No mail mentioning your courses.' : 'No mail in the last two weeks.'}</div>`}</div>
    <div class="switch-row" style="margin:10px 4px;"><span class="note">Show mail you've already read</span>
      <button class="toggle ${mail.showRead ? 'on' : ''}" aria-label="Show read mail" onclick="mail.showRead=!mail.showRead; render()"><i></i></button></div>
    <div class="note" style="margin:12px 4px;">Read in Gmail, opened here, or ticked: it's cleared from PCC only; Gmail stays as it is.</div>
    <div class="note" style="margin:12px 4px;">Signed in as ${esc(mail.status.email)} · <button class="link" onclick="mailForget()">Remove</button></div>`;
}
