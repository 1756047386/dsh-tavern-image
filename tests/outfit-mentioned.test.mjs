import test from 'node:test'
import assert from 'node:assert/strict'
import { characterRoster, outfitsMentioned } from '../lib/planner.js'

const names = ['外出便装', '职场装', '深V秘书包臀裙', '酒红色挂脖包臀裙', '高开衩丝绸旗袍', '浴袍', '白色系带比基尼', '居家毛衣裙']
const outfits = names.map((name, i) => ({ id: 'o' + i, name, upper: 'top ' + i, lower: i === 2 ? 'black pencil skirt, bodycon' : 'skirt ' + i }))
const yx = { id: 'yx', name: '殷雪', match: 'Yin Xue human form', enabled: true, traits: { face: 'adult woman' }, outfits }

test('a garment named in the passage pulls in the full description of the matching outfits', () => {
  const text = '她回房换上了那条深色的包臀裙，对着镜子理了理裙摆。'
  assert.deepEqual(outfitsMentioned(outfits, text).map(o => o.name), ['深V秘书包臀裙', '酒红色挂脖包臀裙'])
  const roster = characterRoster({ characters: [yx] }, { text })
  assert.match(roster, /只列名字/)
  assert.match(roster, /正文提到的衣服可能是下面这几套[\s\S]*深V秘书包臀裙 = top 2 \/ black pencil skirt, bodycon/)
  assert.doesNotMatch(roster, /职场装 = /)
  assert.match(roster, /只写了类别[\s\S]*单品和这套冲突时[\s\S]*不要用这套，照正文自己描述/, 'conflicting details in the text win over the library outfit')
})

test('two-character garment words and full outfit names also match; unrelated text adds nothing', () => {
  assert.deepEqual(outfitsMentioned(outfits, '她披着浴袍出来').map(o => o.name), ['浴袍'])
  assert.deepEqual(outfitsMentioned(outfits, '今天穿旗袍去').map(o => o.name), ['高开衩丝绸旗袍'])
  assert.deepEqual(outfitsMentioned(outfits, '她换上职场装出门').map(o => o.name), ['职场装'])
  assert.deepEqual(outfitsMentioned(outfits, '她坐在窗边看海'), [])
  assert.doesNotMatch(characterRoster({ characters: [yx] }, { text: '她坐在窗边看海' }), /正文提到的衣服/)
  assert.doesNotMatch(characterRoster({ characters: [yx] }), /正文提到的衣服/)
})
