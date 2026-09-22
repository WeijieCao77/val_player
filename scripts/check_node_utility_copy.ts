// DeepSeek test draft, repaired with full branch fixtures and a real pre-edit metadata fingerprint.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AGENT_ROLE, agentCn } from '../src/engine/content'
import { NODES, weakCandidates, keyCandidates } from '../src/engine/me/nodes'
import type { NodeCtx } from '../src/engine/me/nodes'
import { KEY_HL, KEY_HINTS } from '../src/engine/me/keynodes'
import { BRANCHES } from '../src/engine/me/keyround'
import type { RoundBranch, BranchKey } from '../src/engine/me/keyround'
import { ROLES } from '../src/engine/types'

const meta = NODES.map(({ q, ctx, a, when, ...rest }) => ({ ...rest, when: when?.toString(), a: a.map(({ t, ...option }) => option) }))
assert.equal(NODES.length, 47)
// Recorded on a78c6c2 before any copy changes: predicates, risk, weights, recommendations and candidate IDs included.
assert.equal(createHash('sha256').update(JSON.stringify(meta)).digest('hex'), '0d23e6aebfe160a32787c40814f7269cb8a8ebf5789874cb0f6711159f929cab', 'copy fix must not change node mechanics')
const branches = Object.fromEntries(BRANCHES.map(key => [key, {
  won: key.endsWith('Win'), end: 'elim', buyMine: 'full', buyTheirs: 'full',
  mine: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, kills: 0, dead: false })),
  theirs: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, kills: 0, dead: false })), clutchId: null,
}])) as Record<BranchKey, RoundBranch>
const context: NodeCtx = { round: 5, mine: 2, theirs: 2, lead: 0, pistol: false, half: 1, ot: false,
  mapPoint: null, mapIndex: 0, seriesMine: 0, seriesTheirs: 0, need: 2, isIntl: false, role: '决斗者',
  form: 70, attack: true, slot: 'half1', shortBuy: false, map: 'Ascent', buyMine: 'full', buyTheirs: 'full',
  last: null, streak: 0, weak: 'utility', branches }
const ids = (c: NodeCtx) => [...keyCandidates(c), ...weakCandidates(c)].map(row => row.node.id)
const agents = [undefined, '雷兹', '欧门', '捷风', '贤者', ...Object.keys(AGENT_ROLE).map(agentCn)]
for (const role of ROLES) for (const attack of [false, true]) for (const agent of agents) {
  const c = { ...context, role, attack, agent }
  assert.deepEqual(ids(c), ids({ ...c, agent: undefined }), 'generic utility copy must not alter candidates by agent')
  assert.equal(weakCandidates(c).some(row => row.node.id === 'weak_util'), attack)
  assert.equal(weakCandidates({ ...c, weak: 'aim' }).some(row => row.node.id === 'weak_util'), false)
  assert.equal(weakCandidates({ ...c, buyMine: 'eco' }).some(row => row.node.id === 'weak_util'), false)
}
const weak = weakCandidates({ ...context, agent: '雷兹' }).find(row => row.node.id === 'weak_util')
assert.ok(weak, 'real candidate path for Raze must retain its utility test')
const leaves = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : []
const allText = [...NODES.flatMap(n => [n.q, n.ctx, ...n.a.map(a => a.t)]), ...leaves(KEY_HL), ...leaves(KEY_HINTS)]
const personallySmoking = /你的烟|这颗烟我来放|这一波的烟要你来放|你来放烟|自己放烟/
if (process.argv.includes('--expect-bug')) {
  assert.match(weak.node.q, /烟要你来放/)
  assert.ok(allText.some(text => personallySmoking.test(text)))
  console.log('REPRODUCED: Raze weak_util asks for personal smoke; unsupported skill text also present in highlights/hints')
} else {
  for (const text of allText) assert.doesNotMatch(text, personallySmoking)
  assert.match(weak.node.q + weak.node.ctx, /配合|衔接|时机/)
  assert.ok(allText.some(text => text.includes('对面的烟')), 'enemy/team smoke remains allowed')
  console.log('PASS utility copy: every current agent/role/side, ordinary+weak candidates, buy/weak gates, all copy branches, unchanged 47-node mechanics')
}
