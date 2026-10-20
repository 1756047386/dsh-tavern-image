import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGE_BANDS,
  OUTFIT_FIELDS,
  buildOutfitPrompt,
  clampBatchCount,
  mergeOutfits,
  parseOutfits,
} from '../lib/outfit-generator.js'

const character = {
  id: 'c1',
  name: '沈青梧',
  traits: { face: 'grey-blue eyes', bodySFW: 'slim', bodyNSFW: 'slender bare shoulders' },
  outfits: [{ id: 'o1', name: '常服', upper: 'white shirt', lower: 'black slacks', default: true }],
}

test('buildOutfitPrompt：数量被钳制在 1–12', () => {
  assert.equal(buildOutfitPrompt({ character, count: 0 }).count, 1)
  assert.equal(buildOutfitPrompt({ character, count: 99 }).count, 12)
  assert.equal(buildOutfitPrompt({ character, count: 'abc' }).count, 3)
  assert.equal(buildOutfitPrompt({ character, count: 5 }).count, 5)
})

test('buildOutfitPrompt：年龄段非法时回落 adult', () => {
  assert.equal(buildOutfitPrompt({ character, ageBand: 'child' }).ageBand, 'child')
  assert.equal(buildOutfitPrompt({ character, ageBand: 'teen' }).ageBand, 'teen')
  assert.equal(buildOutfitPrompt({ character, ageBand: 'nonsense' }).ageBand, 'adult')
  assert.deepEqual(AGE_BANDS, ['child', 'teen', 'adult'])
})

test('buildOutfitPrompt：child 档也允许 nsfw，提示里不出现拒绝措辞', () => {
  const { system } = buildOutfitPrompt({ character, ageBand: 'child', nsfw: true, count: 4 })
  assert.match(system, /child/)
  assert.match(system, /私密场景服装/, 'child 档也应允许私密场景服装')
  assert.doesNotMatch(system, /不得生成|不允许生成|禁止生成私密/)
  assert.match(system, /nsfw/)
})

test('buildOutfitPrompt：nsfw=false 时要求只要 sfw', () => {
  const { system } = buildOutfitPrompt({ character, nsfw: false })
  assert.match(system, /不要 nsfw/)
})

test('buildOutfitPrompt：已有服装名会提示避免重名；外貌缺失时不臆造', () => {
  const withOutfits = buildOutfitPrompt({ character }).system
  assert.match(withOutfits, /常服/)
  const bare = buildOutfitPrompt({ character: { name: '无名' } }).system
  assert.match(bare, /未填写/)
})

test('parseOutfits：解析标准 JSON 数组', () => {
  const text = JSON.stringify([
    { name: '常服', upper: 'white shirt', lower: 'black slacks', shoes: 'loafers', nsfw: false, default: true },
    { name: '雨夜外衣', upper: 'trench coat', lower: 'dark jeans', shoes: 'boots' },
  ])
  const { outfits, dropped } = parseOutfits(text)
  assert.equal(outfits.length, 2)
  assert.equal(dropped, 0)
  assert.equal(outfits[0].name, '常服')
  assert.equal(outfits[0].default, true)
  assert.equal(outfits[1].nsfw, false)
  for (const field of OUTFIT_FIELDS) assert.ok(field in outfits[0], 'missing field ' + field)
  assert.ok(outfits[0].id.startsWith('o-'))
})

test('parseOutfits：容忍 markdown 代码围栏与前后废话', () => {
  const text = '好的，这是结果：\n```json\n[{"name":"夏日便装","upper":"tank top","lower":"shorts"}]\n```\n希望满意'
  const { outfits } = parseOutfits(text)
  assert.equal(outfits.length, 1)
  assert.equal(outfits[0].name, '夏日便装')
})

test('parseOutfits：单个对象也能解析', () => {
  const { outfits } = parseOutfits('{"name":"运动装","upper":"jersey","lower":"track pants"}')
  assert.equal(outfits.length, 1)
})

test('parseOutfits：丢掉没有 name 或上下身全空的条目，并跳过重名', () => {
  const text = JSON.stringify([
    { name: '', upper: 'a', lower: 'b' },
    { name: 'A', upper: '', lower: '' },
    { name: 'B', upper: 'x' },
    { name: 'B', upper: 'y' },
  ])
  const { outfits, dropped } = parseOutfits(text)
  assert.equal(outfits.length, 1)
  assert.equal(outfits[0].name, 'B')
  assert.equal(dropped, 3)
})

test('parseOutfits：完全无法解析时返回空数组而不是抛错', () => {
  assert.deepEqual(parseOutfits('模型今天不想干活').outfits, [])
  assert.deepEqual(parseOutfits(null).outfits, [])
})

test('parseOutfits：nsfw 与 default 只认布尔 true', () => {
  const { outfits } = parseOutfits(JSON.stringify([
    { name: 'X', upper: 'a', nsfw: 'true', default: 1 },
    { name: 'Y', upper: 'b', nsfw: true, default: true },
  ]))
  assert.equal(outfits[0].nsfw, false)
  assert.equal(outfits[0].default, false)
  assert.equal(outfits[1].nsfw, true)
  assert.equal(outfits[1].default, true)
})

test('mergeOutfits：同名跳过，不覆盖用户已有服装，也不删旧的', () => {
  const existing = [{ id: 'o1', name: '常服', upper: 'user edited', default: true }]
  const incoming = [
    { id: 'o9', name: '常服', upper: 'from model' },
    { id: 'o10', name: '新衣', upper: 'new', lower: 'new', default: true },
  ]
  const { outfits, added, skipped } = mergeOutfits(existing, incoming)
  assert.equal(added, 1)
  assert.equal(skipped, 1)
  assert.equal(outfits.length, 2)
  assert.equal(outfits[0].upper, 'user edited', '用户改过的内容不能被覆盖')
  assert.equal(outfits[0].default, true)
  assert.equal(outfits[1].default, false, '已有常穿时新服装不抢 default')
})

test('mergeOutfits：没有常穿时允许新的一套当 default', () => {
  const { outfits } = mergeOutfits([], [{ id: 'a', name: 'A', default: true }, { id: 'b', name: 'B', default: true }])
  assert.equal(outfits.filter(o => o.default).length, 1)
})

test('clampBatchCount：单角色数量与总量上限', () => {
  assert.deepEqual(clampBatchCount(3), { perCharacter: 3, maxTotal: 60 })
  assert.deepEqual(clampBatchCount(99), { perCharacter: 12, maxTotal: 60 })
  assert.deepEqual(clampBatchCount(0), { perCharacter: 1, maxTotal: 60 })
})
