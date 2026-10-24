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
  var OTTAVA_FONT = Object.freeze({ FAMILY: 'serif', SIZE: 12, SUPERSCRIPT_SIZE: 9, WEIGHT: 'normal', STYLE: 'italic' });
  var OTTAVA_GROUP = 'ottava';
  var SIXTEENTHS = Object.freeze({ w: 16, h: 8, q: 4, '8': 2, '16': 1 });
  var BEAT_SIXTEENTHS = 4;
  var PITCH_CLASSES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  var LAYOUT = Object.freeze({
    LEFT_X: 18,
    TOP_Y: 18,
    MIN_WIDTH: 260,
    SIDE_PADDING: 2,
    RIGHT_ROOM: 16,
    NOTE_SLACK: 6,
    MIN_SCALE: 0.85,
    OTTAVA_LINE: 2,
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
      var sn = new VF.StaveNote({ clef: clef, keys: p.keys, duration: p.duration, autoStem: !p.rest });
      var a;
      for (a = 0; a < p.accidentals.length; a++) {
        if (p.accidentals[a]) sn.addModifier(new VF.Accidental(p.accidentals[a]), a);
      }
      return sn;
    });
  }

  function ottavaRuns(plans) {
    var runs = [];
    var cur = null;
    plans.forEach(function (p, i) {
      if (!p.rest && p.ottava === OTTAVA.BASSA) {
        if (cur) cur.stop = i;
        else cur = { start: i, stop: i };
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    });
    if (cur) runs.push(cur);
    return runs;
  }

  function makeOttavas(VF, notes, plans) {
    return ottavaRuns(plans).map(function (r) {
      var tb = new VF.TextBracket({
        start: notes[r.start],
        stop: notes[r.stop],
        text: '8',
        superscript: 'vb',
        position: VF.TextBracket.Position.BOTTOM
      });
      tb.textElement.setFont(OTTAVA_FONT.FAMILY, OTTAVA_FONT.SIZE, OTTAVA_FONT.WEIGHT, OTTAVA_FONT.STYLE);
      tb.superscriptElement.setFont(OTTAVA_FONT.FAMILY, OTTAVA_FONT.SUPERSCRIPT_SIZE, OTTAVA_FONT.WEIGHT, OTTAVA_FONT.STYLE);
      tb.setLine(LAYOUT.OTTAVA_LINE);
      return tb;
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

  function beamGroups(VF, timeSig) {
    return VF.Beam.getDefaultBeamGroups(timeSig);
  }

  function makeBeams(VF, notes, timeSig) {
    return VF.Beam.generateBeams(notes, { groups: beamGroups(VF, timeSig) });
  }

  function sixteenths(n) {
    var d = soundDuration(n && n.duration);
    return SIXTEENTHS[d] || SIXTEENTHS.q;
  }

  function beatSplits(notes) {
    var out = [];
    var acc = 0;
    var i;
    for (i = 0; i < notes.length; i++) {
      if (i > 0 && acc % BEAT_SIXTEENTHS === 0) out.push(i);
      acc += sixteenths(notes[i]);
    }
    out.push(notes.length);
    return out;
  }

  function makeRow(measure, kind, index, from, to) {
    var src = (measure && measure.notes) ? measure.notes : [];
    return {
      measure: { notes: src.slice(from, to) },
      kind: kind,
      showTime: index === 0 && from === 0,
      closed: to >= src.length
    };
  }

  function buildMeasure(VF, row, timeSig, y, width) {
    var kind = row.kind;
    var staves = [];
    var parts = [];
    if (kind === KIND.GRAND) {
      staves.push(new VF.Stave(LAYOUT.LEFT_X, y, width).addClef(CLEF.TREBLE));
      staves.push(new VF.Stave(LAYOUT.LEFT_X, y + LAYOUT.BASS_OFFSET_Y, width).addClef(CLEF.BASS));
      parts.push({ clef: CLEF.TREBLE, band: BAND.HIGH });
      parts.push({ clef: CLEF.BASS, band: BAND.LOW });
    } else {
      var clef = kind === KIND.BASS ? CLEF.BASS : CLEF.TREBLE;
      staves.push(new VF.Stave(LAYOUT.LEFT_X, y, width).addClef(clef));
      parts.push({ clef: clef, band: BAND.ALL });
    }
    if (row.showTime) staves.forEach(function (st) { st.addTimeSignature(timeSig); });
    if (!row.closed) staves.forEach(function (st) { st.setEndBarType(VF.Barline.type.NONE); });
    if (staves.length > 1) {
      var start = Math.max.apply(null, staves.map(function (st) { return st.getNoteStartX(); }));
      staves.forEach(function (st) { st.setNoteStartX(start); });
    }
    var voices = [];
    var beams = [];
    var ottavas = [];
    parts.forEach(function (part) {
      var plans = planMeasure(row.measure, part.clef, part.band);
      var notes = buildNotes(VF, plans, part.clef);
      beams = beams.concat(makeBeams(VF, notes, timeSig));
      ottavas = ottavas.concat(makeOttavas(VF, notes, plans));
      voices.push(makeVoice(VF, notes));
    });
    var formatter = new VF.Formatter();
    voices.forEach(function (v) { formatter.joinVoices([v]); });
    return { kind: kind, staves: staves, voices: voices, beams: beams, ottavas: ottavas, formatter: formatter };
  }

  function requiredWidth(VF, row, timeSig, width) {
    var built = buildMeasure(VF, row, timeSig, 0, width);
    var top = built.staves[0];
    var overhead = width - (top.getNoteEndX() - top.getNoteStartX());
    return Math.ceil(overhead + VF.Stave.defaultPadding + built.formatter.preCalculateMinTotalWidth(built.voices) + LAYOUT.NOTE_SLACK);
  }

  function measureRows(VF, measure, kind, index, timeSig, nominal) {
    var src = (measure && measure.notes) ? measure.notes : [];
    var whole = makeRow(measure, kind, index, 0, src.length);
    whole.width = requiredWidth(VF, whole, timeSig, nominal);
    var limit = nominal / LAYOUT.MIN_SCALE;
    if (whole.width <= limit || src.length < 2) return [whole];
    var splits = beatSplits(src);
    var rows = [];
    var from = 0;
    while (from < src.length) {
      var best = null;
      var k;
      for (k = 0; k < splits.length; k++) {
        if (splits[k] <= from) continue;
        var row = makeRow(measure, kind, index, from, splits[k]);
        row.width = requiredWidth(VF, row, timeSig, nominal);
        if (best && row.width > limit) break;
        best = row;
        best.to = splits[k];
        if (row.width > limit) break;
      }
      rows.push(best);
      from = best.to;
    }
    return rows;
  }

  function layout(VF, measures, kinds, timeSig, innerWidth) {
    var displayWidth = Math.max(LAYOUT.MIN_WIDTH, (innerWidth || 358) - LAYOUT.SIDE_PADDING);
    var nominal = displayWidth - LAYOUT.LEFT_X - LAYOUT.RIGHT_ROOM;
    var staveWidth = nominal;
    var rows = [];
    var m;
    for (m = 0; m < measures.length; m++) {
      measureRows(VF, measures[m], kinds[m], m, timeSig, nominal).forEach(function (row) {
        rows.push(row);
        staveWidth = Math.max(staveWidth, row.width);
      });
    }
    var height = LAYOUT.EXTRA_HEIGHT;
    rows.forEach(function (row) { height += measureHeight(row.kind); });
    var logicalWidth = LAYOUT.LEFT_X + staveWidth + LAYOUT.RIGHT_ROOM;
    var scale = displayWidth / logicalWidth;
    return {
      rows: rows,
      staveWidth: staveWidth,
      logicalWidth: logicalWidth,
      logicalHeight: height,
      displayWidth: displayWidth,
      displayHeight: Math.ceil(height * scale),
      scale: scale
    };
  }

  function draw(VF, el, data, innerWidth) {
    var measures = (data && data.measures && data.measures.length) ? data.measures : [{ notes: [] }];
    var timeSig = (data && data.timeSigStr) || '4/4';
    var kinds = measures.map(function (m) { return staffKind(measureMidis(m)); });
    var box = layout(VF, measures, kinds, timeSig, innerWidth);
    var renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
    renderer.resize(box.displayWidth, box.displayHeight);
    var ctx = renderer.getContext();
    if (box.scale < 1) ctx.scale(box.scale, box.scale);
    var y = LAYOUT.TOP_Y;
    box.rows.forEach(function (row) {
      var built = buildMeasure(VF, row, timeSig, y, box.staveWidth);
      built.staves.forEach(function (st) { st.setContext(ctx).draw(); });
      if (built.kind === KIND.GRAND) {
        new VF.StaveConnector(built.staves[0], built.staves[1]).setType('brace').setContext(ctx).draw();
        new VF.StaveConnector(built.staves[0], built.staves[1]).setType('singleLeft').setContext(ctx).draw();
      }
      built.formatter.formatToStave(built.voices, built.staves[0]);
      built.voices.forEach(function (v, i) { v.draw(ctx, built.staves[i]); });
      built.beams.forEach(function (b) { b.setContext(ctx).draw(); });
      built.ottavas.forEach(function (o) {
        ctx.openGroup(OTTAVA_GROUP);
        o.setContext(ctx).draw();
        ctx.closeGroup();
      });
      y += measureHeight(built.kind);
    });
    return box;
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
    layout: layout,
    beatSplits: beatSplits,
    makeRow: makeRow,
    buildMeasure: buildMeasure,
    ottavaRuns: ottavaRuns,
    draw: draw
  };
});
