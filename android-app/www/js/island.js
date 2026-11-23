/* ---------- The island ---------- */
// An Android Live Update (Island.java does the showing and the timing, even
// with the app closed). Here we work out what could show over the next few
// days and hand it over; only one thing shows at a time, in this order:
//   0 class      from `lead` minutes before a class until it ends
//   1 today      deadlines due today, from the morning until midnight
//   2 tomorrow   deadlines due tomorrow, from the evening before
//   3 overdue    deadlines past their date, from the morning
//   4 tasks      open high-priority tasks, from a chosen time   (off by default)
// "Done" on a single deadline ticks it off (collected here with takeDone);
// "Hide" puts the island away for a few hours, then it comes back by itself.
//
// Settings (Store):
//   __islandOn, __islandLead (30 | 60 | 90)
//   __islandDl, __islandDlHour      deadlines due today, and from what hour (9)
//   __islandEve, __islandEveHour    the evening before, and from what hour (20)
//   __islandOverdue                 overdue, from the same hour as today's
//   __islandTasks, __islandTasksHour  high-priority tasks (off), and from what hour (10)
//   __islandHideHours               3 | 4

const ISLAND_LEADS = [30, 60, 90];
const islandPlugin = () => ((window.Capacitor && window.Capacitor.Plugins) || {}).Island;
let islandStatus = null;   // { notifications, promoted, hiddenUntil } as Android reports them
let islandSent = '';       // what was last handed over, to skip needless updates

const islandOn = () => Store.get('__islandOn', true);
const islandLead = () => Store.get('__islandLead', 60);
const islandOpt = (key, fallback) => Store.get('__island' + key, fallback);

function islandAt(dateStr, hour){ const d = parseLocalDate(dateStr); d.setHours(hour, 0, 0, 0); return d.getTime(); }
const islandMidnight = (dateStr) => parseLocalDate(dateStr).getTime() + 86400000;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A deadline item: one deadline gets its own title and a Done button; several are listed together.
function islandDeadlineItem(kind, priority, list, chip, start, end, label){
  if(!list.length || end <= Date.now()) return null;
  if(list.length === 1) return { kind, priority, start, end, title: list[0].title, text: label, chip, key: list[0].key };
  return { kind, priority, start, end, title: label.replace('A deadline', plural(list.length, 'deadline', 'deadlines')).replace(' is ', ' are '),
           text: list.map(d => '• ' + d.title).join('\n'), chip, key: '' };
}

function islandItems(){
  const out = [];
  const deadlines = openDeadlines();
  const tasks = data.tasks.filter(t => !t.done && t.priority === 'high');
  const dlHour = islandOpt('DlHour', 9), eveHour = islandOpt('EveHour', 20), tasksHour = islandOpt('TasksHour', 10);

  for(let i = 0; i < 3; i++){
    const d = new Date(); d.setDate(d.getDate() + i);
    const day = todayStr(d);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const tomorrow = todayStr(next);

    for(const c of classesOn(day)) if(c.end > Date.now()) out.push({ kind: 'class', priority: 0, title: c.subject, room: c.room, start: c.start, end: c.end });

    if(islandOpt('Dl', true))
      out.push(islandDeadlineItem('today', 1, deadlines.filter(x => x.date === day), 'Due today', islandAt(day, dlHour), islandMidnight(day), 'A deadline is due today'));
    if(islandOpt('Eve', true))
      out.push(islandDeadlineItem('tomorrow', 2, deadlines.filter(x => x.date === tomorrow), 'Tomorrow', islandAt(day, eveHour), islandMidnight(day), 'A deadline is due tomorrow'));
    if(islandOpt('Overdue', true)){
      const late = deadlines.filter(x => x.date < day);
      if(late.length) out.push(islandDeadlineItem('overdue', 3, late, plural(late.length, 'overdue', 'overdue'), islandAt(day, dlHour), islandMidnight(day), 'A deadline is overdue'));
    }
    if(islandOpt('Tasks', false) && tasks.length && islandMidnight(day) > Date.now())
      out.push({ kind: 'tasks', priority: 4, start: islandAt(day, tasksHour), end: islandMidnight(day),
                 title: tasks.length === 1 ? tasks[0].text : plural(tasks.length, 'high-priority task', 'high-priority tasks'),
                 text: tasks.length === 1 ? 'High-priority task' : tasks.map(t => '• ' + t.text).join('\n'),
                 chip: plural(tasks.length, 'task', 'tasks'), key: '' });
  }
  return out.filter(Boolean);
}

// Deadlines ticked "Done" on the notification since we last looked.
async function islandCollectDone(){
  const p = islandPlugin();
  if(!p || !p.takeDone) return;
  try {
    const { keys } = await p.takeDone();
    for(const k of keys || []) completeDeadline(k);
  } catch(e){ console.warn('Island: could not collect Done', e); }
}

