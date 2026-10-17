import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../lib/index.js'

// The bundled world book (04 人物库与服装库的调用) teaches planners to call an outfit with its
// own macro: ${"name":"服装名", ...}$. Outfits usually live on the character entry, not in the
// shared wardrobe, so the lookup must also search character wardrobes.
const alice = {
  id: 'c1', name: '小雨', match: 'xiao yu', enabled: true,
  traits: { face: 'long black hair, brown eyes' },
  outfits: [
    { id: 'o1', name: '湿透的灰色短打', upper: 'soaked grey short jacket', lower: 'grey trousers', shoes: 'straw sandals', accessory: 'none' },
    { id: 'o2', name: '停用的衣服', upper: 'disabled coat', enabled: false },
  ],
}
const bob = {
  id: 'c2', name: '阿青', match: 'a qing', enabled: true, traits: { face: 'short brown hair' },
  outfits: [{ id: 'o3', name: '湿透的灰色短打', upper: 'BOB jacket' }],
}
const defs = { characters: [alice, bob], outfits: [{ id: 's1', name: '通用雨衣', upper: 'yellow raincoat' }] }

test('standalone outfit macro finds an outfit stored on the character entry', () => {
  const out = expandRosterCalls('${"name":"xiao yu","angle":"from front"}$, ${"name":"湿透的灰色短打","upperBody":"visible","lowerBody":"visible"}$, rain', defs)
  assert.match(out, /soaked grey short jacket/)
  assert.match(out, /grey trousers/)
  assert.doesNotMatch(out, /湿透的灰色短打/, 'the raw Chinese outfit name should not be left behind')
})

test('the character called just before the outfit macro wins when two characters share an outfit name', () => {
  const out = expandRosterCalls('${"name":"xiao yu"}$, ${"name":"湿透的灰色短打"}$', defs)
  assert.match(out, /soaked grey short jacket/)
  assert.doesNotMatch(out, /BOB jacket/)
})

test('shared wardrobe still takes priority; disabled outfits are ignored', () => {
  assert.match(expandRosterCalls('${"name":"通用雨衣"}$', defs), /yellow raincoat/)
  assert.doesNotMatch(expandRosterCalls('${"name":"xiao yu"}$, ${"name":"停用的衣服"}$', defs), /disabled coat/)
})

test('placeholder values like "none" are not written into the prompt', () => {
  const out = expandRosterCalls('${"name":"xiao yu"}$, ${"name":"湿透的灰色短打"}$', defs)
  assert.doesNotMatch(out, /(^|,\s*)none(\s*,|$)/)
  const viaCharacter = expandRosterCalls('${"name":"xiao yu","outfit":"湿透的灰色短打"}$', defs)
  assert.match(viaCharacter, /soaked grey short jacket/)
  assert.doesNotMatch(viaCharacter, /(^|,\s*)none(\s*,|$)/)
})

test('a named outfit in the character macro is used even when another outfit is marked default', () => {
  const carol = { id: 'c3', name: '阿梅', match: 'a mei', enabled: true, traits: { face: 'red hair' },
    outfits: [{ id: 'd', name: '常服', upper: 'plain blue robe', default: true }, { id: 'e', name: '礼服', upper: 'embroidered gown' }] }
  const out = expandRosterCalls('${"name":"a mei","outfit":"礼服"}$', { characters: [carol] })
  assert.match(out, /embroidered gown/)
  assert.doesNotMatch(out, /plain blue robe/)
  // Without an explicit outfit the default is still used, as before.
  assert.match(expandRosterCalls('${"name":"a mei"}$', { characters: [carol] }), /plain blue robe/)
})
