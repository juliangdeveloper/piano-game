// js/gate.js — Filtro de nivel por RMS en dBFS (R19): si no hay nada sonando
// (ruido de fondo por debajo del umbral), el procesador ni pregunta a las máscaras.
// Histéresis de 8 dB: abierto cierra a (umbral − 8) — evita opening/closing parpadeante
// en el borde del umbral. Puro, sin DOM. UMD: module.exports + window.Gate.
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Gate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HYST_DB = 8;

  function rmsDbfs(buffer) {
    var sum = 0;
    for (var i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    var rms = Math.sqrt(sum / buffer.length);
    return 20 * Math.log10(rms + 1e-12);
  }

  /**
   * passes(buffer, thresholdDb): gate cerrado — pasa solo si rms > threshold.
   * (no considera histéresis: es el chequeo estático)
   */
  function passes(buffer, thresholdDb) {
    return rmsDbfs(buffer) > thresholdDb;
  }

  /**
   * decide(buffer, thresholdDb, wasOpen) → {db, open, passed}
   * - estaba cerrado: abre si db > threshold (y pasa)
   * - estaba abierto: sigue abierto mientras db > threshold − HYST_DB
   * - al cerrar: no pasa
   */
  function decide(buffer, thresholdDb, wasOpen) {
    var db = rmsDbfs(buffer);
    var open = wasOpen ? (db > thresholdDb - HYST_DB) : (db > thresholdDb);
    return { db: db, open: open, passed: open };
  }

  function isOpen(st) { return st.open; }

  return {
    passes: passes,
    decide: decide,
    isOpen: isOpen,
    rmsDbfs: rmsDbfs,
    HYST_DB: HYST_DB
  };
});