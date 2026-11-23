# Personal Command Center (PCC)

A desktop dashboard for running student life from one window. It covers your classes, mail, deadlines, grades, money, habits, focus time, apps and games. It also puts a small **floating island** at the top of your screen with your timer, next class, music and messages. It's built with Electron and is developed and tested on Windows. Your data stays on your own computer; the only things that leave it are the ones you switch on (see [What uses the internet](#what-uses-the-internet)).

**Current version:** 2.8.0 · [Download the latest release](https://github.com/BeingPartisan/pcc-desktop/releases/latest) · **PCC for Android** 0.1.0 is on the same release page (see [PCC for Android](#pcc-for-android)).

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

### Music visualiser

Settings → Island → Music. Shapes that move to whatever your computer is playing, drawn on the wallpaper itself: behind the desktop icons (which stay clickable) and under all your windows. Seven styles: Bars, Wave, Ring, Nebula (a turning galaxy of gas and stars), Orbit (a small solar system where each planet is a part of the music), and Album art (the cover of what's playing in a corner card, with a record spinning behind it).

It can also float over every open window instead (Settings → Island → Visualiser shows, the layers button on the island, or the tray menu): see-through, with clicks going straight through it, and hidden for full-screen apps.

It reads the feel of each song as it plays (loudness, how bass-heavy it is, and the beat and tempo) and moves to match: heavy, fast tracks make it punch on every kick and throw sparks; soft, slow songs make it drift and glow. It listens only to measure loudness; nothing is recorded or sent. The island also gets little bars beside the track name, and shows the cover.

### Desktop mode

Settings → Desktop. Turns the desktop into a PCC dashboard, drawn on the wallpaper under the desktop icons (which stay on top and clickable) and under all windows: a large clock with the weather, a "now / next" line, upcoming and overdue deadlines, tasks, a small list of today's classes, this week, important mail and messages, countdowns, CPU / memory / battery gauges and network speed, attendance, budget and habits, what's playing, and a notice when an update is out. The cards are frosted glass: each shows a blurred copy of the wallpaper behind it (PCC reads the wallpaper picture from Windows' settings to do this). You tell it which side your icons are on (left, right or both) so it leaves them room. It stops updating while a maximised or full-screen window covers the desktop, and it works alongside the music visualiser, which plays behind it. For now it's for looking at; clicking things on it is planned. It comes back by itself after sleep, hibernate or unlocking, and keeps trying for a while at sign-in until the desktop is ready.

### Performance

Settings → Performance (also in the tray menu). **Battery saver**, **Balanced** (the default) or **Best quality** sets the visualiser's frame rate and sparks, how often the dashboard's stats update, and how rich its glass is. **Lighter on battery** switches to Battery saver while the laptop is unplugged. **Pause for full-screen apps** stops the visualiser listening while a game or video is full screen. The pane also shows what each part of PCC is using right now. None of the live stats start extra processes: CPU and memory come from Node's own counters, network from the media helper that's already running, battery from the browser engine.

### Sync

Settings → Sync. Start syncing on one device and enter its sync code on your others. Tasks, deadlines (and their ticks), evaluation patterns and marks, countdowns, message channels, notes, and your name, city and colour stay in step. Changes are encrypted on the device with a key made from the code (which never leaves your devices) and pass through the ntfy.sh relay as scrambled data. Each device keeps a full copy and works offline; the newest edit of each item wins, deletes included, and a device that was off catches up from the others when it starts. Passwords, sign-ins and each computer's own settings are never synced. The Android app will use the same sync.

### Evaluation in Word

On the Evaluation card, **Export to Word** saves every course's pattern (components in date order, marks, dates, time and place, and a page of all dates). **Import from Word** reads such a file back, in another PCC too, course by course, with a preview first; marks someone scored are never imported. Any other Word table (a calendar) goes through the schedule importer.

### Messages

Short messages between copies of PCC on different computers, set up in **Settings → Messages**.

- **Channels.** One person creates a channel and gets a code like `PCC-XXXX-XXXX-XXXX-XXXX`; the other pastes it under "Join a channel". Everyone with the code can read and send on that channel.
- **One-tap messages.** Pick a channel on the island and a row of short phrases appears ("Thinking of you", "Call me when you're free"). One click sends it. The phrases are yours to edit.
- **Focus status.** Optional, per channel: the people in it see when your focus timer is running and when it ends.
- **Shared countdowns.** A countdown added on the Life page can be private or shared with a channel, so it counts down on everyone's island. Copies that were closed at the time catch up when they next start.
- **Announcements.** The developer can send an announcement to every running copy. Each one is signed, and PCC ignores any announcement whose signature doesn't check out.

Messages travel through [ntfy.sh](https://ntfy.sh), a public relay, and are not encrypted beyond the connection itself. Treat a channel like a postcard: fine for "call me" or "class moved", not for anything private.

### PCC for Android

The academic side of PCC on your phone (Android 8 and later; built and tested on Android 16). Its source is in `android-app/`.

- **Today:** the class on now or next, deadlines (overdue ones in red, with a tick to mark done), tasks, mail to you and countdowns.
- **Classes:** today and the week from Digiicampus, with rooms, holidays and attendance per course (what you can still miss, or need to attend). Sign-in happens on the university's own page inside the app, Google sign-in included; PCC never sees the password.
- **Tasks and deadlines:** add, tick and set priorities.
- **The island:** your next class as an Android 16 Live Update, from 30, 60 or 90 minutes before it until it ends: "in 18m" or "50m left" in the status bar capsule (realme's Live Alerts and similar), room, end time and a progress bar in the notification. It keeps working with the app closed. On realme phones, turn on **Show Live Updates on Live Alerts** in PCC's notification settings.
- **Messages:** the same channels as PCC on the computer: chats, one-tap nudges, focus status, shared countdowns; join with a `PCC-…` code or create a channel. With the app closed, Android checks for new messages about every 15 minutes and shows them as notifications.
- **Mail:** read-only Gmail with an app password (encrypted with Android's keystore): To you, Courses and All. Mail read in Gmail, opened from PCC or ticked is cleared from PCC's lists; Gmail itself is never changed.
- **Sync:** enter the sync code from PCC on your computer (Settings › Sync) under More; tasks, deadlines, evaluations, countdowns, channels, notes, your name and colour stay in step.
- **Updates:** the app checks PCC's GitHub releases and offers a newer `PCC-Android-x.y.z.apk` on Today.

**Installing:** download `PCC-Android-x.y.z.apk` from the [latest release](https://github.com/BeingPartisan/pcc-desktop/releases/latest) on your phone, open it, and allow your browser or files app to install apps when Android asks. Updates install over it the same way, keeping everything.

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
| Sync | `ntfy.sh` | Your synced items, end-to-end encrypted with your sync code: the relay only sees scrambled data |
| Messages | `ntfy.sh` | The messages you send, shared countdowns, your focus status if you share it, and the channel names you listen on |
| Feedback | `ntfy.sh` | The report you write, encrypted; your PCC and Windows versions; the activity log only if you tick it |
| Fresh quotes | `dummyjson.com` | Nothing about you; can be switched off in Settings |
| Weather | `open-meteo.com` | The city you entered |
| Updates | GitHub Releases | Nothing about you |

The music visualiser listens to your computer's own sound output to measure loudness. That stays on your computer.

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
4. Run `npm run release`. This creates one **draft** release, builds the installer and uploads three files to it: the `.exe`, the `.exe.blockmap` and `latest.yml`. It then builds PCC for Android (when its tools and signing key are on this computer, see below) and attaches `PCC-Android-x.y.z.apk`. The release notes are taken from this version's section of the changelog below.
5. On GitHub, open the draft under Releases, check the files are there, and click **Publish release**. Drafts never reach users, so a bad build can't go live by accident.

The `.blockmap` file is what keeps updates small. With it on both the old and the new release, an installed copy downloads only the parts of the installer that changed (usually 1–3 MB) instead of all ~117 MB. `scripts/release.js` exists to make sure it lands on the same release as the installer.

Whatever you write in the release description is shown to users as the release notes in the update dialog.

Running copies of PCC will offer the update within 30 minutes, or straight away when the user picks tray → **Check for Updates**.

> **Note:** anyone who installed PCC from this repo receives every release you publish. Test a build before you publish its draft.

### Building PCC for Android

Needs Java 21 (Eclipse Temurin) and the Android SDK (command-line tools, `platforms;android-36`, `build-tools;36.0.0`, `platform-tools`); Android Studio isn't required. On the developer's computer they're in `D:\Dev`, and `android-app/android/local.properties` points at the SDK (`sdk.dir=D:/Dev/android-sdk`).

```bash
cd android-app
npm install
npm run install-phone     # build a test version and install it on a phone connected by USB (USB debugging on)
```

The version is `version` in `android-app/package.json`; bump it for a new Android release. Release builds are signed with a key kept outside the repository: `android-app/android/keystore.properties` (not committed) names the keystore and its password. **Back up the keystore and its password.** Android installs an update only if it's signed with the same key, so without them phones would have to uninstall PCC (losing what's on them) to get a new version.

---

## Project structure

```
pcc-desktop/
├── package.json        # dependencies, electron-builder and publish config
├── android-app/        # PCC for Android (Capacitor): www/ is the app's pages,
│                       #   android/ the Android project with PCC's native parts
│                       #   (Digiicampus sign-in, island, messages check, mail)
├── main.js             # main process: window, tray, hotkey, IPC, mail, games,
│                       #   system info, backups, autostart, auto-updater
├── campus.js           # Digiicampus sign-in and sync (timetable, attendance, results)
├── island.js           # the floating island's window, break reminder, media helper, visualiser window
├── desktop.js          # Desktop mode: the dashboard window on the wallpaper, system stats, wallpaper picture
├── performance.js      # Settings > Performance: profiles, battery switching, usage readout
├── sync.js             # sync between your own devices: pairing code, encryption, the relay
├── evaluation-docx.js  # the evaluation pattern as a Word document
├── word-tables.js      # reads the tables out of a Word file (for importing)
├── desktop-preload.js  # bridge for the Desktop mode window
├── wallpaper.js        # joins a window to the wallpaper layer (visualiser and Desktop mode)
├── island-preload.js   # bridge for the island window
├── media-helper.ps1    # Windows: what's playing (and its cover), and which kind of window is in front
├── wallpaper-helper.ps1 # Windows: the wallpaper-layer placement itself, behind the icons
├── visualizer-preload.js # bridge for the visualiser window
├── messaging.js        # messages over the ntfy.sh relay, signed announcements
├── feedback.js         # encrypted bug reports and ideas to the developer
├── preload.js          # secure bridge exposing the window.pcc API to the UI
├── renderer/
│   ├── index.html      # app shell and pages
│   ├── css/            # styles.css (theme tokens), fonts.css
│   ├── fonts/          # Geist, Geist Mono, Instrument Serif (OFL), bundled for offline use
│   ├── island/         # the island's own page, styles and script
│   ├── visualizer/     # the music visualiser: audio analysis, mood, the styles
│   ├── desktop/        # the Desktop mode dashboard page
│   └── js/             # one module per feature:
│                       #   today, inbox, academics, evaluation, campus, timetable-mail,
│                       #   workspace (tasks/agenda), notes-links, flashcards, finance,
│                       #   life (habits), games, vitals, console, palette, nav,
│                       #   appearance, settings, core, app, island-feed, desktop-feed, messages,
│                       #   workspaces, moments, feedback, quotes, updates, welcome
└── assets/
    └── icon.png        # app and tray icon
```

---

## Changelog

### 2.8.0
- **PCC for Android 0.1.0** (on the same release): Today, classes and attendance from Digiicampus, tasks and deadlines, the island as an Android 16 Live Update, messages with notifications, read-only mail, sync with PCC on your computer, and update checks.
- **Sync between your own devices** (Settings > Sync): tasks, deadlines and their ticks, evaluation patterns and marks, countdowns, message channels, notes, and your name, city and colour, end-to-end encrypted with a sync code.

### 2.7.1
- **A new welcome** for new computers: eight short steps (restore a backup from another computer, you, your colour, classes, mail, your desktop, friends and start-up) and a 20-second tour. New installs start with an empty task list.
- About now says who made PCC.
- **Performance** settings: Battery saver / Balanced / Best quality, Lighter on battery, Pause for full-screen apps, a live "what PCC is using" readout, and a tray quick switch. Live stats no longer start a PowerShell process for each reading.
- Live network speed on the dashboard, from the media helper.
- Desktop mode and the visualiser come back after sleep, hibernate and unlocking, and retry at sign-in.
- The over-windows visualiser no longer disappears with an auto-hiding taskbar (maximised windows were taken for full-screen ones).
- Dashboard: deadlines and tasks first, a compact class list, overdue deadlines in red; cards no longer stay invisible when it starts behind a window.
- A tick to mark deadlines done; evaluation deadlines now appear in the app as soon as courses load.
- Evaluation: components in date order, **Export to Word** and **Import from Word**.

### 2.7.0
- **Desktop mode** (Settings → Desktop): a PCC dashboard on the wallpaper with frosted-glass cards, a class timeline, tasks, deadlines, a week strip, mail and messages, countdowns, system gauges, weather, at-a-glance stats and what's playing. Leaves room for desktop icons on the left, right or both sides.
- **Visualiser over windows**: it can float over everything, see-through and click-through; switch from the island, the tray menu, Settings or Ctrl+K.
- The visualiser and Desktop mode now work at the same time (the wallpaper layer keeps both).

### 2.6.1
- **Bars and wave rebuilt** on the classic desktop-visualiser model: a raw, unsmoothed spectrum shown through a fixed loudness window (with very slow self-calibration), instant rise and quick fall, redrawn every frame. Quiet parts look quiet and drops jump.
- The mood reacts to a drop within about a second.
- Bars that jump hard light up and fade; mirrored layout with peak caps.
- **Bars and wave stand:** just above the taskbar, or on the screen's bottom edge.

### 2.6.0
- **Music visualiser** on the wallpaper, behind the desktop icons: Bars, Wave, Ring, Nebula, Orbit and Album art, reacting to the energy, bass and beat of each song.
- **Island:** music bars and the album cover; shrinks to a handle while PCC itself is in front; "Hide 30 min" and "Hide 2 hours", with "Show the island now" in the tray menu.
- The PCC icon is the default logo.

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
