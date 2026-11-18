# Personal Command Center (PCC)

A desktop dashboard for running student life from one window. It covers your classes, mail, deadlines, grades, money, habits, focus time, apps and games. It also puts a small **floating island** at the top of your screen with your timer, next class, music and messages. It's built with Electron and is developed and tested on Windows. Your data stays on your own computer; the only things that leave it are the ones you switch on (see [What uses the internet](#what-uses-the-internet)).

**Current version:** 2.5.0 · [Download the latest release](https://github.com/BeingPartisan/pcc-desktop/releases/latest)

---

## Features

The app is organised into pages on an icon rail. You can jump to any of them with **Ctrl+1 … Ctrl+9**.

| Page | What it does |
| --- | --- |
| **Today** | Live view of today's classes, tasks, deadlines, focus timer, budget, habits, attendance and important mail. The cards can be reordered or hidden. |
| **Messages** | Chats with friends who use PCC: the whole conversation, unread counts, one-tap phrases, and starting or joining a chat with a code. New messages also show on the floating island. |
| **Inbox** | IMAP mail sorted by *who sent it*. Label a sender once (Important, Opportunity, For information, Ignore) and their mail is sorted that way from then on. Mail that mentions one of your courses is promoted to Important. Dates found in an email can be added to Deadlines in one click. The inbox checks for new mail every 15 minutes. |
| **Focus** | Pomodoro timer with adjustable focus and break lengths, plus a native notification when a session ends. |
| **Study** | Weekly timetable, tasks and agenda, notes and links, and flashcards with decks. |
| **Academics** | Attendance per course against a target you set, CGPA and SGPA per term, grades coloured on the 7-point scale (O to C, F, AB), and an **evaluation tracker**. The tracker shows the marks scored and lost in each course, and the marks you still need from what remains for each grade. |
| **Money** | Expenses and budget, with spending by category and month by month. |
| **Life** | Habit tracker with current and best streaks, and countdowns to dates you care about. |
| **Launch** | Quick launcher for websites and local apps, optional **workspaces** (sets of sites and apps that open together in one click), plus a Steam-style **Games Library** with icons, folder sizes and tracked playtime. |
| **System** | Live CPU, RAM, disk, battery and OS info, plus a console that shows the app's own log. |

**Across the app:**

- **Command palette.** Press **Ctrl+K** to jump anywhere or run actions. For example, type `/note` to capture a note.
- **Global hotkey.** **Ctrl+Alt+Space** shows or hides PCC from any app. You can change it in Settings.
- **Tray icon.** Closing the window keeps PCC running in the tray.
- **Start at login.** This is optional. When enabled, PCC starts quietly in the tray.
- **Native notifications** for timers, important mail and updates.
- **Appearance.** Settings include system, light or dark theme; an accent colour (including your Windows accent); a blur, solid or image background; density; text size; reduced motion; a custom logo; and a custom app name.
- **Backups.** PCC makes an automatic daily backup and keeps the last 10. It also backs up before any import or reset. You can export and import all your data as one JSON file.
- **Updates.** PCC checks GitHub Releases at startup and every 30 minutes. A new version is offered in a dialog with its release notes, and on the island. Nothing downloads or restarts until you press the button.
- **Send feedback.** Settings → About, or "feedback" in the command palette, sends a bug report or an idea to the developer. It is encrypted on your computer so only the developer can read it, and PCC keeps trying for up to two weeks until it is confirmed as received. Attaching the app's activity log is optional.
- **First-run welcome.** A new install asks for your name and city, offers to connect Digiicampus, and introduces the island. Every step can be skipped.
- **Works offline.** Fonts are bundled. Everything except the items under [What uses the internet](#what-uses-the-internet) works without a network.

### The floating island

A small bar that sits at the top of the screen above other windows, even while PCC itself is hidden in the tray. Its one line shows whatever matters most right now; pointing at it opens a panel with controls.

- **Focus timer** with start, pause and reset.
- **Current or next class**, with a countdown.
- **What's playing** in any app, with play, pause and skip (Windows only).
- **New important mail.**
- **Quick capture:** type a note or a task without opening PCC. Notes collect in one "Quick notes" note.
- **Messages:** incoming messages appear here, and you can reply from it.
- **Workspaces:** one button per workspace, if you use them.
- **Countdowns:** days until the dates you're waiting for, and who in your channels is in a focus session right now.
- **Updates:** Download and Restart buttons when a new version is out.
- **Break reminder:** after a long stretch at the computer (90 minutes by default) the island glows softly for a few minutes. No sound and no pop-up.

It never takes keyboard focus unless you click its text box, and it can hide itself while another app is full screen or maximised. Everything above can be switched off individually in **Settings → Island**.

### Messages

Short messages between copies of PCC on different computers, set up in **Settings → Messages**.

- **Channels.** One person creates a channel and gets a code like `PCC-XXXX-XXXX-XXXX-XXXX`; the other pastes it under "Join a channel". Everyone with the code can read and send on that channel.
- **One-tap messages.** Pick a channel on the island and a row of short phrases appears ("Thinking of you", "Call me when you're free"). One click sends it. The phrases are yours to edit.
- **Focus status.** Optional, per channel: the people in it see when your focus timer is running and when it ends.
- **Shared countdowns.** A countdown added on the Life page can be private or shared with a channel, so it counts down on everyone's island. Copies that were closed at the time catch up when they next start.
- **Announcements.** The developer can send an announcement to every running copy. Each one is signed, and PCC ignores any announcement whose signature doesn't check out.

Messages travel through [ntfy.sh](https://ntfy.sh), a public relay, and are not encrypted beyond the connection itself. Treat a channel like a postcard: fine for "call me" or "class moved", not for anything private.

### Digiicampus sync (NLSIU only)

PCC can sign in to `nls.digiicampus.com` using the university's own login page. It then pulls dated class sessions, rooms, cancellations, holidays, attendance and declared results. PCC never sees your password: it only reads the session token the site sets after you sign in, and that token lasts about a week. When synced, the real timetable replaces the manual weekly grid. If you disconnect, the manual grid comes back.

This depends on a website PCC doesn't control. If Digiicampus changes, sync may break until PCC is updated. It will not work for other universities without code changes (see `CAMPUS_ORIGIN` in `campus.js`).

---

## Installing (for users)

1. Go to [Releases](https://github.com/BeingPartisan/pcc-desktop/releases/latest) and download `Personal Command Center Setup x.y.z.exe`.
2. Run it. You don't need Node.js or anything else installed.
3. Windows will probably show **"Windows protected your PC"** because the app isn't code-signed. Click **More info → Run anyway**. This is normal for a self-published personal app.
4. Open **Settings** (the sliders icon at the bottom of the rail) to set up the parts you want:
   - **Mail:** enter your email address, an **app password** (not your normal password) and an IMAP host, which defaults to `imap.gmail.com`. For Gmail, you need 2-Step Verification turned on before you can create an app password at Google Account → Security → App passwords.
   - **Timetable:** connect Digiicampus, or edit the manual timetable.
   - **General:** choose start at login and the global hotkey.
   - **Island** and **Messages:** switch island features on or off, and create or join a message channel.
5. On the **Launch** page, click **Choose folder** in the Games card and choose your games directory (for example `D:\Games`). The first scan can take a while on a large library.

### Where your data lives

Nothing personal is stored in this repository or inside the installer. Every install starts empty, with generic sample data.

- App data, settings and playtime are kept in Electron's per-user `userData` folder. On Windows this is `%APPDATA%\personal-command-center`. Backups are in its `backups` subfolder, which you can open from Settings → Data.
- The mail app password is encrypted with your operating system's credential store through Electron's `safeStorage`. It is never written in plain text.
- Message channels and their codes are saved with the rest of your data, so they are included in backups and exports.
- Uninstalling the app does not delete this folder. Use **Settings → Data** to export your data before moving to a new PC.

### What uses the internet

PCC has no account and no server of its own. These features contact other services, and only when you use them:

| Feature | Contacts | What is sent |
| --- | --- | --- |
| Mail | Your mail provider (IMAP) | Your sign-in; mail is read, never changed, and stays on your computer |
| Digiicampus sync | `nls.digiicampus.com` | Your session, to read timetable, attendance and results |
| Messages | `ntfy.sh` | The messages you send, shared countdowns, your focus status if you share it, and the channel names you listen on |
| Feedback | `ntfy.sh` | The report you write, encrypted; your PCC and Windows versions; the activity log only if you tick it |
| Fresh quotes | `dummyjson.com` | Nothing about you; can be switched off in Settings |
| Weather | `open-meteo.com` | The city you entered |
| Updates | GitHub Releases | Nothing about you |

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

A few things behave differently when running from source:

- Start at login can't be turned on. It only works in the installed app.
- **Check for updates** plays a pretend update (version 9.9.9) so you can see the dialog and the island's update row. Nothing is downloaded.
- The installed app and a source run share one data folder and can't run at the same time. Quit the installed app from the tray first.

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
4. Run `npm run release`. This creates one **draft** release, builds the installer and uploads three files to it: the `.exe`, the `.exe.blockmap` and `latest.yml`.
5. On GitHub, open the draft under Releases, check all three files are there, and click **Publish release**. Drafts never reach users, so a bad build can't go live by accident.

The `.blockmap` file is what keeps updates small. With it on both the old and the new release, an installed copy downloads only the parts of the installer that changed (usually 1–3 MB) instead of all ~117 MB. `scripts/release.js` exists to make sure it lands on the same release as the installer.

Whatever you write in the release description is shown to users as the release notes in the update dialog.

Running copies of PCC will offer the update within 30 minutes, or straight away when the user picks tray → **Check for Updates**.

> **Note:** anyone who installed PCC from this repo receives every release you publish. Test a build before you publish its draft.

---

## Project structure

```
pcc-desktop/
├── package.json        # dependencies, electron-builder and publish config
├── main.js             # main process: window, tray, hotkey, IPC, mail, games,
│                       #   system info, backups, autostart, auto-updater
├── campus.js           # Digiicampus sign-in and sync (timetable, attendance, results)
├── island.js           # the floating island's window, break reminder, media helper
├── island-preload.js   # bridge for the island window
├── media-helper.ps1    # Windows: what's playing, and which kind of window is in front
├── messaging.js        # messages over the ntfy.sh relay, signed announcements
├── feedback.js         # encrypted bug reports and ideas to the developer
├── preload.js          # secure bridge exposing the window.pcc API to the UI
├── renderer/
│   ├── index.html      # app shell and pages
│   ├── css/            # styles.css (theme tokens), fonts.css
│   ├── fonts/          # Geist, Geist Mono, Instrument Serif (OFL), bundled for offline use
│   ├── island/         # the island's own page, styles and script
│   └── js/             # one module per feature:
│                       #   today, inbox, academics, evaluation, campus, timetable-mail,
│                       #   workspace (tasks/agenda), notes-links, flashcards, finance,
│                       #   life (habits), games, vitals, console, palette, nav,
│                       #   appearance, settings, core, app, island-feed, messages,
│                       #   workspaces, moments, feedback, quotes, updates, welcome
└── assets/
    └── icon.png        # app and tray icon
```

---

## Changelog

### 2.5.0
- **Messages page** on the rail, with an unread badge. Chats are no longer buried in Settings.
- **Feedback button** (the star) at the bottom of the rail.
- **What's new:** after an update, a card shows what changed, with buttons to try each thing.
- **Island messages:** every unread message is listed, clicking one replies on its chat with the conversation above the box, and replying clears that chat's messages.
- **"To you" mail tags** and a "To you only" filter, for mail sent to you personally rather than to a list.
- **Import schedule** on the Evaluation card: paste a table of dates, components and courses; short course names are matched and marks can be left blank.
- **Fix:** the Digiicampus sign-in no longer has to be repeated after every restart.

### 2.4.1
- **Mail:** a refused sign-in now explains why and what to do, Settings checks the sign-in as soon as you save, and the Mail pane has app-password instructions.
- **Island:** it opens only after the pointer rests on it, so passing over it to reach a browser tab does nothing and clicks go through. New **Shrink** option turns it into a small handle while another app's maximised window is in front.

### 2.4.0
- **One-tap messages** on the island, with phrases you can edit.
- **Focus status:** optionally show the people in a channel when your focus timer is running.
- **Countdowns** on the Life page and the island, private or shared with a channel.
- **Send feedback:** bug reports and ideas go to the developer, encrypted, from inside the app.
- Releases now include the blockmap file, so updates download only what changed (a few MB instead of the whole installer).

### 2.3.0
- **Messages** between copies of PCC: shared channels joined with a code, and signed announcements from the developer.
- **Island:** a text box for quick notes, tasks and messages; rows for incoming messages and app updates; a soft break reminder; workspace buttons.
- **Workspaces** on the Launch page: sets of Quick launch items that open together. Off until you set one up.
- **New update flow:** an in-app dialog with release notes, a check every 30 minutes, and Download / Restart on the island.
- Quotes are topped up from the internet and show their author. This can be switched off.
- First-run welcome for new installs.

### 2.2.1
- **Floating island:** an always-on-top bar with the focus timer, current or next class, what's playing and important mail. It can hide while another app is full screen or maximised.

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
