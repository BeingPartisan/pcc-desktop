/* ---------- Settings & Search ---------- */
function openSettings(){ document.getElementById('settings-overlay').classList.add('open'); loadMailSettingsUI(); loadHotkeyUI(); loadAutostartUI(); loadAboutUI(); renderCampusSettings(); renderAppearanceSettings(); }

// --- Autostart ---

function showAutostartState(state){
  const toggle = document.getElementById('autostart-toggle');
  const status = document.getElementById('autostart-status');
  toggle.checked = !!state.enabled;
  toggle.disabled = !state.supported;
  status.textContent = state.supported ? '' : 'Only available in the installed app, not in a development run.';
}
async function loadAutostartUI(){
  showAutostartState(await window.pcc.getAutostartStatus());
}
async function toggleAutostart(enable){
  const state = await window.pcc.setAutostart(enable);
  showAutostartState(state);
  if(state.supported) showToast(state.enabled ? 'PCC will start when you sign in' : 'Autostart turned off');
}

// --- Data backup: export / import / automatic daily backup ---
// Everything the app stores lives in localStorage. Keys starting with "__"
// are internal bookkeeping and are left out of backups.

const LAST_BACKUP_KEY = '__lastAutoBackup';
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function collectData(){
  const data = {};
  for(let i = 0; i < localStorage.length; i++){
    const key = localStorage.key(i);
    if(key.startsWith('__')) continue;
    const raw = localStorage.getItem(key);
    try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
  }
  return data;
}

async function exportData(){
  const result = await window.pcc.exportData(collectData());
  if(result.ok) showToast('Data exported');
  else if(!result.canceled) showToast('Export failed: ' + (result.error || 'unknown error'));
}

async function importData(){
  const picked = await window.pcc.pickImportFile();
  if(!picked.ok){
    if(!picked.canceled) showToast(picked.error || 'Import failed');
    return;
  }
  const when = picked.exportedAt ? new Date(picked.exportedAt).toLocaleString() : 'an unknown date';
  const sure = confirm(
    `Replace ALL current data with "${picked.fileName}" (saved ${when})?\n\n` +
    'Your current data is backed up automatically first, so this can be undone from the backups folder.'
  );
  if(!sure) return;

  // Safety copy of what's about to be replaced. Don't go ahead without it.
  const backup = await window.pcc.backupData(collectData(), 'before import');
  if(!backup.ok){ showToast('Import cancelled: could not back up current data'); return; }

  const applied = await window.pcc.applyImport();
  if(!applied.ok){ showToast('Import failed: ' + (applied.error || 'unknown error')); return; }

  Object.keys(collectData()).forEach(key => localStorage.removeItem(key));
  for(const [key, value] of Object.entries(picked.data)){
    if(key.startsWith('__')) continue;
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch(e){ console.error('Could not restore "' + key + '"', e); }
  }
  location.reload();
}

