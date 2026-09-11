# piano-game

Detector monofónico de notas de piano desde el micrófono. Página estática para GitHub Pages, sin dependencias ni build.

## Estructura

```
index.html        UI móvil (390px)
js/pitch.js       Detección de pitch (YIN) + conversión nota↔Hz — lógica pura
js/app.js         Micrófono + AudioContext + loop de render
test/pitch.test.js  Tests contra buffers sintéticos (Node, sin deps)
SPEC.md           Reglas de negocio R1–R7 y contratos
```

## Correr local

```
python -m http.server 8000
# abrir http://localhost:8000
```

## Tests

```
npm test
```

## Deploy

Push a `main` → GitHub Pages sirve desde la raíz de `main`.

## iOS Safari

- El permiso de micrófono se pide en cada carga de página.
- Toca "Escuchar" para crear/reanudar el AudioContext (requisito de gesto).
- Si la pestaña va a segundo plano el audio se suspende: toca para reanudar (badge visible).