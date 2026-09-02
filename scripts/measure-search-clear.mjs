#!/usr/bin/env node
// Count the clear affordances the browser actually PAINTS inside the search
// field, in a real Chromium, at real pixels.
//
// 🔴 Why this exists at all: jsdom does not render. The 0.3.1 store capture
// showed TWO ✕ controls side by side in the field — the UA's
// ::-webkit-search-cancel-button and the app's own <button> — and every
// assertion in the vitest suite passed straight through it, because both
// elements were exactly where they were supposed to be. A defect that is
// purely a question of what got painted needs an instrument that paints.
//
// Two independent instruments, deliberately failing in different ways:
//
//   A) LAYOUT — reach into the input's user-agent shadow DOM over CDP and read
//      the cancel button's computed width/appearance. `appearance: none` strips
//      the control's intrinsic sizing, so a suppressed button computes to 0px.
//   B) PIXELS — screenshot the right-hand end of the field at 4x, decode the
//      PNG here (no image library), project ink onto the x axis and count the
//      glyph clusters. This one cannot be fooled by a box that is laid out but
//      invisible, or invisible but laid out.
//
// Both are reported. They are supposed to agree; if they ever disagree, the
// disagreement is the finding, so do not average them or drop one.
//
// 🔴 HOVER IS LOAD-BEARING, and it is the thing that made this hard to see.
// Blink's UA sheet gives ::-webkit-search-cancel-button `opacity: 0` and only
// lifts it under `:hover` or `:focus`. So a scripted value-set with the pointer
// parked elsewhere paints ONE ✕ even on completely unfixed code — which reads
// exactly like a passing test. The live store capture had the field hovered/
// focused because a person had just typed into it. The measurement has to put
// the pointer on the field or it is measuring nothing.
//
// Focus would work equally well for the UA rule, but the app draws its own
// focus outline *inside* the strip being sampled, whose horizontal segments put
// ink in every column and collapse the projection to one cluster. Hover selects
// the same UA branch without that confound.
//
// Three states are measured, and at base they return three DIFFERENT numbers —
// which is what makes the counter a measurement rather than a constant:
//
//   empty + hover    → 0   (nothing to clear; proves the clip is aimed right)
//   filled, no hover → 1   (UA button laid out but transparent)
//   filled + hover   → 2 before the fix, 1 after   ← the defect
//
// Usage:
//   node scripts/measure-search-clear.mjs --url http://localhost:5187
//   node scripts/measure-search-clear.mjs --json    # machine-readable
//
// Requires a Chromium-family browser on PATH (chromium / chrome / brave) and a
// dev harness already serving --url. It never touches the operator's browser
// profile — it launches its own headless instance in a temp user-data-dir.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const URL_UNDER_TEST = arg('--url', 'http://localhost:5187');
const QUERY = arg('--query', 'dark');
const AS_JSON = args.includes('--json');
const SHOT_DIR = arg('--shots', null);

const BROWSERS = ['chromium', 'chrome', 'google-chrome-stable', 'brave', 'brave-browser'];

// ---------------------------------------------------------------- CDP client

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  once(method, predicate = () => true) {
    return new Promise((resolve) => {
      const l = (msg) => {
        if (msg.method === method && predicate(msg)) {
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(msg.params);
        }
      };
      this.listeners.push(l);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true });
  });
  return new Cdp(ws);
}

async function launchBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'ar-searchclear-'));
  const port = 9000 + Math.floor(Math.random() * 900);
  let child = null;
  let lastErr = null;

  for (const bin of BROWSERS) {
    child = spawn(
      bin,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--disable-extensions',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    const started = await new Promise((resolve) => {
      child.once('error', () => resolve(false));
      setTimeout(() => resolve(true), 300);
    });
    if (started) break;
    lastErr = new Error(`${bin} not runnable`);
    child = null;
  }
  if (!child) throw lastErr ?? new Error(`no browser found (tried ${BROWSERS.join(', ')})`);

  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const body = await res.json();
      if (body.webSocketDebuggerUrl) {
        return {
          wsUrl: body.webSocketDebuggerUrl,
          browser: body.Browser,
          close: () => {
            try {
              child.kill('SIGTERM');
            } catch {
              /* already gone */
            }
            rmSync(profile, { recursive: true, force: true });
          },
        };
      }
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  child.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
  throw new Error('browser never exposed a CDP endpoint');
}

