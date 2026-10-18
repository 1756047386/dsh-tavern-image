import test from 'node:test'
import assert from 'node:assert/strict'
import { injectDefinitions } from '../lib/index.js'

const a = { id: 'a', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman, long silver hair, fox ears', negative: 'glasses, short hair' } }
const b = { id: 'b', name: '阿仁', match: 'A Ren', enabled: true, traits: { face: 'adult man, short black hair, dark eyes', negative: 'beard, long hair' } }
const af = { id: 'af', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true, traits: { face: 'white fox with nine tails', negative: 'human' } }
const defs = { characters: [a, b, af] }

test('a single library person called by macro keeps their negatives', () => {
  const one = injectDefinitions('adult woman, long silver hair, fox ears, sitting', defs, {}, { raw: '${"name":"A Mei"}$, sitting' })
  assert.deepEqual(one.negatives, ['glasses', 'short hair'])
})

test('two library people: no character negatives at all, so neither suppresses the other', () => {
  const two = injectDefinitions('adult woman, long silver hair, fox ears, adult man, short black hair, dark eyes, hugging', defs, {}, { raw: '${"name":"A Mei"}$, ${"name":"A Ren"}$, hugging' })
  assert.deepEqual(two.negatives ?? [], [])
})

test('a negative that the picture itself shows is dropped (a stranger with short black hair)', () => {
  const r = injectDefinitions('adult woman, long silver hair, fox ears, a man with short black hair', defs, {}, { raw: '${"name":"A Mei"}$, a man with short black hair' })
  assert.deepEqual(r.negatives, ['glasses'])
})

test('name-only injection with one person still gets negatives', () => {
  const r = injectDefinitions('A Ren leans on the railing', defs, {}, {})
  assert.deepEqual(r.negatives, ['beard', 'long hair'])
})
