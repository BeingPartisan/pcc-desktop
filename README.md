# Personal Command Center — Desktop Shell

This is the Electron version of your PCC. Current features:

- **Tray icon** with Open/Quit/Check-for-Updates menu (closing the window minimizes to tray)
- **Native notifications** ("Personal Command Center" as sender, not "electron.app.Electron")
- **Autostart on login**
- **Live system info** (CPU, RAM, disk, battery, OS)
- **Quick Launcher** — pin either a URL or a local app
- **Games Library** — Steam-style grid with real icons, folder size, tracked playtime
- **Mail scan** — IMAP-based schedule-change/deadline detection, credentials encrypted via `safeStorage`
- **Auto-updates** — checks GitHub Releases on startup, asks before downloading, asks before installing

## Requirements

- [Node.js](https://nodejs.org) (LTS, 18+ recommended)
- npm
- A GitHub account (for hosting update releases)

## Setup

```bash
cd pcc-desktop
npm install
npm start
```

## One-time: setting up auto-updates

1. **Create a GitHub repo** for this project (public is simplest — e.g. `pcc-desktop`).
   No secrets ever live in this code, so public is safe here.

2. **Push this project to it:**
   ```bash
   git init
   git add .
   git commit -m "v1.0.0"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

3. **Edit `package.json`** → `build.publish` → replace `REPLACE_WITH_YOUR_GITHUB_USERNAME`
   and `REPLACE_WITH_YOUR_REPO_NAME` with your actual GitHub username and repo name.

4. **Create a GitHub Personal Access Token** (used only on your machine, to publish
   releases — never shipped inside the app):
   - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Scope: `repo` (that's the only permission needed)
   - Copy the token

5. **Set it as an environment variable before publishing** (PowerShell):
   ```powershell
   $env:GH_TOKEN="paste_your_token_here"
   ```

6. **Publish your first release** (this builds the installer AND uploads it to
   GitHub Releases automatically):
   ```bash
   npm run release
   ```
   This creates a **draft** release on GitHub with the installer + `latest.yml`
   attached. Go to your repo → Releases → find the draft → click **Publish release**.
   (It stays a draft until you manually publish it — this is intentional, so a bad
   build never goes live automatically.)

## Shipping future updates (v1.1, v1.2, etc.)

1. Make your changes.
2. Bump the version in `package.json` (e.g. `1.0.0` → `1.1.0`).
3. Commit + push to GitHub as usual.
4. Run `npm run release` again.
5. Publish the draft release on GitHub.
6. Next time your running PCC checks for updates (on startup, or via tray →
   "Check for Updates"), it'll notice the new version, ask if you want to
   download it, then ask if you want to restart & install.

## Note on unsigned builds

This setup doesn't use a code-signing certificate (those cost money and are
usually for public/commercial distribution). Windows may show a SmartScreen
warning ("Windows protected your PC") the first time you install a new version
on a machine — click "More info" → "Run anyway". This is expected for
self-published personal apps and doesn't indicate anything is wrong.

## Mail scan setup — IMPORTANT security note

Your original `mail_config.json` had your Gmail app password sitting in plain text.
**If you haven't already, regenerate that app password** (Google Account → Security →
App Passwords) since the old one should be treated as compromised.

This version never stores the password in plain text. Open Settings (gear icon, top
right) and fill in:
- Email address
- App password (only needs to be entered once — it's encrypted using your OS's
  native credential store via Electron's `safeStorage` API, and the encrypted blob
  lives in Electron's private `userData` folder, not in this project folder)
- IMAP host (defaults to `imap.gmail.com`)
- Allowed senders (comma-separated, optional filter)
- Days back to scan

## Games Library setup

Click "Set Folder" in the Games Library card and point it at your games directory
(e.g. `D:\Games`). Click "Refresh" to scan. First scan may take a moment on a large
library since it walks every file to compute folder sizes.

## Build an installer without publishing

```bash
npm run dist
```

Produces an installer in `dist/` locally without touching GitHub:
- Windows → `.exe` (NSIS, auto-creates Start Menu + Desktop shortcuts)
- Mac → `.dmg`
- Linux → `.AppImage`

## Project structure

```
pcc-desktop/
├── package.json       # dependencies + electron-builder + publish config
├── main.js            # Electron main process: window, tray, all IPC handlers, auto-updater
├── preload.js         # secure bridge exposing window.pcc API to the frontend
├── renderer/
│   └── index.html     # your actual PCC dashboard (localStorage-based, self-contained)
└── assets/
    └── icon.png        # placeholder app/tray icon — replace with real branding later
```

## What was intentionally left out

The FitGirl-style scraper/Selenium auto-downloader endpoints from the original
Python backend were not ported, since they automate downloading pirated game
repacks. Everything else — system stats, app launcher, games library, mail scan,
key-value logic (superseded by localStorage) — was ported or improved on.