async function autoBackupIfDue(){
  if(!window.pcc || !window.pcc.backupData) return;
  const last = Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0;
  if(Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return;
  const result = await window.pcc.backupData(collectData(), 'daily');
  if(result.ok) localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
}
function closeSettings(){ document.getElementById('settings-overlay').classList.remove('open'); }

// Settings is a tabbed dialog: one pane is shown at a time. Pass a tab name
// to openSettingsAt() to land on a specific pane (e.g. 'timetable').
function showSettingsTab(tab){
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
}
function openSettingsAt(tab){ openSettings(); showSettingsTab(tab); }

document.addEventListener('keydown', e => {
  // Esc closes Settings, unless it is being used to cancel a shortcut capture.
  if(e.key !== 'Escape' || hotkeyCaptureStop) return;
  if(document.getElementById('settings-overlay').classList.contains('open')) closeSettings();
});

// --- About ---

async function loadAboutUI(){
  if(!window.pcc.getAppVersion) return;
  const version = await window.pcc.getAppVersion();
  document.getElementById('about-version').textContent = 'Version ' + version;
  document.getElementById('about-version-short').textContent = 'PCC ' + version;
}

async function checkForUpdatesNow(){
  const result = await window.pcc.checkForUpdates();
  showToast(result.ok ? 'Checking for updates…' : 'Updates are only checked in the installed app');
}

async function loadMailSettingsUI(){
  const cfg = await window.pcc.getMailConfig();
  document.getElementById('mail-email').value = cfg.email || '';
  document.getElementById('mail-imap-host').value = cfg.imapHost || '';
  document.getElementById('mail-allowed-senders').value = (cfg.allowedSenders || []).join(', ');
  document.getElementById('mail-days-back').value = cfg.daysBack || 14;
  document.getElementById('mail-password-status').textContent = cfg.hasPassword
    ? 'An app password is already saved (encrypted). Leave blank to keep it.'
    : 'No app password saved yet.';
}

async function saveMailSettings(){
  const email = document.getElementById('mail-email').value.trim();
  const appPassword = document.getElementById('mail-password').value;
  const imapHost = document.getElementById('mail-imap-host').value.trim() || 'imap.gmail.com';
  const allowedSenders = document.getElementById('mail-allowed-senders').value
    .split(',').map(s => s.trim()).filter(Boolean);
  const daysBack = parseInt(document.getElementById('mail-days-back').value, 10) || 14;

  await window.pcc.setMailConfig({ email, imapHost, allowedSenders, daysBack, appPassword });
  document.getElementById('mail-password').value = '';
  showToast('Mail settings saved');
  inboxAccount = { email, gmail: /gmail|google/i.test(imapHost) };
  scanMail(true); // pick up mail with the new settings straight away
  loadMailSettingsUI();
}


// --- Global Hotkey ---

// 'CommandOrControl+Alt+Space' -> 'Ctrl + Alt + Space' for display
function formatHotkey(accelerator){
  return String(accelerator).replace('CommandOrControl', 'Ctrl').replace('Super', 'Win').split('+').join(' + ');
}

async function loadHotkeyUI(){
  const hotkey = await window.pcc.getHotkey();
  document.getElementById('hotkey-display').value = formatHotkey(hotkey);
  document.getElementById('hotkey-status').textContent = '';
}

let hotkeyCaptureStop = null; // set while a capture is in progress

function startHotkeyCapture(){
  const input = document.getElementById('hotkey-display');
  const status = document.getElementById('hotkey-status');
  if(hotkeyCaptureStop) return; // already capturing
  input.value = 'Press keys... (Esc to cancel)';
  status.textContent = '';
  input.focus();

  function stop(){
    input.removeEventListener('keydown', handler);
    input.removeEventListener('blur', cancel);
    hotkeyCaptureStop = null;
  }
  function cancel(){
    stop();
    loadHotkeyUI(); // put the current hotkey back
  }
  hotkeyCaptureStop = stop;

  function handler(e){
    e.preventDefault();
    e.stopPropagation();

    // Ignore standalone modifier presses — wait for a real key
    if(['Control','Alt','Shift','Meta'].includes(e.key)) return;

    const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
    if(e.key === 'Escape' && !hasModifier && !e.shiftKey){ cancel(); return; }

    const parts = [];
    if(e.ctrlKey) parts.push('CommandOrControl');
    if(e.altKey) parts.push('Alt');
    if(e.shiftKey) parts.push('Shift');
    if(e.metaKey) parts.push('Super'); // Windows key

    let key = e.key;
    if(key === ' ') key = 'Space';
    else if(key === 'Escape') key = 'Esc';
    else if(/^Arrow/.test(key)) key = key.replace('Arrow', '');
    else if(key.length === 1) key = key.toUpperCase();

    // A global shortcut takes its key away from every other app, so it
    // needs Ctrl/Alt/Win — unless it's a function key. Keep listening.
    if(!hasModifier && !/^F\d{1,2}$/.test(key)){
      status.textContent = 'Add Ctrl, Alt or the Windows key to the combination.';
      status.style.color = 'var(--amber)';
      return;
    }

    parts.push(key);
    const accelerator = parts.join('+');

    stop();
    input.value = formatHotkey(accelerator);

    window.pcc.setHotkey(accelerator).then(result => {
      if(result.ok){
        status.textContent = 'Hotkey updated.';
        status.style.color = 'var(--accent-text)';
      } else {
        status.textContent = result.error || 'Failed to set hotkey.';
        status.style.color = 'var(--red)';
        loadHotkeyUI(); // revert display back to the last working hotkey
      }
    });
  }

  input.addEventListener('keydown', handler);
  input.addEventListener('blur', cancel);
}


function updateSettings(key, val){
  state.settings[key] = val; Store.set('settings', state.settings);
  if(key==='name') renderGreeting();
  if(key==='weatherCity') loadWeather(true);
}
async function resetAllData(){
  if(!confirm('Erase all your data?\n\nA backup of the current data is saved to the backups folder first.')) return;
  const backup = await window.pcc.backupData(collectData(), 'before factory reset');
  if(!backup.ok && !confirm('The safety backup failed. Erase everything anyway?')) return;
  localStorage.clear(); location.reload();
}
