# Personal Command Center (PCC)

A desktop dashboard for running student life from one window. It covers your classes, mail, deadlines, grades, money, habits, focus time, apps and games. It's built with Electron and runs on Windows, macOS and Linux. All your data stays on your own computer.

**Current version:** 2.2.0 · [Download the latest release](https://github.com/BeingPartisan/pcc-desktop/releases/latest)

---

## Features

The app is organised into pages on an icon rail. You can jump to any of them with **Ctrl+1 … Ctrl+9**.

| Page | What it does |
| --- | --- |
| **Today** | Live view of today's classes, tasks, deadlines, focus timer, budget, habits, attendance and important mail. The cards can be reordered or hidden. |
| **Inbox** | IMAP mail sorted by *who sent it*. Label a sender once (Important, Opportunity, For information, Ignore) and their mail is sorted that way from then on. Mail that mentions one of your courses is promoted to Important. Dates found in an email can be added to Deadlines in one click. The inbox checks for new mail every 15 minutes. |
| **Focus** | Pomodoro timer with adjustable focus and break lengths, plus a native notification when a session ends. |
| **Study** | Weekly timetable, tasks and agenda, notes and links, and flashcards with decks. |
| **Academics** | Attendance per course against a target you set, CGPA and SGPA per term, grades coloured on the 7-point scale (O to C, F, AB), and an **evaluation tracker**. The tracker shows the marks scored and lost in each course, and the marks you still need from what remains for each grade. |
| **Money** | Expenses and budget, with spending by category and month by month. |
| **Life** | Habit tracker with current and best streaks. |
| **Launch** | Quick launcher for websites and local apps, plus a Steam-style **Games Library** with icons, folder sizes and tracked playtime. |
| **System** | Live CPU, RAM, disk, battery and OS info, plus a console that shows the app's own log. |

**Across the app:**

- **Command palette.** Press **Ctrl+K** to jump anywhere or run actions. For example, type `/note` to capture a note.
- **Global hotkey.** **Ctrl+Alt+Space** shows or hides PCC from any app. You can change it in Settings.
- **Tray icon.** Closing the window keeps PCC running in the tray.
- **Start at login.** This is optional. When enabled, PCC starts quietly in the tray.
- **Native notifications** for timers, important mail and updates.
- **Appearance.** Settings include system, light or dark theme; an accent colour (including your Windows accent); a blur, solid or image background; density; text size; reduced motion; a custom logo; and a custom app name.
- **Backups.** PCC makes an automatic daily backup and keeps the last 10. It also backs up before any import or reset. You can export and import all your data as one JSON file.
- **Auto-updates.** PCC checks GitHub Releases at startup and asks before downloading or installing anything.
- **Works offline.** Fonts are bundled, and only mail, Digiicampus sync and updates need a network.

### Digiicampus sync (NLSIU only)

PCC can sign in to `nls.digiicampus.com` using the university's own login page. It then pulls dated class sessions, rooms, cancellations, holidays, attendance and declared results. PCC never sees your password: it only reads the session token the site sets after you sign in, and that token lasts about a week. When synced, the real timetable replaces the manual weekly grid. If you disconnect, the manual grid comes back.

This depends on a website PCC doesn't control. If Digiicampus changes, sync may break until PCC is updated. It will not work for other universities without code changes (see `CAMPUS_ORIGIN` in `campus.js`).

---

## Installing (for users)

1. Go to [Releases](https://github.com/BeingPartisan/pcc-desktop/releases/latest) and download `Personal Command Center Setup x.y.z.exe`.
2. Run it. You don't need Node.js or anything else installed.
3. Windows will probably show **"Windows protected your PC"** because the app isn't code-signed. Click **More info → Run anyway**. This is normal for a self-published personal app.
4. Open **Settings** (gear icon, top right) to set up the parts you want:
   - **Mail:** enter your email address, an **app password** (not your normal password) and an IMAP host, which defaults to `imap.gmail.com`. For Gmail, you need 2-Step Verification turned on before you can create an app password at Google Account → Security → App passwords.
   - **Timetable:** connect Digiicampus, or edit the manual timetable.
   - **General:** choose start at login and the global hotkey.
5. On the **Launch** page, click **Set Folder** in the Games Library and choose your games directory (for example `D:\Games`). The first scan can take a while on a large library.

### Where your data lives

Nothing personal is stored in this repository or inside the installer. Every install starts empty, with generic sample data.

- App data, settings and playtime are kept in Electron's per-user `userData` folder. On Windows this is usually `%APPDATA%\Personal Command Center`. Backups are in its `backups` subfolder, which you can open from Settings → Data.
- The mail app password is encrypted with your operating system's credential store through Electron's `safeStorage`. It is never written in plain text.
- Uninstalling the app does not delete this folder. Use **Settings → Data** to export your data before moving to a new PC.

---

## Development

### Requirements

- [Node.js](https://nodejs.org) 18 or newer (LTS)
- npm
- A GitHub account, if you want to publish releases

### Run from source

```bash
git clone https://github.com/BeingPartisan/pcc-desktop.git
cd pcc-desktop
npm install
npm start
```

Start at login can't be turned on when running from source. It only works in the installed app.

### Build an installer locally

```bash
npm run dist
```

This puts the installer in `dist/` without touching GitHub:

- Windows: `.exe` (NSIS installer with Start Menu and Desktop shortcuts)
- macOS: `.dmg` (must be built on a Mac)
- Linux: `.AppImage`

### Publishing a release

Releases go to this repo's GitHub Releases. Installed copies of PCC check there for updates.

**One-time setup:**

1. Create a GitHub Personal Access Token (classic) with the `repo` scope. Go to GitHub → Settings → Developer settings → Personal access tokens. The token is used only on your machine and is never shipped inside the app.
2. Before publishing, set the token as an environment variable. In PowerShell:

   ```powershell
   $env:GH_TOKEN="paste_your_token_here"
   ```

**Every release:**

1. Make your changes.
2. Bump `version` in `package.json` (for example `2.2.0` → `2.3.0`).
3. Commit and push.
4. Run `npm run release`. This builds the installer and uploads it, with `latest.yml`, to a **draft** release.
5. On GitHub, open the draft under Releases and click **Publish release**. Drafts never reach users, so a bad build can't go live by accident.

Running copies of PCC will offer the update at their next startup, or when the user picks tray → **Check for Updates**.

> **Note:** anyone who installed PCC from this repo receives every release you publish. Test a build before you publish its draft.

---

## Project structure

```
pcc-desktop/
├── package.json        # dependencies, electron-builder and publish config
├── main.js             # main process: window, tray, hotkey, IPC, mail, games,
│                       #   system info, backups, autostart, auto-updater
├── campus.js           # Digiicampus sign-in and sync (timetable, attendance, results)
├── preload.js          # secure bridge exposing the window.pcc API to the UI
├── renderer/
│   ├── index.html      # app shell and pages
│   ├── css/            # styles.css (theme tokens), fonts.css
│   ├── fonts/          # Geist, Geist Mono, Instrument Serif (OFL), bundled for offline use
│   └── js/             # one module per feature:
│                       #   today, inbox, academics, evaluation, campus, timetable-mail,
│                       #   workspace (tasks/agenda), notes-links, flashcards, finance,
│                       #   life (habits), games, vitals, console, palette, nav,
│                       #   appearance, settings, core, app
└── assets/
    └── icon.png        # app and tray icon
```

---

## Changelog

### 2.2.0
- **New Inbox page.** It replaces the old keyword-based mail scan. Mail is sorted by sender label, and new senders are listed separately until you label them.
- Course tags come from the synced course list, and a course mention promotes an email to Important.
- Dates found in emails can be added to Deadlines in one click.
- New Mail card on Today, and notifications for new important mail.
- Mail scans fetch only unseen messages, every 15 minutes.
- Academics: grades are coloured on the 7-point scale, each mark has a note showing how far it is from the next grade, and SGPA bars are drawn against the full scale.
- **Evaluation tracker** on Academics: you enter each course's components (or paste them from the course page) and it shows the marks still needed for each grade. Dated, unmarked components appear in Deadlines.

### 2.1.0
- **New Academics page:** attendance and declared results synced from Digiicampus, CGPA, SGPA per trimester, and an attendance chip on Today.
- Charts: spending by category and by month. Habit streaks, current and best.
- Appearance and layout settings: theme, accent, background, density, text size, reduced motion, custom logo and name, start page, and 24-hour clock. You can also reorder or hide Today's cards and the rail pages, and set focus and break lengths.

### 2.0.0
- **Full redesign.** The app now has an icon rail with pages, a new visual style and bundled fonts, and the code is split into CSS and JS modules.
- **Digiicampus timetable sync,** plus an in-app editor for the manual timetable.
- Tabbed Settings (General, Timetable, Mail, Data, About), a version display and a manual update check.
- Games scan and system vitals now run only when their page is open.
- Personal sample data is replaced with generic placeholders.

### 1.2.0 (and Electron 45 upgrade)
- Upgraded to Electron 45, electron-builder 26 and electron-updater 6.8, and fixed security advisories in dependencies.
- Start at login, launching hidden in the tray.
- Data export and import, plus daily automatic backups (the last 10 are kept).
- Console panel with the live log, and a configurable global hotkey.
- Fixes: external links open in your browser, launch failures are reported, dates use local time, and the Pomodoro timer runs off the clock.
- Performance: async games scan with cached sizes, paused vitals while hidden, lighter mail scan, and non-blocking font loading.

### 1.1.0 / 1.0.2
- Auto-updater handles both "update downloaded" and "no update available".

### 1.0.1
- Fixed packaging so that `node_modules` are included in the installer.

### 1.0.0
- First Electron release: tray icon, native notifications, live system info, quick launcher, games library, IMAP mail scan with an encrypted password, and auto-updates.

---

## License

MIT © Ansh (Partisan)
