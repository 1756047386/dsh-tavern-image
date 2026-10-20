import test from 'node:test'
import assert from 'node:assert/strict'
import {
  charactersFromWorldbookText,
  charactersFromCardBookBody,
  charactersFromExtraction,
  mergeCharacters,
  cleanBody,
  youngifyAge,
  splitNameAliases,
} from '../lib/character-import.js'

const WORLD_BOOK = `
<npc_亲属网络>
  成员构成:
    - 姓名: 测试成年女性
      年龄: 40岁
      身份关系: 母亲
      职业: 会计
      简介: 留着黑色长直发，眼尾微挑，拥有H罩杯的巨乳，性格干练。丈夫早年去世，她独自撑起家庭。
    - 姓名: 测试未成年
      年龄: 13岁
      身份关系: 女儿
      简介: 长发，穿校服。
</npc_亲属网络>
`

test('世界书 YAML 条目：成年与未成年都导入', () => {
  const chars = charactersFromWorldbookText(WORLD_BOOK)
  // 未满 18 的角色不再被丢弃：卡/世界书里写了什么年龄，就照实导入
  assert.equal(chars.length, 2)
  const names = chars.map(c => c.name)
  assert.ok(names.includes('测试成年女性'), '成年的要导入')
  assert.ok(chars.some(c => /13\s*岁/.test(c.traits.feature + c.traits.bodySFW + c.traits.face)), '未成年的也要导入且年龄保留')
})

test('世界书 YAML 条目：体积词改成比例词，剧情句剔除', () => {
  const [char] = charactersFromWorldbookText(WORLD_BOOK)
  const text = char.traits.feature + '，' + char.traits.bodySFW
  assert.doesNotMatch(text, /罩杯|巨乳|豪乳/)
  assert.match(char.traits.feature, /胸型饱满/)
  assert.doesNotMatch(char.traits.feature, /丈夫|独自撑起/)
  assert.match(char.traits.feature, /黑色长直发/)
})

test('世界书 YAML 条目：年龄原样保留，不做整体下压', () => {
  const chars = charactersFromWorldbookText(WORLD_BOOK)
  const adult = chars.find(c => /40\s*岁/.test(c.traits.feature + c.traits.bodySFW))
  assert.ok(adult, '40岁 必须原样保留')
  assert.doesNotMatch(adult.traits.feature, /三十出头/,
    '不再把 40 岁压成三十出头：使用者写多少就是多少')
})

test('模型返回：允许 ```json 围栏与前后解释', () => {
  const raw = '结果如下：\n```json\n{"characters":[{"name":"测试女性B","age":"二十九岁左右","identity":"教师","feature":"齐肩短发，眉眼温和","body":"胸型饱满，腰线柔和","outfit":"针织衫","note":"温和"}]}\n```\n以上。'
  const chars = charactersFromExtraction(raw)
  assert.equal(chars.length, 1)
  assert.equal(chars[0].name, '测试女性B')
  assert.equal(chars[0].traits.bodySFW, '胸型饱满，腰线柔和')
  assert.equal(chars[0].outfits[0].upper, '针织衫')
})

test('模型返回：未成年角色照实导入，年龄保留', () => {
  const raw = '{"characters":[{"name":"未成年C","age":"15岁","feature":"长发"},{"name":"成年D","age":"26岁","feature":"短发"}]}'
  const chars = charactersFromExtraction(raw)
  // 未成年的不再被丢弃
  assert.equal(chars.length, 2)
  const minor = chars.find(c => c.name === '未成年C')
  assert.ok(minor, '未成年角色必须导入')
  assert.match(minor.traits.feature, /15\s*岁/, '年龄原样保留')
  assert.doesNotMatch(minor.traits.feature, /十八九岁/, '不再下压成成年')
})

test('模型返回：非法内容返回空数组而不抛错', () => {
  assert.deepEqual(charactersFromExtraction('完全不是 JSON'), [])
  assert.deepEqual(charactersFromExtraction(''), [])
  assert.deepEqual(charactersFromExtraction(null), [])
})

