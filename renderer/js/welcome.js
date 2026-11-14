/* ---------- First-run welcome ---------- */
// Shown once, the first time PCC opens on a computer with no saved data.
// Three short steps: who you are, where your timetable comes from, and
// what the island is. Everything here can be changed later in Settings, and
// every step can be skipped.
//
// app.js decides whether this is a first run (before anything is saved) and
// sets WELCOME_PENDING_KEY; it stays set until the welcome is finished, so
// closing the app halfway brings it back next time.

const WELCOME_PENDING_KEY = '__welcomePending';
const WELCOME_STEPS = 3;
let welcomeStep = 0;

function showWelcome(){
  welcomeStep = 0;
  document.getElementById('welcome-overlay').classList.add('open');
  renderWelcome();
  document.getElementById('welcome-name').focus();
}

function renderWelcome(){
  document.querySelectorAll('.welcome-step').forEach((el, i) => { el.style.display = i === welcomeStep ? '' : 'none'; });
  document.querySelectorAll('.welcome-dot').forEach((el, i) => el.classList.toggle('active', i === welcomeStep));
  document.getElementById('welcome-back-btn').style.visibility = welcomeStep ? 'visible' : 'hidden';
  document.getElementById('welcome-next-btn').textContent = welcomeStep === WELCOME_STEPS - 1 ? 'Start using PCC' : 'Continue';
  document.getElementById('welcome-island').checked = !!prefs().islandEnabled;
  renderWelcomeCampus();
}

// Step 2 reflects whether the Digiicampus sign-in has been done.
function renderWelcomeCampus(){
  const connected = campusActive();
  document.getElementById('welcome-campus-btn').style.display = connected ? 'none' : '';
  document.getElementById('welcome-campus-done').style.display = connected ? '' : 'none';
}

async function welcomeConnectCampus(){
  await connectCampus();
  renderWelcomeCampus();
}

function welcomeBack(){ if(welcomeStep){ welcomeStep--; renderWelcome(); } }

function welcomeNext(){
  if(welcomeStep === 0){
    // Save the name and city as soon as they're given.
    const name = document.getElementById('welcome-name').value.trim();
    const city = document.getElementById('welcome-city').value.trim();
    if(name){ updateSettings('name', name); document.getElementById('set-name').value = name; }
    if(city){ updateSettings('weatherCity', city); document.getElementById('set-city').value = city; }
  }
  if(welcomeStep < WELCOME_STEPS - 1){ welcomeStep++; renderWelcome(); return; }
  finishWelcome();
}

function finishWelcome(){
  localStorage.removeItem(WELCOME_PENDING_KEY);
  document.getElementById('welcome-overlay').classList.remove('open');
}

// "Add my timetable by hand" on step 2
function welcomeManualTimetable(){ finishWelcome(); openSettingsAt('timetable'); }
