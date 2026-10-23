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
  var FLOOR_MIN_DB = -55;

  function rmsDbfs(buffer) {
    var sum = 0;
    for (var i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    var rms = Math.sqrt(sum / buffer.length);
    return 20 * Math.log10(rms + 1e-12);
  }

  function calibrateNoiseFloor(blockDb) {
    if (!blockDb || blockDb.length === 0) return FLOOR_MIN_DB;
    var sorted = blockDb.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    var median = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    return Math.max(median, FLOOR_MIN_DB);
  }

  function passes(buffer, thresholdDb) {
    return rmsDbfs(buffer) > thresholdDb;
  }

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
    calibrateNoiseFloor: calibrateNoiseFloor,
    HYST_DB: HYST_DB,
    FLOOR_MIN_DB: FLOOR_MIN_DB
  };
});