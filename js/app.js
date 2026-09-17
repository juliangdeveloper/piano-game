/* piano-game — app.js: micrófono, AudioContext, AnalyserNode y loop de render.
   Depende de window.Pitch (js/pitch.js). Sin dependencias, sin red. */
(function () {
  'use strict';

  // ---- Constantes (SPEC R2, R4, R6) ----
  var A4 = 440;
  var CLARITY_THRESHOLD = 0.90;
  var STABLE_FRAMES = 3;
  var MIDI_MIN = 36; // C2
  var MIDI_MAX = 96; // C7
  var FRAME_SKIP = 2; // procesar cada 2 frames de rAF (~30 Hz)
  var LOG_MAX = 8;
  var VERSION = 'v1.6.5';
  var LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  var LS_KEY = 'piano-game.source'; // R12: persistencia de la fuente elegida
  // R14: transcripción
  var TX_HOP = 1024;          // muestras por hop (~21ms @48k)
  var TX_RING_SEC = 60;       // R14: memoria de 60s
  var TX_TICK_MS = 200;       // R18: ticker del procesador
  var TX_VOICE = 0.6;         // R15: umbral nota sola
  var TX_CHORD = 0.45;        // R15: umbral acorde
  var TX_GATE_DB = -45;       // R19: gate — debajo de esto es silencio/ruido de fondo

  // ---- DOM ----
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
  var sourceMode = 'mic'; // R11: 'mic' | 'midi' | 'line' | 'transcribe'
  var midiAccess = null;  // R11: acceso Web MIDI (solo modo midi)
  var midiInputName = '';
  // R14: estado del modo transcripción
  var txEs = null;        // EventStream
  var txSessionStart = 0; // performance.now() al iniciar sesión
  var txLastNoteIdx = 0;  // último eventIdx mostrado en la lista
  var txGateOpen = false; // R19: estado del gate (histéresis)
  var txLastRms = 0;      // RMS del frame anterior (score de re-ataque)
  var txEventCount = 0;   // filas de la lista en la sesión
  var txGateThresholdDb = TX_GATE_DB; // umbral del gate (calibrado al arranque)
  var txPendingGroup = null; // R20: agrupación de notas con onset simultáneo

  // ---- Estado ----
  var ctx = null;
  var analyser = null;
  var buf = null;
  var stream = null;
  var rafId = 0;
  var frameCount = 0;
  var running = false;

  var stableNote = null;      // nota estable actual: {name, octave, cents, midi}
  var holdState = null;       // máquina de estados R4+R10 (window.Hold)
  var lastFreq = null;        // última medición real (para render durante hold)
  var lastClarity = 0;
  var logEntries = [];        // últimas 8 notas estables (R7)

  // ---- Utilidades ----

  function latinName(name) {
    var idx = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(name);
    return idx >= 0 ? LATIN[idx] : name;
  }

  function noteLabel(note) {
    return note.name + note.octave + ' · ' + latinName(note.name) + note.octave;
  }

  function renderOff() {
    elNote.textContent = '—';
    elNote.classList.add('off');
    elCents.style.left = '50%';
    elClarity.style.width = '0%';
    elFreq.textContent = '';
  }

  function renderNote(note, clarity, freq, db) {
    elNote.textContent = noteLabel(note);
    elNote.classList.remove('off');
    // cents −50..+50 → posición 0..100%
    var pct = (note.cents + 50) / 100 * 100;
    elCents.style.left = pct + '%';
    var cl = Math.max(0, Math.min(1, clarity));
    elClarity.style.width = (cl * 100) + '%';
    // v1.6.3: dB del frame de captura, pegado al display
    elNoteDb.textContent = (typeof db === 'number')
      ? Math.round(db) + 'dB'
      : '';
    // v1.3.1: la línea de Hz es telemetría (el loop la actualiza cada frame con
    // dB+Hz+claridad). Solo la limpiamos al detener/reset, no aquí.
  }

  function renderLog() {
    elLog.innerHTML = '';
    for (var i = 0; i < logEntries.length; i++) {
      var li = document.createElement('li');
      li.textContent = logEntries[i];
      elLog.appendChild(li);
    }
  }

  function pushLog(note) {
    var label = noteLabel(note);
    logEntries.push(label);
    if (logEntries.length > LOG_MAX) {
      logEntries = logEntries.slice(-LOG_MAX);
    }
    renderLog();
  }

  function updateBadge() {
    if (ctx && ctx.state === 'suspended') {
      elBadge.classList.add('visible');
    } else {
      elBadge.classList.remove('visible');
    }
  }

  function resetDetection() {
    holdState = window.Hold.createState();
    stableNote = null;
    lastFreq = null;
    lastClarity = 0;
    renderOff();
    elFreq.textContent = '';
    // R3/R7: fuera de rango NO borra el log; aquí tampoco.
  }

  // ---- Start / Stop ----

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    stopTranscribe(); // R14: limpiar ticker + script processor
    // R11: limpiar MIDI (handlers y acceso)
    if (midiAccess) {
      midiAccess.onstatechange = null;
      var inputs = midiAccess.inputs.values();
      for (var it = inputs.next(); !it.done; it = inputs.next()) {
        it.value.onmidimessage = null;
      }
      midiAccess = null;
    }
    midiInputName = '';
    renderMidiStatus();
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (ctx) {
      // intentar cerrar el contexto para liberar recursos
      if (typeof ctx.close === 'function') {
        try { ctx.close(); } catch (e) { /* noop */ }
      }
      ctx = null;
      analyser = null;
      buf = null;
    }
    resetDetection(); // display '—' SIN borrar el log (R7)
    elBtn.textContent = 'Escuchar';
    elBtn.classList.remove('listening');
    elHint.textContent = (sourceMode === 'midi')
      ? 'Conecta el piano por USB o Bluetooth MIDI y toca Escuchar'
      : 'Toca notas: todas quedan en la lista, en orden';
    renderSettingsVisibility();
    updateBadge();
  }

  function start() {
    // R14: la transcripción corre SIEMPRE sobre la entrada de mic (no es modo aparte);
    // 'line' comparte el mismo pipeline con preamp ×1.
    if (sourceMode === 'midi') {
      startMidi();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      elHint.textContent = 'Micrófono no disponible en este navegador';
      return;
    }
    // R5: AudioContext creado dentro del gesto del usuario
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      elHint.textContent = 'Web Audio no soportado';
      return;
    }
    ctx = new AC();
    updateBadge();

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }).then(function (mediaStream) {
      if (!running) { // ya se paró mientras llegaba el permiso
        mediaStream.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      beginTranscribe(mediaStream); // R14: transcripción SIEMPRE sobre el mic
    }).catch(function (err) {
      stop();
      elHint.textContent = 'Permiso de micrófono denegado: ' + (err && err.name ? err.name : 'error');
    });
  }

  // ---- R11: modo MIDI — eventos discretos, sin mic ni YIN ----

  function startMidi() {
    if (!navigator.requestMIDIAccess) {
      stop();
      elHint.textContent = 'Web MIDI no soportado en este navegador';
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
      if (!running) return; // se paró mientras llegaba el permiso
      midiAccess = access;
      var input = pickMidiInput(access);
      if (!input) {
        stop();
        elHint.textContent = 'Sin entrada MIDI — conectá el piano por USB o Bluetooth MIDI';
        return;
      }
      midiInputName = input.name || 'MIDI';
      input.onmidimessage = onMidiMessage;
      // escuchar conexiones/desconexiones en caliente
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
        // preferir uno que ya esté enviando datos (connection === 'open')
        if (inp.connection === 'open') return inp;
        if (!first) first = inp;
      }
    }
    return first;
  }

  function onMidiMessage(e) {
    // R11: solo note-on/note-off del canal 0-15; velocity 0 = note-off
    var status = e.data[0] & 0xf0;
    var midiNum = e.data[1];
    var velocity = e.data[2];
    if (midiNum < MIDI_MIN || midiNum > MIDI_MAX) return; // R3 fuera de rango
    var note = window.Pitch.noteFromMidi(midiNum);
    if (!note) return;
    if (status === 0x90 && velocity > 0) {
      var out = window.Hold.midiUpdate(holdState, note);
      if (out.display) {
        lastFreq = null; // MIDI no da Hz medidos; mostramos la referencia teórica
        lastClarity = 1;
        renderNote(out.display, 1, window.Pitch.hzForNote(out.display.name, out.display.octave, A4));
      }
      if (out.changed) pushLog(out.display);
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      var offOut = window.Hold.midiUpdate(holdState, null); // dial: cae al instante
      if (!offOut.display) renderOff();
    }
  }

  function renderMidiStatus() {
    if (sourceMode === 'midi' && running) {
      elMidiStatus.textContent = 'MIDI: ' + (midiInputName || 'buscando dispositivo…');
    } else {
      elMidiStatus.textContent = '';
    }
  }

  // ---- R14/R18: modo Transcripción — capturador (ring 60s) + procesador (ticker 200ms) ----