test('合并：不覆盖已有字段，只补空字段', () => {
  const existing = [{ id: 'x1', name: '测试女性B', enabled: true, match: 'BB', traits: { feature: '手工写的外观', bodySFW: '' } }]
  const incoming = charactersFromExtraction('{"characters":[{"name":"测试女性B","age":"29岁","feature":"导入的外观","body":"导入的体型"}]}')
  const merged = mergeCharacters(existing, incoming)
  assert.equal(merged.characters.length, 1)
  assert.equal(merged.characters[0].traits.feature, '手工写的外观')
  assert.equal(merged.characters[0].traits.bodySFW, '导入的体型')
  assert.equal(merged.report.updated.length, 1)
})

test('合并：新角色追加，不重复', () => {
  const merged = mergeCharacters([], charactersFromExtraction('{"characters":[{"name":"新人E","age":"30岁","feature":"短发"}]}'))
  assert.equal(merged.characters.length, 1)
  assert.equal(merged.report.added.length, 1)
  const again = mergeCharacters(merged.characters, charactersFromExtraction('{"characters":[{"name":"新人E","age":"30岁","feature":"短发"}]}'))
  assert.equal(again.characters.length, 1)
})

test('cleanBody：体积词改写并清理残留动词', () => {
  assert.equal(cleanBody('拥有H罩杯的傲人巨乳'), '胸型饱满')
  assert.doesNotMatch(cleanBody('巨臀，赘肉明显'), /巨臀|赘肉/)
})

test('youngifyAge：按代码里的档位下压', () => {
  assert.equal(youngifyAge('42岁'), '三十出头')
  assert.equal(youngifyAge('36岁'), '三十出头')
  assert.equal(youngifyAge('26岁'), '二十五六岁')
  assert.equal(youngifyAge('19岁'), '十八九岁')
  assert.equal(youngifyAge('48岁'), '三十五岁左右')
  assert.equal(youngifyAge('没有年龄'), '没有年龄')
})

test('splitNameAliases：含名字本身', () => {
  const aliases = splitNameAliases('陈秋月')
  assert.ok(String(aliases).includes('陈秋月'))
})

// 正文解析要求条目足够长（真实卡都在 1k 字以上），测试里补一段填充
const pad = text => text + '\n' + '她的轮廓与衣着被描述得很细，光线落在肩线上，衣料的褶皱一层层推开，房间里安静下来。'.repeat(3)

test('世界书正文：从 name: 抠出真名，条目标题当别名', () => {
  const card = {
    character_book: {
      entries: [{
        comment: '母后',
        content: pad('SFW - 人物设定\n核心信息 (Core Information)\n\nname: 艾莉西亚\nage: 327（外表年龄约38岁）\ngender: Female\n\n她留着银白长发，身姿高挑，常穿深色礼裙。'),
      }],
    },
  }
  const [char] = charactersFromCardBookBody(card)
  assert.equal(char.name, '艾莉西亚', '正文里的 name: 才是真名')
  assert.match(String(char.match), /母后/, '条目标题进别名')
  assert.match(char.traits.feature, /外表年龄约38岁/, '优先用外表年龄')
})

test('世界书正文：地点/组织条目不进人物库', () => {
  const card = {
    character_book: {
      entries: [
        { comment: '王座厅', content: pad('name: 小王座厅\nage: 300\n映入眼帘的是高大的拱顶与长桌，窗外是皇家森林。') },
        { comment: '女仆长', content: pad('name: 塞西尔\nage: 30\ngender: Female\n她穿着黑色女仆装，盘起长发。') },
      ],
    },
  }
  const chars = charactersFromCardBookBody(card)
  assert.equal(chars.length, 1)
  assert.equal(chars[0].name, '塞西尔')
})

test('世界书正文：只有名字、没有年龄/性别/外貌的不算人物', () => {
  const card = { character_book: { entries: [{ comment: '传闻', content: pad('name: 某个传闻\n这里讲述了一段古老的往事。') }] } }
  assert.deepEqual(charactersFromCardBookBody(card), [])
})

test('世界书正文：中文键 姓名：也能解析', () => {
  const card = { character_book: { entries: [{ comment: '厨娘', content: pad('姓名：罗莎琳德\n年龄：37岁\n简介：栗色短发，围裙上总沾着面粉。') }] } }
  const [char] = charactersFromCardBookBody(card)
  assert.equal(char.name, '罗莎琳德')
  assert.match(char.traits.feature, /37岁/)
})
