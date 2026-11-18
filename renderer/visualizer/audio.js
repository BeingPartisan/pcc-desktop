// Listens to what the computer is playing and turns it into levels that
// pictures can move to. Used by the island (its little bars) and by the
// desktop visualizer.
//
// How: Windows lets an app hear the sound going to the speakers
// ("loopback"). Chromium only offers that together with a screen capture,
// so PCC asks for both and stops the picture straight away, keeping only
// the sound. Nothing is recorded or sent anywhere: the sound goes into an
// analyser that reports how loud each band of pitches is, many times a
// second, and that's all that is kept.
//
//   PCCAudio.start()   begin listening (asks the main process; see main.js)
//   PCCAudio.stop()    stop, and release the capture
//   PCCAudio.bands(n)  n levels from 0 to 1, low pitches first (lightly smoothed)
//   PCCAudio.spectrumDb(n) n raw band loudnesses in decibels, unsmoothed, 30 Hz to 16 kHz:
//                      the reading the bars and wave are drawn from (see dynamics.js)
//   PCCAudio.wave(n)   n samples of the waveform, -1 to 1
//   PCCAudio.level()   overall loudness, 0 to 1
//   PCCAudio.rms()     loudness of the whole sound right now (signal level, not decibels)
//   PCCAudio.kickLevel() loudness of just the deep bass right now, unsmoothed (for finding kicks)

const PCCAudio = (() => {
  let stream = null, ctx = null, analyser = null, freq = null, time = null, starting = null;
  let kickAnalyser = null, kickBuf = null;
  let rawAnalyser = null, rawDb = null;      // unsmoothed spectrum, about a tenth of a second of sound
  let failed = false;

  async function start(){
    if(analyser || failed) return !!analyser;
    if(starting) return starting;
    starting = (async () => {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach(t => t.stop()); // only the sound is wanted
        if(!stream.getAudioTracks().length) throw new Error('no sound track');
        ctx = new AudioContext();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        analyser.minDecibels = -88;
        analyser.maxDecibels = -22;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser); // not connected to the speakers: nothing is played back
        // The unsmoothed reading: a 4096-sample window (about 85 ms) and no averaging
        // between readings, so each one shows exactly what is playing now.
        rawAnalyser = ctx.createAnalyser();
        rawAnalyser.fftSize = 4096; rawAnalyser.smoothingTimeConstant = 0;
        rawAnalyser.minDecibels = -100; rawAnalyser.maxDecibels = 0;
        source.connect(rawAnalyser);
        rawDb = new Float32Array(rawAnalyser.frequencyBinCount);
        // A second listener for kicks: only the deep bass, with no smoothing, so a
        // drum hit shows up as a sharp jump even when a bassline is playing too.
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass'; lowpass.frequency.value = 130;
        kickAnalyser = ctx.createAnalyser();
        kickAnalyser.fftSize = 1024; kickAnalyser.smoothingTimeConstant = 0;
        source.connect(lowpass).connect(kickAnalyser);
        kickBuf = new Float32Array(kickAnalyser.fftSize);
        freq = new Uint8Array(analyser.frequencyBinCount);
        time = new Float32Array(analyser.fftSize);
        return true;
      } catch(e){
        console.warn('Music visualiser: could not listen to system audio', e && e.message);
        failed = true; // don't keep asking; the pictures fall back to a gentle made-up motion
        stop();
        return false;
      } finally { starting = null; }
    })();
    return starting;
  }

  function stop(){
    if(stream) stream.getTracks().forEach(t => t.stop());
    if(ctx) ctx.close().catch(() => {});
    stream = ctx = analyser = kickAnalyser = rawAnalyser = null;
  }

  // Bands spaced like hearing (each one a fixed step up in pitch), 40 Hz to 14 kHz.
  function bands(n){
    const out = new Array(n).fill(0);
    if(!analyser) return out;
    analyser.getByteFrequencyData(freq);
    const binHz = ctx.sampleRate / analyser.fftSize;
    const lo = Math.log(40), hi = Math.log(14000);
    for(let i = 0; i < n; i++){
      const a = Math.max(1, Math.floor(Math.exp(lo + (hi - lo) * i / n) / binHz));
      const b = Math.max(a + 1, Math.floor(Math.exp(lo + (hi - lo) * (i + 1) / n) / binHz));
      let peak = 0;
      for(let k = a; k < b && k < freq.length; k++) if(freq[k] > peak) peak = freq[k];
      out[i] = peak / 255;
    }
    return out;
  }

  // Bands spaced like hearing, 30 Hz to 16 kHz; each band's loudest bin, in decibels.
  function spectrumDb(n){
    const out = new Array(n).fill(-100);
    if(!rawAnalyser) return out;
    rawAnalyser.getFloatFrequencyData(rawDb);
    const binHz = ctx.sampleRate / rawAnalyser.fftSize;
    const lo = Math.log(30), hi = Math.log(16000);
    for(let i = 0; i < n; i++){
      const a = Math.max(1, Math.floor(Math.exp(lo + (hi - lo) * i / n) / binHz));
      const b = Math.max(a + 1, Math.ceil(Math.exp(lo + (hi - lo) * (i + 1) / n) / binHz));
      let peak = -100;
      for(let k = a; k < b && k < rawDb.length; k++) if(rawDb[k] > peak) peak = rawDb[k];
      out[i] = peak;
    }
    return out;
  }

  function wave(n){
    const out = new Array(n).fill(0);
    if(!analyser) return out;
    analyser.getFloatTimeDomainData(time);
    const step = time.length / n;
    for(let i = 0; i < n; i++) out[i] = time[Math.floor(i * step)];
    return out;
  }

  function level(){
    const b = bands(16);
    return b.reduce((s, v) => s + v, 0) / b.length;
  }

  function rms(){
    if(!analyser) return 0;
    analyser.getFloatTimeDomainData(time);
    let s = 0; for(let i = 0; i < time.length; i++) s += time[i] * time[i];
    return Math.sqrt(s / time.length);
  }

  function kickLevel(){
    if(!kickAnalyser) return 0;
    kickAnalyser.getFloatTimeDomainData(kickBuf);
    let s = 0; for(let i = 0; i < kickBuf.length; i++) s += kickBuf[i] * kickBuf[i];
    return Math.sqrt(s / kickBuf.length);
  }

  return { start, stop, bands, spectrumDb, wave, level, rms, kickLevel, get listening(){ return !!analyser; }, get failed(){ return failed; } };
})();
