import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { injectDefinitions, expandRosterCalls } from '../lib/index.js'

const source = fileURLToPath(new URL('..', import.meta.url))
const SECRET = 'sk-SUPERSECRET-123456'
const definitions = { characters: [
  { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'black long hair, dark brown eyes', negative: 'glasses, beard, short hair' }, outfits: [{ id: 'o1', name: '常服', upper: 'cream cardigan', lower: 'blue skirt', negative: 'jeans' }] },
  { id: 'mf', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true, traits: { face: 'silver-white long hair, pale ice-blue eyes, white fox ears' }, outfits: [] },
] }
const story = '雨夜，阿梅和他共撑一把伞。' + SECRET
const plannerText = '<image><regex>阿梅和他共撑一把伞</regex><title>雨夜</title><prompts>${"name":"A Mei","outfit":"常服"}$, A Mei and a man with short black hair share an umbrella in the rain</prompts></image>'

async function runtime(t, { diagnostics } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfy-test-'))
  await mkdir(join(root, 'lib')); await mkdir(join(root, 'workflows'))
  await cp(join(source, 'lib'), join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(root, 'worldbook.json'), JSON.stringify({ name: 'test', entries: [] }))
  await writeFile(join(root, 'definitions.json'), JSON.stringify(definitions))
  if (diagnostics !== undefined) {
    if (diagnostics === 'broken') { await writeFile(join(root, 'diagnostics.json'), JSON.stringify({ enabled: true })); await writeFile(join(root, 'diagnostics'), 'not a dir') }
    else await writeFile(join(root, 'diagnostics.json'), JSON.stringify(diagnostics))
  }
  await writeFile(join(root, 'workflows', 'test.json'), JSON.stringify({
    format: 'dsh-tavern-comfy-v1', outputNode: '9',
    prompt: { '1': { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: '' } }, '2': { class_type: 'CLIPTextEncode', _meta: { title: '负面提示词' }, inputs: { text: 'lowres' } }, '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } },
    bindings: { positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }] },
  }))
  const routes = new Map(), disposes = [], bodies = [], llmCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(input)
    if (url.pathname === '/prompt') { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ prompt_id: 'comfy-' + bodies.length }), { status: 200 }) }
    return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 })
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    llm: { stream: args => { llmCalls.push(structuredClone({ ...args, signal: undefined })); return (async function* () { yield { type: 'text-delta', text: plannerText } })() } },
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const off = install(); if (typeof off === 'function') disposes.push(off); return off },
  }
  const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?' + Math.random())
  apply(ctx, { plannerProvider: 'mock', plannerModel: 'mock', plannerCount: 1, comfyAuthToken: SECRET, negativeMode: 'plugin', promptMode: 'tags', injectWeight: 1 })
  t.after(async () => {
    for (const dispose of disposes.splice(0).reverse()) dispose()
    globalThis.fetch = originalFetch
    await delay(40)
    assert.ok(resolve(root).startsWith(resolve(tmpdir())) && basename(root).startsWith('dsh-comfy-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const request = (path, body) => new Promise((ok, fail) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method: 'POST', url: '/plugins/dsh-tavern-image/' + path, headers: { host: 'localhost', 'content-type': 'application/json' } })
    routes.get(req.url)(req, { headersSent: false, writeHead(s) { this.status = s }, end(b) { try { ok({ status: this.status, body: JSON.parse(String(b)) }) } catch (e) { fail(e) } } })
  })
  const plan = () => request('plan', { text: story, messageId: 'm1', sessionId: 'game-1', count: 1, manual: true })
  const events = async () => {
    const dir = join(root, 'diagnostics')
    try { if (!(await stat(dir)).isDirectory()) return [] } catch { return [] }
    const out = []
    for (const id of await readdir(dir)) out.push(...(await readFile(join(dir, id, 'events.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l)))
    return out
  }
  return { root, plan, bodies, llmCalls, events }
}

const strip = body => ({ ...body, prompt_id: '<id>', client_id: '<id>' })

test('diagnostics off by default: no log files, request unchanged', async t => {
  const f = await runtime(t)
  const r = await f.plan()
  assert.equal(r.status, 200)
  assert.equal(f.bodies.length, 1)
  assert.deepEqual(await f.events(), [])
})

test('enabling diagnostics does not change the LLM call or the ComfyUI request', async t => {
  const off = await runtime(t)
  await off.plan()
  const on = await runtime(t, { diagnostics: { enabled: true, contentMode: 'full' } })
  await on.plan()
  assert.deepEqual(on.llmCalls, off.llmCalls)
  assert.equal(on.bodies.length, off.bodies.length)
  assert.deepEqual(on.bodies.map(strip), off.bodies.map(strip))
  for (const b of on.bodies) assert.ok(!JSON.stringify(b).includes('traceId'), 'trace ids must not reach ComfyUI')
})

test('a full trace records every stage, each macro result and the exact ComfyUI body', async t => {
  const f = await runtime(t, { diagnostics: { enabled: true, contentMode: 'full' } })
  await f.plan(); await delay(30)
  const ev = await f.events()
  const stages = ev.map(e => e.stage)
  for (const s of ['trace-begin', 'planner-input', 'planner-context', 'planner-request', 'image-adopted', 'macro-expansion', 'job-input', 'compile-positive', 'compile-negative', 'compiled', 'job-created', 'comfy-request', 'comfy-accepted', 'image-job', 'planner-response', 'planner-finished'])
    assert.ok(stages.includes(s), 'missing stage ' + s + ' in ' + stages.join(','))
  const macro = ev.find(e => e.stage === 'macro-expansion').data.macros[0]
  assert.equal(macro.result, 'character'); assert.equal(macro.characterId, 'm'); assert.equal(macro.outfitResult, 'found')
  assert.deepEqual(macro.droppedNegatives, ['glasses, beard, short hair', 'jeans'])
  const pos = ev.find(e => e.stage === 'compile-positive').data
  assert.deepEqual(pos.hits, ['阿梅'])
  const logged = JSON.parse(ev.find(e => e.stage === 'comfy-request').data.body.text)
  assert.deepEqual(strip(logged), strip(f.bodies[0]))
  assert.equal(JSON.parse(await readFile(join(f.root, 'diagnostics.json'), 'utf8')).enabled, false, 'one-shot switch closes itself')
  const seqs = ev.map(e => e.seq); assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
})

test('the second plan after a one-shot trace is not logged', async t => {
  const f = await runtime(t, { diagnostics: { enabled: true, contentMode: 'full' } })
  await f.plan()
  const before = (await f.events()).length
  await f.plan()
  assert.equal((await f.events()).length, before)
})

test('summary mode keeps hashes only, no story or prompt text', async t => {
  const f = await runtime(t, { diagnostics: { enabled: true, contentMode: 'summary' } })
  await f.plan(); await delay(30)
  const raw = JSON.stringify(await f.events())
  assert.ok(!raw.includes('共撑一把伞'), 'story text leaked')
  assert.ok(!raw.includes('short black hair'), 'prompt text leaked')
  assert.match(raw, /"sha256":"[0-9a-f]{64}"/)
})

test('secrets from config are redacted even if they appear in content', async t => {
  const f = await runtime(t, { diagnostics: { enabled: true, contentMode: 'full' } })
  await f.plan(); await delay(30)
  const raw = JSON.stringify(await f.events())
  assert.ok(!raw.includes(SECRET), 'secret leaked')
  assert.match(raw, /\[REDACTED\]/)
})

test('a broken diagnostics directory never breaks image generation', async t => {
  const f = await runtime(t, { diagnostics: 'broken' })
  const r = await f.plan()
  assert.equal(r.status, 200)
  assert.equal(f.bodies.length, 1)
})

test('provenance attributes injected traits and whole-image negatives to their character', () => {
  const provenance = []
  injectDefinitions('A Mei and a man with short black hair', definitions, { injectWeight: 1 }, { provenance })
  const src = provenance.find(p => p.field === 'traits.negative')
  assert.equal(src.characterId, 'm'); assert.equal(src.appliedScope, 'whole-image-negative'); assert.match(src.text, /short hair/)
  assert.ok(provenance.some(p => p.field === 'traits.face' && p.appliedScope === 'whole-image-positive'))
})

test('onMacro reports unknown names and outfit macros', () => {
  const seen = []
  expandRosterCalls('${"name":"A Mei"}$, ${"name":"常服"}$, ${"name":"nobody"}$', definitions, 'auto', { onMacro: e => seen.push(e) })
  assert.deepEqual(seen.map(e => e.result), ['character', 'character-outfit', 'not-found'])
  assert.equal(seen[1].ownerId, 'm')
})

test('negative words recorded for provenance never reach the natural-language positive prompt', () => {
  const out = expandRosterCalls('${"name":"A Mei","outfit":"常服"}$', definitions, 'auto', { style: 'natural' })
  assert.match(out, /A Mei is the woman in this scene|A Mei is a character in this scene/)
  assert.doesNotMatch(out, /glasses|beard|short hair|jeans/)
  const injected = injectDefinitions('A Mei waits', definitions, { injectWeight: 1 }, { style: 'natural' })
  assert.doesNotMatch(injected.text, /glasses|beard|jeans/)
})