// -------------------------------------------------------------- PNG decoding
// Chrome returns 8-bit RGBA (colour type 6) or RGB (type 2), non-interlaced.
// Small enough to unfilter here rather than take an image dependency.

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (!channels) throw new Error(`colour type ${colourType} unsupported`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * Count glyph clusters by projecting "ink" onto the x axis.
 *
 * The field's fill is flat, so the modal luminance of the strip IS the
 * background. A column counts as ink if any pixel in it is far enough from that
 * background; clusters are runs of ink columns, merged across gaps narrower
 * than `gap` so antialiasing inside one glyph cannot split it in two.
 */
function countInkClusters({ width, height, channels, data }, { threshold = 20, gap = 8 } = {}) {
  const lum = new Float64Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  // modal luminance, 8-unit buckets — the flat field fill dominates by area
  const hist = new Array(32).fill(0);
  for (let i = 0; i < lum.length; i++) hist[Math.min(31, Math.floor(lum[i] / 8))]++;
  let mode = 0;
  for (let b = 1; b < 32; b++) if (hist[b] > hist[mode]) mode = b;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < lum.length; i++) {
    if (Math.floor(lum[i] / 8) === mode) {
      sum += lum[i];
      n++;
    }
  }
  const background = n ? sum / n : 0;

  const inkCols = [];
  for (let x = 0; x < width; x++) {
    let ink = 0;
    for (let y = 0; y < height; y++) {
      if (Math.abs(lum[y * width + x] - background) > threshold) ink++;
    }
    inkCols.push(ink > 0);
  }

  const clusters = [];
  let start = -1;
  let lastInk = -1;
  for (let x = 0; x < width; x++) {
    if (inkCols[x]) {
      if (start < 0) start = x;
      else if (x - lastInk > gap) {
        clusters.push([start, lastInk]);
        start = x;
      }
      lastInk = x;
    }
  }
  if (start >= 0) clusters.push([start, lastInk]);
  return { background: Math.round(background), clusters, inkColumns: inkCols.filter(Boolean).length };
}

// ------------------------------------------------------------------ the run

