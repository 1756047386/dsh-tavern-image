import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGE_BANDS,
  TRAIT_BLOCKS,
  buildCharacterBatchPrompt,
  clampCharacterCount,
  parseCharacters,
  sanitizeNegative,
} from '../lib/character-generator.js'

const prototypes = [
  { name: '龙清苑', traits: { feature: 'elegant, cold, ethereal' } },
  { name: '灵玥', traits: { feature: 'innocent, curious' } },
]

test('buildCharacterBatchPrompt：child 档默认，且提示里要求照实写年龄段', () => {
  const p = buildCharacterBatchPrompt({ prototypes, count: 3 })
  assert.equal(p.ageBand, 'child')
  assert.match(p.system, /child（未满 18）/)
  assert.match(p.system, /年龄段词照实写/)
  assert.doesNotMatch(p.system, /不得生成|不允许生成|禁止生成/)
})

test('buildCharacterBatchPrompt：nsfw 打开时要求每个角色都写 NSFW 分块', () => {
  const p = buildCharacterBatchPrompt({ prototypes, nsfw: true })
  assert.equal(p.nsfw, true)
  assert.match(p.system, /每个角色都要写 NSFW 分块/)
  for (const key of ['bodyNSFW', 'bodyNSFWBack', 'lowerNSFW', 'lowerNSFWBack']) {
    assert.match(p.system, new RegExp(key))
  }
})

test('buildCharacterBatchPrompt：nsfw 关闭时要求 SFW 分块留空', () => {
  const p = buildCharacterBatchPrompt({ prototypes, nsfw: false })
  assert.match(p.system, /NSFW 分块留空字符串/)
})

test('buildCharacterBatchPrompt：明确禁止把年龄写进 negative', () => {
  const p = buildCharacterBatchPrompt({ prototypes })
  assert.match(p.system, /`negative` 里绝对不能出现年龄词/)
})

test('buildCharacterBatchPrompt：数量钳制与年龄文本', () => {
  assert.equal(buildCharacterBatchPrompt({ count: 99 }).count, 12)
  assert.equal(buildCharacterBatchPrompt({ count: 0 }).count, 1)
  assert.equal(buildCharacterBatchPrompt({ ageBand: 'nonsense' }).ageBand, 'child')
  assert.match(buildCharacterBatchPrompt({ age: 14 }).system, /14/)
  assert.match(buildCharacterBatchPrompt({ age: '十四五岁' }).system, /十四五岁/)
})

test('buildCharacterBatchPrompt：原型与已存在角色都会进提示词', () => {
  const p = buildCharacterBatchPrompt({ prototypes, existing: [{ name: '韩月梅' }] })
  assert.match(p.system, /龙清苑/)
  assert.match(p.system, /韩月梅/)
})

test('parseCharacters：完整角色能解析，traits 12 块齐全', () => {
  const text = JSON.stringify([
    {
      name: '林小满',
      match: 'Lin Xiaoman, 小满',
      traits: {
        feature: 'innocent, curious',
        face: 'black hair, twin tails, ((amber eyes)), petite, young girl',
        faceBack: 'black hair, twin tails, nape, petite, young girl',
        bodySFW: 'slim, small frame, young girl',
        bodySFWBack: 'narrow back, young girl',
        lowerSFW: 'slim legs',
        lowerSFWBack: 'slim legs, ankles',
        bodyNSFW: 'flat chest, bare shoulders',
        bodyNSFWBack: 'smooth back',
        lowerNSFW: 'slim thighs',
        lowerNSFWBack: 'slim thighs',
        negative: '',
      },
      outfits: [
        { name: '校服', upper: 'white sailor blouse', lower: 'pleated navy skirt', shoes: 'mary janes', nsfw: false, default: true },
        { name: '私密居家', upper: 'thin camisole', lower: 'underwear only', nsfw: true },
      ],
    },
  ])
  const { characters, dropped } = parseCharacters(text)
  assert.equal(characters.length, 1)
  assert.equal(dropped, 0)
  const c = characters[0]
  assert.equal(c.name, '林小满')
  for (const [key] of TRAIT_BLOCKS) assert.ok(key in c.traits, 'missing trait ' + key)
  assert.match(c.traits.face, /young girl/, '年龄段词要保留在外貌块')
  assert.equal(c.outfits.length, 2)
  assert.equal(c.outfits[1].nsfw, true)
  assert.equal(c.outfits.filter(o => o.default).length, 1)
  assert.ok(c.id.startsWith('card-'))
})

test('parseCharacters：容忍围栏与前后废话', () => {
  const text = '好的：\n```json\n[{"name":"阿霜","traits":{"face":"white hair, red eyes"}}]\n```\n完成'
  const { characters } = parseCharacters(text)
  assert.equal(characters.length, 1)
  assert.equal(characters[0].name, '阿霜')
})

test('parseCharacters：丢掉没名字/没 traits/重名的条目', () => {
  const text = JSON.stringify([
    { name: '', traits: { face: 'x' } },
    { name: 'A', traits: {} },
    { name: 'B', traits: { face: 'y' } },
    { name: 'B', traits: { face: 'z' } },
  ])
  const { characters, dropped } = parseCharacters(text)
  assert.equal(characters.length, 1)
  assert.equal(characters[0].name, 'B')
  assert.equal(dropped, 3)
})

test('parseCharacters：无法解析时返回空数组', () => {
  assert.deepEqual(parseCharacters('模型罢工了').characters, [])
  assert.deepEqual(parseCharacters(null).characters, [])
})

test('sanitizeNegative：把年龄词从 negative 里剔掉（design-rules 硬规则）', () => {
  const cleaned = sanitizeNegative({
    negative: 'loli, child, flat chest, ugly, bad hands, extra limbs',
    face: 'young girl',
  })
  assert.doesNotMatch(cleaned.negative, /loli|child|flat chest/)
  assert.match(cleaned.negative, /ugly/)
  assert.match(cleaned.negative, /bad hands/)
  assert.equal(cleaned.face, 'young girl', '外貌块里的年龄段词不能被删')
})

test('sanitizeNegative：negative 为空时原样返回', () => {
  assert.equal(sanitizeNegative({ negative: '' }).negative, '')
  assert.equal(sanitizeNegative({}).negative, '')
})

test('clampCharacterCount：数量与上限', () => {
  assert.deepEqual(clampCharacterCount(3), { count: 3, max: 12 })
  assert.deepEqual(clampCharacterCount(99), { count: 12, max: 12 })
  assert.deepEqual(clampCharacterCount(0), { count: 1, max: 12 })
  assert.deepEqual(clampCharacterCount('abc'), { count: 3, max: 12 })
})

test('AGE_BANDS 与 TRAIT_BLOCKS 结构稳定', () => {
  assert.deepEqual(AGE_BANDS, ['child', 'teen', 'adult'])
  assert.equal(TRAIT_BLOCKS.length, 12)
  assert.deepEqual(TRAIT_BLOCKS.map(t => t[0]), [
    'feature', 'face', 'faceBack', 'bodySFW', 'bodySFWBack', 'lowerSFW', 'lowerSFWBack',
    'bodyNSFW', 'bodyNSFWBack', 'lowerNSFW', 'lowerNSFWBack', 'negative',
  ])
})
