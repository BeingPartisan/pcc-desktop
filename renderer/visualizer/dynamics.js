// How loud things *look*. Pure functions with no drawing in them, so the
// same code can be checked against recorded music outside the app.
//
// The model (the same idea as classic desktop visualisers):
//   - read the spectrum raw: each band's loudness in decibels, unsmoothed;
//   - show it through one fixed, narrow window of loudness (about 36 dB):
//     anything quieter than the window is an empty bar, anything at its top
//     is a full bar. No automatic scaling, so loud music looks loud and quiet
//     music looks quiet, and a drop jumps from low to high instead of being
//     scaled back down;
//   - no smoothing on the way up; a quick fall on the way down, so kicks
//     land sharply but bars don't flicker.

const Dyn = (() => {
  // The loudness window, in decibels as the analyser reports them. It starts
  // where the loud parts of a typical loud song sit, and calibrate() moves it
  // very slowly (over about a minute) towards whatever is playing, so a quieter
  // or louder volume setup still fills the range. That is far too slow to
  // flatten a drop. `sensitivity` (0.5 to 1.5) shifts it on top.
  let WINDOW_TOP = -27, WINDOW_WIDTH = 35;
  let loudRef = WINDOW_TOP - 7;          // slow average of the loud bands, in dB; starts at the default so an intro can't set it
  // Highs carry less energy than bass in almost all music; a small lift so they move too.
  const TILT_DB = 8;

  // decibels -> 0..1 through the window, for band i of n
  function windowed(db, i, n, sensitivity = 1){
    const top = WINDOW_TOP - (sensitivity - 1) * 12;
    const lifted = db + TILT_DB * (i / Math.max(1, n - 1));
    return Math.max(0, Math.min(1, (lifted - (top - WINDOW_WIDTH)) / WINDOW_WIDTH));
  }

  // state: { shown: [] } -> levels 0..1 with an instant rise and a quick fall.
  // fallPerSecond: how much of the bar's height it can drop in a second.
  function follow(state, target, dt, fallPerSecond = 3.2){
    if(!state.shown || state.shown.length !== target.length) state.shown = target.slice();
    const drop = fallPerSecond * dt;
    for(let i = 0; i < target.length; i++) state.shown[i] = Math.max(target[i], state.shown[i] - drop);
    return state.shown;
  }

  // Loudness of the whole sound, for the mood (calm or energetic).
  // state: { fast, slow, peak }. Returns { now, recent }: 0..1 against the
  // loudest of the last minute or so, but never against less than typical
  // loud music (an RMS around 0.15), so a quiet intro doesn't count as loud.
  function loudness(state, rms, dt){
    state.peak = Math.max(rms, (state.peak || 0.15) * Math.pow(0.985, dt), 0.15);
    const level = Math.min(1, rms / state.peak);
    state.fast = (state.fast ?? level) + (level - (state.fast ?? level)) * Math.min(1, dt * 6);     // last ~0.2 s
    state.slow = (state.slow ?? level) + (level - (state.slow ?? level)) * Math.min(1, dt * 0.4);   // last few seconds
    return { now: state.fast, recent: state.slow };
  }

  // Call once a frame with the raw band dB. Only sound that is actually playing counts.
  function calibrate(db, dt){
    const playing = db.filter(d => d > -90);
    if(playing.length < db.length / 3) return;
    const sorted = playing.slice().sort((a, b) => b - a);
    const loud = sorted[Math.floor(sorted.length * 0.2)];            // the loud fifth of the bands
    loudRef += (loud - loudRef) * Math.min(1, dt / 60);
    // the window's top sits a few dB above the usual loud level; kept within sensible bounds
    WINDOW_TOP = Math.max(-42, Math.min(-12, loudRef + 7));
  }

  // For tuning: set the window directly (used when checking against recordings).
  function setWindow(top, width){ WINDOW_TOP = top; WINDOW_WIDTH = width; }

  return { windowed, follow, loudness, calibrate, setWindow, get top(){ return WINDOW_TOP; } };
})();

if(typeof module !== 'undefined') module.exports = Dyn;
