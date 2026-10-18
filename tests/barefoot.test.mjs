import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls, compileJob } from '../lib/index.js'

const mei = { id: 'm', name: '阿梅', match: 'A Mei human form', enabled: true, traits: { face: 'adult woman, long black hair', negative: 'short hair' },
  outfits: [{ id: 'o', name: '外出便装', upper: 'beige light coat over a white knit top', lower: 'navy pleated skirt', shoes: 'white canvas sneakers', accessory: 'canvas shoulder bag' }] }
const defs = { characters: [mei] }
const raw = '阿梅, ${"name":"A Mei human form", "upperBody":"sfw", "lowerBody":"sfw"}$, ${"name":"外出便装"}$, 1girl, walking, barefoot, wet sand, toes in sand, beach'
const workflow = { prompt: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '2': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, bad hands, short hair' } } },
  bindings: { positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }] } }

test('barefoot scene: the outfit keeps everything except its shoes, and shoes go to the negative once', () => {
  const tag = expandRosterCalls(raw, defs, 'auto', { style: 'tags' })
  assert.match(tag, /navy pleated skirt/); assert.match(tag, /canvas shoulder bag/)
  assert.doesNotMatch(tag, /sneakers/)
  const job = compileJob({ workflow, params: { tag, rawTag: raw }, config: { promptMode: 'tags', weightMode: 'none', negativeMode: 'merge' }, definitions: defs })
  const neg = job.prompt['2'].inputs.text
  assert.match(neg, /\bshoes\b/)
  assert.equal(neg.split(',').map(t => t.trim()).filter(t => t === 'short hair').length, 1, 'duplicated negatives are merged')
})

test('shoes stay when the scene is not barefoot, and shoes held in hand are not pushed to the negative', () => {
  assert.match(expandRosterCalls(raw.replace('barefoot, wet sand, toes in sand', 'walking on the boardwalk'), defs, 'auto', { style: 'tags' }), /white canvas sneakers/)
  const held = raw.replace('toes in sand', 'holding her shoes')
  const job = compileJob({ workflow, params: { tag: expandRosterCalls(held, defs, 'auto', { style: 'tags' }), rawTag: held }, config: { promptMode: 'tags', weightMode: 'none', negativeMode: 'merge' }, definitions: defs })
  assert.doesNotMatch(job.prompt['2'].inputs.text, /\bshoes\b/)
})

test('an outfit macro adds its back-view description only in back views', () => {
  const d = { characters: [{ ...mei, outfits: [{ ...mei.outfits[0], back: 'coat belt' }] }] }
  const front = expandRosterCalls('${"name":"A Mei human form", "angle":"from side"}$, ${"name":"外出便装"}$, walking', d, 'auto', { style: 'tags' })
  assert.doesNotMatch(front, /coat belt/)
  const back = expandRosterCalls('${"name":"A Mei human form", "angle":"from behind"}$, ${"name":"外出便装"}$, walking away', d, 'auto', { style: 'tags' })
  assert.match(back, /coat belt/)
})
