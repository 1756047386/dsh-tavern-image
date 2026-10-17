import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../lib/index.js'

const mei = { id: 'm', name: '阿梅', match: 'A Mei human form', enabled: true, traits: { face: 'MEI HUMAN FACE' }, outfits: [] }
const meiFox = { id: 'mf', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true, traits: { face: 'MEI FOX FACE' }, outfits: [] }
const noMatch = { id: 'x', name: '小红', match: '', enabled: true, traits: { face: 'RED HAIR' }, outfits: [] }
const li = { id: 'l', name: '李', match: 'Li', enabled: true, traits: { face: 'LI FACE' }, outfits: [] }
const lina = { id: 'n', name: '丽娜', match: 'Lina Park', enabled: true, traits: { face: 'LINA FACE' }, outfits: [] }

const run = (macro, characters) => expandRosterCalls(macro, { characters }, 'auto')

test('a character with an empty match is not hit by unrelated macros', () => {
  const out = run('${"name":"xiao yu"}$', [noMatch, mei])
  assert.doesNotMatch(out, /RED HAIR/)
  assert.equal(out, 'xiao yu')
  assert.match(run('${"name":"小红"}$', [noMatch, mei]), /RED HAIR/, 'its Chinese name still works')
})

test('the macro picks the form it names, even when another form is listed first', () => {
  assert.match(run('${"name":"A Mei fox form"}$', [mei, meiFox]), /MEI FOX FACE/)
  assert.doesNotMatch(run('${"name":"A Mei fox form"}$', [mei, meiFox]), /MEI HUMAN FACE/)
  assert.match(run('${"name":"阿梅（狐形）"}$', [mei, meiFox]), /MEI FOX FACE/)
  assert.match(run('${"name":"mf"}$', [mei, meiFox]), /MEI FOX FACE/, 'stable id works')
})

test('a short name is not matched inside a longer one', () => {
  assert.match(run('${"name":"Lina Park"}$', [li, lina]), /LINA FACE/)
  assert.doesNotMatch(run('${"name":"Lina Park"}$', [li, lina]), /LI FACE/)
  assert.match(run('${"name":"Li"}$', [lina, li]), /LI FACE/)
})

test('a short alias still finds the base entry of a multi-form character', () => {
  assert.match(run('${"name":"A Mei"}$', [meiFox, mei]), /MEI HUMAN FACE/)
  assert.match(run('${"name":"Lina"}$', [li, lina]), /LINA FACE/)
})

test('a genuinely ambiguous short name is left as written instead of guessed', () => {
  const a = { id: 'a', name: 'Anna Smith', match: 'Anna Smith', enabled: true, traits: { face: 'ANNA S' } }
  const b = { id: 'b', name: 'Anna Jones', match: 'Anna Jones', enabled: true, traits: { face: 'ANNA J' } }
  const seen = []
  assert.equal(expandRosterCalls('${"name":"Anna"}$', { characters: [a, b] }, 'auto', { onMacro: e => seen.push(e) }), 'Anna')
  assert.equal(seen[0].result, 'ambiguous')
})
