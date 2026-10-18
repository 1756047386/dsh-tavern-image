import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

const source = fileURLToPath(new URL('..', import.meta.url))
const definitions = { characters: [{ id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman, long black hair' }, outfits: [] }] }
const plannerText = '<image><regex>阿梅推开门</regex><title>推门</title><size>竖图</size><prompts>${"name":"A Mei"}$, A Mei opens the door</prompts></image>'

async function runtime(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfy-test-'))
  await mkdir(join(root, 'lib')); await mkdir(join(root, 'workflows'))
  await cp(join(source, 'lib'), join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(root, 'worldbook.json'), JSON.stringify({ name: 'test', entries: [{ comment: '01', content: 'rule', enabled: true }] }))
  await writeFile(join(root, 'definitions.json'), JSON.stringify(definitions))
  await writeFile(join(root, 'workflows', 'test.json'), JSON.stringify({
    format: 'dsh-tavern-comfy-v1', outputNode: '9',
    prompt: { '1': { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: '' } }, '3': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } }, '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } },
    bindings: { positive: [{ node: '1', input: 'text' }] },
  }))
  const routes = new Map(), disposes = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    if (url.pathname === '/prompt') return new Response(JSON.stringify({ prompt_id: 'x' }), { status: 200 })
    return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 })
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    llm: { stream: () => (async function* () { yield { type: 'text-delta', text: plannerText } })() },
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const off = install(); if (typeof off === 'function') disposes.push(off); return off },
  }
  const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?' + Math.random())
  apply(ctx, { plannerProvider: 'mock', plannerModel: 'mock', plannerCount: 1, promptMode: 'tags', sizes: { 竖图: { width: 896, height: 1152 } } })
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
    routes.get(req.url)(req, { headersSent: false, setHeader() {}, writeHead(s) { this.status = s }, end(b) { try { ok({ status: this.status, body: JSON.parse(String(b)) }) } catch (e) { fail(e) } } })
  })
  return { root, request }
}

test('manual prompts and artist sets survive a save', async t => {
  const f = await runtime(t)
  const r = await f.request('config', { promptManualPositive: 'soft light', promptManualNegative: 'blurry', artistSets: [{ id: 's1', name: '组一', positive: 'artist a' }], activeArtistSet: 's1' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  await delay(50)
  const saved = JSON.parse(await readFile(join(f.root, 'config.json'), 'utf8'))
  assert.equal(saved.promptManualPositive, 'soft light')
  assert.equal(saved.promptManualNegative, 'blurry')
  assert.equal(saved.activeArtistSet, 's1')
  assert.equal(saved.artistSets.length, 1)
})

test('planned images report a real size, never "undefinedxundefined"', async t => {
  const f = await runtime(t)
  const r = await f.request('plan', { text: '阿梅推开门，走了进来。', messageId: 'm1', sessionId: 'g', count: 1, manual: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const item = (r.body.plans ?? r.body.plan?.plans ?? [])[0]
  assert.ok(item, JSON.stringify(r.body).slice(0, 300))
  assert.equal(item.sizeText, '896x1152')
})

test('worldbook saves keep only the latest 12 automatic backups and leave other files alone', async t => {
  const f = await runtime(t)
  const dir = join(f.root, 'backups')
  await mkdir(join(dir, 'freeze-manual'), { recursive: true })
  await writeFile(join(dir, 'worldbook-manual-copy.json'), '{}')
  for (let i = 0; i < 15; i++) await writeFile(join(dir, `worldbook-2026-01-01T00-00-${String(i).padStart(2, '0')}.json`), '{}')
  const r = await f.request('worldbook-entry', { index: 0, patch: { content: 'rule changed' } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const names = await readdir(dir)
  const auto = names.filter(n => /^worldbook-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(n))
  assert.equal(auto.length, 12)
  assert.ok(!auto.includes('worldbook-2026-01-01T00-00-00.json'), 'oldest removed')
  assert.ok(names.includes('freeze-manual') && names.includes('worldbook-manual-copy.json'), 'manual backups untouched')
})
