/* ---------- Life (Habits & Weather) ---------- */
function addHabit(){
  const name = document.getElementById('habit-input').value.trim();
  if(!name) return;
  state.habits.list.push({id:uid(), name:name});
  document.getElementById('habit-input').value=''; Store.set('habits', state.habits); renderHabits();
}
function renderHabits(){
  const table = document.getElementById('habit-table');
  if(!state.habits.list.length){ table.innerHTML = '<tr><td class="empty">No habits yet.</td></tr>'; return; }
  
  const days = Array.from({length:7}, (_,i) => { let d=new Date(); d.setDate(d.getDate()-(6-i)); return d; });
  const head = '<tr><th></th>' + days.map(d => `<th>${d.toLocaleDateString(undefined,{weekday:'narrow'})}</th>`).join('') + '</tr>';
  
  const rows = state.habits.list.map(h => {
    const cells = days.map(d => {
      const ds = todayStr(d);
      const on = state.habits.log[ds] && state.habits.log[ds][h.id];
      return `<td><span class="hcell ${on?'on':''}" onclick="if(!state.habits.log['${ds}'])state.habits.log['${ds}']={}; state.habits.log['${ds}']['${h.id}']=!state.habits.log['${ds}']['${h.id}']; Store.set('habits', state.habits); renderHabits();"></span></td>`;
    }).join('');
    return `<tr>
      <td class="habit-name">${esc(h.name)} <button class="btn-icon" style="background:transparent; border:none; padding:0 4px;" onclick="state.habits.list=state.habits.list.filter(x=>x.id!=='${h.id}'); Store.set('habits', state.habits); renderHabits();">&times;</button></td>
      ${cells}
    </tr>`;
  }).join('');
  table.innerHTML = head + rows;
}

function loadWeather(force){
  const city = state.settings.weatherCity;
  const wb = document.getElementById('weather-body');
  if(!city){ wb.innerHTML = '<div class="empty">Set a city in Settings.</div>'; return; }
  if(force) wb.innerHTML = '<div class="empty">Loading weather&hellip;</div>';
  
  fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)
    .then(r => r.json())
    .then(d => {
      if(!d.results) throw new Error('City not found');
      return fetch(`https://api.open-meteo.com/v1/forecast?latitude=${d.results[0].latitude}&longitude=${d.results[0].longitude}&current_weather=true`);
    })
    .then(r => r.json())
    .then(d => {
      const cw = d.current_weather;
      wb.innerHTML = `
        <div class="weather-temp">${Math.round(cw.temperature)}&deg;</div>
        <div class="weather-meta">${esc(city)} · Wind ${Math.round(cw.windspeed)} km/h</div>`;
    }).catch(() => wb.innerHTML = '<div class="empty">Weather is unavailable right now.</div>');
}

/* ---------- Aesthetic Widget ---------- */
function handleImageUpload(files){
  if(!files.length) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.images.push(e.target.result);
    Store.set('images', state.images);
    currentImageIdx = state.images.length - 1;
    updateAestheticWidget();
  };
  reader.readAsDataURL(files[0]);
}
function shuffleAesthetics(){
  currentWidgetQuote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  if(state.images.length > 0) currentImageIdx = (currentImageIdx + 1) % state.images.length;
  updateAestheticWidget();
}
function updateAestheticWidget(){
  document.getElementById('widget-quote-text').textContent = `“${currentWidgetQuote}”`;
  if(state.images.length > 0) {
    document.getElementById('widget-img').style.backgroundImage = `url('${state.images[currentImageIdx]}')`;
  }
}
