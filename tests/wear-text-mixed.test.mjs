import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCharacterUpdates, applyCharacterSnapshot, emptyCharacterSnapshot } from '../lib/character-history.js'
import { expandRosterCalls } from '../lib/index.js'
import { buildPlannerSystem } from '../lib/planner.js'

const yx = { id: 'yx', name: '殷雪', match: 'Yin Xue human form', enabled: true, traits: { face: 'adult woman, long black hair' },
  outfits: [{ id: 'o1', name: '酒红色挂脖包臀裙', upper: 'burgundy dress, halterneck', lower: 'bodycon, miniskirt', shoes: 'black pantyhose, black high heels', accessory: 'gold necklace' }] }
const defs = { characters: [yx] }
const macro = '${"name":"Yin Xue human form","upperBody":"sfw","lowerBody":"sfw"}$, standing, bedroom'
const withRecord = outfit => applyCharacterSnapshot(defs, mergeCharacterUpdates(emptyCharacterSnapshot(), defs, [{ id: 'yx', name: '殷雪', current: { outfit } }], { turn: 1 }).snapshot)

test('a recorded outfit that mixes a library name with extra items expands the name and keeps the extras once', () => {
  const out = expandRosterCalls(macro, withRecord('酒红色挂脖包臀裙, black pantyhose, black high heels, red lipstick'), 'auto')
  assert.match(out, /burgundy dress, halterneck/)
  assert.match(out, /red lipstick/)
  assert.doesNotMatch(out, /酒红/, 'no untranslated Chinese reaches the prompt')
  assert.equal(out.match(/black pantyhose/g).length, 1)
})

test('a plain library name or a plain English description behaves as before', () => {
  assert.match(expandRosterCalls(macro, withRecord('酒红色挂脖包臀裙'), 'auto'), /burgundy dress, halterneck/)
  assert.match(expandRosterCalls(macro, withRecord('white knit top, navy skirt'), 'auto'), /white knit top, navy skirt/)
})

test('the planner is told to write the library name, or comma-separated tags with a colour on each garment', () => {
  const system = buildPlannerSystem({ rules: '', roster: '', count: 2, characterUpdates: true })
  assert.match(system, /就直接写服装名，不要改写成英文描述/)
  assert.match(system, /burgundy dress, halterneck, bodycon, side slit，不要写成一整句长描述/)
})
