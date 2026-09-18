# piano-game — SPEC v1

Detector monofónico de notas de piano vía micrófono. Página estática para GitHub Pages. Sin dependencias externas, sin build, 100% client-side.

## Reglas de negocio

- **R1**: El micrófono solo se activa tras gesto del usuario (botón "Escuchar"). Antes del gesto no hay audio ni red. El audio nunca sale del dispositivo: cero fetch/XHR en runtime.
- **R2**: Monofónico: se detecta UNA nota dominante. Si claridad < 0.90 (`CLARITY_THRESHOLD`) → display "—".
- **R3**: Salida = nota + octava + cents (±50) + frecuencia Hz. Rango C2 (65.41 Hz) – C7 (2093.0 Hz). Fuera de rango → "—" (pero NO borra el log).
- **R4**: Anti-parpadeo: nota se muestra solo tras 3 frames consecutivos con la misma nota (`STABLE_FRAMES=3`). Mientras tanto se mantiene la nota estable anterior.
- **R5**: iOS Safari: AudioContext creado/resumido dentro del tap; badge visible si el contexto queda suspendido; tap en cualquier parte lo reanuda.
- **R6**: A4 = 440 Hz fijo (const `A4=440`, sin dial en v1).
- **R7**: Log de últimas 8 notas estables: se agrega entrada cuando la nota estable CAMBIA; "—" y mic-off no agregan ni borran.
- **R8**: Cadena de audio: source → BiquadFilter highpass 60Hz (Q 0.707) → BiquadFilter lowpass 4kHz (Q 0.707) → Gain ×4 fija → AnalyserNode. Sin AGC (`autoGainControl: false`): ganancia determinista, sin pumping.
- **R10**: Hold: la nota estable sobrevive gaps de ≤15 frames (`HOLD_FRAMES=15`, ~500ms) antes de mostrar "—". La misma nota tras gap corto NO se re-loguea; tras pausa larga (> hold) SÍ. Implementado en `js/hold.js` (pura, TDD).
- **R11**: Tres fuentes de entrada seleccionables: `mic` (cadena R8, default), `midi` (Web MIDI: note-on → display inmediato vía `Hold.midiUpdate`, note-off → display "—" al instante, sin YIN/hold/contador; status line `⚙ midi` visible en `midiStatus`), `line` (getUserMedia con preamp ×1 en vez de ×4). Si Web MIDI no está disponible o no hay dispositivo → aviso en hint, sin crash.
- **R12**: La fuente elegida persiste en `localStorage` (`piano-game.source`). El botón ⚙ (abre/cierra el panel) solo es visible cuando el detector está parado.
- **R13**: `Pitch.noteFromMidi(m)` pura en `pitch.js`: número entero 0–127 → {name, octave, cents:0, midi}; fuera de rango o no-entero → null. TDD (C4=60, A4=69, extremos, roundtrip 0–127).
- **R14**: Modo Transcripción (📝): arquitectura de 2 partes — capturador (ScriptProcessorNode escribe audio crudo a ring buffer de 60s, sin análisis) + procesador (cada 200ms toma el tramo nuevo, ventanas de 4096 con hop de 1024 muestras ~21ms, FFT + máscaras). La ventana corre con la señal: lo viejo cae del buffer, los eventos reportados permanecen.
- **R15**: Detección dirigida por máscaras (`js/mask.js`): 61 máscaras C2–C7 (midi 36–96, = 61 teclas del CT-S1). Score por nota = energía ponderada en fundamental+8 armónicos (1/k) / energía total, calibrado en runtime (seno puro = 1.0), penalización de subarmónicos. Umbrales: VOICE ≥0.6 (nota sola), CHORD_MIN ≥0.45 (acorde: mitad física de energía por nota), máx 2 voces/hop.
- **R16**: Merge de eventos (`js/eventstream.js`): run ≥2 hops emite evento inmediato (~42ms tras onset, lista en vivo); se extiende in-place mientras la nota siga; gap ≤3 hops de la misma nota = misma pulsación (decaimiento del piano); gap mayor = re-tocada (evento nuevo).
- **R17**: Lista cronológica completa de la sesión, sin límite: `#n Nota · +X.Xs` (+ intervalo desde la anterior). Teclas SIEMPRE individuales (acorde = 2 entradas con mismo timestamp, marcadas ♪♪). Se limpia solo al iniciar nueva sesión.
- **R18**: Ticker del procesador: 200ms fijos, independiente del rAF (setInterval); procesa el backlog completo desde la última muestra procesada (backfill imposible de perder).
- **R21**: Partitura tradicional en vivo (`#staff`): mientras se escucha (mic/línea/MIDI), los eventos de `EventStream` se cuantizan (`js/score.js`) y se dibujan con VexFlow. Al pulsar Parar la partitura se queda; al iniciar una sesión nueva se limpia. El log de texto (`#noteLog`) no se sustituye.
- **R22**: VexFlow **vendored** en `js/vexflow.js` (pin **4.2.5**, fuentes musicales Gonville/Bravura/Petaluma embebidas). Cero CDN, cero `fetch` de webfonts (Google u otro). Carga: `<script src="js/vexflow.js?v=…">`.
- **R23**: Cuantización de la partitura: default ♩=80, 4/4, clave de sol. Duración de cada evento = `(tEndMs-tStartMs)` al valor más cercano entre [redonda, blanca, negra, corchea, semicorchea]. Huecos ≥ ½ semicorchea → silencios. Eventos con el mismo `tStartMs` → acorde. MIDI < 48 (C3) se escribe una octava arriba con marca **8vb** (sigue en clave de sol; no hay pentagrama de fa en v1.7).

