(function () {
  'use strict';

  var ENGINE_ROOT = 'https://juliangdeveloper.github.io/piano-transcribe/engine/v1/';
  var ENGINE_KEY = 'piano-transcribe.engine';
  var APP_VERSION = '1.12.9';
  var SCORE = { bpm: 80, timeSig: '4/4', clef: 'treble' };
  var LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var LS_KEY = 'piano-transcribe.source';
  var LS_KEY_OLD = 'piano-game.source';
  var MUSIC_FONT = Object.freeze({ FAMILY: 'Gonville', URL: 'fonts/gonville.woff2' });

  var elBtn = document.getElementById('btnToggle');
  var elNote = document.getElementById('noteDisplay');
  var elNoteDb = document.getElementById('noteDb');
  var elCents = document.getElementById('centsBar');
  var elClarity = document.getElementById('clarityBar');
  var elFreq = document.getElementById('freqText');
  var elLog = document.getElementById('noteLog');
  var elBadge = document.getElementById('badgeSuspended');
  var elHint = document.getElementById('hint');
  var elSettings = document.getElementById('settings');
  var elBtnSettings = document.getElementById('btnSettings');
  var elMidiStatus = document.getElementById('midiStatus');
  var elStaff = document.getElementById('staff');
  var elStaffWrap = document.getElementById('staffWrap');
  var elVersion = document.getElementById('version');

  var engine = null;
  var session = null;
  var sourceMode = 'mic';
  var midiAccess = null;
  var midiInputName = '';
  var ctx = null;
  var analyser = null;
  var buf = null;
  var stream = null;
  var hopTimer = 0;
  var running = false;
  var txEventCount = 0;
  var staffLastDraw = 0;
  var teleAt = 0;
  var silentTicks = 0;
  var progress = null;
  var fontReady = false;

  function loadPianoEngine(root) {
    return fetch(root + 'version.txt?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('version');
        return res.text();
      })
      .then(function (text) {
        var version = text.trim();
        try { localStorage.setItem(ENGINE_KEY, version); } catch (e) {}
        return import(root + 'capture.js?v=' + encodeURIComponent(version));
      })
      .catch(function () {
        var version = '';
        try { version = localStorage.getItem(ENGINE_KEY) || ''; } catch (e) {}
        var url = root + 'capture.js' + (version ? ('?v=' + encodeURIComponent(version)) : '');
        return import(url);
      })
      .then(function (mod) {
        if (!mod || mod.INTERFACE !== 1 || typeof mod.createCapture !== 'function') {
          throw new Error('interface');
        }
        return mod;
      });
  }

  function latinName(name) {
    var idx = NAMES.indexOf(name);
    return idx >= 0 ? LATIN[idx] : name;
  }

  function renderOff() {
    elNote.textContent = '—';
    elNote.classList.add('off');
    elNote.classList.remove('duo');
    elCents.style.left = '50%';
    elClarity.style.width = '0%';
    elNoteDb.textContent = '';
  }

  function showHeld(held, reading) {
    if (!held || !held.length) { renderOff(); return; }
    var list = held.slice().sort(function (a, b) { return a.midi - b.midi; });
    elNote.textContent = list.map(function (h) {
      return h.note + h.octave + ' · ' + latinName(h.note) + h.octave;
    }).join('   ');
    elNote.classList.toggle('duo', list.length > 1);
    elNote.classList.remove('off');
    var primary = list[0];
    var cents = 0;
    var clarity = 1;
    var freq = null;
    var db = null;
    if (reading && reading.midi === primary.midi) {
      if (typeof reading.cents === 'number') cents = reading.cents;
      if (typeof reading.clarity === 'number') clarity = reading.clarity;
      freq = reading.freq;
      db = reading.db;
    }
    elCents.style.left = ((cents + 50) / 100 * 100) + '%';
    var cl = (typeof clarity === 'number') ? Math.max(0, Math.min(1, clarity)) : 1;
    elClarity.style.width = (cl * 100) + '%';
    elNoteDb.textContent = (typeof db === 'number' && isFinite(db)) ? Math.round(db) + 'dB' : '';
    if (typeof freq === 'number' && isFinite(freq) && list.length === 1) {
      elFreq.textContent = Math.round(db || 0) + 'dB · ' + freq.toFixed(1) + ' Hz · claridad ' + Math.round(cl * 100) + '%';
    } else if (list.length > 1) {
      elFreq.textContent = list.map(function (h) { return h.pitch; }).join(' + ');
    }
  }

  function pushTranscriptRow(ev) {
    txEventCount++;
    var li = document.createElement('li');
    li.textContent = '#' + txEventCount + ' ' + ev.note + ev.octave + ' · ' +
      latinName(ev.note) + ev.octave + ' · +' + (ev.t / 1000).toFixed(1) + 's';
    elLog.appendChild(li);
    while (elLog.children.length > 500) elLog.removeChild(elLog.firstChild);
  }

  function updateBadge() {
    if (ctx && ctx.state === 'suspended') elBadge.classList.add('visible');
    else elBadge.classList.remove('visible');
  }

  function newSession() {
    session = engine.createCapture({ profile: 'score', maxVoices: 2, score: SCORE });
    txEventCount = 0;
    elLog.classList.add('chrono');
    elLog.innerHTML = '';
    drawStaff();
    if (progress) progress.beginSession();
  }

  function stopTimers() {
    if (hopTimer) { clearInterval(hopTimer); hopTimer = 0; }
  }

  function stop() {
    if (progress) progress.endSession();
    running = false;
    stopTimers();
    silentTicks = 0;
    if (midiAccess) {
      midiAccess.onstatechange = null;
      var inputs = midiAccess.inputs.values();
      for (var it = inputs.next(); !it.done; it = inputs.next()) it.value.onmidimessage = null;
      midiAccess = null;
    }
    midiInputName = '';
    renderMidiStatus();
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch (e) {}
    }
    ctx = null;
    analyser = null;
    buf = null;
    renderOff();
    elFreq.textContent = '';
    elLog.classList.remove('chrono');
    elLog.innerHTML = '';
    txEventCount = 0;
    drawStaff();
    elBtn.textContent = 'Escuchar';
    elBtn.classList.remove('listening');
    elHint.textContent = sourceMode === 'midi'
      ? 'Conecta el piano por USB o Bluetooth MIDI y toca Escuchar'
      : 'Toca notas: se escriben en la partitura';
    renderSettingsVisibility();
    updateBadge();
  }

  function start() {
    if (!engine) return;
    if (sourceMode === 'midi') { startMidi(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      elHint.textContent = 'Micrófono no disponible en este navegador';
      running = false;
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      elHint.textContent = 'Web Audio no soportado';
      running = false;
      return;
    }
    ctx = new AC();
    updateBadge();
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (mediaStream) {
      if (!running) {
        mediaStream.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      beginMic(mediaStream);
    }).catch(function (err) {
      stop();
      elHint.textContent = 'Permiso de micrófono denegado: ' + (err && err.name ? err.name : 'error');
    });
  }

  function beginMic(mediaStream) {
    stream = mediaStream;
    newSession();
    var source = ctx.createMediaStreamSource(stream);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    hp.Q.value = 0.707;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    lp.Q.value = 0.707;
    var preamp = ctx.createGain();
    preamp.gain.value = (sourceMode === 'line') ? 1 : 4;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    buf = new Float32Array(analyser.fftSize);
    var mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(hp);
    hp.connect(lp);
    lp.connect(preamp);
    preamp.connect(analyser);
    analyser.connect(mute);
    mute.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume().then(updateBadge).catch(updateBadge);
    elBtn.textContent = 'Parar';
    elBtn.classList.add('listening');
    elHint.textContent = 'Toca: las notas se escriben en el pentagrama';
    renderMidiStatus();
    hopTimer = setInterval(micHop, engine.HOP_MS);
  }

  function bufferIsSilent() {
    var i;
    for (i = 0; i < buf.length; i += 16) if (buf[i] !== 0) return false;
    return true;
  }

  function micHop() {
    if (!running || !session || !analyser || !buf) return;
    updateBadge();
    try { analyser.getFloatTimeDomainData(buf); } catch (e) { return; }
    if (bufferIsSilent()) {
      silentTicks += 1;
      if (silentTicks > 30 && ctx && ctx.state !== 'running') {
        try { ctx.resume(); } catch (e2) {}
      }
      return;
    }
    silentTicks = 0;
    var now = performance.now();
    var out = session.hop(buf, ctx.sampleRate || 48000, now);
    var i;
    for (i = 0; i < out.events.length; i++) {
      var ev = out.events[i];
      if (ev.type === 'on' && ev.fresh) {
        pushTranscriptRow(ev);
        if (progress) progress.captureNote(out.held.length);
      }
    }
    if (out.held.length) showHeld(out.held, out.reading);
    else if (out.events.length) renderOff();
    if (out.reading && now - teleAt >= 250 && !out.held.length) {
      teleAt = now;
      elFreq.textContent = Math.round(out.reading.db) + 'dB';
    }
    scheduleStaffRedraw();
  }

  function startMidi() {
    if (!navigator.requestMIDIAccess) {
      stop();
      elHint.textContent = 'Web MIDI no soportado en este navegador';
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
      if (!running) return;
      midiAccess = access;
      var input = pickMidiInput(access);
      if (!input) {
        stop();
        elHint.textContent = 'Sin entrada MIDI — conectá el piano por USB o Bluetooth MIDI';
        return;
      }
      midiInputName = input.name || 'MIDI';
      newSession();
      input.onmidimessage = onMidiMessage;
      access.onstatechange = function () {
        if (!running || sourceMode !== 'midi') return;
        var live = pickMidiInput(access);
        if (live) {
          live.onmidimessage = onMidiMessage;
          midiInputName = live.name || 'MIDI';
        }
        renderMidiStatus();
      };
      elBtn.textContent = 'Parar';
      elBtn.classList.add('listening');
      elHint.textContent = '';
      renderMidiStatus();
      hopTimer = setInterval(function () {
        if (!running || !session) return;
        session.advance(performance.now());
        scheduleStaffRedraw();
      }, engine.HOP_MS);
    }).catch(function (err) {
      stop();
      elHint.textContent = 'Acceso MIDI denegado: ' + (err && err.name ? err.name : 'error');
    });
  }

  function pickMidiInput(access) {
    var first = null;
    var inputs = access.inputs.values();
    for (var it = inputs.next(); !it.done; it = inputs.next()) {
      var inp = it.value;
      if (inp.type === 'input') {
        if (inp.connection === 'open') return inp;
        if (!first) first = inp;
      }
    }
    return first;
  }

  function onMidiMessage(e) {
    if (!session || !e.data || e.data.length < 2) return;
    var status = e.data[0] & 0xf0;
    var midiNum = e.data[1];
    var velocity = e.data.length > 2 ? e.data[2] : 0;
    var now = performance.now();
    if (status === 0x90 && velocity > 0) {
      var on = session.press(midiNum, 'midi', now);
      if (on.events[0] && on.events[0].type === 'on') {
        var freq = null;
        try { freq = engine.hzForNote(on.events[0].note, on.events[0].octave); } catch (err) {}
        showHeld(on.held, { midi: midiNum, cents: 0, clarity: 1, freq: freq, db: null });
        if (on.events[0].fresh) {
          pushTranscriptRow(on.events[0]);
          if (progress) progress.captureNote(on.held.length);
        }
      }
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      var off = session.release(midiNum, 'midi', now);
      if (off.events[0] && off.events[0].released) {
        if (!off.held.length) renderOff();
        else showHeld(off.held, null);
      }
    }
    scheduleStaffRedraw(true);
  }

  function renderMidiStatus() {
    elMidiStatus.textContent = (sourceMode === 'midi' && running)
      ? ('MIDI: ' + (midiInputName || 'buscando dispositivo…'))
      : '';
  }

  function scheduleStaffRedraw(force) {
    var now = performance.now();
    if (!force && now - staffLastDraw < 150) return;
    staffLastDraw = now;
    drawStaff();
  }

  function drawStaff() {
    if (!elStaff || !fontReady) return;
    var VF = window.VexFlow;
    if (!VF || !window.Staff) return;
    var data = (session && typeof session.score === 'function')
      ? session.score()
      : { clef: 'treble', timeSigStr: '4/4', measures: [{ notes: [] }] };
    var innerW = (elStaffWrap && elStaffWrap.clientWidth) ? elStaffWrap.clientWidth : 358;
    elStaff.innerHTML = '';
    try {
      window.Staff.draw(VF, elStaff, data, innerW);
    } catch (err) {}
    if (elStaffWrap) elStaffWrap.scrollTop = elStaffWrap.scrollHeight;
  }

  function loadSource() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) saved = localStorage.getItem(LS_KEY_OLD);
      if (saved === 'transcribe') saved = 'mic';
      if (saved === 'mic' || saved === 'midi' || saved === 'line') sourceMode = saved;
    } catch (e) {}
  }

  function saveSource() {
    try { localStorage.setItem(LS_KEY, sourceMode); } catch (e) {}
  }

  function renderSettings() {
    var radios = elSettings.querySelectorAll('input[name="source"]');
    var i;
    for (i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === sourceMode);
    elBtnSettings.textContent = sourceMode === 'mic' ? '⚙ mic' : (sourceMode === 'midi' ? '⚙ midi' : '⚙ línea');
  }

  function renderSettingsVisibility() {
    elBtnSettings.style.display = running ? 'none' : '';
  }

  elBtnSettings.addEventListener('click', function () {
    var willShow = elSettings.classList.toggle('visible');
    if (willShow) renderSettings();
  });

  elSettings.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'source') {
      sourceMode = e.target.value;
      saveSource();
      renderSettings();
      renderMidiStatus();
    }
  });

  elBtn.addEventListener('click', function () {
    if (!engine) return;
    if (running) stop();
    else {
      running = true;
      renderSettingsVisibility();
      renderOff();
      start();
    }
  });

  document.addEventListener('click', function () {
    if (ctx && ctx.state === 'suspended') ctx.resume().then(updateBadge).catch(updateBadge);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateBadge();
  });

  function loadMusicFont() {
    if (!window.VexFlow || typeof window.FontFace !== 'function' || !document.fonts) return;
    window.VexFlow.setFonts(MUSIC_FONT.FAMILY);
    new FontFace(MUSIC_FONT.FAMILY, 'url(' + MUSIC_FONT.URL + '?v=' + APP_VERSION + ')', { display: 'block' }).load().then(function (face) {
      document.fonts.add(face);
      fontReady = true;
      drawStaff();
    }, function () {});
  }

  try { loadMusicFont(); } catch (eFont) {}

  if (window.Progress && typeof window.Progress.createTracker === 'function') {
    progress = window.Progress.createTracker({ version: APP_VERSION });
    try { progress.load(); } catch (eMeta) {}
  }

  function flushProgress() {
    if (!progress) return;
    try { progress.flush(); } catch (eHide) {}
  }
  if (progress && window.Progress && typeof window.Progress.bindLifecycle === 'function') {
    window.Progress.bindLifecycle(progress, window, document);
  } else {
    window.addEventListener('pagehide', flushProgress);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushProgress();
    });
  }
  window.addEventListener('beforeunload', flushProgress);

  elVersion.textContent = 'v' + APP_VERSION;
  elBtn.disabled = true;
  elHint.textContent = 'Cargando motor de notas…';
  loadSource();
  renderSettings();
  renderSettingsVisibility();
  renderMidiStatus();
  renderOff();
  drawStaff();

  loadPianoEngine(ENGINE_ROOT).then(function (mod) {
    engine = mod;
    elBtn.disabled = false;
    elHint.textContent = sourceMode === 'midi'
      ? 'Conecta el piano por USB o Bluetooth MIDI y toca Escuchar'
      : 'Toca una nota de piano cerca del micrófono';
    if (mod.VERSION && mod.VERSION !== APP_VERSION) {
      elVersion.textContent = 'v' + APP_VERSION + ' · motor ' + mod.VERSION;
    }
  }).catch(function () {
    engine = null;
    elBtn.disabled = true;
    elHint.textContent = 'No se pudo cargar el motor de notas. Recarga la página.';
  });
})();
