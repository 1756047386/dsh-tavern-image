import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCharacterUpdates, applyCharacterSnapshot, boundCharacterSnapshot, emptyCharacterSnapshot } from '../lib/character-history.js'
import { expandRosterCalls, pickOutfitForScene } from '../lib/index.js'
import { buildPlannerSystem } from '../lib/planner.js'

// 一轮正文里先穿着湿的藏青长裙起身，之后才换上浅紫细肩带礼服（第 302 轮的真实情形，内容已简化）。
const human = { id: 'yx', name: '殷雪', match: 'Yin Xue human form', enabled: true, traits: { face: 'adult woman, long straight black hair' },
  outfits: [{ id: 'o1', name: '外出便装', upper: 'beige trench coat', lower: 'navy pleated skirt, long skirt' }] }
const fox = { id: 'yxf', name: '殷雪（显形）', match: 'Yin Xue fox form', enabled: true, traits: { face: 'adult woman, white fox ears' }, outfits: [] }
const defs = { characters: [human, fox] }
const BEFORE = 'beige thin open jacket, white knit top, navy blue skirt reaching mid-calf, barefoot'
const AFTER = 'light purple slip dress, thin shoulder straps, low neckline, hem above the knee, barefoot'
const macro = '${"name":"Yin Xue human form","angle":"from front","upperBody":"sfw","lowerBody":"sfw"}$'

function turns() {
  let snap = mergeCharacterUpdates(emptyCharacterSnapshot(), defs, [{ id: 'yx', name: '殷雪', current: { outfit: BEFORE } }], { turn: 295, textVersion: 'v295' }).snapshot
  snap = boundCharacterSnapshot({ ...snap, turn: 295, textVersion: 'v295' })
  let changed = mergeCharacterUpdates(snap, defs, [{ id: 'yx', name: '殷雪', current: { outfit: AFTER } }], { turn: 302, textVersion: 'v302' }).snapshot
  changed = boundCharacterSnapshot({ ...changed, turn: 302, textVersion: 'v302' })
  return { before: snap, changed }
}

test('a change of clothes within a turn remembers what was worn at the start of that turn, for every form', () => {
  const { changed } = turns()
  assert.equal(changed.characters.yx.current.outfit, AFTER)
  assert.equal(changed.characters.yx.current.previous, BEFORE)
  assert.equal(changed.characters.yxf.current.previous, BEFORE)
  // A second update in the same turn keeps the outfit from the start of the turn.
  const again = mergeCharacterUpdates(changed, defs, [{ id: 'yx', name: '殷雪', current: { outfit: 'white bathrobe' } }], { turn: 302 }).snapshot
  assert.equal(again.characters.yx.current.previous, BEFORE)
})

test('a picture from before the change in that turn wears the earlier outfit (wet skirt scene)', () => {
  const notes = []
  const out = expandRosterCalls(macro + ', 1girl, standing up, hand on own knee, wet clothes, wet skirt, bare feet', applyCharacterSnapshot(defs, turns().changed), 'auto', { onMacro: n => notes.push(n) })
  assert.match(out, /navy blue skirt reaching mid-calf/)
  assert.doesNotMatch(out, /purple slip dress/)
  assert.equal(notes[0].wearMoment, 'before')
})

test('a picture from after the change wears the new outfit; a dress only held in hand does not count', () => {
  const defsNow = applyCharacterSnapshot(defs, turns().changed)
  const after = expandRosterCalls(macro + ', tying the dress straps behind her back, slip dress', defsNow, 'auto')
  assert.match(after, /light purple slip dress/)
  const held = expandRosterCalls(macro + ', holding dress, purple dress in hands, long skirt', defsNow, 'auto')
  assert.match(held, /navy blue skirt/)
})

test('when the scene says nothing about clothes the latest outfit is kept and the macro note says it was unclear', () => {
  const notes = []
  const out = expandRosterCalls(macro + ', smile, looking at viewer, sunset', applyCharacterSnapshot(defs, turns().changed), 'auto', { onMacro: n => notes.push(n) })
  assert.match(out, /light purple slip dress/)
  assert.equal(notes[0].wearMoment, 'unclear')
})

test('the earlier outfit is only used inside the turn where the change happened', () => {
  const { changed } = turns()
  // The next turn starts from this snapshot; without a new update the old "previous" must not leak.
  const next = boundCharacterSnapshot({ ...mergeCharacterUpdates(changed, defs, [], { turn: 303 }).snapshot, turn: 303 })
  const applied = applyCharacterSnapshot(defs, next).characters.find(c => c.id === 'yx')
  assert.equal(applied.current.previous, undefined)
  const out = expandRosterCalls(macro + ', wet skirt', applyCharacterSnapshot(defs, next), 'auto')
  assert.match(out, /light purple slip dress/)
})

test('pickOutfitForScene scoring', () => {
  assert.equal(pickOutfitForScene('wet skirt, standing', BEFORE, AFTER), 'before')
  assert.equal(pickOutfitForScene('slip dress, straps', BEFORE, AFTER), 'after')
  assert.equal(pickOutfitForScene('holding dress, skirt', BEFORE, AFTER), 'before')
  assert.equal(pickOutfitForScene('smile', BEFORE, AFTER), 'unclear')
})

test('the planner is told to write the outfit in every macro when clothes change within the passage', () => {
  const system = buildPlannerSystem({ rules: '', roster: '', count: 2, characterUpdates: true })
  assert.match(system, /换了衣服时[\s\S]*每张 image 里这个人物的宏都必须写 "outfit" 字段/)
})

test('a change of clothes without saying what into picks a library outfit that fits the scene', () => {
  const system = buildPlannerSystem({ rules: '', roster: '', count: 2, characterUpdates: true })
  assert.match(system, /只说换了衣服、没写换成什么时，从这个角色的服装库里挑一套最符合当时场景的/)
})
