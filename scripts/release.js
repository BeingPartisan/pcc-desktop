// Builds the installer and uploads it to a draft GitHub release.
// Run with:  npm run release   (GH_TOKEN must be set in the terminal first)
//
// Why this isn't just "electron-builder --publish always":
// the installer and its .blockmap file finish building at the same moment,
// and electron-builder 26 then creates TWO draft releases, one for each
// file. Whichever draft gets published is missing the other file. Without
// the .blockmap on the release, installed copies can't work out which parts
// of the installer changed, so every update downloads all ~117 MB instead
// of the 1-3 MB that actually differ.
//
// So this script makes sure a single draft release exists first.
// electron-builder then finds it and uploads every file to it.
//
// Then it builds PCC for Android (android-app/, signed with the key named in
// android-app/android/keystore.properties, which stays on this computer) and
// attaches it to the same release as PCC-Android-<version>.apk; the phone app
// looks for that file to offer updates. Skipped, with a note, if the Android
// tools or the key aren't on this computer. --skip-android skips it on purpose;
// --android-only does just that part, for a draft that already has the PC files.
//
// It also writes the release notes: this version's section of the README's
// changelog, signed off. Without notes, GitHub shows the commit message
// instead, and that is what installed copies show in their update dialog.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const SIGN_OFF = "From Partisan's workshop, with Champ.";   // Champ: Partisan's name for Claude, the co-builder

// "### 2.7.1" up to the next "### " heading in the README's changelog.
function releaseNotes() {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = readme.indexOf(`\n### ${pkg.version}\n`);
  if (start < 0) stop(`the README's changelog has no "### ${pkg.version}" section. Add one, then run this again.`);
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n### ', 4);
  const section = (end < 0 ? rest : rest.slice(0, end)).split('\n').slice(1).join('\n').trim();
  return `${section}\n\n---\n${SIGN_OFF}`;
}

const { owner, repo } = pkg.build.publish[0];
const tag = `v${pkg.version}`;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const api = `https://api.github.com/repos/${owner}/${repo}/releases`;

function stop(message) {
  console.error(`\nRelease stopped: ${message}\n`);
  process.exit(1);
}

async function github(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pcc-release-script', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) stop('GitHub rejected the token. Check that GH_TOKEN is current and has the "repo" scope.');
  if (!res.ok) stop(`GitHub answered ${res.status} for ${options.method || 'GET'} ${url}`);
  return res.json();
}

async function ensureDraft() {
  const releases = await github(`${api}?per_page=50`);
  const matching = releases.filter((r) => r.tag_name === tag);
  if (matching.some((r) => !r.draft)) stop(`${tag} is already published. Bump "version" in package.json before releasing again.`);
  if (matching.length > 1) stop(`there are ${matching.length} drafts for ${tag} on GitHub. Delete them on the Releases page and run this again.`);
  const body = releaseNotes();
  if (matching.length === 1) {
    await github(`${api}/${matching[0].id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    console.log(`Using the existing draft for ${tag} (release notes updated)`);
    return matching[0];
  }
  const created = await github(api, { method: 'POST', body: JSON.stringify({ tag_name: tag, name: pkg.version, draft: true, body }) });
  console.log(`Created a draft release for ${tag}`);
  return created;
}

// --- PCC for Android ---
const ANDROID = path.join(__dirname, '..', 'android-app');
const JAVA_HOME = process.env.PCC_JAVA_HOME || 'D:/Dev/jdk/jdk-21.0.13.1+2';

// One command line, run in `cwd`. Programs are named by full path: Windows may be set
// (NoDefaultCurrentDirectoryInExePath) not to look in the current folder for them.
function run(commandLine, cwd) {
  const r = spawnSync(commandLine, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, JAVA_HOME, CAPACITOR_TELEMETRY: 'false' } });
  return r.status === 0;
}

async function releaseAndroid(release) {
  if (process.argv.includes('--skip-android')) { console.log('Skipped PCC for Android (--skip-android).'); return; }
  const props = path.join(ANDROID, 'android', 'keystore.properties');
  if (!fs.existsSync(path.join(ANDROID, 'node_modules')) || !fs.existsSync(props) || !fs.existsSync(JAVA_HOME)) {
    console.log("\nPCC for Android not built: the Android tools or its signing key (android-app/android/keystore.properties) aren't on this computer.");
    return;
  }
  const androidPkg = JSON.parse(fs.readFileSync(path.join(ANDROID, 'package.json'), 'utf8'));
  console.log(`\nBuilding PCC for Android ${androidPkg.version}...`);
  const capacitor = path.join(ANDROID, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  if (!run(`"${process.execPath}" "${capacitor}" sync android`, ANDROID)) stop('Capacitor could not prepare the Android app (see above).');
  const gradlew = path.join(ANDROID, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!run(`"${gradlew}" assembleRelease --console=plain`, path.join(ANDROID, 'android'))) stop('the Android build failed (see above). The PC files are already on the draft.');
  const apk = path.join(ANDROID, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const name = `PCC-Android-${androidPkg.version}.apk`;
  // Replace an earlier upload of the same file (when running this again).
  for (const asset of release.assets || []) {
    if (asset.name === name) await fetch(`${api}/assets/${asset.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'pcc-release-script' } });
  }
  const res = await fetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pcc-release-script', 'Content-Type': 'application/vnd.android.package-archive' },
    body: fs.readFileSync(apk),
  });
  if (!res.ok) stop(`GitHub answered ${res.status} when uploading ${name}`);
  console.log(`Attached ${name} to the draft.`);
}

async function main() {
  if (!token) stop('GH_TOKEN is not set. In PowerShell:  $env:GH_TOKEN="your token"');
  const release = await ensureDraft();
  // --android-only: the PC files are already on the draft; just add (or replace) the APK.
  if (process.argv.includes('--android-only')) {
    await releaseAndroid(release);
    console.log(`\nDone. Check the draft has PCC-Android-x.y.z.apk next to the PC files, then publish it:\nhttps://github.com/${owner}/${repo}/releases\n`);
    return;
  }
  const build = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--publish', 'always'], { stdio: 'inherit' });
  if (build.status !== 0) stop('the build or upload failed (see above). The draft is still on GitHub; running this again reuses it.');
  await releaseAndroid(release);
  console.log(`\nDone. Open the draft on GitHub, check it has its files (the .exe, the .exe.blockmap, latest.yml and PCC-Android-x.y.z.apk),\nread over the release notes (taken from the README), and publish it:\nhttps://github.com/${owner}/${repo}/releases\n`);
}

main().catch((e) => stop(String(e.message || e)));
