# 🎼 piano-game

> Toca una nota en tu piano y mírala escrita en una partitura, en vivo, desde el micrófono del navegador.

**[▶ Probar ahora](https://juliangdeveloper.github.io/piano-game/)** · gratis, en el navegador, sin instalar

<img src="docs/screenshot.png" alt="piano-game detectando C4 y escribiendo las notas en un pentagrama" width="320">

## Cómo se usa
- Abre la página y pulsa **Escuchar**; el navegador pide permiso para el micrófono.
- Toca una nota a la vez (piano, voz u otro instrumento) cerca del micrófono.
- Arriba ves la nota (C4 · Do4), su desafinación en cents y la claridad de la señal.
- Cada nota se escribe en un pentagrama en clave de sol a ♩=80 y 4/4, con la duración cuantizada y silencios en los huecos.
- Al pulsar **Parar** la partitura se queda; al volver a escuchar, empieza limpia.
- En iPhone el permiso se pide en cada carga y hay que tocar la pantalla para reanudar el audio.

## Stack
JavaScript vanilla, Web Audio (detección de tono YIN) y [VexFlow](https://www.vexflow.com/) 4.2.5 incluido en el repo. Funciona sin red una vez cargado.

```
python3 -m http.server 8000   # abrir http://localhost:8000
npm test                      # tests en Node, sin npm install
```

## Relacionado
🎹 [piano-magic](https://github.com/juliangdeveloper/piano-magic): un combate RPG que se juega tocando piano, con el mismo detector de notas. [Jugar](https://juliangdeveloper.github.io/piano-magic/)

---

Más proyectos: https://juliangdeveloper.github.io/
