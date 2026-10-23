# piano-transcribe — SPEC

Partitura en vivo. Sin build. La página es un cliente del motor público: lo carga por URL y dibuja con VexFlow. No importa archivos internos del motor.

## Motor `engine/v1`

- Ruta estable: `https://juliangdeveloper.github.io/piano-transcribe/engine/v1/`.
- `version.txt`: una línea con la versión. Se pide con `cache: 'no-store'`.
- `capture.js?v=<versión>`: módulo ES. Sin DOM, sin `window`, sin VexFlow, sin dependencias.
- Contrato: `INTERFACE === 1`. Exporta `createCapture`, `detectPitch`, `noteFromFreq`, `noteFromMidi`, `hzForNote`, `sessionType`, `denyMessage`, `statusLine`, `HOP_MS` (20) y `VERSION`.
- `createCapture({ profile, maxVoices, score })`. `score` (default): C2–C7. `combat`: C3–C6, el mismo criterio de piano-magic. `maxVoices` default 1; `2` permite un intervalo o un bajo sostenido bajo otra nota, desde C3. `score: { bpm, timeSig, clef }` default 80, 4/4, treble.
- `hop(buffer, sampleRate, nowMs, { blocked })` una vez por `HOP_MS`, con el `Float32Array` del `AnalyserNode` (`fftSize` 2048). La detección no sale del dispositivo.
- `press` / `release` / `advance` / `releaseSource` / `reset` / `score` / `held`.
- Evento: `{ type:'on'|'off', pitch, note, octave, midi, source, sound, combat, fresh, released, t }`.
- Nota de partitura: `{ rest, duration, beats, midi, pitch, note, octave, beat, measure, ottava, accidentals }`. `duration` ∈ `w h q 8 16` (el silencio lleva `r`). MIDI &lt; 48 lleva `ottava: '8vb'` y se dibuja una octava arriba. A4 = 440.

## Página

- **R1**: El micrófono o el MIDI solo arrancan tras pulsar Escuchar. Antes de eso la única red es la carga del motor (`version.txt` y `capture.js`).
- **R5**: iOS Safari: `AudioContext` creado en el gesto; badge si queda suspendido; un toque lo reanuda.
- **R8**: Cadena de audio en el cliente, no en el motor: highpass 60 Hz → lowpass 4 kHz → ganancia ×4 (línea ×1) → analyser 2048, smoothing 0. Sin AGC, sin supresión de ruido, sin cancelación de eco. Una ganancia a 0 va al destino para que iOS no corte el grafo.
- **R11**: Fuentes `mic` (default), `midi` y `line`. MIDI usa `press` / `release`. Si no hay dispositivo, el hint lo dice y no hay crash.
- **R12**: La fuente persiste en `localStorage` (`piano-transcribe.source`; si no hay, se lee `piano-game.source`). ⚙ solo se ve con el detector parado.
- **R21**: `#staff` se redibuja desde `session.score()` como máximo cada 150 ms. Parar deja la partitura. Escuchar de nuevo crea otra sesión.
- **R22**: VexFlow vendored en `js/vexflow.js` (4.2.5). Cero CDN.

Si el motor no carga, Escuchar queda desactivado y el hint pide recargar.

## Tests

`npm test` (Node, sin instalar nada) cubre el contrato del motor, la paridad de afinación y que `js/app.js` e `index.html` solo entran por el URL público.
