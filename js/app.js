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
  var LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

  // ---- DOM ----
  var elBtn = document.getElementById('btnToggle');
  var elNote = document.getElementById('noteDisplay');
  var elCents = document.getElementById('centsBar');
  var elClarity = document.getElementById('clarityBar');
  var elFreq = document.getElementById('freqText');
  var elLog = document.getElementById('noteLog');
  var elBadge = document.getElementById('badgeSuspended');
  var elHint = document.getElementById('hint');

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

  function renderNote(note, clarity, freq) {
    elNote.textContent = noteLabel(note);
    elNote.classList.remove('off');
    // cents −50..+50 → posición 0..100%
    var pct = (note.cents + 50) / 100 * 100;
    elCents.style.left = pct + '%';
    var cl = Math.max(0, Math.min(1, clarity));
    elClarity.style.width = (cl * 100) + '%';
    elFreq.textContent = freq != null ? freq.toFixed(1) + ' Hz' : '';
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

  // ---- Procesamiento de un frame de audio ----

  function processAudio() {
    analyser.getFloatTimeDomainData(buf);
    var res = window.Pitch.detectPitch(buf, ctx.sampleRate, {
      clarityThreshold: CLARITY_THRESHOLD
    });

    var note = null;
    if (res.clarity >= CLARITY_THRESHOLD && res.freq != null) {
      var cand = window.Pitch.noteFromFreq(res.freq, A4);
      // R3: fuera de rango C2–C7 → tratado como frame sin nota (log intacto)
      if (cand != null && cand.midi >= MIDI_MIN && cand.midi <= MIDI_MAX) {
        note = cand;
        lastFreq = res.freq;
        lastClarity = res.clarity;
      }
    }

    // R4+R10: delegar estabilidad/hold a la máquina pura (testeada en Node)
    var out = window.Hold.update(note, holdState);
    stableNote = out.display;
    if (stableNote) {
      renderNote(stableNote, lastClarity, lastFreq);
      if (out.changed) {
        pushLog(stableNote); // R7: solo cuando la nota estable CAMBIA
      }
    } else {
      renderOff();
    }
  }

  // ---- Loop rAF con skip (cada 2 frames) ----

  function loop() {
    rafId = requestAnimationFrame(loop);
    frameCount++;
    if (frameCount % FRAME_SKIP !== 0) return;
    updateBadge();
    if (!analyser) return;
    try {
      processAudio();
    } catch (e) {
      // no romper el loop por un frame ruidoso
    }
  }

  // ---- Start / Stop ----

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
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
    elHint.textContent = 'Toca una nota de piano cerca del micrófono';
    updateBadge();
  }

  function start() {
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
      beginAudio(mediaStream);
    }).catch(function (err) {
      stop();
      elHint.textContent = 'Permiso de micrófono denegado: ' + (err && err.name ? err.name : 'error');
    });
  }

  // ---- Arranque real tras tener stream ----
  // (separado para mantener start() plano; se invoca desde el .then)

  function beginAudio(mediaStream) {
    stream = mediaStream;
    var source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);
    buf = new Float32Array(analyser.fftSize);

    frameCount = 0;
    holdState = window.Hold.createState();
    lastFreq = null;
    lastClarity = 0;
    stableNote = null;

    elBtn.textContent = 'Parar';
    elBtn.classList.add('listening');
    elHint.textContent = 'Escuchando… toca una nota de piano';

    if (ctx.state === 'suspended') {
      ctx.resume().then(updateBadge).catch(updateBadge);
    }
    updateBadge();
    rafId = requestAnimationFrame(loop);
  }

  // ---- Eventos ----

  elBtn.addEventListener('click', function () {
    if (running) {
      stop();
    } else {
      running = true;
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
  renderOff();
  renderLog();
})();
