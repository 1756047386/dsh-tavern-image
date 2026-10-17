import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls, injectDefinitions, compileJob } from '../lib/index.js'
import { normalizePrompts } from '../lib/planner.js'

const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true,
  traits: { face: 'adult woman, long silver hair, fox ears, fair skin', bodySFW: 'slender figure' },
  outfits: [{ id: 'o1', name: '常服', upper: 'beige blouse', lower: 'long grey skirt', default: true }] }
const meiFox = { id: 'mf', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true,
  traits: { face: 'adult woman, long silver hair, fox ears, large white fox tail, fair skin' }, outfits: [] }
const ren = { id: 'r', name: '阿仁', match: 'A Ren', enabled: true,
  traits: { face: 'adult man, short black hair, fair skin', bodySFW: 'tall lean build' },
  outfits: [{ id: 'o2', name: '家常', upper: 'dark grey t-shirt', default: true }] }
const defs = { characters: [mei, meiFox, ren] }
const natural = { style: 'natural' }

test('natural style binds traits and outfit to the person', () => {
  const out = expandRosterCalls('${"name":"A Mei"}$, ${"name":"A Ren"}$, hugging at a railing', defs, 'auto', natural)
  assert.match(out, /A Mei is the woman in this scene: adult woman, long silver hair, fox ears, fair skin, slender figure; she is wearing beige blouse, long grey skirt/)
  assert.match(out, /A Ren is the man in this scene: adult man, short black hair, fair skin, tall lean build; he is wearing dark grey t-shirt/)
})

test('tag style is unchanged', () => {
  const out = expandRosterCalls('${"name":"A Mei"}$', defs, 'auto')
  assert.doesNotMatch(out, /in this scene/)
  assert.match(out, /long silver hair, fox ears/)
})

test('natural normalization keeps words both people share', () => {
  const expanded = expandRosterCalls('${"name":"A Mei"}$, ${"name":"A Ren"}$', defs, 'auto', natural)
  assert.equal((normalizePrompts(expanded, defs, { backend: 'comfyui', style: 'natural' }).match(/fair skin/g) ?? []).length, 2)
  assert.equal((normalizePrompts(expanded, defs, { backend: 'comfyui' }).match(/fair skin/g) ?? []).length, 1, 'tag mode still deduplicates')
})

test('a person expanded by macro is not injected again, nor are their other forms', () => {
  const expanded = expandRosterCalls('${"name":"A Mei fox form"}$, ${"name":"A Ren"}$', defs, 'auto', natural)
  const text = 'A Mei, ' + normalizePrompts(expanded, defs, { backend: 'comfyui', style: 'natural' })
  const r = injectDefinitions(text, defs, { injectWeight: 1 }, natural)
  assert.equal(r.text, text)
  assert.equal((r.text.match(/is the man in this scene/g) ?? []).length, 1)
})

test('name-only mention still injects one bound sentence', () => {
  const r = injectDefinitions('A Ren leans on the railing', defs, { injectWeight: 1 }, natural)
  assert.match(r.text, /A Ren is the man in this scene: adult man, short black hair/)
})

test('end to end natural compile keeps each person separate', () => {
  const workflow = { prompt: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }, bindings: { positive: [{ node: '1', input: 'text' }] } }
  const tag = normalizePrompts(expandRosterCalls('${"name":"A Mei"}$, ${"name":"A Ren"}$, the man hugs the woman', defs, 'auto', natural), defs, { backend: 'comfyui', style: 'natural' })
  const job = compileJob({ workflow, params: { tag }, config: { promptMode: 'natural', weightMode: 'strip' }, definitions: defs })
  const text = job.prompt['1'].inputs.text
  assert.equal((text.match(/A Mei is the woman in this scene/g) ?? []).length, 1)
  assert.equal((text.match(/A Ren is the man in this scene/g) ?? []).length, 1)
})
