import test from 'node:test'
import assert from 'node:assert/strict'
import { checkPluginCompatibility } from '../lib/plugin-compatibility.js'

const pkg = tavernApiVersion => ({
  dsh: { compatibility: tavernApiVersion === undefined ? {} : { tavernApiVersion } },
})

test('legacy package metadata remains compatible', () => {
  assert.equal(checkPluginCompatibility({ name: 'old' }, undefined).compatible, true)
})

test('minimum Tavern API version requires a valid, sufficiently new integer host API', () => {
  const tooOld = checkPluginCompatibility(pkg(1), 0)
  assert.equal(tooOld.compatible, false)
  assert.equal(tooOld.requiredApiVersion, 1)
  assert.equal(tooOld.hostApiVersion, 0)
  assert.match(tooOld.reason, /API 为 v0/)
  assert.match(tooOld.reason, /先更新 Tavern/)
  for (const unknown of [undefined, null, '1', 1.5, -1]) {
    assert.equal(checkPluginCompatibility(pkg(1), unknown).compatible, false)
  }
  assert.equal(checkPluginCompatibility(pkg(1), 1).compatible, true)
})

test('declared minimum API metadata must be a positive safe integer', () => {
  for (const invalid of [0, 1.5, '1', null, Number.NaN]) {
    const result = checkPluginCompatibility(pkg(invalid), 1)
    assert.equal(result.compatible, false, String(invalid))
    assert.match(result.reason, /最低版本无效/)
  }
})