#!/usr/bin/env node
// Measure what the stacked toolbar is actually SHAPED like, in a real Chromium,
// at real pixels, at four widths.
//
// 🔴 Why this exists — the defect it was written against, measured at 375px:
//
//     board-ready   h=264  dir=column
//       child0 (search wrapper)   h=220   content=53   grow=1  basis=220px
//       child1 (sort row)         h=32    content=32   grow=0  basis=auto
//
// ~167px of dead space between the search field and the sort switcher. The
// wrapper carried `flex: 1 1 220px`, written for a ROW where `220px` is a
// minimum WIDTH. The stacked toolbar sets `flex-direction: column`, so the same
// declaration became a 220px HEIGHT and `flex-grow: 1` held it there.
//
// 🔴 EVERY ATTRIBUTE ASSERTION IN THE VITEST SUITE PASSED THROUGH IT, and would
// again. `data-layout` read `stacked`, `data-tier` read `base`, every testid was
// present — the layout DECISION was right and only the SIZING was wrong. jsdom
// has no layout engine, so a defect that is purely a question of what box got
// how many pixels needs an instrument with a layout engine. Same reasoning, and
// the same shape, as scripts/measure-search-clear.mjs.
//
// (`src/responsive.test.tsx` carries the CI-runnable half — a structural walk
// asserting no column flex container has a child with a fixed-length basis.
// That one catches the CAUSE from resolved style; this one measures the EFFECT
// in pixels. They are supposed to agree; a disagreement is the finding.)
//
// Two instruments, failing in different ways:
//
//   A) DEAD SPACE — each toolbar child's border box height against the union of
//      its own children's boxes. A box far taller than its contents is the
//      defect, whatever caused it.
//   B) RESOLVED BASIS — each child's computed flex-basis while the container is
//      a column. A positive LENGTH there is a height, and is the mechanism.
//
// 🔴 AND A CONTROL, because a checker that answers the same thing at every width
// is indistinguishable from one wired to nothing: the toolbar's flex-direction
// and the search wrapper's basis must DIFFER between the narrow and wide widths
// (column/auto vs row/220px). If they do not, the emulation never took and every
// PASS below is vacuous.
//
// Usage:
//   node scripts/measure-toolbar-geometry.mjs --url http://localhost:5187
//   node scripts/measure-toolbar-geometry.mjs --json
//
// Requires a Chromium-family browser on PATH and a dev harness serving --url.
// Launches its own headless instance in a temp profile; never touches the
// operator's browser.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const URL_UNDER_TEST = arg('--url', 'http://localhost:5187');
const AS_JSON = args.includes('--json');

const BROWSERS = ['chromium', 'chrome', 'google-chrome-stable', 'brave', 'brave-browser'];

/**
 * Widths that straddle both thresholds, plus a control above them.
 * `stacked: true` means the toolbar's main axis is expected to be vertical —
 * which is exactly when a length basis on a child becomes a height.
 */
const WIDTHS = [
  { name: 'phone-375', width: 375, height: 667, stacked: true },
  { name: 'narrow-519', width: 519, height: 800, stacked: true },
  { name: 'tablet-900', width: 900, height: 800, stacked: false },
  { name: 'desktop-1440', width: 1440, height: 900, stacked: false },
];

/** A child taller than its content by more than this is holding dead space. */
const DEAD_SPACE_LIMIT_PX = 12;

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
  const profile = mkdtempSync(join(tmpdir(), 'ar-toolbargeom-'));
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

// ------------------------------------------------------------- the in-page probe

