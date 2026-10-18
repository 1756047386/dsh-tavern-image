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
  await writeFile(join(root, 'definitions.json'), JSON.stringify({ characters: [] }))
  await writeFile(join(root, 'workflows', 'test.json'), JSON.stringify({
    format: 'dsh-tavern-comfy-v1', outputNode: '9',
    prompt: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '5': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 6 } }, '8': { class_type: 'ModelComputeDtype', inputs: { dtype: 'bf16' } }, '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } },
    bindings: { positive: [{ node: '1', input: 'text' }], seed: [{ node: '5', input: 'seed' }] },
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

test('a black image is redrawn with a new seed and the good image is kept', async t => {
  const f = await runtime(t, [BLACK, PICTURE])
  const r = await f.request('POST', 'jobs', { tag: '1girl, sofa' })
  const id = r.body?.id ?? r.body?.job?.id
  assert.ok(id, JSON.stringify(r.body))
  const job = await f.waitDone(id)
  assert.equal(job.state, 'done')
  assert.equal(f.submitted.length, 2)
  assert.notEqual(f.submitted[0].prompt['5'].inputs.seed, f.submitted[1].prompt['5'].inputs.seed)
  assert.equal(f.submitted[0].prompt['1'].inputs.text, f.submitted[1].prompt['1'].inputs.text, 'same prompt, only the seed changes')
})

test('three black images in a row fail with a clear message, retries only change the seed', async t => {
  const f = await runtime(t, [BLACK, BLACK, BLACK])
  const r = await f.request('POST', 'jobs', { tag: '1girl, sofa' })
  const job = await f.waitDone(r.body?.id ?? r.body?.job?.id)
  assert.equal(job.state, 'failed')
  assert.match(job.error, /全黑/)
  assert.equal(f.submitted.length, 3)
  assert.deepEqual(f.submitted.map(b => b.prompt['8'].inputs.dtype), ['bf16', 'bf16', 'bf16'], 'retries never switch precision (fp32 on top of a loaded bf16 model lost the GPU)')
})

test('a ComfyUI execution error shows the node and message, with a hint for a lost GPU', async t => {
  const f = await runtime(t, [], { failWith: 'UR_RESULT_ERROR_DEVICE_LOST' })
  const r = await f.request('POST', 'jobs', { tag: '1girl, sofa' })
  const job = await f.waitDone(r.body?.id ?? r.body?.job?.id)
  assert.equal(job.state, 'failed')
  assert.match(job.error, /KSampler：UR_RESULT_ERROR_DEVICE_LOST/)
  assert.match(job.error, /重启 ComfyUI/)
})

test('isBlankImage only flags large, nearly all-black PNGs', async () => {
  const { isBlankImage } = await import('../lib/image-output.js')
  assert.equal(isBlankImage(BLACK), true)
  assert.equal(isBlankImage(PICTURE), false)
  assert.equal(isBlankImage(png(32, 32, () => 0)), false, 'tiny icons are not treated as failed renders')
  assert.equal(isBlankImage(Buffer.from('not a png')), false)
})
