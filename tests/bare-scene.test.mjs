import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls, injectDefinitions } from '../lib/index.js'

const ren = { id: 'r', name: '阿仁', match: 'A Ren', enabled: true, traits: { face: 'adult man, short black hair' },
  outfits: [{ id: 'o1', name: '家常', upper: 'dark gray t-shirt', lower: 'dark trousers', default: true }],
  current: { outfit: 'navy hoodie and jeans' } }
const defs = { characters: [ren] }
const natural = { style: 'natural' }

test('a shower scene does not get the recorded or usual outfit', () => {
  const out = expandRosterCalls('${"name":"A Ren", "upperBody":"sfw", "lowerBody":"hidden"}$, the man showering under hot water, steam', defs, 'auto', natural)
  assert.doesNotMatch(out, /hoodie|t-shirt|is wearing/)
  assert.match(out, /A Ren is the man in this scene/)
})

test('nudity words also stop automatic clothing, but an explicit outfit in the macro is kept', () => {
  assert.doesNotMatch(expandRosterCalls('${"name":"A Ren"}$, he stands naked by the window', defs, 'auto', natural), /is wearing/)
  assert.match(expandRosterCalls('${"name":"A Ren", "outfit":"white bath towel wrapped around his waist"}$, after showering', defs, 'auto', natural), /he is wearing white bath towel wrapped around his waist/)
})

test('ordinary scenes, a bathroom or a bath towel in hand still use the recorded outfit', () => {
  assert.match(expandRosterCalls('${"name":"A Ren"}$, he hands her a bath towel at the bathroom door', defs, 'auto', natural), /he is wearing navy hoodie and jeans/)
})

test('name-only injection follows the same rule', () => {
  assert.doesNotMatch(injectDefinitions('A Ren taking a shower', defs, { injectWeight: 1 }, { ...natural, raw: 'A Ren taking a shower' }).text, /hoodie|t-shirt/)
  assert.match(injectDefinitions('A Ren reading on the sofa', defs, { injectWeight: 1 }, { ...natural, raw: 'A Ren reading on the sofa' }).text, /navy hoodie/)
})

test('underwear and intimate descriptions also stop the usual outfit (real prompts from floor 261)', () => {
  const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman, long silver hair' },
    outfits: [{ id: 'o', name: '常服', upper: 'light beige top', lower: 'grey-blue skirt', shoes: 'white canvas sneakers', default: true }] }
  const d = { characters: [mei] }
  for (const scene of [
    'lying back onto the sofa cushions, black lace underwear bunched up at her chest, both breasts fallen out, undressing, sweat',
    'one knee bent, red pressure marks across her hip, sweat shining on her exposed waist, spread legs, wet',
  ]) {
    const out = expandRosterCalls('${"name":"A Mei", "upperBody":"sfw", "lowerBody":"sfw"}$, ' + scene, d, 'auto', natural)
    assert.doesNotMatch(out, /sneakers|beige top|is wearing/, scene)
  }
  assert.match(expandRosterCalls('${"name":"A Mei"}$, sitting on the sofa reading, bare feet', d, 'auto', natural), /she is wearing light beige top/)
})

test('upper and lower body are chosen separately, and a written outfit survives a partial nsfw (floor 262)', () => {
  const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true,
    traits: { face: 'adult woman', bodySFW: 'UPPER_SFW', bodyNSFW: 'UPPER_NSFW', lowerSFW: 'LOWER_SFW', lowerNSFW: 'LOWER_NSFW' }, outfits: [] }
  const d = { characters: [mei] }
  const a = expandRosterCalls('${"name":"A Mei", "upperBody":"nsfw", "lowerBody":"sfw", "outfit":"black cutout lingerie slipped down off her shoulders"}$, lifted from the sofa', d, 'auto', natural)
  assert.match(a, /UPPER_NSFW/); assert.match(a, /LOWER_SFW/); assert.doesNotMatch(a, /LOWER_NSFW|UPPER_SFW/)
  assert.match(a, /she is wearing black cutout lingerie slipped down off her shoulders/)
  const b = expandRosterCalls('${"name":"A Mei", "upperBody":"sfw", "lowerBody":"nsfw", "outfit":"light grey cotton shirt pulled up"}$', d, 'auto', natural)
  assert.match(b, /UPPER_SFW/); assert.match(b, /LOWER_NSFW/); assert.doesNotMatch(b, /UPPER_NSFW/)
  const c = expandRosterCalls('${"name":"A Mei", "upperBody":"sfw", "lowerBody":"hidden"}$', d, 'auto', natural)
  assert.doesNotMatch(c, /LOWER_/)
  assert.match(expandRosterCalls('${"name":"A Mei", "upperBody":"nsfw", "lowerBody":"nsfw"}$', d, 'auto', natural), /UPPER_NSFW.*LOWER_NSFW/)
})

test('a "nude" outfit record adds no clothing at all', () => {
  for (const outfit of ['nude', 'naked', 'nothing, completely nude', '全裸']) {
    const p = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman' }, outfits: [], current: { outfit } }
    assert.doesNotMatch(expandRosterCalls('${"name":"A Mei"}$, sitting on the sofa', { characters: [p] }, 'auto', natural), /is wearing/, outfit)
  }
})

test('tag mode: an nsfw macro without a named outfit no longer pulls in the usual outfit', () => {
  const out = expandRosterCalls('${"name":"A Ren", "upperBody":"nsfw", "lowerBody":"nsfw"}$, lying on the bed', defs, 'auto', { style: 'tags' })
  assert.doesNotMatch(out, /t-shirt|trousers|hoodie/)
  const dressed = expandRosterCalls('${"name":"A Ren", "upperBody":"sfw", "lowerBody":"sfw", "outfit":"家常"}$, cooking', defs, 'auto', { style: 'tags' })
  assert.match(dressed, /dark gray t-shirt/)
})

test('appearance words such as "medium breasts" in expanded traits do not make every picture a bare scene', () => {
  const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman', bodySFW: 'medium breasts' },
    outfits: [], current: { outfit: 'cream cardigan, blue skirt' } }
  const out = injectDefinitions('A Mei, medium breasts, reading', { characters: [mei] }, { injectWeight: 1 }, { style: 'tags', raw: 'A Mei, reading' })
  assert.match(out.text, /cream cardigan/)
})
