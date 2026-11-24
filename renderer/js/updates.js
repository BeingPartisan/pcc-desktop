/* ---------- App updates: the dialog ---------- */
// The main process finds and downloads updates (see "Auto Updates" in
// main.js) and reports each stage as a status object. This file shows that
// as a dialog in the app's own style and sends back the user's choice.
// Nothing downloads or installs until a button here is pressed.

let updateStatus = null;
let updateSnoozedVersion = null; // "Later" hides the offer for this version until the app restarts

function closeUpdateDialog(){ document.getElementById('update-overlay').classList.remove('open'); }

function snoozeUpdate(){
  if(updateStatus && updateStatus.version) updateSnoozedVersion = updateStatus.version;
  closeUpdateDialog();
}

async function startUpdateDownload(){ await window.pcc.updateDownload(); }
async function installUpdate(){ await window.pcc.updateInstall(); }

function showUpdateStatus(status){
  if(!status) return;
  updateStatus = status;
  const el = (id) => document.getElementById(id);
  const show = (id, on) => { el(id).style.display = on ? '' : 'none'; };

  // A scheduled check that finds a version the user already postponed stays quiet.
  if(status.state === 'available' && !status.manual && status.version === updateSnoozedVersion) return;

  const buttons = { download: false, later: false, restart: false, close: false };
  let title = '', text = '', notes = '', progress = null;

  if(status.state === 'available'){
    title = 'Update available';
    text = say(`Version ${status.version} is ready to download. You have ${status.current}.`, `Version ${status.version} is ready to download. You have ${status.current}, which is basically vintage now.`);
    notes = status.notes || '';
    buttons.download = buttons.later = true;
  } else if(status.state === 'downloading'){
    title = 'Downloading update';
    text = `Version ${status.version || ''} · ${status.percent || 0}%`;
    progress = status.percent || 0;
    buttons.close = true;
  } else if(status.state === 'downloaded'){
    title = 'Update ready';
    text = say(`Version ${status.version} has downloaded. Restart to install it; your data stays as it is.`, `Version ${status.version} has downloaded. Restart to install it; your data stays exactly as it is. Fresh PCC, who dis?`);
    buttons.restart = buttons.later = true;
  } else if(status.state === 'none'){
    title = status.preview ? 'End of the preview' : "You're up to date";
    text = status.preview ? 'A real update would close PCC here, install, and open it again.' : say(`Version ${status.current} is the latest.`, `Version ${status.current} is the latest. Damn bro, peak PCC already.`, `Version ${status.current} is the latest. Nothing new, go touch some grass.`);
    buttons.close = true;
  } else if(status.state === 'error'){
    title = "Couldn't update";
    text = status.message || say('Something went wrong while checking for updates.', 'Something went wrong while checking for updates. Check your internet and try again later.');
    buttons.close = true;
  } else return;

  el('update-title').textContent = title;
  el('update-text').textContent = text;
  el('update-notes').textContent = notes;
  show('update-notes', !!notes);
  show('update-progress', progress !== null);
  if(progress !== null) el('update-progress-fill').style.width = progress + '%';
  show('update-download-btn', buttons.download);
  show('update-restart-btn', buttons.restart);
  show('update-later-btn', buttons.later);
  show('update-close-btn', buttons.close);

  // While downloading, the dialog only stays up if it's already open; closing
  // it lets the download carry on in the background.
  const overlay = el('update-overlay');
  if(status.state !== 'downloading' || overlay.classList.contains('open')) overlay.classList.add('open');
}

if(window.pcc && window.pcc.onUpdateStatus){
  window.pcc.onUpdateStatus(showUpdateStatus);
  window.pcc.getUpdateStatus().then(showUpdateStatus);
}
