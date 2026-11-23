/* ---------- Updates ---------- */
// New versions of PCC for Android are attached to PCC's GitHub releases as
// PCC-Android-<version>.apk (scripts/release.js). Every 12 hours or so this
// looks at the latest release; if it has a newer one, Today offers it.
// Downloading opens the phone's browser; Android then asks to install it.

const UPDATE_CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const RELEASES = 'https://api.github.com/repos/BeingPartisan/pcc-desktop/releases/latest';
let appVersion = '';
let update = Store.get('__update', null);   // { version, url, checkedAt }

const newer = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for(let i = 0; i < 3; i++){ if((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; };

async function checkForUpdate(force){
  try {
    const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if(app && !appVersion) appVersion = (await app.getInfo()).version;
    if(!appVersion) return;
    if(!force && update && Date.now() - update.checkedAt < UPDATE_CHECK_EVERY_MS) return;
    const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    if(!res.ok) return;
    const release = await res.json();
    const asset = (release.assets || []).map(a => ({ a, m: /^PCC-Android-(\d+\.\d+\.\d+)\.apk$/.exec(a.name) })).find(x => x.m);
    update = { version: asset ? asset.m[1] : '', url: asset ? asset.a.browser_download_url : '', checkedAt: Date.now() };
    Store.set('__update', update);
    render();
    if(force) toast(asset && newer(asset.m[1], appVersion) ? `PCC for Android ${asset.m[1]} is ready` : "You're on the latest version");
  } catch(e){ /* offline: try again later */ }
}

function updateAvailable(){ return update && update.version && appVersion && newer(update.version, appVersion) ? update : null; }

function renderUpdateCard(){
  const el = document.getElementById('update-card');
  if(!el) return;
  const u = updateAvailable();
  el.hidden = !u;
  if(u) el.innerHTML = `<div><b>PCC for Android ${esc(u.version)} is ready</b><div class="note">You have ${esc(appVersion)}. Download it, then open the file to install; everything here stays.</div></div>
    <a class="btn primary" href="${esc(u.url)}" target="_blank">Download</a>`;
}
