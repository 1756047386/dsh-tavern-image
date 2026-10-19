import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

const source = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const PNG = require('../lib/vendor/pngjs/lib/png-sync.js')
const png = (w, h, fill) => { const data = Buffer.alloc(w * h * 4); for (let i = 0; i < data.length; i += 4) { const v = fill(i / 4); data[i] = v; data[i + 1] = (v * 3) & 255; data[i + 2] = (v * 7) & 255; data[i + 3] = 255 } return PNG.write({ width: w, height: h, data }) }
const BLACK = png(320, 320, () => 0)
const PICTURE = png(320, 320, i => (i * 13) & 255)

async function runtime(t, views, { failWith = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfy-test-'))
  await mkdir(join(root, 'lib')); await mkdir(join(root, 'workflows'))
  await cp(join(source, 'lib'), join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(root, 'worldbook.json'), JSON.stringify({ name: 't', entries: [] }))
  await writeFile(join(root, 'definitions.json'), JSON.stringify({ characters: [{ id: 'am', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'adult woman, long black hair' }, outfits: [{ id: 'o1', name: '常服', upper: 'grey hoodie', default: true }] }] }))
  await writeFile(join(root, 'workflows', 'test.json'), JSON.stringify({
    format: 'dsh-tavern-comfy-v1', outputNode: '9',
    prompt: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '4': { class_type: 'EmptyLatentImage', inputs: { width: 896, height: 1152, batch_size: 1 } }, '5': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 6 } }, '8': { class_type: 'ModelComputeDtype', inputs: { dtype: 'bf16' } }, '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } },
    bindings: { positive: [{ node: '1', input: 'text' }], seed: [{ node: '5', input: 'seed' }], size: [{ node: '4', input: 'width' }] },
  }))
  const routes = new Map(), disposes = [], submitted = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(input)
    if (url.pathname === '/prompt') { const b = JSON.parse(init.body); submitted.push(b); return new Response(JSON.stringify({ prompt_id: b.prompt_id }), { status: 200 }) }
    if (url.pathname.startsWith('/history/')) { const id = decodeURIComponent(url.pathname.slice(9)); if (failWith) return new Response(JSON.stringify({ [id]: { status: { completed: false, status_str: 'error', messages: [['execution_start', {}], ['execution_error', { node_type: 'KSampler', exception_message: failWith }]] }, outputs: {} } }), { status: 200 }); return new Response(JSON.stringify({ [id]: { status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename: 'x' + submitted.length + '.png', subfolder: '', type: 'output' }] } } } }), { status: 200 }) }
    if (url.pathname === '/view') { const n = Number(url.searchParams.get('filename').slice(1, -4)); return new Response(views[n - 1] ?? PICTURE, { status: 200, headers: { 'content-type': 'image/png' } }) }
    return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 })
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const off = install(); if (typeof off === 'function') disposes.push(off); return off },
  }
  const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?' + Math.random())
  apply(ctx, { promptMode: 'tags', queryThrottleMs: 0 })
  t.after(async () => {
    for (const dispose of disposes.splice(0).reverse()) dispose()
    globalThis.fetch = originalFetch
    await delay(40)
    assert.ok(resolve(root).startsWith(resolve(tmpdir())) && basename(root).startsWith('dsh-comfy-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const request = (method, path, body) => new Promise((ok, fail) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    Object.assign(req, { method, url: '/plugins/dsh-tavern-image/' + path, headers: { host: 'localhost', 'content-type': 'application/json' } })
    const handler = routes.get(req.url.split('?')[0])
    handler(req, { headersSent: false, setHeader() {}, writeHead(s) { this.status = s }, end(b) { try { ok({ status: this.status, body: JSON.parse(String(b)) }) } catch (e) { ok({ status: this.status, body: null }) } } })
  })
  const waitDone = async id => {
    for (let i = 0; i < 80; i++) {
      const r = await request('GET', 'jobs?id=' + id)
      const j = r.body?.job ?? r.body
      if (j && ['done', 'failed'].includes(j.state)) return j
      await delay(60)
    }
    throw new Error('timeout')
  }
  return { request, submitted, waitDone }
}


const snapshot = { version: 1, characters: { am: { current: { outfit: 'red qipao, side slit', turn: 7, textVersion: 'v7' } } }, changes: [], turn: 7 }
const macro = '${"name":"A Mei","upperBody":"sfw","lowerBody":"sfw"}$, standing, garden'

test('console redraw keeps the size and the turn-specific character state of the original picture', async t => {
  const f = await runtime(t, [PICTURE, PICTURE])
  const r = await f.request('POST', 'jobs', { tag: macro, rawTag: macro, size: '横图', characterSnapshot: snapshot, textVersion: 'v7', turn: 7 })
  const id = r.body?.id ?? r.body?.job?.id
  assert.ok(id, JSON.stringify(r.body))
  assert.equal((await f.waitDone(id)).state, 'done')
  const again = await f.request('POST', 'redraw', { jobId: id })
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.equal((await f.waitDone(again.body.jobId)).state, 'done')
  const [first, redraw] = f.submitted
  assert.equal(redraw.prompt['4'].inputs.width, first.prompt['4'].inputs.width, 'same size as the original')
  assert.ok(first.prompt['4'].inputs.width > first.prompt['4'].inputs.height, 'the original was landscape')
  assert.match(redraw.prompt['1'].inputs.text, /red qipao/, 'recorded outfit of that turn')
  assert.doesNotMatch(redraw.prompt['1'].inputs.text, /grey hoodie/)
})
