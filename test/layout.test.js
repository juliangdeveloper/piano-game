'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find(p => fs.existsSync(p));
const WIDTHS = Object.freeze({ PHONE: 358, DESKTOP: 1200 });

function n(midis, duration) {
  return midis ? { rest: false, duration, midi: midis[0], midis } : { rest: true, duration: duration + 'r', midi: null, midis: [] };
}

const SCORE = {
  timeSigStr: '4/4',
  measures: [
    { notes: [n([60], '8'), n([64], '16'), n([67], '16'), n([72], '8'), n([48], '8'), n([43], '8'), n([36, 48], '8'), n([40], '8'), n([36, 64, 67], '8')] },
    { notes: [n([45, 72], '8'), n([47, 74], '8'), n([61], '16'), n([63], '16'), n([84], '8'), n(null, '16'), n([79, 83], '16'), n([62], '8'), n([40], '16'), n([38], '16'), n([36], '16'), n([35], '16')] },
    { notes: [61, 63, 66, 68, 70, 73, 75, 78, 80, 82, 85, 87, 30, 31, 33, 35].map(m => n([m], '16')) }
  ]
};

function page(width) {
  const src = f => pathToFileURL(path.join(root, f)).href;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="staff" style="width:${width}px"></div>
<script src="${src('js/vexflow.js')}"></script>
<script src="${src('js/staff.js')}"></script>
<script>
window.result = (async () => {
  try {
    VexFlow.setFonts('Gonville');
    const face = new FontFace('Gonville', 'url(${src('fonts/gonville.woff2')})');
    await face.load();
    document.fonts.add(face);
    const el = document.getElementById('staff');
    const box = Staff.draw(VexFlow, el, ${JSON.stringify(SCORE)}, ${width});
    const svg = el.querySelector('svg');
    const ctm = svg.getScreenCTM();
    const r0 = svg.getBoundingClientRect();
    const sx = b => ({ l: b.x * ctm.a + ctm.e - r0.left, r: (b.x + b.width) * ctm.a + ctm.e - r0.left });
    const all = sel => Array.from(svg.querySelectorAll(sel)).map(e => sx(e.getBBox()));
    return {
      ok: true,
      font: document.fonts.check('20px Gonville'),
      svgWidth: r0.width,
      scale: box.scale,
      rows: box.rows.length,
      staves: all('.vf-stave'),
      notes: all('.vf-stavenote'),
      brackets: all('.vf-ottava'),
      beams: svg.querySelectorAll('.vf-beam').length
    };
  } catch (e) {
    return { ok: false, error: String(e && e.stack || e) };
  }
})();
</script></body></html>`;
}

function devtools(proc) {
  let buf = '';
  let id = 0;
  const waiting = new Map();
  proc.stdio[4].on('data', chunk => {
    buf += chunk.toString('utf8');
    let at;
    while ((at = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      if (msg.id && waiting.has(msg.id)) {
        const { resolve, reject } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    }
  });
  return (method, params, sessionId) => new Promise((resolve, reject) => {
    id += 1;
    waiting.set(id, { resolve, reject });
    proc.stdio[3].write(JSON.stringify({ id, method, params: params || {}, sessionId }) + '\0');
  });
}

async function render(width) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-layout-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page(width));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--allow-file-access-from-files',
    '--remote-debugging-pipe', '--user-data-dir=' + path.join(dir, 'profile'), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  try {
    const send = devtools(proc);
    const { targetInfos } = await send('Target.getTargets');
    let target = targetInfos.find(t => t.type === 'page');
    if (!target) target = { targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId };
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    for (let i = 0; i < 300; i++) {
      const probe = await send('Runtime.evaluate', { expression: 'typeof window.result', returnByValue: true }, sessionId);
      if (probe.result.value === 'object') break;
      await new Promise(r => setTimeout(r, 100));
    }
    const res = await send('Runtime.evaluate', { expression: 'window.result', awaitPromise: true, returnByValue: true }, sessionId);
    if (!res.result.value) throw new Error('sin resultado: ' + JSON.stringify(res.exceptionDetails || res.result));
    return res.result.value;
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const [label, width] of Object.entries(WIDTHS)) {
  test(`partitura ${label.toLowerCase()}: nada pasa la barra final, el 8vb queda dentro y hay barras`, { skip: chrome ? false : 'sin Chrome', timeout: 60000 }, async () => {
    const res = await render(width);
    assert.ok(res.ok, res.error);
    assert.ok(res.font, 'Gonville sin cargar');
    assert.ok(res.svgWidth <= width);
    const staveEnd = Math.min(...res.staves.map(s => s.r));
    assert.ok(res.notes.length > 0);
    res.notes.forEach(b => assert.ok(b.r <= staveEnd, `nota en ${b.r} pasa la barra en ${staveEnd}`));
    assert.ok(res.brackets.length > 0);
    res.brackets.forEach(b => {
      assert.ok(b.l >= 0);
      assert.ok(b.r <= res.svgWidth, `8vb en ${b.r} fuera de ${res.svgWidth}`);
    });
    assert.ok(res.beams >= 6);
    if (width === WIDTHS.PHONE) assert.ok(res.scale >= 0.85, 'escala ' + res.scale + ' filas ' + res.rows);
  });
}
