import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/family-visit-ui')
mkdirSync(output, { recursive: true })

const compiled = await build({
  stdin: {
    contents: `
      import React, { useReducer } from 'react';
      import { createRoot } from 'react-dom/client';
      import { GameCtx } from './src/ui/me/ctx';
      import PendingModal from './src/ui/me/Modals';
      import { Held, heldNow } from './src/ui/me/hold';
      import { createCareer, emptyTalents } from './src/engine/me/career';
      import { autoResolve } from './src/engine/me/auto';
      import { FAMILY_VISIT_EVENTS, familyVisitBlocked } from './src/engine/me/familyVisit';
      import { eventOf } from './src/engine/me/events';
      import { stagesOf } from './src/engine/era';
      import './src/ui/me/base.css';
      import './src/me.css';

      const game = createCareer({
        name: '本地家庭事件测试',
        region: 'China',
        role: '先锋',
        talents: emptyTalents(),
        originKey: 'netcafe',
        start: 't1',
        seed: 771901,
        year: 2026,
      });

      game.me.pending = [];
      game.me.moments = [];
      game.me.log = [];
      game.comps = {
        champions: {
          key: 'champions',
          name: '冠军赛',
          stage: 'champions',
          teams: [game.myTeam],
          standings: {},
          finished: [],
          format: 'champions',
        },
      };
      const champions = stagesOf(game.year, false).find((s) => s.key === 'champions');
      if (!champions) throw new Error('missing champions stage');
      game.day = champions.start;

      const id = new URLSearchParams(location.search).get('event');
      if (id) {
        game.me.pendingEvent = id;
        game.me.pending = [{ kind: 'event', id, day: game.day }];
      }

      window.harnessGame = game;
      window.harnessCommits = 0;
      window.__familyVisitBlocked = familyVisitBlocked(game);
      window.caseInfo = FAMILY_VISIT_EVENTS.map((id) => ({
        id,
        choices: eventOf(id).a.map((o) => ({ text: o.t, confirm: !!o.confirm })),
      }));

      const oldItem = game.me.pending[0];
      window.repeatAuto = () => autoResolve(game, oldItem);
      window.hasHeld = () => heldNow();

      function Harness() {
        const [, bump] = useReducer((x) => x + 1, 0);
        window.refresh = bump;
        window.runAuto = () => {
          const stale = game.me.pending[0];
          let n = 0;
          while (game.me.pending.length && n < 8) {
            autoResolve(game, game.me.pending[0]);
            n++;
          }
          if (game.me.pending.length) throw Error('auto stalled');
          bump();
          return n;
        };
        const commit = () => {
          window.harnessCommits++;
          bump();
        };
        window.commit = commit;
        const item = game.me.pending.find((x) => x.kind === 'event');
        const noop = () => {};
        return (
          <GameCtx.Provider value={{ game, commit, toast: noop, openPlayer: noop, openMatch: noop, go: noop, startTutorial: noop }}>
            <div className="app career">
              <div className="body">
                <main className="main">
                  <button onClick={() => window.runAuto()}>托管处理旧卡</button>
                  {item && !heldNow() && <PendingModal item={item} onDone={bump} />}
                  <Held />
                </main>
              </div>
            </div>
          </GameCtx.Provider>
        );
      }

      createRoot(document.getElementById('root')).render(<Harness />);
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  outfile: 'app.js',
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  define: {
    'import.meta.env.BASE_URL': '"/"',
    'import.meta.env.DEV': 'false',
    'process.env.NODE_ENV': '"production"',
  },
});

const files = new Map(compiled.outputFiles.map((f) => [extname(f.path), f.contents]));
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
    return;
  }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(files.get(extname(path)));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
function normalize(o) {
  const { me: { pending, pendingEvent, log, ...restMe }, ...rest } = o;
  return { ...rest, me: restMe };
}

async function noOverflow(page, stage) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    page: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, inner: el.scrollWidth - el.clientWidth };
    }),
  }));
  assert.ok(layout.page <= layout.width + 1, `${stage}: ${JSON.stringify(layout)}`);
  assert.ok(layout.dialogs.every((d) => d.left >= -1 && d.right <= layout.width + 1 && d.inner <= 1), `${stage}: ${JSON.stringify(layout)}`);
}

try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const blocked = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === origin && req.method() === 'GET') return route.continue();
      blocked.push(url.origin + url.pathname);
      return route.abort();
    });
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw Error('UI harness must not read saved careers');
      };
      HTMLMediaElement.prototype.play = async function () {
        this.muted = true;
      };
      localStorage.setItem('val_player.tour.off', '1');
    });

    await page.goto(origin + '?event=family_call');
    await page.locator('.node-opt button').first().waitFor();
    const caseInfo = await page.evaluate(() => window.caseInfo);
    assert.deepEqual(caseInfo.map(x => x.id).sort(), ['family_call', 'career_family_leave', 'echo_home', 'cn_newyear'].sort());
    assert.ok(caseInfo.every(x => x.choices.length > 0));
    let manualCount = 0, doubleCount = 0, autoCount = 0;

    for (const info of caseInfo) {
      const id = info.id;
      for (let i = 0; i < info.choices.length; i++) {
        await page.goto(origin + '?event=' + id);
        const btn = page.locator('.node-opt button').nth(i);
        await btn.waitFor();
        assert.equal(await page.evaluate(() => window.__familyVisitBlocked), true);
        const before = await page.evaluate(() => JSON.stringify(window.harnessGame));
        await btn.click();
        const choice = info.choices[i];
        if (choice.confirm) {
          const confirm = page.getByRole('button', { name: `确认：${choice.text}` });
          await confirm.waitFor();
          await confirm.click();
        }
        await page.waitForFunction(() => window.harnessGame.me.pending.length === 0 && window.harnessGame.me.pendingEvent === undefined && window.hasHeld());
        await page.getByText('家庭返乡安排暂缓', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => window.harnessGame.me.careerEvents?.absence), undefined);
        const after = await page.evaluate(() => JSON.stringify(window.harnessGame));
        assert.deepEqual(normalize(JSON.parse(after)), normalize(JSON.parse(before)));
        await noOverflow(page, `${width} ${id} manual ${i} result`);
        if ((id === 'family_call' || id === 'career_family_leave') && i === 0) {
          await noOverflow(page, `${width} ${id} manual`);
          await page.screenshot({ path: resolve(output, `${width}-${id}-result.png`) });
        }
        await page.getByRole('button', { name: '继续', exact: true }).click();
        await page.waitForFunction(() => !window.hasHeld());
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        const afterContinue = await page.evaluate(() => JSON.stringify(window.harnessGame));
        await page.getByRole('button', { name: '托管处理旧卡', exact: true }).click();
        await page.evaluate(() => window.repeatAuto());
        const afterRepeat = await page.evaluate(() => JSON.stringify(window.harnessGame));
        assert.equal(afterRepeat, afterContinue);
        await noOverflow(page, `${width} ${id} manual ${i}`);
        manualCount++;
      }

      await page.goto(origin + '?event=' + id);
      await page.locator('.node-opt button').first().waitFor();
      const firstChoice = info.choices[0];
      const beforeDouble = await page.evaluate(() => JSON.stringify(window.harnessGame));
      await page.locator('.node-opt button').first().evaluate((el) => {
        el.click();
        el.click();
      });
      if (firstChoice.confirm) {
        const confirm = page.getByRole('button', { name: `确认：${firstChoice.text}` });
        await confirm.waitFor();
        await confirm.evaluate((el) => {
          el.click();
          el.click();
        });
      }
      await page.waitForFunction(() => window.harnessGame.me.pending.length === 0 && window.harnessGame.me.pendingEvent === undefined && window.hasHeld());
      assert.deepEqual(normalize(JSON.parse(await page.evaluate(() => JSON.stringify(window.harnessGame)))), normalize(JSON.parse(beforeDouble)), 'double click has no rewards or absence');
      const deferLogs = await page.evaluate(() => window.harnessGame.me.log.filter((x) => x.text && x.text.includes('家庭返乡安排暂缓')).length);
      assert.equal(deferLogs, 1);
      assert.equal(await page.evaluate(() => window.harnessGame.me.careerEvents?.absence), undefined);
      await noOverflow(page, `${width} ${id} double`);
      await page.getByRole('button', { name: '继续', exact: true }).click();
      await page.waitForFunction(() => !window.hasHeld());
      doubleCount++;

      await page.goto(origin + '?event=' + id);
      await page.locator('.node-opt button').first().waitFor();
      const beforeAuto = await page.evaluate(() => JSON.stringify(window.harnessGame));
      const n = await page.evaluate(() => window.runAuto());
      assert.equal(n, 1);
      assert.equal(await page.evaluate(() => window.harnessGame.me.pending.length), 0);
      assert.equal(await page.evaluate(() => window.harnessGame.me.pendingEvent), undefined);
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const afterAuto = await page.evaluate(() => JSON.stringify(window.harnessGame));
      assert.deepEqual(normalize(JSON.parse(afterAuto)), normalize(JSON.parse(beforeAuto)));
      await page.evaluate(() => window.repeatAuto());
      const afterRepeatAuto = await page.evaluate(() => JSON.stringify(window.harnessGame));
      assert.equal(afterRepeatAuto, afterAuto);
      assert.equal(await page.evaluate(() => window.harnessGame.me.careerEvents?.absence), undefined);
      await noOverflow(page, `${width} ${id} auto`);
      autoCount++;
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    console.log(`PASS ${width}px: ${manualCount} real PendingModal choices, ${doubleCount} double clicks, ${autoCount} real autoResolve paths; no absence/rewards/network/errors/overflow`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