async function main() {
  const browser = await launchBrowser();
  let cdp;
  const report = { url: URL_UNDER_TEST, browser: browser.browser, query: QUERY, states: {} };

  try {
    cdp = await connect(browser.wsUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);

    await S('Page.enable');
    await S('Runtime.enable');
    await S('DOM.enable');
    await S('CSS.enable');
    // The geometry the live store capture used, so the measurement is about the
    // same layout the defect was seen in.
    await S('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 778,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = cdp.once('Page.loadEventFired', (m) => m.sessionId === sessionId);
    await S('Page.navigate', { url: URL_UNDER_TEST });
    await loaded;

    // wait for the board's own ready anchor
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const r = await S('Runtime.evaluate', {
        expression: `!!document.querySelector('[data-testid="board-ready"]')`,
        returnByValue: true,
      });
      if (r.result.value) {
        ready = true;
        break;
      }
      await sleep(100);
    }
    if (!ready) throw new Error('board-ready never appeared — is the dev harness serving?');

    for (const [state, text, hover] of [
      ['empty-hover', '', true],
      ['filled-nohover', QUERY, false],
      ['filled-hover', QUERY, true],
    ]) {
      // React is controlled, so poke the native setter and fire `input`.
      await S('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('[data-testid="search-input"]');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, ${JSON.stringify(text)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return el.value;
        })()`,
        returnByValue: true,
      });
      await sleep(250);

      const where = await S('Runtime.evaluate', {
        expression: `(() => {
          const r = document.querySelector('[data-testid="search-input"]').getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
        returnByValue: true,
      });
      // Park the pointer on the field, or far away — see the hover note above.
      await S('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: hover ? where.result.value.x : 4,
        y: hover ? where.result.value.y : 4,
        buttons: 0,
      });
      await sleep(250);

      const geom = await S('Runtime.evaluate', {
        expression: `(() => {
          const input = document.querySelector('[data-testid="search-input"]');
          const field = input.parentElement;
          const f = field.getBoundingClientRect();
          const custom = document.querySelector('[data-testid="search-clear"]');
          return {
            value: input.value,
            inputType: input.getAttribute('type'),
            field: { x: f.x, y: f.y, width: f.width, height: f.height },
            customClearPresent: !!custom,
            customClearWidth: custom ? custom.getBoundingClientRect().width : 0,
          };
        })()`,
        returnByValue: true,
      });
      const g = geom.result.value;

      // ---- instrument A: the UA shadow DOM's cancel button box
      const { root } = await S('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId: inputNode } = await S('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '[data-testid="search-input"]',
      });
      const described = await S('DOM.describeNode', { nodeId: inputNode, depth: -1, pierce: true });
      const shadow = [];
      const walk = (node) => {
        for (const sr of node.shadowRoots ?? []) walk(sr);
        for (const ch of node.children ?? []) {
          shadow.push(ch);
          walk(ch);
        }
      };
      walk(described.node);
      const cancel = shadow.find(
        (n) => (n.pseudoIdentifier ?? '').includes('search-cancel') ||
               (n.pseudoType ?? '').includes('search-cancel') ||
               (n.attributes ?? []).join(' ').includes('search-cancel') ||
               (n.nodeName ?? '').toLowerCase().includes('search-cancel'),
      );
      let cancelStyle = null;
      if (cancel) {
        const { nodeIds } = await S('DOM.pushNodesByBackendIdsToFrontend', {
          backendNodeIds: [cancel.backendNodeId],
        });
        const { computedStyle } = await S('CSS.getComputedStyleForNode', { nodeId: nodeIds[0] });
        const pick = (name) => computedStyle.find((p) => p.name === name)?.value ?? null;
        cancelStyle = {
          width: pick('width'),
          height: pick('height'),
          opacity: pick('opacity'),
          appearance: pick('-webkit-appearance') ?? pick('appearance'),
          display: pick('display'),
        };
      }

      // ---- instrument B: painted pixels at the right-hand end of the field
      const SCALE = 4;
      const INSET = 4; // stay off the field's own border
      const STRIP = 74; // wide enough to hold both ✕ glyphs
      const clip = {
        x: g.field.x + g.field.width - STRIP,
        y: g.field.y + INSET,
        width: STRIP - INSET,
        height: g.field.height - INSET * 2,
        scale: SCALE,
      };
      const shot = await S('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
      const png = decodePng(Buffer.from(shot.data, 'base64'));
      const ink = countInkClusters(png, { threshold: 20, gap: SCALE * 2 });
      if (SHOT_DIR) {
        writeFileSync(join(SHOT_DIR, `search-${state}.png`), Buffer.from(shot.data, 'base64'));
      }

      report.states[state] = {
        inputType: g.inputType,
        inputValue: g.value,
        customClearPresent: g.customClearPresent,
        customClearWidthCssPx: Math.round(g.customClearWidth * 100) / 100,
        nativeCancelFound: !!cancel,
        nativeCancelComputed: cancelStyle,
        paintedClusters: ink.clusters.length,
        clusterBoundsDevicePx: ink.clusters,
        stripBackgroundLuminance: ink.background,
        clipCssPx: { x: Math.round(clip.x), y: Math.round(clip.y), w: clip.width, h: Math.round(clip.height) },
      };
    }
  } finally {
    browser.close();
  }

  // The verdict: the defect state must paint exactly one, and the two control
  // states must return their own distinct numbers — a counter stuck on 1 would
  // "pass" the defect state while measuring nothing.
  const expected = { 'empty-hover': 0, 'filled-nohover': 1, 'filled-hover': 1 };
  const failures = Object.entries(expected).filter(
    ([state, n]) => report.states[state].paintedClusters !== n,
  );

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ ...report, expected, ok: failures.length === 0 }, null, 2) + '\n');
  } else {
    const order = ['empty-hover', 'filled-nohover', 'filled-hover'];
    const col = (s) => String(s).padEnd(16);
    const lines = [
      `browser              ${report.browser}`,
      `url                  ${report.url}`,
      `input type           ${report.states['filled-hover'].inputType}`,
      `query                ${JSON.stringify(report.query)}`,
      '',
      `state                ${order.map(col).join('')}`,
      `painted ✕ clusters   ${order.map((s) => col(report.states[s].paintedClusters)).join('')}`,
      `expected             ${order.map((s) => col(expected[s])).join('')}`,
      `custom clear button  ${order.map((s) => col(report.states[s].customClearPresent)).join('')}`,
      `UA cancel width      ${order.map((s) => col(report.states[s].nativeCancelComputed?.width ?? 'absent')).join('')}`,
      `UA cancel opacity    ${order.map((s) => col(report.states[s].nativeCancelComputed?.opacity ?? '-')).join('')}`,
      `UA cancel appearance ${order.map((s) => col(report.states[s].nativeCancelComputed?.appearance ?? '-')).join('')}`,
      '',
      ...order.map(
        (s) => `cluster bounds ${col(s)} (device px, 4x): ${JSON.stringify(report.states[s].clusterBoundsDevicePx)}`,
      ),
      '',
      failures.length === 0
        ? 'PASS — exactly one clear affordance is painted, and the controls moved.'
        : failures
            .map(([s, n]) => `FAIL — ${s}: ${report.states[s].paintedClusters} clusters painted, expected ${n}.`)
            .join('\n'),
    ];
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`measure-search-clear: ${err.message}\n`);
  process.exit(2);
});
