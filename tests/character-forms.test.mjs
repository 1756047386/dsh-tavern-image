import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCharacterForms } from '../lib/character-forms.js'
import { expandRosterCalls } from '../lib/index.js'
import { characterRoster } from '../lib/planner.js'

const outfits = () => [{ id: 'o1', name: '外出便装', upper: 'light beige blouse', lower: 'long grey-blue skirt' }]
const human = { id: 'am', name: '阿梅', match: 'A Mei human form', enabled: true,
  traits: { face: 'adult woman, long straight black hair, dark brown eyes' }, outfits: outfits() }
const fox = { id: 'amf', name: '阿梅（狐形）', match: 'A Mei fox form', formCues: 'fox ears, fox tail, 狐耳, 狐尾', enabled: true,
  traits: { face: 'adult woman, long silver-white hair, ice-blue eyes, white fox ears', bodySFW: 'a fluffy white fox tail' }, outfits: outfits() }
const defs = { characters: [human, fox] }
const man = 'a tall young man with short black hair'
const ids = (text, d = defs) => { const notes = []; expandRosterCalls(text, d, 'auto', { onMacro: n => notes.push(n) }); return notes.map(n => n.characterId) }

test('the base name with fox cues in the scene expands to the fox form', () => {
  assert.deepEqual(ids('${"name":"阿梅"}$, white fox ears, standing'), ['amf'])
  assert.deepEqual(ids('${"name":"A Mei"}$, fox tail swaying'), ['amf'], 'short alias')
  assert.deepEqual(ids('${"name":"阿梅"}$, 狐耳, standing'), ['amf'], 'Chinese cue')
  const out = expandRosterCalls('${"name":"阿梅"}$, white fox ears', defs, 'auto')
  assert.match(out, /silver-white hair/)
  assert.doesNotMatch(out, /straight black hair/)
})

test('without cues, or with negated cues, the named form stays', () => {
  assert.deepEqual(ids('${"name":"阿梅"}$, standing at the railing'), ['am'])
  assert.deepEqual(ids('${"name":"阿梅"}$, no fox ears, standing'), ['am'])
})

test('an explicit human-form macro is kept while she is changing back, switched when the scene plainly shows the fox form', () => {
  assert.deepEqual(ids('${"name":"A Mei human form"}$, her hair shifting into black, the fox ears disappearing'), ['am'])
  assert.deepEqual(ids('${"name":"A Mei human form"}$, ' + man + ' hugging a young woman with two pale fox ears and a bushy fox tail'), ['amf'])
})

test('an explicit fox-form macro is respected; other people in the picture are never recoloured', () => {
  assert.deepEqual(ids('${"name":"阿梅（狐形）"}$, smiling'), ['amf'])
  const out = expandRosterCalls('${"name":"阿梅"}$, ' + man + ' hugging a young woman with fox ears', defs, 'auto')
  assert.match(out, /short black hair/)
})

test('a bare name written outside the macro follows the chosen form', () => {
  const fixed = resolveCharacterForms('阿梅, ${"name":"阿梅"}$, fox tail', defs)
  assert.match(fixed, /^A Mei fox form, /)
  assert.match(fixed, /"name":"阿梅（狐形）"/)
})

test('characters without form cues are untouched', () => {
  const plain = { characters: [human, { ...fox, formCues: '' }] }
  const text = '${"name":"阿梅"}$, white fox ears'
  assert.equal(resolveCharacterForms(text, plain), text)
})

test('the planner roster shows the form cues on the form entry', () => {
  const roster = characterRoster(defs)
  assert.match(roster, /阿梅（狐形）[\s\S]*形态线索（画面里有这些就是这个形态，宏里写这个形态的名字）：fox ears, fox tail, 狐耳, 狐尾/)
})
