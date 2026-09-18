# piano-game

Detector monofónico de notas de piano desde el micrófono. Página estática para GitHub Pages, sin dependencias de red en runtime.

## Estructura

```
index.html          UI móvil (390px)
js/pitch.js         Detección de pitch (YIN) + conversión nota↔Hz — lógica pura
js/eventstream.js   Hops → eventos {midi, tStartMs, tEndMs, …}
js/score.js         Eventos → notas cuantizadas (VexFlow-ready) — lógica pura
js/vexflow.js       VexFlow 4.2.5 vendored (fuentes musicales embebidas, offline)
js/app.js           Micrófono + AudioContext + loop de render + dibujo del pentagrama
test/pitch.test.js  Tests contra buffers sintéticos (Node, sin deps)
test/score.test.js  Tests de cuantización (Node, sin red)
SPEC.md             Reglas de negocio R1–R23 y contratos
```

## Partitura en vivo

Mientras pulsas **Escuchar**, cada nota consolidada se vuelca a un pentagrama tradicional (`#staff`) debajo del display:

- Tempo fijo **♩=80**, compás **4/4**, **clave de sol**.
- La duración se cuantiza al valor más cercano entre redonda, blanca, negra, corchea y semicorchea; los huecos se llenan con silencios; dos notas al mismo instante se dibujan como acorde.
- Notas por debajo de C3 (MIDI &lt; 48) se escriben una octava arriba con **8vb**.
- Al **Parar**, la partitura se queda. Al volver a Escuchar, se limpia.

VexFlow **no se carga de un CDN**: el archivo `js/vexflow.js` va en el repo (v4.2.5). Las páginas de GitHub Pages y un `index.html` abierto en local (incluso sin red, tras tener los archivos) dibujan el pentagrama con los glifos embebidos (Gonville).

## Correr local

```
python -m http.server 8000
# abrir http://localhost:8000
```

## Tests

```
npm test
```

Corre `test/pitch.test.js` y `test/score.test.js` (Node, sin `npm install`).

## Deploy

Push a `main` → GitHub Pages sirve desde la raíz de `main`.

## iOS Safari

- El permiso de micrófono se pide en cada carga de página.
- Toca "Escuchar" para crear/reanudar el AudioContext (requisito de gesto).
- Si la pestaña va a segundo plano el audio se suspende: toca para reanudar (badge visible).
