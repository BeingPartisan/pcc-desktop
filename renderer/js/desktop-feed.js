/* ---------- Desktop mode: data feed ---------- */
// Desktop mode draws a PCC dashboard on the wallpaper (desktop.js in the
// main process, renderer/desktop/ for the page). Like the island it has no
// data of its own: this file sends it a snapshot whenever something it shows
// changes. Stage 1 is read-only, so nothing comes back.

const DESKTOP_WEATHER_EVERY_MS = 30 * 60 * 1000;
let desktopWeather = null;     // { city, temp, text, at }

// Open-Meteo's weather codes, in a few words.
function weatherWords(code){
  if(code === 0) return 'clear';
  if(code <= 2) return 'partly cloudy';
  if(code === 3) return 'cloudy';
  if(code <= 48) return 'fog';
  if(code <= 57) return 'drizzle';
  if(code <= 67) return 'rain';
  if(code <= 77) return 'snow';
  if(code <= 82) return 'showers';
  return 'thunderstorm';
}

// Weather for the city in Settings, at most every half hour (Open-Meteo is free and needs no key).
async function refreshDesktopWeather(){
  const city = state.settings.weatherCity;
  if(!city || !prefs().desktopMode) return;
  if(desktopWeather && desktopWeather.city === city && Date.now() - desktopWeather.at < DESKTOP_WEATHER_EVERY_MS) return;
  try {
    const place = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json());
    if(!place.results) return;
    const { latitude, longitude } = place.results[0];
    const d = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`).then(r => r.json());
    const cw = d.current_weather;
    desktopWeather = { city, temp: cw.temperature, text: weatherWords(cw.weathercode), code: cw.weathercode, day: cw.is_day !== 0, wind: cw.windspeed, at: Date.now() };
    pushDesktop();
  } catch(e){ /* offline; try again next time */ }
}

function desktopSnapshot(){
  const rank = { high: 0, med: 1, low: 2 };
  const open = state.tasks.filter(t => !t.done).sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
  const today = todayStr();
  const deadlines = [...state.agenda, ...evaluationDeadlines()].filter(a => a.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const important = inbox.messages.filter(m => !m.done && mailCategory(m).category === 'important');
  const att = campus.data && campus.data.attendance;
  const spent = state.finances.reduce((sum, f) => sum + f.amount, 0);
  const habits = state.habits.list;
  const log = state.habits.log[today] || {};
  const streak = habits.reduce((best, h) => Math.max(best, habitStreaks(h.id).current), 0);
  return {
    accent: currentAccent(), accentInk: inkForAccent(currentAccent()), clock24: use24Hour(), name: state.settings.name || '',
    timer: { running: pomo.running, mode: pomo.mode, endsAt: pomo.endsAt },
    classes: islandClasses(),
    tasks: open.slice(0, 6).map(t => ({ text: t.text, priority: t.priority })), taskCount: open.length,
    deadlines: deadlines.slice(0, 14).map(a => ({ title: a.title, date: a.date })),
    mail: important.slice(0, 2).map(m => ({ subject: m.subject, from: m.fromName || m.fromAddress, toYou: m.audience === 'direct' })),
    mailCount: important.length,
    messages: msg.unread.slice(0, 3).map(m => ({ from: m.from, text: m.text, channel: m.channel, at: m.at })),
    unread: msg.unread.length,
    presence: activePresence().map(p => ({ from: p.from, state: p.state, until: p.until })),
    countdowns: islandCountdowns(),
    quote: currentWidgetQuote, quoteAuthor: currentWidgetAuthor,
    attendance: att && att.total ? { pct: att.percentage, target: attendanceTarget() } : null,
    budget: state.settings.budget ? { left: Math.round(state.settings.budget - spent) } : null,
    habits: { done: habits.filter(h => log[h.id]).length, total: habits.length, streak },
    weather: desktopWeather && desktopWeather.city === state.settings.weatherCity ? desktopWeather : null,
  };
}

// Many things can change at once (and the timer redraws every second), so send at most a couple of times a second.
let desktopPushTimer = null;
function pushDesktop(){
  if(!window.pcc || !window.pcc.desktopState || !prefs().desktopMode || desktopPushTimer) return;
  desktopPushTimer = setTimeout(() => {
    desktopPushTimer = null;
    try { window.pcc.desktopState(desktopSnapshot()); } catch(e){ console.error('Desktop mode update failed', e); }
  }, 400);
}

// Tell the main process whether Desktop mode is on, and where the icons are.
function configureDesktop(){
  if(!window.pcc || !window.pcc.desktopConfigure) return;
  const p = prefs();
  window.pcc.desktopConfigure({ enabled: !!p.desktopMode, icons: p.desktopIcons }).then(() => { pushDesktop(); refreshDesktopWeather(); });
  configureIsland();   // the media helper also runs for Desktop mode
}

// Everything the dashboard shows comes from these pages; push after any of them redraws.
['renderTasks', 'renderAgenda', 'renderTimetable', 'renderPomo', 'renderInbox', 'renderFinances', 'renderHabits',
 'renderAcademics', 'renderCountdowns', 'updateAestheticWidget'].forEach(name => { if(typeof window[name] === 'function') hookRender(name, pushDesktop); });
// pushIsland runs whenever messages, presence and countdowns change, so follow it too.
hookRender('pushIsland', pushDesktop);
setInterval(() => { pushDesktop(); refreshDesktopWeather(); }, 60 * 1000);