## Reparto de archivos (partición estricta entre agentes)

- `index.html` — UI móvil-first (390px), sin librerías de CDN → **Agente B**
- `js/app.js` — mic + AudioContext + AnalyserNode + loop de render + dibujo de la partitura → **Agente B**
- `js/pitch.js` — lógica pura, sin DOM, UMD (`module.exports` + `window.Pitch`) → **Agente A**
- `js/score.js` — lógica pura EventStream → notas VexFlow-ready, UMD (`window.Score`) → **Agente A**
- `js/vexflow.js` — VexFlow 4.2.5 vendored (offline)
- `test/pitch.test.js` — tests Node (assert nativo, sin deps) contra buffers sintéticos → **Agente A**
- `test/score.test.js` — tests de cuantización (duraciones, silencios, midi→key), sin red
- `package.json`, `README.md`, `.gitignore`, `SPEC.md` → orquestador (ya existen, NO modificar)

Los agentes NO ejecutan git (init/commit/push lo hace el orquestador). NO usar npm install (no hay dependencias).

## Contrato de `js/pitch.js`

```js
// UMD: module.exports = Pitch (Node) y window.Pitch (browser)
Pitch.detectPitch(buffer, sampleRate, opts) -> {freq: number|null, clarity: number}
//   buffer: Float32Array; opts.clarityThreshold default 0.90
//   clarity ∈ [0,1]; freq=null si claridad < threshold o buffer inválido (< 2*maxLag muestras)
Pitch.noteFromFreq(freq, a4=440) -> {name, octave, cents, midi} | null
//   name ∈ ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
//   midi redondeado al semitono más cercano; cents = desvío redondeado ±50
Pitch.hzForNote(name, octave, a4=440) -> number
```

`noteFromFreq` NO chequea el rango C2–C7 (eso lo hace app.js con midi ∈ [36,96]).

## Algoritmo (YIN)

- Ventana: 4096 muestras (app usa `analyser.fftSize=4096`), `maxLag=760` (cubre C2 a 48 kHz), `tauMin=2`.
- Pasos estándar: función de diferencia d(τ) → diferencia media normalizada acumulativa d'(τ) → primer τ con d'(τ) < 0.15 (si no hay, argmin) → refinamiento parabólico.
- `claridad = 1 - d'(τ)` en el τ elegido.

## UI (index.html)

- Fondo oscuro, tipografía grande para la nota: formato `A4 · La4` (nomenclatura anglosajona + latina: Do Do# Re Re# Mi Fa Fa# Sol Sol# La La# Si).
- Elementos con id: `btnToggle` (texto "Escuchar"/"Parar"), `noteDisplay`, `centsBar` (barra horizontal −50..+50 con marcador), `clarityBar` (0..1), `freqText`, `noteLog` (lista, últimas 8), `badgeSuspended` (oculto por defecto, texto "Audio suspendido — toca para reanudar"), `hint` ("Toca una nota de piano cerca del micrófono").
- Meta viewport + safe-area; sin scroll de página (el main y la partitura sí hacen scroll interno); sin recursos externos (ninguna fuente/CDN). `#staff` / `#staffWrap`: pentagrama ~390px, fondo claro para glifos VexFlow, sistemas apilados (un compás por renglón).

## Loop (app.js)

- `rAF` con skip: procesa cada 2 frames (~30 Hz). `analyser.getFloatTimeDomainData(buf)` → `Pitch.detectPitch(buf, ctx.sampleRate)`.
- Estabilidad: contador por nota; al llegar a `STABLE_FRAMES` se vuelve nota estable y se actualiza display + log.
- Stop: `stream.getTracks().forEach(t => t.stop())`, cancelar loop, reset de display ("—") SIN borrar el log.
- R5: en tap general, si `ctx.state === 'suspended'` → `ctx.resume()`; badge visible mientras esté suspendido.

## Tests (TDD: escribirlos primero, verlos fallar, luego implementar)

Usar sampleRate 48000 y 44100 según el caso; buffers Float32Array de 4096.

1. Seno 440 Hz → freq 440±1.5, claridad > 0.9; `noteFromFreq` → A4, cents 0±2
2. Seno 261.6256 Hz @44100 → C4 (freq ±1.5)
3. Seno 82.4069 Hz → E2 (freq ±2)
4. Seno 2093.0 Hz → C7 (freq ±3)
5. Señal tipo piano 220 Hz (220 + 0.5·440 + 0.25·660 + 0.12·880) → A3 (freq ±2), claridad > 0.9
6. Buffer de ceros → freq null, claridad ≤ 0.1
7. Ruido blanco (LCG seed fija, determinista) → freq null
8. Buffer de 100 muestras → freq null sin lanzar excepción
9. `hzForNote('A',4) === 440`; `hzForNote('C',4,442)` ≈ 263.74 (±0.05)
10. Roundtrip: para cada semitono C2..C7, `hzForNote → noteFromFreq` devuelve mismo name/octave y |cents| ≤ 1
11. `noteFromFreq(444.5)` → A4 con cents ≈ +18 (±5)

## Criterios de aceptación

- `npm test` verde (exit 0), sin dependencias instaladas.
- `node --check js/app.js` y `node --check js/pitch.js` sin errores.
- index.html abre sin errores de consola antes del gesto (verificación del orquestador en browser).
- Sin llamadas de red en runtime (grep de fetch/XHR vacío).