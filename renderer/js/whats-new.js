/* ---------- What's new ---------- */
// The first time PCC opens after an update, a short card shows what changed,
// in plain words, with a button to go and try each thing. It appears once per
// version; Settings > About and Ctrl+K bring it back.
//
// To add notes for a release: put a new entry at the top of RELEASE_NOTES
// with the version from package.json. Keep each item to a title and a
// sentence or two about what the user can now do. `go` runs when its
// button is pressed; leave it out for changes there's nothing to click on.

const RELEASE_NOTES = [
  {
    version: '2.6.0',
    items: [
      { icon: 'music', title: 'Your desktop dances to the music', text: 'Pick Bars, Wave or Ring and whatever you play moves on your wallpaper itself, behind your desktop icons, which stay clickable. Your windows simply cover it.', go: { label: 'Turn it on', run: () => openSettingsAt('island') } },
      { icon: 'music', title: 'Nebula, Orbit and Album art', text: 'Three more styles: a turning galaxy that lights up with the song, a little solar system where each planet is a part of the music, and a corner card with the cover of what you\'re playing and a record spinning behind it.', go: { label: 'Pick a style', run: () => openSettingsAt('island') } },
      { icon: 'music', title: 'It feels the music', text: 'Heavy, fast, bass-driven tracks make it punch on every kick and throw sparks; soft, slow songs make it drift and glow with long trails. It works this out as the song plays.' },
      { icon: 'music', title: 'Bars in the island', text: 'While music plays, little bars beside the track name move with the beat.' },
      { icon: 'star', title: 'The PCC icon is the logo', text: 'The mark at the top of the rail is now the PCC icon. You can still type your own letters or pick an image in Settings.' },
      { icon: 'island', title: 'The island gets out of PCC\'s way', text: 'While you use PCC itself (or one of its file pickers) the island shrinks to a small handle.' },
      { icon: 'island', title: 'Hide it for a while', text: 'Point at the island and choose "Hide 30 min" or "Hide 2 hours". Bring it back early from the tray icon\'s menu.' },
    ],
  },
  {
    version: '2.5.0',
    items: [
      { icon: 'chat', title: 'Messages has its own page', text: 'Your chats are now on the rail, with the whole conversation, unread counts, and New / Join right there. No more digging in Settings.', go: { label: 'Open Messages', run: () => navigate('messages') } },
      { icon: 'stack', title: 'The island keeps every message', text: 'Several messages in a row now all show on the island. Click one to reply, and the chat stays above the box. Replying clears that person\'s messages.' },
      { icon: 'star', title: 'Feedback is one click away', text: 'The star at the bottom of the rail sends a bug report or an idea straight to the developer.', go: { label: 'Try it', run: () => openFeedback() } },
      { icon: 'mail', title: '"To you" in your Inbox', text: 'Mail sent to you personally gets a "To you" or "Cc you" tag, and "To you only" hides mailing lists and batch-wide mail.', go: { label: 'Open Inbox', run: () => navigate('inbox') } },
      { icon: 'calendar', title: 'Import your schedule', text: 'Paste a table of dates, components and courses (from Word or Docs) into the Evaluation card. Short course names like "LPD" are understood, and marks can be filled in later.', go: { label: 'Open Academics', run: () => navigate('academics') } },
      { icon: 'key', title: 'Digiicampus stays signed in', text: 'Restarting your laptop no longer asks you to sign in again. Sign in once more after this update, then it lasts the week.' },
    ],
  },
  {
    version: '2.4.1',
    items: [
      { icon: 'mail', title: 'Clearer mail sign-in', text: 'If mail can\'t sign in, Settings says why and how to fix it, and checks the sign-in as soon as you press Save.' },
      { icon: 'island', title: 'The island stays out of your tabs', text: 'It opens only when the pointer rests on it, and can shrink to a small handle over maximised windows (Settings > Island).' },
    ],
  },
  {
    version: '2.4.0',
    items: [
      { icon: 'heart', title: 'One-tap messages and shared countdowns', text: 'Send "Thinking of you" with one click from the island, share when you\'re focusing, and count down to dates together on the Life page.' },
    ],
  },
];

