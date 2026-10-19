import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginUpdater, REPOSITORY_URL } from '../lib/updater.js'

const crc32 = data => {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function makeZip(entries) {
  const locals = [], central = []
  let offset = 0
  for (const [path, value] of Object.entries(entries)) {
    const name = Buffer.from('dsh-tavern-image/' + path), data = Buffer.from(value), crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const row = Buffer.alloc(46)
    row.writeUInt32LE(0x02014b50, 0); row.writeUInt16LE(20, 4); row.writeUInt16LE(20, 6)
    row.writeUInt16LE(0, 8); row.writeUInt16LE(0, 10); row.writeUInt32LE(crc, 16)
    row.writeUInt32LE(data.length, 20); row.writeUInt32LE(data.length, 24); row.writeUInt16LE(name.length, 28)
    row.writeUInt32LE(offset, 42)
    central.push(row, name)
    offset += local.length + name.length + data.length
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}
function response(data) {
  const body = Buffer.from(data)
  return {
    ok: true,
    headers: { get: name => name === 'content-length' ? String(body.length) : null },
    json: async () => JSON.parse(body.toString()),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }
}
async function fixture(t, gitInstall = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-update-dispatch-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dsh-tavern-comfy', version: '2.7.0',
    dsh: { compatibility: { tavernApiVersion: 1 } },
  }))
  if (gitInstall) await mkdir(join(root, '.git'))
  const packageJson = JSON.stringify({
    name: 'dsh-tavern-comfy', version: '2.8.0',
    dsh: { compatibility: { tavernApiVersion: 1 } },
  })
  const archive = makeZip({ 'package.json': packageJson, 'lib/release-test.js': 'release installed' })
  const digest = createHash('sha256').update(archive).digest('hex')
  const zipUrl = 'https://github.com/weixinlll/dsh-tavern-image/releases/download/v2.8.0/dsh-tavern-image-source.zip'
  const sumsUrl = 'https://github.com/weixinlll/dsh-tavern-image/releases/download/v2.8.0/SHA256SUMS'
  const apiUrl = 'https://api.github.com/repos/weixinlll/dsh-tavern-image/releases/latest'
  const calls = [], gitCalls = []
  const fetchImpl = async url => {
    calls.push(String(url))
    if (String(url) === apiUrl) return response(JSON.stringify({
      tag_name: 'v2.8.0', assets: [
        { name: 'dsh-tavern-image-source.zip', browser_download_url: zipUrl },
        { name: 'SHA256SUMS', browser_download_url: sumsUrl },
      ],
    }))
    if (String(url) === zipUrl) return response(archive)
    if (String(url) === sumsUrl) return response(digest + '  dsh-tavern-image-source.zip')
    throw Error('Unexpected fetch URL')
  }
  const updater = createPluginUpdater({
    root, fetchImpl, getApiVersion: () => 1,
    git: async args => { gitCalls.push(args); throw Error('git must not be called for Release installs') },
  })
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return { root, updater, calls, gitCalls }
}

test('folder without its own .git routes Release check and apply without git', async t => {
  const f = await fixture(t)
  const local = await f.updater.status()
  assert.equal(local.mode, 'release')
  assert.equal(local.compatibility.compatible, true)
  const checked = await f.updater.check()
  assert.equal(checked.mode, 'release')
  assert.equal(checked.available, true)
  assert.equal(checked.canUpdate, true)
  assert.equal(checked.compatibility.compatible, true)
  const applied = await f.updater.apply(checked.target)
  assert.equal(applied.mode, 'release')
  assert.equal(applied.restartRequired, true)
  assert.equal(await readFile(join(f.root, 'lib/release-test.js'), 'utf8'), 'release installed')
  assert.deepEqual(f.gitCalls, [])
  assert.equal(f.calls.length, 3)
})

test('Git check rejects remote metadata requiring a newer Tavern API', async t => {
  const f = await fixture(t, true)
  const git = async args => {
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? f.root : (args[1] === 'FETCH_HEAD' ? 'b'.repeat(40) : 'a'.repeat(40))
    if (args[0] === 'remote') return REPOSITORY_URL + '.git'
    if (args[0] === 'branch') return 'master'
    if (args[0] === 'status' || args[0] === 'fetch') return ''
    if (args[0] === 'show') return JSON.stringify({ name: 'dsh-tavern-image', version: '3.0.0', dsh: { compatibility: { tavernApiVersion: 2 } } })
    if (args[0] === 'diff') return 'client.js'
    throw Error('Unexpected git command ' + args.join(' '))
  }
  const updater = createPluginUpdater({ root: f.root, git, getApiVersion: () => 1 })
  const checked = await updater.check()
  assert.equal(checked.available, true)
  assert.equal(checked.canUpdate, false)
  assert.equal(checked.compatibility.compatible, false)
  assert.equal(checked.compatibility.requiredApiVersion, 2)
  assert.match(checked.reason, /先更新 Tavern/)
})

test('Git apply rejects a host downgraded after the compatible check', async t => {
  const f = await fixture(t, true)
  let apiVersion = 1
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ name: 'dsh-tavern-comfy', version: '2.7.0' }))
  const target = 'b'.repeat(40)
  const git = async args => {
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? f.root : (args[1] === 'HEAD' ? 'a'.repeat(40) : target)
    if (args[0] === 'remote') return REPOSITORY_URL + '.git'
    if (args[0] === 'branch') return 'master'
    if (args[0] === 'status' || args[0] === 'fetch') return ''
    if (args[0] === 'show') return JSON.stringify({ name: 'dsh-tavern-image', version: '3.0.0', dsh: { compatibility: { tavernApiVersion: 1 } } })
    if (args[0] === 'merge-base') return 'a'.repeat(40)
    if (args[0] === 'diff') return 'client.js'
    throw Error('Unexpected git command ' + args.join(' '))
  }
  const updater = createPluginUpdater({ root: f.root, git, getApiVersion: () => apiVersion })
  const checked = await updater.check()
  assert.equal(checked.canUpdate, true)
  apiVersion = 0
  await assert.rejects(updater.apply(checked.target), /API 为 v0.*先更新 Tavern/)
})
test('dangling own .git entry selects Git mode instead of Release fallback', async t => {
  const f = await fixture(t)
  await symlink(join(f.root, 'missing-git-dir'), join(f.root, '.git'), process.platform === 'win32' ? 'junction' : 'dir')
  const calls = []
  const updater = createPluginUpdater({
    root: f.root, getApiVersion: () => 1,
    git: async args => { calls.push(args); throw Error('Git mode selected') },
  })
  const status = await updater.status()
  assert.equal(status.mode, 'git')
  assert.equal(status.supported, false)
  assert.equal(calls.length, 1)
})
