/**
 * 从「卡的设定」导入人物形象。
 *
 * 两个来源：
 *   1. MVU 变量块 <initvar>{ "角色": { 名字: {身份, 性格, 外貌, 身体, 服装} } }</initvar>
 *   2. 卡的 characterBook（世界书）条目：条目名像人名、内容里有外貌描述
 *
 * 输出直接对齐 definitions.json 的 characters 结构，交给 index.js 落盘。
 */

const MAX_TRAIT_LEN = 400

/** 体积词 → 比例词：直接照抄会画成一堆肥肉 */
const BODY_REWRITES = [
  [/[A-Z]罩杯[^，,；;]*/g, '胸型饱满'],
  [/巨乳|大乳|豪乳|爆乳/g, '胸型饱满'],
  [/巨臀|大屁股|肥臀|丰满的臀/g, '臀部圆润'],
  [/小腹(?:微凸|赘肉|柔软)/g, '腰线柔和'],
  [/肉感|赘肉|松垮|松弛/g, '线条紧实'],
  [/腰腹柔软/g, '腰线柔和'],
  [/大腿粗|粗腿/g, '腿线流畅'],
  [/极其丰满|非常丰满/g, '丰满匀称'],
]

export function cleanBody(text) {
  let out = String(text ?? '')
  for (const [re, rep] of BODY_REWRITES) out = out.replace(re, rep)
  // “拥有胸型饱满”这种残留动词去掉，提示词更干净
  out = out.replace(/(拥有|有着|带着|长着)(?=胸型饱满|臀部圆润|线条紧实|丰满匀称|腰线柔和)/g, '')
  out = out.replace(/(^|[，,])\s*拥有(?=[^，,]{0,6}[，,]|$)/g, '$1')
  return out.replace(/[，,]{2,}/g, '，').replace(/^[，,]+|[，,]+$/g, '').trim()
}

/** 40 岁 → 三十出头（插件规则要求整体下压一档，避免画老） */
export function youngifyAge(text) {
  const s = String(text ?? '')
  return s.replace(/(\d{1,3})\s*岁/, (m, n) => {
    const age = Number(n)
    if (!Number.isFinite(age)) return m
    if (age <= 22) return '十八九岁'
    if (age <= 28) return '二十五六岁'
    if (age <= 34) return '二十七八岁'
    if (age <= 42) return '三十出头'
    if (age <= 50) return '三十五岁左右'
    return '四十出头'
  })
}

function clip(value, max = MAX_TRAIT_LEN) {
  return String(value ?? '').trim().slice(0, max)
}

export function splitNameAliases(name) {
  const n = String(name ?? '').trim()
  if (!n) return ''
  // 中文名去掉常见后缀，方便匹配正文里的称呼
  const aliases = new Set([n])
  if (n.length >= 3) aliases.add(n.slice(-2))
  return [...aliases].join(', ')
}

/** 一个 MVU 角色对象 → definitions.characters 条目 */
export function roleToDefinition(name, role = {}) {
  const identity = clip(role.身份 ?? '', 120)
  const persona = clip(role.性格 ?? '')
  const look = clip(youngifyAge(role.外貌 ?? ''))
  const body = clip(cleanBody(role.身体 ?? ''))
  const wear = role.服装 && typeof role.服装 === 'object' ? role.服装 : null

  const feature = [look, identity ? `身份：${identity}` : ''].filter(Boolean).join('，')

  const outfit = wear ? {
    id: 'o1',
    name: '常服',
    upper: clip(youngifyAge(wear.外层 ?? '')),
    lower: '',
    shoes: clip(wear.鞋袜 ?? ''),
    accessory: clip(wear.内衣 ?? ''),
    full: '',
    back: '',
    negative: '',
    enabled: true,
    default: true,
  } : null

  return {
    id: `import-${Buffer.from(String(name)).toString('hex').slice(0, 12)}`,
    enabled: true,
    name: String(name).trim(),
    match: splitNameAliases(name),
    continuity: '',
    note: persona,
    inject: {},
    cards: [],
    outfitRefs: [],
    traits: {
      feature,
      face: look,
      faceBack: '',
      bodySFW: body,
      bodySFWBack: '',
      lowerSFW: '',
      lowerSFWBack: '',
      bodyNSFW: '',
      bodyNSFWBack: '',
      lowerNSFW: '',
      lowerNSFWBack: '',
      negative: '',
    },
    outfits: outfit ? [outfit] : [],
  }
}

