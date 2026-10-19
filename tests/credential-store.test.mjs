import test from 'node:test'
import assert from 'node:assert/strict'
import { createCredentialStore, secretSlots } from '../lib/credential-store.js'

function vault(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    async resolve(ref) { return values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined },
    async set(ref, value) { values.set(ref, value) },
    async unset(ref) { values.delete(ref) },
  }
}
const quiet = { warn() {} }
const config = (extra = {}) => ({ comfyAuthToken: '', comfyAuthPass: '', imageChannels: [{ id: 'openai-1', apiKey: '', password: '' }], credentialRefs: [], ...extra })
const out = target => ({ ...target })
const keyRef = target => secretSlots(target)[2].ref

test('reference names are env-style and distinct for look-alike channel ids', () => {
  const refs = secretSlots(config({ imageChannels: [{ id: 'a-b' }, { id: 'a_b' }] })).map(slot => slot.ref)
  for (const ref of refs) assert.match(ref, /^[A-Z_][A-Z0-9_]*$/)
  assert.equal(new Set(refs).size, refs.length)
})

test('saving moves secrets into the vault and blanks them in config.json; reload restores them', async () => {
  const store = createCredentialStore({ logger: quiet }), v = vault()
  const live = config()
  await store.connect(v); await store.load(live)
  live.imageChannels[0].apiKey = 'sk-test'
  live.comfyAuthToken = 'comfy-token'
  const file = out(live)
  await store.persist(live, file)
  assert.equal(file.imageChannels[0].apiKey, '')
  assert.equal(file.comfyAuthToken, '')
  assert.equal(live.imageChannels[0].apiKey, 'sk-test', 'in-memory config keeps working')
  assert.equal(v.values.get(keyRef(live)), 'sk-test')
  assert.equal(file.credentialRefs.length, 2)

  const next = createCredentialStore({ logger: quiet }), reloaded = { ...file, imageChannels: file.imageChannels.map(item => ({ ...item })) }
  await next.connect(v); await next.load(reloaded)
  assert.equal(reloaded.imageChannels[0].apiKey, 'sk-test')
  assert.equal(reloaded.comfyAuthToken, 'comfy-token')
})

test('plaintext keys from older versions are migrated on load', async () => {
  const saved = []
  const store = createCredentialStore({ logger: quiet, save: async target => { const file = out(target); await store.persist(target, file); saved.push(file) } })
  const v = vault(), live = config({ imageChannels: [{ id: 'openai-1', apiKey: 'old-plain', password: '' }] })
  await store.connect(v); await store.load(live)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].imageChannels[0].apiKey, '')
  assert.equal(v.values.get(keyRef(live)), 'old-plain')
})

test('the vault may arrive after the config was loaded', async () => {
  const v = vault(), first = config()
  first.imageChannels[0].apiKey = 'sk-late'
  const seed = createCredentialStore({ logger: quiet })
  await seed.connect(v); const file = out(first); await seed.persist(first, file)

  const store = createCredentialStore({ logger: quiet }), live = { ...file, imageChannels: file.imageChannels.map(item => ({ ...item })) }
  await store.load(live)
  assert.equal(live.imageChannels[0].apiKey, '')
  await store.connect(v)
  assert.equal(live.imageChannels[0].apiKey, 'sk-late')
})

test('clearing a key or removing its channel deletes the vault entry', async () => {
  const store = createCredentialStore({ logger: quiet }), v = vault(), live = config()
  await store.connect(v); await store.load(live)
  live.imageChannels.push({ id: 'gemini-1', apiKey: 'g-key', password: '' })
  live.imageChannels[0].apiKey = 'sk-test'
  await store.persist(live, out(live))
  assert.equal(v.values.size, 2)
  live.imageChannels[0].apiKey = ''
  live.imageChannels = live.imageChannels.slice(0, 1)
  const file = out(live)
  await store.persist(live, file)
  assert.equal(v.values.size, 0)
  assert.deepEqual(file.credentialRefs, [])
})

test('without a credentials service secrets stay in config.json as before', async () => {
  const store = createCredentialStore({ logger: quiet }), live = config()
  await store.load(live)
  live.imageChannels[0].apiKey = 'sk-plain'
  const file = out(live)
  await store.persist(live, file)
  assert.equal(file.imageChannels[0].apiKey, 'sk-plain')
})

test('a failed vault write keeps the key in config.json; a failed read never deletes', async () => {
  const v = vault()
  v.set = async () => { throw new Error('read-only') }
  const store = createCredentialStore({ logger: quiet }), live = config()
  await store.connect(v); await store.load(live)
  live.imageChannels[0].apiKey = 'sk-keep'
  const file = out(live)
  await store.persist(live, file)
  assert.equal(file.imageChannels[0].apiKey, 'sk-keep')

  const ref = keyRef(live), broken = vault({ [ref]: 'sk-stored' })
  broken.resolve = async () => { throw new Error('locked') }
  const reader = createCredentialStore({ logger: quiet }), stored = config({ credentialRefs: [ref] })
  await reader.connect(broken); await reader.load(stored)
  const next = out(stored)
  await reader.persist(stored, next)
  assert.equal(broken.values.get(ref), 'sk-stored')
  assert.deepEqual(next.credentialRefs, [ref])
})
