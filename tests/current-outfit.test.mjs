import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCharacterSnapshot, boundCharacterSnapshot, emptyCharacterSnapshot, mergeCharacterUpdates } from '../lib/character-history.js'
import { characterRoster } from '../lib/planner.js'
import { expandRosterCalls, injectDefinitions } from '../lib/index.js'

const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true,
  traits: { face: 'adult woman, long silver hair' },
  outfits: [
    { id: 'o1', name: '常服', upper: 'beige blouse', lower: 'long grey skirt', default: true },
    { id: 'o2', name: '睡衣', upper: 'white silk pajama shirt', lower: 'white silk pajama pants' },
  ] }
const meiFox = { id: 'mf', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true, traits: { face: 'adult woman, fox ears, white fox tail' }, outfits: [] }
const ren = { id: 'r', name: '阿仁', match: 'A Ren', enabled: true, traits: { face: 'adult man, short black hair' },
  outfits: [{ id: 'o3', name: '家常', upper: 'dark grey t-shirt', default: true }] }
const defs = { characters: [mei, meiFox, ren] }
const natural = { style: 'natural' }

function withRecord(updates) {
  const { snapshot, changes } = mergeCharacterUpdates(emptyCharacterSnapshot(), defs, updates, { turn: 3, textVersion: 'v3', at: 1 })
  return { snapshot, changes, scoped: applyCharacterSnapshot(defs, boundCharacterSnapshot(snapshot)) }
}

test('current outfit is recorded without permanent=true and shared by forms of the same character', () => {
  const { changes, scoped } = withRecord([{ id: 'm', name: '阿梅', current: { outfit: 'red raincoat, black boots' }, reason: '她换上了红雨衣' }])
  assert.deepEqual(changes.map(c => [c.id, c.field]), [['m', 'current.outfit'], ['mf', 'current.outfit']])
  assert.equal(scoped.characters[0].current.outfit, 'red raincoat, black boots')
  assert.equal(scoped.characters[1].current.outfit, 'red raincoat, black boots')
  assert.equal(scoped.characters[2].current, undefined)
  assert.deepEqual(scoped.characters[0].traits, mei.traits, 'traits are untouched')
  assert.throws(() => mergeCharacterUpdates(emptyCharacterSnapshot(), defs, [{ id: 'm', current: { outfit: '' } }]), /current\.outfit/)
  assert.throws(() => mergeCharacterUpdates(emptyCharacterSnapshot(), defs, [{ id: 'nobody', current: { outfit: 'coat' } }]), /唯一/)
})

test('the record carries over to the next turn and replaces the default outfit', () => {
  const { scoped } = withRecord([{ id: 'm', current: { outfit: 'red raincoat, black boots' } }])
  const out = expandRosterCalls('${"name":"A Mei"}$, standing in the rain', scoped, 'auto', natural)
  assert.match(out, /she is wearing red raincoat, black boots/)
  assert.doesNotMatch(out, /beige blouse/)
  const tag = expandRosterCalls('${"name":"A Mei"}$', scoped, 'auto')
  assert.match(tag, /red raincoat, black boots/)
  assert.doesNotMatch(tag, /beige blouse/)
})

test('a record that names a library outfit expands to that outfit', () => {
  const { scoped } = withRecord([{ id: 'm', current: { outfit: '睡衣' } }])
  const out = expandRosterCalls('${"name":"A Mei"}$', scoped, 'auto', natural)
  assert.match(out, /she is wearing white silk pajama shirt, white silk pajama pants/)
})

test('an explicit macro outfit beats the record; no record falls back to the default', () => {
  const { scoped } = withRecord([{ id: 'm', current: { outfit: 'red raincoat' } }])
  assert.match(expandRosterCalls('${"name":"A Mei","outfit":"睡衣"}$', scoped, 'auto', natural), /white silk pajama shirt/)
  assert.match(expandRosterCalls('${"name":"A Mei","outfit":"blue denim jacket"}$', scoped, 'auto', natural), /she is wearing blue denim jacket/)
  assert.match(expandRosterCalls('${"name":"A Ren"}$', scoped, 'auto', natural), /he is wearing dark grey t-shirt/)
})

test('a standalone outfit macro for the person suppresses the record so clothing is not stated twice', () => {
  const { scoped } = withRecord([{ id: 'm', current: { outfit: 'red raincoat' } }])
  const out = expandRosterCalls('${"name":"A Mei"}$, ${"name":"睡衣"}$', scoped, 'auto', natural)
  assert.doesNotMatch(out, /red raincoat/)
  assert.equal((out.match(/is wearing/g) ?? []).length, 0)
})

test('name-only injection and the planner roster use the record', () => {
  const { scoped } = withRecord([{ id: 'm', current: { outfit: 'red raincoat' } }])
  assert.match(injectDefinitions('A Mei waits by the door', scoped, { injectWeight: 1 }, natural).text, /she is wearing red raincoat/)
  assert.match(characterRoster(scoped), /当前穿着[^\n]*red raincoat/)
})