/** 从任意文本里抓 <initvar> JSON */
export function parseInitvar(text) {
  const src = String(text ?? '')
  const m = /<initvar>([\s\S]*?)<\/initvar>/i.exec(src)
  if (!m) return null
  const body = m[1].trim()
  try {
    const data = JSON.parse(body)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** MVU 变量对象 → 角色条目数组 */
export function charactersFromVariables(vars) {
  const roles = vars && typeof vars === 'object' ? vars['角色'] ?? vars.characters : null
  if (!roles || typeof roles !== 'object') return []
  return Object.entries(roles)
    .filter(([name, role]) => String(name).trim() && role && typeof role === 'object')
    .map(([name, role]) => roleToDefinition(name, role))
}

/** 卡的世界书条目 → 角色条目（只认像人名的条目） */
export function charactersFromCardBook(card) {
  const entries = card?.characterBook?.entries ?? card?.character_book?.entries ?? card?.data?.character_book?.entries ?? []
  if (!Array.isArray(entries)) return []
  const out = []
  for (const entry of entries) {
    const keys = Array.isArray(entry?.keys) ? entry.keys : []
    const name = String(entry?.comment ?? entry?.name ?? keys[0] ?? '').trim()
    const text = String(entry?.content ?? '').trim()
    if (!name || !text) continue
    if (!/外貌|外表|长相|容貌|发色|头发|身高|体型|穿着|服装|appearance|hair|wearing/i.test(text)) continue
    if (name.length > 12) continue
    const look = clip(text.replace(/\s+/g, ' '), 200)
    out.push({
      id: `card-${Buffer.from(name).toString('hex').slice(0, 12)}`,
      enabled: true,
      name,
      match: keys.length ? keys.join(', ') : name,
      continuity: '',
      note: '',
      inject: {},
      cards: [],
      outfitRefs: [],
      traits: {
        feature: youngifyAge(look),
        face: '',
        faceBack: '',
        bodySFW: '',
        bodySFWBack: '',
        lowerSFW: '',
        lowerSFWBack: '',
        bodyNSFW: '',
        bodyNSFWBack: '',
        lowerNSFW: '',
        lowerNSFWBack: '',
        negative: '',
      },
      outfits: [],
    })
  }
  return out
}

/** 合并：同名更新为空字段，不同名追加 */
export function mergeCharacters(existing, incoming) {
  const list = Array.isArray(existing) ? existing.map(item => ({ ...item })) : []
  const report = { added: [], updated: [], skipped: [] }

  for (const fresh of incoming) {
    const hit = list.find(item => String(item.name ?? '').trim() === fresh.name)
    if (!hit) {
      list.push(fresh)
      report.added.push(fresh.name)
      continue
    }
    let touched = false
    for (const [key, value] of Object.entries(fresh.traits ?? {})) {
      if (!String(hit.traits?.[key] ?? '').trim() && String(value ?? '').trim()) {
        hit.traits[key] = value
        touched = true
      }
    }
    if (!String(hit.match ?? '').trim() && fresh.match) { hit.match = fresh.match; touched = true }
    if (!String(hit.note ?? '').trim() && fresh.note) { hit.note = fresh.note; touched = true }
    if (!(hit.outfits ?? []).length && (fresh.outfits ?? []).length) { hit.outfits = fresh.outfits; touched = true }
    if (touched) report.updated.push(fresh.name)
    else report.skipped.push(fresh.name)
  }
  return { characters: list, report }
}

/** 一次性导入：变量优先，其次卡世界书 */
export function importCharacters({ texts = [], card = null, existing = [] } = {}) {
  const found = []
  for (const text of texts) {
    const vars = parseInitvar(text)
    if (vars) {
      const chars = charactersFromVariables(vars)
      if (chars.length) { found.push(...chars); break }
    }
  }
  if (card) found.push(...charactersFromCardBook(card))
  if (!found.length) return { characters: existing, report: { added: [], updated: [], skipped: [] }, source: 'none' }
  const { characters, report } = mergeCharacters(existing, found)
  return { characters, report, source: found[0].id.startsWith('import-') ? 'variables' : 'cardbook' }
}


/**
 * 世界书（YAML 风格的 NPC 条目）→ 角色库条目。
 * 兼容：
 *   - 姓名: 陈秋月 / 名字: 陈秋月
 *   年龄: 40岁 / 身份关系: 母亲 / 职业: … / 生活地点: … / 简介: …
 */
export function charactersFromWorldbookText(text, options = {}) {
  const src = String(text ?? '')
  if (!src.trim()) return []
  const lines = src.split(/\r?\n/)
  const out = []
  let current = null

  const flush = () => {
    if (!current) return
    const filled = describeFromWikiEntry(current)
    if (filled) out.push(filled)
    current = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const nameMatch = /^[-*•·]?\s*(?:姓名|名字)\s*[:：]\s*(.+)$/.exec(line)
    if (nameMatch) {
      flush()
      current = { name: nameMatch[1].trim().replace(/[，。,]$/, ''), fields: {} }
      continue
    }
    if (!current) continue
    const fieldMatch = /^[-*•·]?\s*(年龄|身份关系|身份|职业|生活地点|简介|外貌|身体|体型|服装|性格|关系)\s*[:：]\s*(.*)$/.exec(line)
    if (fieldMatch) {
      current.fields[fieldMatch[1]] = fieldMatch[2].trim()
      continue
    }
    // 简介常常换行续写
    if (current.fields['简介']) current.fields['简介'] += ' ' + line
  }
  flush()
  return out
}

const APPEARANCE_HINT = /(发|瞳|眼|眉|鼻|唇|脸|皮肤|身高|罩杯|乳|胸|腰|臀|腿|脚|身形|身材|体型|身穿|穿着|衣|裙)/

/** 把一条世界书 NPC 条目变成 definitions 结构 */
function describeFromWikiEntry(entry) {
  const name = String(entry.name ?? '').trim()
  if (!name || name.length > 12) return null
  // 过滤模板占位符与代码残片：<user>、{{char}}、身份: string; 之类
  if (/[<>{}[\]:]/.test(name)) return null
  if (/^[\x00-\x7f]+$/.test(name)) return null
  const ageNum = Number((String(entry.fields?.['年龄'] ?? '').match(/(\d{1,3})/) ?? [])[1])
  // 未成年角色一律不导入
  if (Number.isFinite(ageNum) && ageNum > 0 && ageNum < 18) return null
  const f = entry.fields ?? {}
  // 代码残片/占位符条目（身份: string; 之类）直接丢弃
  if (/string|number|boolean|unknown|any\b/.test(String(f['身份关系'] ?? f['身份'] ?? ''))) return null
  const intro = String(f['简介'] ?? '').replace(/\s+/g, ' ').trim()
  const appearanceRaw = [f['外貌'], f['身体'], f['体型'], f['服装'], intro].filter(Boolean).join('，')

  // 只保留"看得见"的长相/身材片段，剔除剧情、家庭、职业经历。
  // 按逗号逐段过滤，避免一句话里出现"性格"就把同句的发型描述一起丢掉。
  const PLOT = /(丈夫|妻子|女儿|儿子|父亲|母亲|结婚|婚后|去世|离婚|猝死|改嫁|工作|公司|集团|俱乐部|组织|开展|关系|暗恋|喜欢|追求|性格|三观|经历|生下|试管|家庭|财政|掌管|事业|毕业于)/
  const clauses = appearanceRaw
    .split(/[。；;！!？?]/)
    .filter(Boolean)
    .flatMap(sentence => sentence.split(/[，,]/))
    .map(part => part.trim())
    .filter(Boolean)
  const visual = clauses
    .filter(part => APPEARANCE_HINT.test(part) && !PLOT.test(part))
    .join('，')
    .slice(0, 220)
  // 体型只挑和身材比例有关的片段，避免把发型重复写进 body
  const BODY_HINT = /(胸|腰|臀|腿|身形|身材|体型|肩|臂|背|皮肤|身高|罩杯|骨|足)/

  const identity = [f['身份关系'] ?? f['身份'], f['职业']].filter(Boolean).join(' · ')
  const age = String(f['年龄'] ?? '').match(/(\d{1,3})\s*岁/)
  const ageText = age ? youngifyAge(age[0]) : ''

  const feature = [ageText, cleanBody(visual), identity ? '身份：' + identity : '']
    .filter(Boolean).join('，').slice(0, 400)
  const bodyText = cleanBody(clauses.filter(part => BODY_HINT.test(part) && !PLOT.test(part)).join('，')).slice(0, 160)

  if (!feature && !intro) return null

  return {
    id: `wb-${Buffer.from(name).toString('hex').slice(0, 12)}`,
    enabled: true,
    name,
    match: splitNameAliases(name),
    continuity: '',
    note: String(f['性格'] ?? intro).slice(0, 160),
    inject: {},
    cards: [],
    outfitRefs: [],
    traits: {
      feature,
      face: cleanBody(visual).slice(0, 200),
      faceBack: '',
      bodySFW: bodyText || cleanBody(visual).slice(0, 160),
      bodySFWBack: '',
      lowerSFW: '',
      lowerSFWBack: '',
      bodyNSFW: '',
      bodyNSFWBack: '',
      lowerNSFW: '',
      lowerNSFWBack: '',
      negative: '',
    },
    outfits: (f['服装'] ? [{
      id: 'o1', name: '常服', upper: String(f['服装']).slice(0, 120), lower: '', shoes: '',
      accessory: '', full: '', back: '', negative: '', enabled: true, default: true,
    }] : []),
  }
}


/** 解析模型返回的 JSON（{characters:[...]} 或 [...]）→ 人物库条目 */
export function charactersFromExtraction(raw) {
  const text = String(raw ?? '')
  let data = null
  const tryParse = value => { try { return JSON.parse(value) } catch { return null } }
  data = tryParse(text.trim())
  if (!data) {
    const start = text.search(/[[{]/)
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
    if (start >= 0 && end > start) data = tryParse(text.slice(start, end + 1))
  }
  if (!data) return []
  const list = Array.isArray(data) ? data : Array.isArray(data.characters) ? data.characters : []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const name = String(item.name ?? '').trim().slice(0, 12)
    if (!name) continue
    const ageText = String(item.age ?? '').trim()
    const ageNum = Number((ageText.match(/(\d{1,3})/) ?? [])[1])
    if (Number.isFinite(ageNum) && ageNum > 0 && ageNum < 18) continue
    const feature = clip(String(item.feature ?? '').trim() || [ageText, String(item.identity ?? '')].filter(Boolean).join('，'), 400)
    const body = cleanBody(String(item.body ?? '').trim()).slice(0, 160)
    if (!feature && !body) continue
    out.push({
      id: `ai-${Buffer.from(name).toString('hex').slice(0, 12)}`,
      enabled: true,
      name,
      match: splitNameAliases(name),
      continuity: '',
      note: clip(String(item.note ?? ''), 160),
      inject: {},
      cards: [],
      outfitRefs: [],
      traits: {
        feature,
        face: clip(feature, 200),
        faceBack: '',
        bodySFW: body,
        bodySFWBack: '',
        lowerSFW: '',
        lowerSFWBack: '',
        bodyNSFW: '',
        bodyNSFWBack: '',
        lowerNSFW: '',
        lowerNSFWBack: '',
        negative: '',
      },
      outfits: item.outfit ? [{
        id: 'o1', name: '常服', upper: clip(item.outfit, 120), lower: '', shoes: '',
        accessory: '', full: '', back: '', negative: '', enabled: true, default: true,
      }] : [],
    })
  }
  return out
}
