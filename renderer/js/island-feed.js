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
    quote: currentWidgetQuote, quoteAuthor: currentWidgetAuthor,
    capture: !!prefs().islandCapture,
    musicBars: !!prefs().musicBars,
    channels: msg.channels.map(c => ({ id: c.id, name: c.name })),
    messages: msg.unread.slice(0, 8),
    unreadCount: msg.unread.length,
    threads: channelThreads(),
    workspaces: islandWorkspaces(),
    nudges: nudgePhrases(),
    presence: activePresence().map(p => ({ channelId: p.channelId, from: p.from, state: p.state, until: p.until })),
    countdowns: islandCountdowns(),
    visualizer: prefs().visualizer, visualizerLayer: prefs().visualizerLayer,
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
  window.pcc.islandConfigure({ enabled: !!p.islandEnabled, media: !!p.islandMedia, position: p.islandPosition, hide: p.islandHide, breaks: !!p.islandBreaks, breakMinutes: p.islandBreakMinutes, visualizer: p.visualizer, visualizerPlace: p.visualizerPlace, visualizerLayer: p.visualizerLayer, desktop: !!p.desktopMode })
    .then(pushIsland);
}

// Text typed into the island goes into one running note, newest line first,
// so quick thoughts collect in a single place instead of a pile of notes.
function addQuickNote(text){
  let note = state.notes.find(n => n.quick);
  if(!note){ note = { id: uid(), title: 'Quick notes', body: '', quick: true, updatedAt: Date.now() }; state.notes.unshift(note); }
  const stamp = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: !use24Hour() });
  note.body = `${stamp}: ${text}` + (note.body ? '\n' + note.body : '');
  note.updatedAt = Date.now();
  Store.set('notes', state.notes); renderNotes();
}

function addQuickTask(text){
  state.tasks.unshift({ id: uid(), text, done: false, priority: 'med' });
  Store.set('tasks', state.tasks); renderTasks();
}

// Buttons pressed on the island
if(window.pcc && window.pcc.onIslandAction){
  window.pcc.onIslandAction((action) => {
    if(action.type === 'pomo-toggle') pomoToggle();
    else if(action.type === 'pomo-reset') pomoReset();
    else if(action.type === 'open' && action.page) navigate(action.page);
    else if(action.type === 'quick-note' && action.text) addQuickNote(String(action.text).slice(0, 500));
    else if(action.type === 'quick-task' && action.text) addQuickTask(String(action.text).slice(0, 200));
    else if(action.type === 'send-message') sendMessage(action.channelId, action.text, action.kind);
    else if(action.type === 'message-read') markMessageRead(action.id);
    else if(action.type === 'open-workspace') openWorkspace(action.id);
    // the layers button on the island, and the tray menu: visualiser over windows, or back on the wallpaper
    // the tray's Performance menu
    else if(action.type === 'perf-mode' && ['saver', 'balanced', 'best'].includes(action.mode)) setPref('perfMode', action.mode);
    else if(action.type === 'visualizer-layer') setPref('visualizerLayer', prefs().visualizerLayer === 'top' ? 'wallpaper' : 'top');
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
