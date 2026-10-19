import test from 'node:test'
import assert from 'node:assert/strict'
import { compileJob } from '../lib/index.js'

const config = { sizes: { '竖图': { width: 896, height: 1152 } }, weightMode: 'none', negativeMode: 'plugin' }
const nodes = () => ({
  '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
  '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
  '9': { class_type: 'LatentUpscale', inputs: { upscale_method: 'nearest-exact', width: 768, height: 1152, crop: 'disabled' } },
})
const compile = bindings => compileJob({ workflow: { id: 'w', prompt: nodes(), bindings: { positive: [{ node: '1', input: 'text' }], ...bindings } }, params: { tag: '1girl', size: '竖图' }, config, definitions: { characters: [] } }).prompt

test('a bound size node is the only one resized; the upscale target of a two-pass workflow is kept', () => {
  const prompt = compile({ size: [{ node: '4', input: 'width' }] })
  assert.deepEqual([prompt['4'].inputs.width, prompt['4'].inputs.height], [896, 1152])
  assert.deepEqual([prompt['9'].inputs.width, prompt['9'].inputs.height], [768, 1152])
})

test('without a size binding, upscale / scale / crop nodes are skipped', () => {
  const prompt = compile({})
  assert.deepEqual([prompt['4'].inputs.width, prompt['4'].inputs.height], [896, 1152])
  assert.deepEqual([prompt['9'].inputs.width, prompt['9'].inputs.height], [768, 1152])
})
