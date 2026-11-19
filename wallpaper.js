// Moves one of PCC's windows into the desktop's wallpaper layer (above the
// wallpaper, below the desktop icons) with wallpaper-helper.ps1. Used by the
// music visualiser and by Desktop mode.
//
//   embedInWallpaper(win, display, (result) => ..., { onTop })
//   onTop: true puts it just below the icons, above any other PCC window there;
//          false puts it lowest, just above the wallpaper picture
//   result: { ok: true, layout: 'raised' | 'classic' } or { ok: false, reason }

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function embedInWallpaper(win, display, done, { onTop = true } = {}) {
  if (process.platform !== 'win32') return done({ ok: false, reason: 'only on Windows' });
  let script;
  try { script = fs.readFileSync(path.join(__dirname, 'wallpaper-helper.ps1'), 'utf-8'); }
  catch (e) { return done({ ok: false, reason: 'helper script missing' }); }
  const scale = display.scaleFactor;
  const b = display.bounds;
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  script = script.replace('__HWND__', hwnd).replace('__X__', Math.round(b.x * scale)).replace('__Y__', Math.round(b.y * scale))
    .replace('__W__', Math.round(b.width * scale)).replace('__H__', Math.round(b.height * scale)).replace('__ONTOP__', onTop ? '1' : '0');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
    // Only the first line of a failure, never the (long) encoded command.
    const firstLine = String(stderr || '').split(/\r?\n/).find(l => l.trim() && !l.startsWith('#<')) || 'helper failed';
    let result = { ok: false, reason: err ? firstLine.replace(/<[^>]+>/g, '').slice(0, 160) : 'no answer' };
    try { result = JSON.parse(String(stdout).trim().split(/\r?\n/).pop()); } catch (e) {}
    done(result);
  });
}

module.exports = { embedInWallpaper };
