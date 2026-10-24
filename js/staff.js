'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Staff = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CLEF = Object.freeze({ TREBLE: 'treble', BASS: 'bass' });
  var KIND = Object.freeze({ TREBLE: 'treble', BASS: 'bass', GRAND: 'grand' });
  var BAND = Object.freeze({ ALL: 'all', HIGH: 'high', LOW: 'low' });
  var OTTAVA = Object.freeze({ NONE: null, BASSA: '8vb' });
  var SPLIT_MIDI = 60;
  var OTTAVA_BELOW_MIDI = 48;
  var REST_KEY = Object.freeze({ treble: 'b/4', bass: 'd/3' });
  var PITCH_CLASSES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  var LAYOUT = Object.freeze({
    LEFT_X: 18,
    TOP_Y: 18,
    MIN_WIDTH: 260,
    SIDE_PADDING: 12,
    BRACE_ROOM: 14,
    BASS_OFFSET_Y: 108,
    GRAND_HEIGHT: 250,
    SINGLE_HEIGHT: 148,
    EXTRA_HEIGHT: 24
  });

  function restKey(clef) {
    return REST_KEY[clef] || REST_KEY.treble;
  }

  function spellKey(midi, ottava) {
    var m = ottava === OTTAVA.BASSA ? midi + 12 : midi;
    var pc = ((m % 12) + 12) % 12;
    var name = PITCH_CLASSES[pc];
    var oct = Math.floor(m / 12) - 1;
    return { key: name + '/' + oct, accidental: name.length > 1 ? '#' : null };
  }

  function noteMidis(n) {
    if (!n || n.rest) return [];
    if (n.midis && n.midis.length) return n.midis.slice();
    return n.midi != null ? [n.midi] : [];
  }

  function measureMidis(measure) {
    var out = [];
    var src = (measure && measure.notes) ? measure.notes : [];
    var i;
    for (i = 0; i < src.length; i++) out = out.concat(noteMidis(src[i]));
    return out;
  }

  function staffKind(midis) {
    var low = false;
    var high = false;
    var i;
    for (i = 0; i < midis.length; i++) {
      if (midis[i] < SPLIT_MIDI) low = true;
      else high = true;
    }
    if (low && high) return KIND.GRAND;
    if (low) return KIND.BASS;
    return KIND.TREBLE;
  }

  function needsOttava(n, midi) {
    if (n.ottavas && n.midis && n.ottavas.length === n.midis.length) {
      var idx = n.midis.indexOf(midi);
      if (idx >= 0) return n.ottavas[idx] === OTTAVA.BASSA;
    }
    return midi < OTTAVA_BELOW_MIDI;
  }

  function inBand(midi, band) {
    if (band === BAND.LOW) return midi < SPLIT_MIDI;
    if (band === BAND.HIGH) return midi >= SPLIT_MIDI;
    return true;
  }

  function planNote(n, clef, band) {
    var midis = noteMidis(n).filter(function (m) { return inBand(m, band); });
    midis.sort(function (a, b) { return a - b; });
    if (!midis.length) {
      return { rest: true, keys: [restKey(clef)], accidentals: [], ottava: OTTAVA.NONE, duration: restDuration(n && n.duration) };
    }
    var ottava = OTTAVA.NONE;
    if (clef === CLEF.BASS) {
      var i;
      for (i = 0; i < midis.length; i++) if (needsOttava(n, midis[i])) ottava = OTTAVA.BASSA;
    }
    var keys = [];
    var accidentals = [];
    var k;
    for (k = 0; k < midis.length; k++) {
      var sp = spellKey(midis[k], ottava);
      keys.push(sp.key);
      accidentals.push(sp.accidental);
    }
    return { rest: false, keys: keys, accidentals: accidentals, ottava: ottava, duration: soundDuration(n.duration) };
  }

  function restDuration(dur) {
    if (!dur) return 'qr';
    return dur.charAt(dur.length - 1) === 'r' ? dur : dur + 'r';
  }

  function soundDuration(dur) {
    if (!dur) return 'q';
    return dur.charAt(dur.length - 1) === 'r' ? dur.slice(0, -1) : dur;
  }

  function planMeasure(measure, clef, band) {
    var src = (measure && measure.notes) ? measure.notes : [];
    if (!src.length) return [{ rest: true, keys: [restKey(clef)], accidentals: [], ottava: OTTAVA.NONE, duration: 'wr' }];
    return src.map(function (n) { return planNote(n, clef, band); });
  }

  function buildNotes(VF, plans, clef) {
    return plans.map(function (p) {
      var sn = new VF.StaveNote({ clef: clef, keys: p.keys, duration: p.duration });
      var a;
      for (a = 0; a < p.accidentals.length; a++) {
        if (p.accidentals[a]) sn.addModifier(new VF.Accidental(p.accidentals[a]), a);
      }
      if (p.ottava === OTTAVA.BASSA) {
        var ann = new VF.Annotation(OTTAVA.BASSA);
        ann.setFont('sans-serif', 10, 'normal', 'italic');
        ann.setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM);
        sn.addModifier(ann, 0);
      }
      return sn;
    });
  }

  function makeVoice(VF, notes) {
    var voice = new VF.Voice({ numBeats: 4, beatValue: 4 });
    voice.setMode(VF.Voice.Mode.SOFT);
    voice.addTickables(notes);
    return voice;
  }

  function measureHeight(kind) {
    return kind === KIND.GRAND ? LAYOUT.GRAND_HEIGHT : LAYOUT.SINGLE_HEIGHT;
  }

  function draw(VF, el, data, innerWidth) {
    var measures = (data && data.measures && data.measures.length) ? data.measures : [{ notes: [] }];
    var timeSig = (data && data.timeSigStr) || '4/4';
    var fullWidth = Math.max(LAYOUT.MIN_WIDTH, (innerWidth || 358) - LAYOUT.SIDE_PADDING);
    var staveWidth = fullWidth - LAYOUT.BRACE_ROOM;
    var kinds = measures.map(function (m) { return staffKind(measureMidis(m)); });
    var height = LAYOUT.EXTRA_HEIGHT;
    kinds.forEach(function (k) { height += measureHeight(k); });
    var renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
    renderer.resize(fullWidth + 10, height);
    var ctx = renderer.getContext();
    var y = LAYOUT.TOP_Y;
    var m;
    for (m = 0; m < measures.length; m++) {
      var kind = kinds[m];
      if (kind === KIND.GRAND) {
        var treble = new VF.Stave(LAYOUT.LEFT_X, y, staveWidth);
        var bass = new VF.Stave(LAYOUT.LEFT_X, y + LAYOUT.BASS_OFFSET_Y, staveWidth);
        treble.addClef(CLEF.TREBLE);
        bass.addClef(CLEF.BASS);
        if (m === 0) {
          treble.addTimeSignature(timeSig);
          bass.addTimeSignature(timeSig);
        }
        var start = Math.max(treble.getNoteStartX(), bass.getNoteStartX());
        treble.setNoteStartX(start);
        bass.setNoteStartX(start);
        treble.setContext(ctx).draw();
        bass.setContext(ctx).draw();
        new VF.StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
        new VF.StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
        var high = makeVoice(VF, buildNotes(VF, planMeasure(measures[m], CLEF.TREBLE, BAND.HIGH), CLEF.TREBLE));
        var low = makeVoice(VF, buildNotes(VF, planMeasure(measures[m], CLEF.BASS, BAND.LOW), CLEF.BASS));
        new VF.Formatter().joinVoices([high]).joinVoices([low]).formatToStave([high, low], treble);
        high.draw(ctx, treble);
        low.draw(ctx, bass);
      } else {
        var clef = kind === KIND.BASS ? CLEF.BASS : CLEF.TREBLE;
        var stave = new VF.Stave(LAYOUT.LEFT_X, y, staveWidth);
        stave.addClef(clef);
        if (m === 0) stave.addTimeSignature(timeSig);
        stave.setContext(ctx).draw();
        var voice = makeVoice(VF, buildNotes(VF, planMeasure(measures[m], clef, BAND.ALL), clef));
        new VF.Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
      }
      y += measureHeight(kind);
    }
  }

  return {
    CLEF: CLEF,
    KIND: KIND,
    BAND: BAND,
    OTTAVA: OTTAVA,
    SPLIT_MIDI: SPLIT_MIDI,
    OTTAVA_BELOW_MIDI: OTTAVA_BELOW_MIDI,
    REST_KEY: REST_KEY,
    LAYOUT: LAYOUT,
    restKey: restKey,
    spellKey: spellKey,
    measureMidis: measureMidis,
    staffKind: staffKind,
    planNote: planNote,
    planMeasure: planMeasure,
    draw: draw
  };
});
