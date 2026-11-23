/* ---------- The island ---------- */
// Your next class as an Android Live Update (Island.java does the showing
// and the timing, even with the app closed): from `lead` minutes before a
// class until it ends. Here we hand over the coming classes whenever they
// may have changed, and keep the on/off and lead-time settings.
//   __islandOn   true | false      (default on)
//   __islandLead 30 | 60 | 90      minutes before a class it appears (default 60)

const ISLAND_LEADS = [30, 60, 90];
const islandPlugin = () => ((window.Capacitor && window.Capacitor.Plugins) || {}).Island;
let islandStatus = null;   // { notifications, promoted } as Android reports them

const islandOn = () => Store.get('__islandOn', true);
const islandLead = () => Store.get('__islandLead', 60);

// The next two days of classes, as the island needs them.
function islandClasses(){
  const out = [];
  for(let i = 0; i < 3; i++){
    const d = new Date(); d.setDate(d.getDate() + i);
    for(const c of classesOn(todayStr(d))) if(c.end > Date.now()) out.push({ title: c.subject, room: c.room, start: c.start, end: c.end });
  }
  return out;
}

async function islandUpdate(){
  const p = islandPlugin();
  if(!p) return;
  try { islandStatus = await p.setSchedule({ classes: islandClasses(), enabled: islandOn(), lead: islandLead() }); }
  catch(e){ console.warn('Island: could not update', e); }
}

// Notifications have to be allowed once (Android asks); then the island can show.
async function islandAskPermission(){
  const ln = ((window.Capacitor && window.Capacitor.Plugins) || {}).LocalNotifications;
  if(ln){ try { await ln.requestPermissions(); } catch(e){} }
  await islandUpdate();
  render();
}

async function setIslandOn(on){
  Store.set('__islandOn', on);
  if(on) await islandAskPermission(); else await islandUpdate();
  render();
}
async function setIslandLead(minutes){ Store.set('__islandLead', minutes); await islandUpdate(); render(); }
function islandOpenSettings(){ const p = islandPlugin(); if(p) p.openSettings(); }

function renderIslandCard(){
  const el = document.getElementById('island-card');
  if(!el) return;
  const on = islandOn(), s = islandStatus || {};
  const hasClasses = !!Store.get('campus', null);
  let warn = '';
  if(on && s.notifications === false) warn = `<div class="note bad">Notifications are off for PCC, so the island can't show.</div><button class="btn" onclick="islandAskPermission()">Allow notifications</button>`;
  else if(on && s.promoted === false) warn = `<div class="note">Live Updates are off for PCC, so it shows as a normal notification instead of in the island. <button class="link" onclick="islandOpenSettings()">Turn them on</button></div>`;
  el.innerHTML = `
    <div class="switch-row"><div><b>Show my next class</b><div class="note">From ${islandLead()} minutes before a class until it ends, in the island or at the top of your notifications.</div></div>
      <button class="toggle ${on ? 'on' : ''}" aria-label="Island" onclick="setIslandOn(${!on})"><i></i></button></div>
    ${on ? `<div class="field-label">Appears before a class</div>
      <div class="seg">${ISLAND_LEADS.map(m => `<button class="${m === islandLead() ? 'on' : ''}" onclick="setIslandLead(${m})">${m} min</button>`).join('')}</div>` : ''}
    ${!hasClasses ? '<div class="note">It needs your timetable: connect Digiicampus first.</div>' : ''}
    ${warn}`;
}
