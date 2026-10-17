import test from 'node:test'
import assert from 'node:assert/strict'
import { characterRoster } from '../lib/planner.js'
import { selectPlannerContext } from '../lib/planner-context.js'
import { expandRosterCalls } from '../lib/index.js'

const wardrobe = (n) => Array.from({ length: n }, (_, i) => ({ id: 'o' + i, name: '服装' + i, upper: 'upper garment number ' + i, lower: 'lower garment number ' + i, default: i === 2 }))
const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman, long silver hair' }, outfits: wardrobe(9) }
const meiFox = { id: 'mf', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true, traits: { face: 'adult woman, fox ears, white fox tail' }, outfits: wardrobe(9) }
const ren = { id: 'r', name: '阿仁', match: 'A Ren', enabled: true, traits: { face: 'adult man, short black hair' },
  outfits: [{ id: 'r1', name: '家常', upper: 'dark grey t-shirt', default: true }, { id: 'r2', name: '外出', upper: 'navy coat', lower: 'none' }] }
const defs = { characters: [mei, meiFox, ren] }

test('large wardrobes are listed by name only, with the usual outfit described', () => {
  const roster = characterRoster({ characters: [mei] })
  assert.match(roster, /服装（共 9 套，只列名字/)
  assert.match(roster, /服装0、服装1、服装2/)
  assert.match(roster, /常穿：服装2 = upper garment number 2 \/ lower garment number 2/)
  assert.doesNotMatch(roster, /upper garment number 5/)
})

test('small wardrobes keep full descriptions, mark the usual outfit after the description and drop "none" fields', () => {
  const roster = characterRoster({ characters: [ren] })
  assert.match(roster, /家常 = dark grey t-shirt（这套是常穿）；外出 = navy coat/)
  assert.doesNotMatch(roster, /none/)
})

test('another form with the identical wardrobe is not listed twice', () => {
  const roster = characterRoster(defs)
  assert.equal((roster.match(/服装（共 9 套/g) ?? []).length, 1)
  assert.match(roster, /服装：与「阿梅」相同/)
})

test('the roster shrinks substantially for big wardrobes', () => {
  const big = { characters: [mei, meiFox].map(c => ({ ...c, outfits: wardrobe(30) })) }
  const old = big.characters.map(c => c.outfits.map(o => o.name + ' = ' + o.upper + ' / ' + o.lower).join('；')).join('').length
  assert.ok(characterRoster(big).length < old / 3)
})

test('mentioning one form also gives the planner the other forms of that character', () => {
  const r = selectPlannerContext({ text: '阿梅推开门，看见阿仁。', definitions: defs })
  assert.deepEqual(r.definitions.characters.map(c => c.id), ['m', 'mf', 'r'])
  assert.equal(r.diagnostics.includedCharacters.find(c => c.stable_id === 'mf').reason, 'form-of-mentioned-character')
  const only = selectPlannerContext({ text: '阿仁一个人坐着。', definitions: defs })
  assert.deepEqual(only.definitions.characters.map(c => c.id), ['r'])
})

test('a copied 常穿 marker in a macro still finds the outfit', () => {
  assert.match(expandRosterCalls('${"name":"A Ren","outfit":"家常（常穿）"}$', defs, 'auto'), /dark grey t-shirt/)
  assert.match(expandRosterCalls('${"name":"外出（这套是常穿）"}$', defs, 'auto'), /navy coat/)
})
