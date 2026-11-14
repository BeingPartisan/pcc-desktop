/* ---------- Floating island: data feed ---------- */
// The island is a separate window (see island.js in the main process). It
// has no data of its own: this file sends it a snapshot of what the app
// knows whenever that changes, and carries out the buttons pressed on it.
// Times are sent as timestamps so the island can count down by itself.

// Today's classes as { subject, room, start, end } with start / end in
// milliseconds, from the Digiicampus sync if there is one, otherwise from
// the manual timetable.
function islandClasses(){
  const today = todayStr();
  const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = parseLocalDate(today); d.setHours(h, m, 0, 0); return d.getTime(); };
  if(campusActive()){
    return campusSessionsOn(today).filter(s => !s.cancelled)
      .map(s => ({ subject: s.subject, room: s.room || '', start: at(s.start), end: at(s.end) }));
  }
  const slots = (state.timetable.days || {})[todayDayName()] || [];
  const midnight = parseLocalDate(today).getTime();
  return slots.map((slot, i) => {
    const times = slot && parseSlotTimes(state.timetable.slots[i]);
    return times ? { subject: slot.subject, room: slot.room || '', start: midnight + times.start * 60000, end: midnight + times.end * 60000 } : null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

function islandSnapshot(){
  const important = inbox.messages.filter(m => !m.done && mailCategory(m).category === 'important');
  const accent = currentAccent();
  return {
    accent, accentInk: inkForAccent(accent), clock24: use24Hour(),
    timer: { running: pomo.running, mode: pomo.mode, endsAt: pomo.endsAt, remaining: pomo.remaining, total: pomo.total },
    classes: islandClasses(),
    mail: { count: important.length, latest: important[0] ? { subject: important[0].subject, from: important[0].fromName || important[0].fromAddress } : null },
    quote: currentWidgetQuote,
  };
}

function pushIsland(){
  if(!window.pcc || !window.pcc.islandState || !prefs().islandEnabled) return;
  try { window.pcc.islandState(islandSnapshot()); } catch(e){ console.error('Island update failed', e); }
}

// Tell the main process whether the island should exist and how it behaves.
function configureIsland(){
  if(!window.pcc || !window.pcc.islandConfigure) return;
  const p = prefs();
  window.pcc.islandConfigure({ enabled: !!p.islandEnabled, media: !!p.islandMedia, position: p.islandPosition, hide: p.islandHide })
    .then(pushIsland);
}

// Buttons pressed on the island
if(window.pcc && window.pcc.onIslandAction){
  window.pcc.onIslandAction((action) => {
    if(action.type === 'pomo-toggle') pomoToggle();
    else if(action.type === 'pomo-reset') pomoReset();
    else if(action.type === 'open' && action.page) navigate(action.page);
    pushIsland();
  });
}

// Refresh the island whenever something it shows is redrawn in the app...
hookRender('renderPomo', pushIsland);
hookRender('renderTimetable', pushIsland);
hookRender('renderInbox', pushIsland);
hookRender('updateAestheticWidget', pushIsland);
// ...and every half minute, so it rolls over at midnight and recovers if a push was missed.
setInterval(pushIsland, 30 * 1000);