/**
 * Read the toolbar's geometry. Runs inside the page.
 *
 * `content` is the union of a child's OWN children's boxes — the space its
 * contents genuinely need. Comparing the border box against that is what makes
 * "dead space" a measurement rather than a guess at a magic number.
 */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const root = q('[data-testid="app-root"]');
  const toolbar = q('[data-testid="board-ready"]');
  if (!toolbar) return { boardReady: false };
  const round = (n) => Math.round(n * 10) / 10;
  const contentHeight = (el) => {
    const kids = [...el.children];
    if (!kids.length) return round(el.getBoundingClientRect().height);
    const top = Math.min(...kids.map((k) => k.getBoundingClientRect().top));
    const bot = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
    return round(bot - top);
  };
  const cs = getComputedStyle(toolbar);
  return {
    boardReady: true,
    tier: root ? root.getAttribute('data-tier') : null,
    measured: root ? root.getAttribute('data-measured') : null,
    toolbarLayout: toolbar.getAttribute('data-layout'),
    direction: cs.flexDirection,
    toolbarHeight: round(toolbar.getBoundingClientRect().height),
    children: [...toolbar.children].map((el, i) => {
      const s = getComputedStyle(el);
      const h = round(el.getBoundingClientRect().height);
      const content = contentHeight(el);
      return {
        i,
        height: h,
        content,
        deadSpace: round(h - content),
        width: round(el.getBoundingClientRect().width),
        flexGrow: s.flexGrow,
        flexBasis: s.flexBasis,
      };
    }),
    sortButtons: document.querySelectorAll('[data-testid=sort-control] button').length,
    searchInput: !!q('[data-testid="search-input"]'),
    horizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;

/** A positive CSS length — the shape that becomes a height on a column's main axis. */
function isFixedLengthBasis(basis) {
  const v = String(basis).trim().toLowerCase();
  if (v === '' || v === 'auto' || v === 'content') return false;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0;
}

// ------------------------------------------------------------------ the run

async function main() {
  const browser = await launchBrowser();
  const report = { url: URL_UNDER_TEST, browser: browser.browser, widths: {} };
  let cdp;

  try {
    cdp = await connect(browser.wsUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);

    await S('Page.enable');
    await S('Runtime.enable');

    for (const c of WIDTHS) {
      await S('Emulation.setDeviceMetricsOverride', {
        width: c.width,
        height: c.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // Navigate AFTER the override so the first measurement the block's
      // ResizeObserver takes is already at this width.
      const loaded = cdp.once('Page.loadEventFired', (m) => m.sessionId === sessionId);
      await S('Page.navigate', { url: URL_UNDER_TEST });
      await loaded;

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
      if (!ready) throw new Error(`board-ready never appeared at ${c.width}px — is the dev harness serving?`);
      await sleep(250); // let the tier settle

      const r = await S('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      report.widths[c.name] = { viewport: `${c.width}x${c.height}`, expectStacked: c.stacked, ...r.result.value };
    }
  } finally {
    browser.close();
  }

  // ----------------------------------------------------------------- verdict

  const failures = [];
  for (const [name, w] of Object.entries(report.widths)) {
    if (!w.boardReady) {
      failures.push(`${name}: board-ready is ABSENT — the capture gate would time out here`);
      continue;
    }
    if (w.sortButtons !== 2) failures.push(`${name}: sort-control has ${w.sortButtons} buttons, expected 2`);
    if (w.horizontalOverflow) failures.push(`${name}: the document overflows horizontally`);

    const isColumn = w.direction === 'column';
    if (isColumn !== w.expectStacked) {
      failures.push(
        `${name}: flex-direction is ${w.direction} but this width should be ${w.expectStacked ? 'column' : 'row'}`,
      );
    }
    if (!isColumn) continue; // a length basis is a WIDTH here, and legitimate

    for (const ch of w.children) {
      if (ch.deadSpace > DEAD_SPACE_LIMIT_PX) {
        failures.push(
          `${name}: toolbar child ${ch.i} is ${ch.height}px tall around ${ch.content}px of content ` +
            `(${ch.deadSpace}px dead, limit ${DEAD_SPACE_LIMIT_PX})`,
        );
      }
      if (isFixedLengthBasis(ch.flexBasis)) {
        failures.push(
          `${name}: toolbar child ${ch.i} has flex-basis ${ch.flexBasis} on the COLUMN main axis — that is a HEIGHT`,
        );
      }
    }
  }

  // 🔴 The control. Without it, an emulation that silently never applied would
  // measure the same width four times and report a confident PASS.
  const narrow = report.widths['phone-375'];
  const wide = report.widths['desktop-1440'];
  const controlMoved =
    narrow?.direction === 'column' &&
    wide?.direction === 'row' &&
    narrow?.children?.[0]?.flexBasis !== wide?.children?.[0]?.flexBasis;
  if (!controlMoved) {
    failures.push(
      'CONTROL FAILED: the narrow and wide widths did not produce different toolbar shapes ' +
        `(375 dir=${narrow?.direction} basis=${narrow?.children?.[0]?.flexBasis}; ` +
        `1440 dir=${wide?.direction} basis=${wide?.children?.[0]?.flexBasis}). ` +
        'Every PASS above is therefore unproven.',
    );
  }

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ ...report, controlMoved, ok: failures.length === 0 }, null, 2) + '\n');
  } else {
    const lines = [`browser              ${report.browser}`, `url                  ${report.url}`, ''];
    for (const [name, w] of Object.entries(report.widths)) {
      lines.push(
        `${name.padEnd(14)} ${String(w.viewport).padEnd(10)} tier=${String(w.tier).padEnd(5)} ` +
          `layout=${String(w.toolbarLayout).padEnd(8)} dir=${String(w.direction).padEnd(7)} ` +
          `toolbar h=${w.toolbarHeight}`,
      );
      for (const ch of w.children ?? []) {
        lines.push(
          `               child${ch.i}  h=${String(ch.height).padEnd(6)} content=${String(ch.content).padEnd(6)} ` +
            `dead=${String(ch.deadSpace).padEnd(6)} grow=${String(ch.flexGrow).padEnd(4)} basis=${ch.flexBasis}`,
        );
      }
    }
    lines.push('');
    lines.push(`control (shapes differ across widths)   ${controlMoved ? 'yes' : 'NO — results unproven'}`);
    lines.push('');
    lines.push(
      failures.length === 0
        ? 'PASS — every stacked-toolbar child is content-sized, and the shape really does change with width.'
        : failures.map((f) => `FAIL — ${f}`).join('\n'),
    );
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`measure-toolbar-geometry: ${err.message}\n`);
  process.exit(2);
});