function beginTranscribe(mediaStream) {
    stream = mediaStream;
    var source = ctx.createMediaStreamSource(stream);
    // R8: HP 60 → LP 4k → preamp ×4 (línea ×1) — acondicionamiento fijo sin AGC
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 60; hp.Q.value = 0.707;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.707;
    var preamp = ctx.createGain();
    preamp.gain.value = (sourceMode === 'line') ? 1.0 : 4.0;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // 43ms @48k — resolución temporal para tiempo real
    buf = new Float32Array(analyser.fftSize);
    source.connect(hp); hp.connect(lp); lp.connect(preamp);
    preamp.connect(analyser);
    txEs = window.EventStream.create();
    window.EventStream.setHopMs(txEs, 2048 * 1000 / ctx.sampleRate);
    txSessionStart = performance.now();
    txEventCount = 0;
    elLog.classList.add('chrono');
    elLog.innerHTML = '';
    txPendingGroup = null;
    txGateOpen = false;
    txLastRms = 0;

    // iOS: reanudar SIEMPRE
    if (ctx.state === 'suspended') {
      ctx.resume().then(updateBadge).catch(updateBadge);
    }

    elBtn.textContent = 'Parar';
    elBtn.classList.add('listening');
    elHint.textContent = 'Calibrando ambiente…';
    renderMidiStatus();
    // v1.6.1: calibrar ruido de fondo 1.2s → gate relativo (no fijo -45)
    var calBlocks = [];
    var calEnd = performance.now() + 1200;
    txGateThresholdDb = TX_GATE_DB; // fallback fijo mientras calibra
    function calibrateStep() {
      if (!analyser) return; // se paró
      try {
        analyser.getFloatTimeDomainData(buf);
        var calDb = window.Gate.rmsDbfs(buf);
        calBlocks.push(calDb);
        elFreq.textContent = Math.round(calDb) + 'dB · calibrando…';
      } catch (e) { /* frame ruidoso */ }
      if (performance.now() < calEnd) {
        requestAnimationFrame(calibrateStep);
      } else {
        txGateThresholdDb = window.Gate.calibrateNoiseFloor(calBlocks) + 12;
        elHint.textContent = 'Tiempo real · ruido ' + Math.round(txGateThresholdDb - 12) + 'dB';
        rafId = requestAnimationFrame(loop);
      }
    }
    requestAnimationFrame(calibrateStep);
  }

  // Loop tiempo real: cada rAF analiza la ventana actual con YIN (~60 mediciones/s)
  var txTelemetryAt = 0;   // último refresco de telemetría (4 Hz)
  var txTelemetryMax = -Infinity; // peak-hold del dB dentro de la ventana de refresco
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!analyser) return;
    updateBadge();
    frameCount++;
    try {
      analyser.getFloatTimeDomainData(buf);
      var rms = 0;
      for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      var db = 20 * Math.log10(rms + 1e-12);
      // v1.6.5: telemetría a 4 Hz con peak-hold — legible en vivo
      if (db > txTelemetryMax) txTelemetryMax = db;
      var now = performance.now();
      var showTele = now - txTelemetryAt >= 250;
      if (showTele) {
        var peak = txTelemetryMax;
        txTelemetryMax = -Infinity;
        txTelemetryAt = now;
      }
      if (showTele && db < txGateThresholdDb) {
        elFreq.textContent = Math.round(peak) + 'dB'; // solo dB bajo el gate
      }
      if (db < txGateThresholdDb) { // R19: silencio → no analizar
        txGateOpen = false;
        return; // v1.6.1: el display SE QUEDA con la última nota
      }
      txGateOpen = true;

      var res = window.Pitch.detectPitch(buf, ctx.sampleRate, {});
      // telemetría: dB pico + Hz + claridad, refresco 4 Hz (legible)
      if (showTele && res.freq != null) {
        elFreq.textContent = Math.round(peak) + 'dB · ' + res.freq.toFixed(1)
          + ' Hz · claridad ' + Math.round(res.clarity * 100) + '%';
      }
      if (res.freq == null) return;

      var cand = window.Pitch.noteFromFreq(res.freq, A4);
      if (!cand || cand.midi < MIDI_MIN || cand.midi > MIDI_MAX) return;

      // v1.6: umbral adaptativo — agudos C5+ salen más flojos del speaker (rolloff)
      var threshold = window.Pitch.clarifyThresholdForMidi(cand.midi);
      if (res.clarity < threshold) return;

      // display instantáneo (Hold R4)
      var out = window.Hold.update(cand, holdState);
      if (out.display) {
        renderNote(out.display, res.clarity, res.freq, db);
        stableNote = out.display;
      }

      // lista cronológica: evento cuando el display consolida y cambió (R7)
      if (out.changed) {
        pushTranscriptRow({
          midi: cand.midi, chord: false,
          tStartMs: performance.now() - txSessionStart
        });
      }
    } catch (e) { /* frame ruidoso no rompe el loop */ }
  }

  function pushTranscriptRow(ev) {
    txEventCount++;
    var note = window.Pitch.noteFromMidi(ev.midi);
    if (!note) return;
    var label = noteLabel(note);
    var tSec = (ev.tStartMs / 1000).toFixed(1);
    var li = document.createElement('li');
    li.textContent = '#' + txEventCount + ' ' + label + ' · +' + tSec + 's';
    elLog.appendChild(li);
    while (elLog.children.length > 500) elLog.removeChild(elLog.firstChild);
  }

  function stopTranscribe() {
    txGateOpen = false;
    txLastRms = 0;
    txTelemetryMax = -Infinity;
    txTelemetryAt = 0;
    elNoteDb.textContent = '';
    elLog.classList.remove('chrono');
    elLog.innerHTML = '';
    txEventCount = 0;
  }

  // ---- Eventos ----

  // R12: persistencia de fuente
  function loadSource() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      // 'transcribe' existió como modo aparte en v1.4.0-dev: normalizar a mic
      if (saved === 'transcribe') saved = 'mic';
      if (saved === 'mic' || saved === 'midi' || saved === 'line') sourceMode = saved;
    } catch (e) { /* localStorage bloqueado → default mic */ }
  }

  function saveSource() {
    try { localStorage.setItem(LS_KEY, sourceMode); } catch (e) { /* noop */ }
  }

  function renderSettings() {
    var radios = elSettings.querySelectorAll('input[name="source"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = (radios[i].value === sourceMode);
    }
    elBtnSettings.textContent = (sourceMode === 'mic') ? '⚙ mic'
      : (sourceMode === 'midi') ? '⚙ midi' : '⚙ línea';
  }

  // R12/dial 3: el ⚙ solo aparece cuando está parado
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
    if (running) {
      stop();
    } else {
      running = true;
      renderSettingsVisibility();
      resetDetection();
      start();
    }
  });

  // R5: tap general → si el contexto quedó suspendido, reanudar
  document.addEventListener('click', function () {
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(updateBadge).catch(updateBadge);
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateBadge();
  });

  // Estado inicial
  document.getElementById('version').textContent = VERSION;
  loadSource();
  renderSettings();
  renderSettingsVisibility();
  renderMidiStatus();
  renderOff();
  renderLog();
})();