const SEEN_VERSION_KEY = '__seenVersion';
const WHATS_NEW_ICONS = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  stack: '<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/>',
  star: '<path d="M12 3l2.4 5.2 5.6.6-4.2 3.8 1.2 5.5L12 15.3 7 18.1l1.2-5.5L4 8.8l5.6-.6z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8"/><path d="M16 7l2 2"/>',
  island: '<rect x="5" y="9" width="14" height="6" rx="3"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  music: '<path d="M5 20v-6"/><path d="M10 20V8"/><path d="M15 20v-9"/><path d="M20 20V4"/>',
};

// 2.10.0 > 2.9.1: compare number by number.
function compareVersions(a, b){
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for(let i = 0; i < 3; i++){ if((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

let whatsNewShown = [];   // the notes in the open card, so its buttons can find their actions

function showWhatsNew(notes){
  if(!notes.length) return;
  whatsNewShown = notes.flatMap(n => n.items);
  const title = document.getElementById('whats-new-title');
  title.textContent = notes.length === 1 ? `What's new in ${notes[0].version}` : `What's new since ${notes[notes.length - 1].version}`;
  let i = 0;
  document.getElementById('whats-new-list').innerHTML = notes.map(n => `
    ${notes.length > 1 ? `<div class="wn-version">Version ${esc(n.version)}</div>` : ''}
    ${n.items.map(item => `
      <div class="wn-item">
        <span class="wn-icon"><svg viewBox="0 0 24 24">${WHATS_NEW_ICONS[item.icon] || WHATS_NEW_ICONS.star}</svg></span>
        <div class="wn-body">
          <div class="wn-title">${esc(item.title)}</div>
          <div class="wn-text">${esc(item.text)}</div>
        </div>
        ${item.go ? `<button class="btn" onclick="runWhatsNew(${i++})">${esc(item.go.label)}</button>` : `<span hidden>${i++}</span>`}
      </div>`).join('')}`).join('');
  document.getElementById('whats-new-overlay').classList.add('open');
}

function runWhatsNew(index){
  const item = whatsNewShown[index];
  closeWhatsNew();
  if(item && item.go) item.go.run();
}

function closeWhatsNew(){ document.getElementById('whats-new-overlay').classList.remove('open'); }

// Settings > About and Ctrl+K: the notes for the version that's running (or the newest written).
async function openWhatsNew(){
  const version = await window.pcc.getAppVersion();
  const notes = RELEASE_NOTES.find(n => n.version === version) || RELEASE_NOTES[0];
  showWhatsNew([notes]);
}

// At startup: once per version, show what changed since the last version this computer saw.
async function checkWhatsNew(){
  if(!window.pcc || !window.pcc.getAppVersion) return;
  const version = await window.pcc.getAppVersion();
  if(!RELEASE_NOTES.some(n => compareVersions(n.version, version) <= 0)) return; // a development run reports Electron's version
  let seen = null;
  try { seen = localStorage.getItem(SEEN_VERSION_KEY); } catch(e){}
  try { localStorage.setItem(SEEN_VERSION_KEY, version); } catch(e){}
  // A brand-new install gets the welcome instead; someone updating from before
  // this existed is shown only the newest version's notes.
  if(localStorage.getItem(WELCOME_PENDING_KEY)) return;
  if(seen && compareVersions(version, seen) <= 0) return;
  const notes = RELEASE_NOTES
    .filter(n => compareVersions(n.version, version) <= 0 && (seen ? compareVersions(n.version, seen) > 0 : n.version === version))
    .slice(0, 3);
  if(notes.length) setTimeout(() => showWhatsNew(notes), 900); // after the window has settled
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && document.getElementById('whats-new-overlay').classList.contains('open')) closeWhatsNew();
});
