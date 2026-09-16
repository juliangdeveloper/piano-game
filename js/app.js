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
  var VERSION = 'v1.5.2';
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
  var txRing = null;      // Float32Array ring buffer (60s)
  var txWriteIdx = 0;     // posición de escritura
  var txWritten = 0;      // muestras totales escritas (absoluto)
  var txProcIdx = 0;      // muestras procesadas (absoluto)
  var txTimer = null;     // setInterval ticker
  var txEs = null;        // EventStream
  var txSessionStart = 0; // performance.now() al iniciar sesión
  var txLastNoteIdx = 0;  // último eventIdx mostrado en la lista
  var txGateOpen = false; // R19: estado del gate (histéresis)
  var txPendingGroup = null; // R20: agrupación de notas con onset simultáneo
  var txModel = null;        // R21: modelo Basic Pitch cargado

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
    // v1.3.1: la línea de Hz es telemetría (processAudio la actualiza cada frame
    // con Hz+claridad). Solo la limpiamos al detener/reset, no aquí.
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

    // Telemetría v1.3.1: el detector SIEMPRE mide → la línea de Hz muestra la
    // medición cruda (Hz + claridad %) incluso cuando no cruza el umbral.
    if (res.freq != null) {
      elFreq.textContent = res.freq.toFixed(1) + ' Hz · claridad ' + Math.round(res.clarity * 100) + '%';
    } else {
      elFreq.textContent = '';
    }

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
    if (!analyser) return; // transcripción: el capturador es el worklet, no el rAF
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
    // R8/R11: misma cadena de acondicionamiento del mic (HP 60 + LP 4k + ×4)
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 60; hp.Q.value = 0.707;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.707;
    var preamp = ctx.createGain();
    preamp.gain.value = (sourceMode === 'line') ? 1.0 : 4.0;
    source.connect(hp); hp.connect(lp); lp.connect(preamp);
    txRing = new Float32Array(Math.ceil(ctx.sampleRate * TX_RING_SEC));
    txWriteIdx = 0; txWritten = 0; txProcIdx = 0;
    txEs = window.EventStream.create();
    window.EventStream.setHopMs(txEs, TX_HOP * 1000 / ctx.sampleRate);
    txSessionStart = performance.now();
    txLastNoteIdx = 0;
    txEventCount = 0;
    elLog.classList.add('chrono'); // R17: lista cronológica completa
    elLog.innerHTML = '';
    txPendingGroup = null;

    // R14 capturador: AudioWorklet (stream contiguo real, iOS 14.5+).
    analyser = null; // el rAF NO captura en este modo
    // R21: cargar el modelo Basic Pitch (una vez por sesión, ~1MB cacheable)
    if (!txModel) {
      elHint.textContent = 'Cargando modelo de transcripción…';
      tf.loadGraphModel('model/model.json').then(function (m) {
        txModel = m;
        elHint.textContent = 'Transcribiendo… toca notas (lista completa abajo)';
      }).catch(function (err) {
        elHint.textContent = 'No se pudo cargar el modelo: ' + (err && err.message ? err.message : 'error');
      });
    }
    ctx.audioWorklet.addModule('js/recorder-worklet.js?v=1.5.2').then(function () {
      var recorder = new AudioWorkletNode(ctx, 'ring-recorder');
      recorder.port.onmessage = function (e) {
        var chunk = e.data; // Float32Array ~1024 muestras, contiguo
        var ringLen = txRing.length;
        for (var i = 0; i < chunk.length; i++) {
          txRing[txWriteIdx] = chunk[i];
          txWriteIdx = (txWriteIdx + 1) % ringLen;
        }
        txWritten += chunk.length;
      };
      preamp.connect(recorder);
      // iOS: conectar a destination con gain 0 — el worklet procesa aunque no suene
      var mute = ctx.createGain();
      mute.gain.value = 0;
      recorder.connect(mute);
      mute.connect(ctx.destination);
    }).catch(function (err) {
      elHint.textContent = 'AudioWorklet no disponible: ' + (err && err.message ? err.message : 'error');
    });

    // iOS: reanudar SIEMPRE (el contexto puede quedar suspendido aunque haya gesto)
    if (ctx.state === 'suspended') {
      ctx.resume().then(updateBadge).catch(updateBadge);
    }

    // R18: ticker del procesador (200ms) — el capturador es el worklet
    if (!txTimer) txTimer = setInterval(tickTranscribe, TX_TICK_MS);

    elBtn.textContent = 'Parar';
    elBtn.classList.add('listening');
    elHint.textContent = 'Transcribiendo… toca notas (lista completa abajo)';
    renderMidiStatus();
    rafId = requestAnimationFrame(loop);
  }

  // R18/R21: ticker — cada tick extrae el segmento nuevo del ring, lo resamplea a
  // 22050 y lo pasa por Basic Pitch. Los onsets nuevos (t > último reportado) van
  // a la lista. Basic Pitch reemplaza TODA la heurística (máscaras/gate/merge).
  var txInferring = false;   // no solapar inferencias
  var txReportedKeys = {};   // dedup por overlap: clave 'midi_t0.1'
  var txResampleBuf = null;

  function tickTranscribe() {
    if (!txRing || !ctx || txInferring || !window.BasicPitchLib) return;
    var ringLen = txRing.length;
    var avail = txWritten - txProcIdx;
    // procesar en ventanas de ~2.5s (48k*2.5=120k) para que el modelo vea contexto
    if (avail < 240000) return;
    var start = txProcIdx % ringLen;
    var count = 240000; // ventana de análisis de 5s
    var segStartAbs = txProcIdx; // muestra absoluta donde empieza la ventana
    var seg = new Float32Array(count);
    var firstPart = Math.min(count, ringLen - start);
    seg.set(txRing.subarray(start, start + firstPart), 0);
    if (count > firstPart) seg.set(txRing.subarray(0, count - firstPart), firstPart);
    txInferring = true;
    var segStartT = segStartAbs / ctx.sampleRate; // inicio de la ventana en s
    // avanzar 3.5s (105k): 1.5s de overlap con la próxima ventana
    var advance = Math.min(105000, txWritten - txProcIdx);
    txProcIdx += advance;
    // resamplear 48k → 22050 (linear; suficiente para detección, el modelo hace su STFT)
    var targetSR = 22050;
    var outLen = Math.floor(count / ctx.sampleRate * targetSR);
    if (!txResampleBuf || txResampleBuf.length !== outLen) txResampleBuf = new Float32Array(outLen);
    var ratio = ctx.sampleRate / targetSR;
    for (var i = 0; i < outLen; i++) {
      var src = i * ratio;
      var i0 = Math.floor(src);
      var frac = src - i0;
      var s0 = seg[Math.min(i0, count - 1)];
      var s1 = seg[Math.min(i0 + 1, count - 1)];
      txResampleBuf[i] = s0 + (s1 - s0) * frac;
    }

    var bp = new window.BasicPitchLib.BasicPitch(Promise.resolve(txModel));
    bp.evaluateModel(txResampleBuf, function (f, o, c) {
      // R21: notas del segmento — el modelo separa onsets; el gate de dedup es temporal
      var notes = window.BasicPitchLib.noteFramesToTime(
        window.BasicPitchLib.outputToNotesPoly(f, o, 0.25, 0.25, 3));
      // ordenar por onset y fusionar duplicados (mismo midi con onset ≤0.4s entre sí
      // = el mismo evento visto en ventanas superpuestas / frames contiguos)
      notes.sort(function (a, b) { return a.startTimeSeconds - b.startTimeSeconds; });
      var lastByMidi = {};
      for (var k = 0; k < notes.length; k++) {
        var nt = notes[k];
        var onsetSec = segStartT + nt.startTimeSeconds;
        var last = lastByMidi[nt.pitchMidi];
        if (last != null && (onsetSec - last) < 0.4) continue; // duplicado del mismo evento
        lastByMidi[nt.pitchMidi] = onsetSec;
        pushTranscriptRow({
          midi: nt.pitchMidi,
          chord: false, // el acorde se muestra como conjunto por timestamp (R20)
          tStartMs: onsetSec * 1000
        });
      }
      txInferring = false;
    }, function () {}).catch(function (err) {
      elHint.textContent = 'Error de inferencia: ' + (err && err.message ? err.message : 'error');
      txInferring = false;
    });
  }

  // R15: elegir voces del hop — todas las ≥ CHORD (máx 2); nota sola requiere VOICE
  function pickVoices(scores) {
    var list = [];
    scores.forEach(function (score, midi) {
      if (score >= TX_CHORD) list.push({ midi: midi, score: score });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    var picked = list.slice(0, 2);
    if (picked.length === 0) return null;
    if (picked.length === 1 && picked[0].score < TX_VOICE) return null;
    if (picked.length === 2 && picked[0].score < TX_VOICE && picked[1].score < TX_VOICE) {
      return null;
    }
    // acorde candidato: 2 voces fuertes (marcado provisorio; el eventStream
    // solo lo confirma como ♪♪ si ambas persisten ≥3 hops — filtro de transitorios)
    if (picked.length === 2) {
      picked[0].chordCand = true;
      picked[1].chordCand = true;
    }
    return picked;
  }

  var txEventCount = 0;
  function pushTranscriptRow(ev) {
    txEventCount++;
    var note = window.Pitch.noteFromMidi(ev.midi);
    if (!note) return;
    var label = noteLabel(note) + (ev.chord ? ' ♪♪' : '');
    var tSec = ((ev.tStartMs) / 1000).toFixed(1);

    // R20: display grande arriba = última nota o conjunto tocado (flushGroup)
    var t = ev.tStartMs;
    // agrupar: si otro evento comparte onset ±80ms, es el mismo conjunto
    if (!txPendingGroup || Math.abs(t - txPendingGroup.t) > 80) {
      flushGroup();
      txPendingGroup = { t: t, labels: [label] };
    } else {
      txPendingGroup.labels.push(label);
    }

    var li = document.createElement('li');
    li.textContent = '#' + txEventCount + ' ' + label + ' · +' + tSec + 's';
    if (ev.chord) li.classList.add('chord');
    elLog.appendChild(li);
    while (elLog.children.length > 500) elLog.removeChild(elLog.firstChild); // guard dura
  }

  // R20: el conjunto se flush-ea al confirmarse (o al llegar otro onset distinto)
  function flushGroup() {
    if (!txPendingGroup) return;
    elNote.textContent = txPendingGroup.labels.join(' + ');
    elNote.classList.remove('off');
    txPendingGroup = null;
  }

  function stopTranscribe() {
    if (txTimer) { clearInterval(txTimer); txTimer = null; }
    txRing = null; txEs = null;
    txPendingGroup = null;
    elLog.classList.remove('chrono');
    elLog.innerHTML = ''; // nueva sesión → lista vacía
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
