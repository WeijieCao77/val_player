import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import OutletPanels from '../src/ui/me/OutletPanels'
import { GameCtx } from '../src/ui/me/ctx'
import { createCareer, emptyTalents } from '../src/engine/me/career'

for (const real of [true, false]) {
  const game = createCareer({ name: 'UI', region: 'China', role: '决斗者', start: 't1', year: 2026, talents: emptyTalents(), originKey: 'radiant', seed: 7, ...(real ? { scenario: 'demon1-2023' as const } : {}) })
  game.me!.out = { family: 1, familySent: 999999, meets: [], scholar: [], breaks: [{ year: game.year, key: 'family' }], studio: 0 }
  const noop = () => {}
  const html = renderToStaticMarkup(<GameCtx.Provider value={{ game, commit: noop, toast: noop, openPlayer: noop, openMatch: noop, go: noop, startTutorial: noop }}><OutletPanels /></GameCtx.Provider>)
  assert.equal(html.includes('往家里寄钱'), !real)
  assert.equal(html.includes('带爸妈出去玩'), !real, 'buttons, lock reasons and saved break label must all hide family details')
  assert.equal(html.includes('家用与置办'), !real)
  assert.ok(html.includes('直播间') && html.includes('网咖') && html.includes('公益捐款'), 'non-family commerce remains visible')
}
console.log('PASS real family UI hidden, including existing family break; ordinary and commercial UI preserved')