async function islandUpdate(force){
  const p = islandPlugin();
  if(!p) return;
  const args = { items: islandItems(), enabled: islandOn(), lead: islandLead(), hideHours: islandOpt('HideHours', 3) };
  const json = JSON.stringify(args);
  if(!force && json === islandSent) return;
  islandSent = json;
  try { islandStatus = await p.setSchedule(args); }
  catch(e){ islandSent = ''; console.warn('Island: could not update', e); }
}

// Called after every render: hands over anything that changed (a new deadline, a synced task...).
let islandTimer = null;
function islandSoon(){ clearTimeout(islandTimer); islandTimer = setTimeout(() => islandUpdate(false), 800); }

// Notifications have to be allowed once (Android asks); then the island can show.
async function islandAskPermission(){
  const ln = ((window.Capacitor && window.Capacitor.Plugins) || {}).LocalNotifications;
  if(ln){ try { await ln.requestPermissions(); } catch(e){} }
  await islandUpdate(true);
  render();
}

async function setIslandOn(on){
  Store.set('__islandOn', on);
  if(on) await islandAskPermission(); else await islandUpdate(true);
  render();
}
async function setIslandOpt(key, value){ Store.set('__island' + key, value); await islandUpdate(true); render(); }
async function setIslandLead(minutes){ await setIslandOpt('Lead', minutes); }
async function islandShowAgain(){ const p = islandPlugin(); if(p){ try { islandStatus = await p.hide({ hours: 0 }); } catch(e){} } render(); }
async function islandHideNow(){ const p = islandPlugin(); if(p){ try { islandStatus = await p.hide({ hours: islandOpt('HideHours', 3) }); } catch(e){} } render(); }
function islandOpenSettings(){ const p = islandPlugin(); if(p) p.openSettings(); }

const hourText = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

function islandRow(key, fallback, title, note, hourKey, hourDefault, hours){
  const on = islandOpt(key, fallback);
  return `<div class="switch-row"><div><b>${title}</b><div class="note">${note}</div></div>
      <button class="toggle ${on ? 'on' : ''}" aria-label="${title}" onclick="setIslandOpt('${key}', ${!on})"><i></i></button></div>
    ${on && hourKey ? `<div class="seg">${hours.map(h => `<button class="${h === islandOpt(hourKey, hourDefault) ? 'on' : ''}" onclick="setIslandOpt('${hourKey}', ${h})">${hourText(h)}</button>`).join('')}</div>` : ''}`;
}

function renderIslandCard(){
  const el = document.getElementById('island-card');
  if(!el) return;
  const on = islandOn(), s = islandStatus || {};
  const hasClasses = !!Store.get('campus', null);
  let warn = '';
  if(on && s.notifications === false) warn = `<div class="note bad">Notifications are off for PCC, so the island can't show.</div><button class="btn" onclick="islandAskPermission()">Allow notifications</button>`;
  else if(on && s.promoted === false) warn = `<div class="note">Live Updates are off for PCC, so it shows as a normal notification instead of in the island. <button class="link" onclick="islandOpenSettings()">Turn them on</button></div>`;
  const hidden = on && s.hiddenUntil && s.hiddenUntil > Date.now();
  const hideHours = islandOpt('HideHours', 3);

  el.innerHTML = `
    <div class="switch-row"><div><b>Island</b><div class="note">Your next class, deadlines and tasks, in the island or at the top of your notifications. One at a time: classes first.</div></div>
      <button class="toggle ${on ? 'on' : ''}" aria-label="Island" onclick="setIslandOn(${!on})"><i></i></button></div>
    ${hidden ? `<div class="note ok">Hidden until ${timeText(s.hiddenUntil)}. <button class="link" onclick="islandShowAgain()">Show again now</button></div>` : ''}
    ${on ? `
      <div class="field-label">Classes: appears before a class</div>
      <div class="seg">${ISLAND_LEADS.map(m => `<button class="${m === islandLead() ? 'on' : ''}" onclick="setIslandLead(${m})">${m} min</button>`).join('')}</div>
      ${!hasClasses ? '<div class="note">Classes need your timetable: connect Digiicampus first.</div>' : ''}
      ${islandRow('Dl', true, 'Deadlines due today', 'From this time until done or midnight. Tap Done on it to tick it off.', 'DlHour', 9, [7, 8, 9, 10])}
      ${islandRow('Eve', true, 'The evening before', 'Deadlines due tomorrow, from this time.', 'EveHour', 20, [18, 19, 20, 21])}
      ${islandRow('Overdue', true, 'Overdue deadlines', 'In the morning, from the same time as today\'s deadlines.')}
      ${islandRow('Tasks', false, 'High-priority tasks', 'When nothing else is showing, from this time.', 'TasksHour', 10, [9, 10, 12, 15])}
      <div class="field-label">"Hide" puts it away for</div>
      <div class="seg">${[3, 4].map(h => `<button class="${h === hideHours ? 'on' : ''}" onclick="setIslandOpt('HideHours', ${h})">${h} hours</button>`).join('')}</div>
      ${hidden ? '' : `<button class="btn" onclick="islandHideNow()">Hide for ${hideHours} hours</button>`}` : ''}
    ${warn}`;
}
