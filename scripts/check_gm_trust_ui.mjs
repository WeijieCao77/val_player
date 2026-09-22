import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/gm-trust-ui')
mkdirSync(output, { recursive: true })

const compiled = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React, { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCtx } from './src/ui/me/ctx';
import TeamScreen from './src/ui/me/TeamScreen';
import { useNumbers } from './src/ui/me/words';
import { createCareer, emptyTalents } from './src/engine/me/career';
import { managerTalkBlock, managerTalkWait } from './src/engine/me/gmTrust';
import './src/ui/me/base.css';
import './src/me.css';

const game = createCareer({
  name: '界面测试',
  region: 'China',
  role: '决斗者',
  talents: emptyTalents(),
  originKey: 'netcafe',
  start: 't1',
  seed: 20260922,
  year: 2026,
});
game.me.week = 26;
game.me.pending = [];
game.me.apMax = 12;
game.me.ap = game.me.apMax;
game.me.gmTrust = 60;
const meId = game.me.id;
game.players[meId].age = 32;
window.game = game;
window.api = {
  managerTalkBlock: () => managerTalkBlock(game),
  managerTalkWait: () => managerTalkWait(game),
};
window.commits = 0;
window.toasts = [];
window.initial = JSON.stringify(game);

function App() {
  const [, bump] = useReducer(x => x + 1, 0);
  const [nums, setNums] = useNumbers();
  window.refresh = bump;
  const ctx = {
    game,
    commit: () => { window.commits++; bump(); },
    toast: (msg) => { window.toasts.push(msg); },
    openPlayer: () => {},
    openMatch: () => {},
    go: () => {},
    startTutorial: () => {},
  };
  return (
    <GameCtx.Provider value={ctx}>
      <div className="app career">
        <div className="body">
          <main className="main">
            <div className="row wrap">
              <button onClick={() => setNums(!nums)}>数值 {nums ? '开' : '关'}</button>
            </div>
            <TeamScreen />
          </main>
        </div>
      </div>
    </GameCtx.Provider>
  );
}
createRoot(document.getElementById('root')).render(<App />);
`,
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  outfile: 'app.js',
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  define: {
    'import.meta.env.BASE_URL': '"/"',
    'import.meta.env.DEV': 'false',
    'process.env.NODE_ENV': '"production"',
  },
});

const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
    return;
  }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(files.get(extname(path)));
    return;
  }
  const publicRoot = resolve(root, 'public');
  const asset = resolve(publicRoot, '.' + decodeURIComponent(path));
  const mime = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(asset)];
  if (asset.startsWith(publicRoot + sep) && mime && existsSync(asset)) {
    res.setHeader('Content-Type', mime);
    res.end(readFileSync(asset));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    const blockedRequests = [];
    const dialogs = [];
    let acceptDialog = false;
    let pendingDialogResolvers = [];

    page.on('pageerror', e => errors.push(e.message));

    await page.route('**/*', route => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() !== 'GET' || url.origin !== origin) {
        blockedRequests.push(url.origin + url.pathname);
        return route.abort();
      }
      return route.continue();
    });

    page.on('dialog', async d => {
      dialogs.push(d.message());
      if (acceptDialog) await d.accept();
      else await d.dismiss();
      if (pendingDialogResolvers.length) {
        const resolve = pendingDialogResolvers.shift();
        resolve();
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('val_player.numbers', '0');
      indexedDB.open = () => { throw Error('No actual saves') };
      HTMLMediaElement.prototype.play = async () => {};
      window.confirm = (() => {
        const native = window.confirm.bind(window);
        return (text) => {
          const yes = native(text);
          if (yes && window.injectApZero) {
            window.game.me.ap = 0;
            window.raceExpected = JSON.stringify(window.game);
            window.injectApZero = false;
          }
          return yes;
        };
      })();
    });

    await page.goto(origin);

    const snapshot = () => page.evaluate(() => JSON.stringify(window.game));

    await page.waitForFunction(() => window.initial !== undefined);

    const managerSection = page.locator('section.manager-talk');
    await managerSection.waitFor();
    assert.equal(await snapshot(), await page.evaluate(() => window.initial), 'first rendered TeamScreen is read-only');

    const inPanel = await managerSection.evaluate(el => {
      return el.closest('.panel')?.querySelector('.panel-head > h2')?.textContent === '话语权';
    });
    assert.ok(inPanel, 'manager-talk is inside a 话语权 panel');

    const managerTextOff = await managerSection.innerText();
    assert.ok(managerTextOff.includes('与经理沟通'), 'ManagerTalk button exists');
    assert.ok(managerTextOff.includes('当前经理信任：中立'), 'numbers off shows qualitative trust');
    assert.ok(managerTextOff.includes('经理的引援信任门槛'), 'numbers off hides exact 72');
    for (const val of ['60', '63', '79', '80', '72', '66']) {
      assert.ok(!managerTextOff.includes(val), `numbers off hides ${val}`);
    }

    await managerSection.screenshot({ path: resolve(output, `manager-${width}-nums-off.png`) });

    await page.getByRole('button', { name: '数值 关' }).click();
    const managerTextOn = await managerSection.innerText();
    assert.ok(managerTextOn.includes('当前经理信任 60'), 'numbers on shows exact trust');
    assert.ok(managerTextOn.includes('引援信任门槛 72'), 'numbers on shows exact sign gate');
    assert.ok(managerTextOn.includes('+3'), 'numbers on shows +3 rule');
    assert.ok(managerTextOn.includes('80'), 'numbers on shows cap 80');
    assert.ok(managerTextOn.includes('66'), 'numbers on shows 名望 66');

    await managerSection.screenshot({ path: resolve(output, `manager-${width}-nums-on.png`) });

    const talkButton = managerSection.getByRole('button', { name: '与经理沟通' });

    // cancel flow
    const beforeCancel = await snapshot();
    let dialogHandled = new Promise(resolve => pendingDialogResolvers.push(resolve));
    await talkButton.click();
    await dialogHandled;
    const cancelSnapshot = await snapshot();
    assert.equal(cancelSnapshot, beforeCancel, 'cancel does not mutate');
    assert.equal(await page.evaluate(() => window.commits), 0, 'no commit after cancel');
    assert.equal(dialogs.length, 1, 'one dialog after cancel');
    const lockedConfirmText = dialogs[0];
    assert.ok(lockedConfirmText.includes('不可撤回'), 'dialog warns');
    assert.ok(lockedConfirmText.includes('锁定本周此前所有可撤回行动'), 'dialog explicitly warns about earlier actions');

    // enable accept for success
    acceptDialog = true;
    dialogHandled = new Promise(resolve => pendingDialogResolvers.push(resolve));
    await talkButton.click();
    await dialogHandled;

    await page.waitForFunction(() => window.game.me.gmTrust === 63 && window.game.me.ap === (window.game.me.apMax - 2));
    assert.equal(await page.evaluate(() => window.commits), 1, 'commit once');
    assert.equal(dialogs[1], lockedConfirmText, 'confirm text locked');
    assert.ok(await page.evaluate(() => window.api.managerTalkBlock()), 'button disabled after talk');
    assert.ok(await talkButton.isDisabled(), 'talk button disabled');
    assert.equal(await page.evaluate(() => window.api.managerTalkWait()), 4, 'cooldown 4 weeks');
    const cooldownText = await managerSection.innerText();
    assert.ok(/还需等待\s*4\s*周/.test(cooldownText), 'cooldown text shows');

    // second success to cap
    await page.evaluate(() => {
      window.game.me.week += 4;
      window.game.players[window.game.me.id].age = 37;
      window.game.me.gmTrust = 79;
      window.game.me.ap = window.game.me.apMax;
      window.refresh();
    });
    await page.waitForFunction(() => window.api.managerTalkWait() === 0);
    await page.waitForFunction(() => !window.api.managerTalkBlock());
    dialogHandled = new Promise(resolve => pendingDialogResolvers.push(resolve));
    await talkButton.click();
    await dialogHandled;

    await page.waitForFunction(() => window.game.me.gmTrust === 80 && window.game.me.ap === (window.game.me.apMax - 2));
    assert.equal(await page.evaluate(() => window.commits), 2, 'commit second time');
    assert.ok(await page.evaluate(() => window.api.managerTalkBlock()), 'cap disables');
    assert.ok(await talkButton.isDisabled(), 'cap button disabled');
    await page.evaluate(() => { window.game.me.week += 4; window.refresh(); });
    await page.waitForFunction(() => window.api.managerTalkWait() === 0);
    assert.ok(await talkButton.isDisabled(), 'cap remains disabled after cooldown expires');
    assert.ok((await page.evaluate(() => window.api.managerTalkBlock())).includes('沟通渠道'), 'cap has its own visible reason');

    // independent AP0 test, no click
    const toastCountBeforeAp0 = await page.evaluate(() => window.toasts.length);
    await page.evaluate(() => {
      window.game.me.gmTrust = 60;
      window.game.me.week += 4;
      window.game.me.ap = 0;
      window.refresh();
    });
    await page.waitForFunction(() => window.api.managerTalkWait() === 0);
    await page.waitForFunction(() => !!window.api.managerTalkBlock());
    assert.ok(await page.evaluate(() => window.api.managerTalkBlock()), 'AP0 block truthy');
    assert.ok(await talkButton.isDisabled(), 'AP0 disabled');
    const commitsAfterAp0NoClick = await page.evaluate(() => window.commits);
    assert.equal(commitsAfterAp0NoClick, 2, 'commits remains 2');
    const toastCountAfterAp0NoClick = await page.evaluate(() => window.toasts.length);
    assert.equal(toastCountAfterAp0NoClick, toastCountBeforeAp0, 'AP0 no click toast unchanged');

    // race test with injectApZero
    await page.evaluate(() => {
      window.game.me.ap = window.game.me.apMax;
      window.refresh();
    });
    await page.waitForFunction(() => window.api.managerTalkWait() === 0 && !window.api.managerTalkBlock());
    const beforeRaceToastCount = await page.evaluate(() => window.toasts.length);
    const beforeRaceCommits = await page.evaluate(() => window.commits);
    assert.equal(beforeRaceCommits, 2, 'commits before race');

    await page.evaluate(() => { window.injectApZero = true; });
    dialogHandled = new Promise(resolve => pendingDialogResolvers.push(resolve));
    await talkButton.click();
    await dialogHandled;

    await page.waitForFunction(n => window.toasts.length === n + 1, beforeRaceToastCount);

    const afterRaceSnapshot = await snapshot();
    const raceExpected = await page.evaluate(() => window.raceExpected);
    assert.equal(afterRaceSnapshot, raceExpected, 'race world unchanged');
    assert.equal(await page.evaluate(() => window.game.me.gmTrust), 60, 'gmTrust remains 60');
    assert.equal(await page.evaluate(() => window.commits), 2, 'race no commit');
    const toastsAfterRace = await page.evaluate(() => window.toasts);
    assert.equal(toastsAfterRace.length, beforeRaceToastCount + 1, 'toast increased by 1');
    const lastToast = toastsAfterRace[toastsAfterRace.length - 1];
    const blockReason = await page.evaluate(() => window.api.managerTalkBlock());
    assert.ok(blockReason, 'managerTalkBlock truthy after AP0');
    assert.deepEqual(lastToast, blockReason, 'toast matches managerTalkBlock(state)');

    // final success to 63
    await page.evaluate(() => {
      window.game.me.ap = window.game.me.apMax;
      window.refresh();
    });
    await page.waitForFunction(() => !window.api.managerTalkBlock() && window.api.managerTalkWait() === 0);
    await page.evaluate(() => {
      window.game.players[window.game.me.id].age = 37;
    });
    dialogHandled = new Promise(resolve => pendingDialogResolvers.push(resolve));
    await talkButton.click();
    await dialogHandled;

    await page.waitForFunction(() => window.game.me.gmTrust === 63 && window.game.me.ap === (window.game.me.apMax - 2));
    assert.equal(await page.evaluate(() => window.commits), 3, 'third success');

    // final numbers off check after trust 63
    await page.getByRole('button', { name: '数值 开' }).click();
    const finalManagerTextOff = await managerSection.innerText();
    assert.ok(finalManagerTextOff.includes('当前经理信任：中立'), 'final trust label 63 is 中立');
    assert.ok(!finalManagerTextOff.includes('63'), 'numbers off hides 63');

    // overflow checks
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert.ok(pageOverflow, `no page overflow at ${width}`);
    const managerOverflow = await managerSection.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      right: el.getBoundingClientRect().right,
      innerWidth: window.innerWidth,
    }));
    assert.ok(managerOverflow.scrollWidth <= managerOverflow.clientWidth, `manager section no horizontal overflow at ${width}`);
    assert.ok(managerOverflow.right <= managerOverflow.innerWidth + 1, `manager section right within viewport at ${width}`);

    assert.deepEqual(errors, [], 'no page errors');
    assert.deepEqual(blockedRequests, [], 'no remote requests');
    await page.screenshot({ path: resolve(output, `manager-page-${width}.png`) });
    console.log(`PASS width ${width}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
}
