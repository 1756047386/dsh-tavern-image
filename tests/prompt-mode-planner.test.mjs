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
    prompt: { '5': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'z_image_turbo_bf16.safetensors' } }, '1': { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: '' } }, '2': { class_type: 'CLIPTextEncode', _meta: { title: '负面提示词' }, inputs: { text: 'lowres' } }, '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } },
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
  apply(ctx, { plannerProvider: 'mock', plannerModel: 'mock', plannerCount: 1, comfyAuthToken: SECRET, negativeMode: 'plugin', promptMode: 'auto', injectWeight: 1, defaultWorkflow: 'test' })
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


test('with a Z-Image default workflow, the planner expands character macros as bound sentences', async t => {
  const f = await runtime(t)
  const r = await f.plan()
  assert.equal(r.status, 200)
  const text = JSON.stringify(f.bodies[0])
  assert.match(text, /A Mei is a character in this scene: black long hair, dark brown eyes; they are wearing cream cardigan/)
})
