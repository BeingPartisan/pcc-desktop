/* ---------- PCC's voice ---------- */
// PCC talks like a friend: cheeky, a bit sarcastic, quick to roast you when
// you slack and to hype you up when you deliver. "Keep it simple" (Settings >
// Appearance) swaps all of that for plain words.
//
//   say(plain, ...funny)   the plain line, or one of the funny ones. The pick
//                          stays the same for the day, so a screen doesn't
//                          change its joke every time it redraws.
//   sayAny(plain, ...funny) the same, but a fresh pick each time (for toasts).
//
// House rules for the funny lines: the information comes first (what's due,
// what broke, what to do), the joke second. No real swearing: "bish", "bro",
// "yaar" and friends are fine. Roast the situation, never the person's worth.

const keepSimple = () => !!(prefs && prefs().keepSimple);

function voiceHash(text){
  let h = 2166136261;
  for(let i = 0; i < text.length; i++){ h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function say(plain, ...funny){
  if(keepSimple() || !funny.length) return plain;
  return funny[voiceHash(plain + '|' + funny[0] + '|' + todayStr()) % funny.length];
}

function sayAny(plain, ...funny){
  if(keepSimple() || !funny.length) return plain;
  return funny[Math.floor(Math.random() * funny.length)];
}

/* ----- Today: the greeting and the line under it ----- */

function greetingLead(hour){
  if(hour < 5) return say('Still up', 'Go to sleep', 'Bro, it\'s late', 'Still awake', 'Night owl mode');
  if(hour < 12) return say('Good morning', 'Rise and grind', 'Wakey wakey', 'Morning', 'Top of the morning');
  if(hour < 17) return say('Good afternoon', 'Post-lunch slump', 'Yo', 'Afternoon', 'Sup');
  if(hour < 21) return say('Good evening', 'Evening', 'Wassup', 'Look who\'s back', 'Good evening');
  return say('Good night', 'Almost bedtime', 'Night night', 'Late again', 'Wrapping up');
}

// One line under the date that sums up the day. Plain: a short summary.
// Funny: whatever deserves a comment most, in this order.
function heroQuip(){
  const today = todayStr();
  const deadlines = typeof openDeadlines === 'function' ? openDeadlines() : [];
  const overdue = deadlines.filter(d => d.date < today).length;
  const dueToday = deadlines.filter(d => d.date === today).length;
  const dueSoon = deadlines.filter(d => d.date > today && Math.round((parseLocalDate(d.date) - parseLocalDate(today)) / 86400000) <= 7).length;
  const open = state.tasks.filter(t => !t.done).length;
  const hadTasks = state.tasks.length > 0;
  const att = campus && campus.data && campus.data.attendance;
  const lowAttendance = att && att.total && att.percentage < attendanceTarget() ? Math.round(att.percentage) : null;
  const hour = new Date().getHours();

  if(keepSimple()){
    const bits = [];
    if(overdue) bits.push(`${overdue} overdue`);
    if(dueToday) bits.push(`${dueToday} due today`);
    if(open) bits.push(`${open} task${open === 1 ? '' : 's'} open`);
    return bits.join(' · ');
  }
  if(overdue) return say('', `${overdue} overdue. They're not going to submit themselves, bish.`, `${overdue} deadline${overdue === 1 ? '' : 's'} already gone. Pretend you didn't see this and go fix it.`, `Overdue: ${overdue}. Your professor has entered the chat.`);
  if(dueToday) return say('', `Something's due today. Future you is already sweating.`, `${dueToday} due today. Lock in, yaar.`, `Due today: ${dueToday}. No pressure. Okay, some pressure.`);
  if(hour < 5) return say('', 'The assignment can wait, your sleep can\'t.', 'Whatever you\'re doing, it can wait till morning. Probably.', 'Sleep is free, bro. Take some.');
  if(lowAttendance !== null) return say('', `Attendance at ${lowAttendance}%. Your professor is starting to forget your face.`, `${lowAttendance}% attendance. Proxy friends can only do so much.`);
  if(hadTasks && !open) return say('', 'Zero tasks left. Damn bro, who even are you?', 'Everything\'s done. Go touch some grass, you earned it.', 'Task list: empty. Productivity: illegal levels.');
  if(open > 6) return say('', `${open} tasks open. Bro is collecting them like Pokémon.`, `${open} things to do. Pick one. Any one. Please.`);
  if(dueSoon) return say('', `${dueSoon} due this week. No pressure. Okay, a little pressure.`, `${dueSoon} deadline${dueSoon === 1 ? '' : 's'} this week. Start now and thank yourself later.`);
  return say('', 'Nothing on fire. Enjoy it while it lasts.', 'All calm. Suspiciously calm.', 'Clean slate. Don\'t ruin it.');
}

function renderHeroQuip(){
  const el = document.getElementById('hero-quip');
  if(!el) return;
  try { el.textContent = heroQuip(); } catch(e){ el.textContent = ''; }
}
