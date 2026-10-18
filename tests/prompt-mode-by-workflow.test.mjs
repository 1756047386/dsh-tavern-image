import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePromptMode, promptBackendContext } from '../lib/prompt-presets.js'
import { selectPlannerContext } from '../lib/planner-context.js'

const wf = model => ({ id: 'x', label: 'x', summary: { model } })

test('auto prompt mode follows the workflow model', () => {
  const cfg = { promptMode: 'auto', imageBackend: 'comfyui', comfyMode: 'workflow' }
  assert.equal(resolvePromptMode(cfg, promptBackendContext(cfg, wf('z_image_turbo_bf16.safetensors'))), 'natural')
  assert.equal(resolvePromptMode(cfg, promptBackendContext(cfg, wf('waiIllustriousSDXL_v170.safetensors'))), 'tags')
  assert.equal(resolvePromptMode({ ...cfg, promptMode: 'natural' }, promptBackendContext(cfg, wf('waiIllustriousSDXL_v170.safetensors'))), 'natural', 'an explicit choice still wins')
})

test('rules marked tags / natural only reach the planner for that kind of model', () => {
  const entries = [
    { index: 0, comment: 'both', content: 'BOTH', enabled: true },
    { index: 1, comment: 'tags', content: 'TAGS ONLY', enabled: true, backends: ['tags'] },
    { index: 2, comment: 'natural', content: 'NATURAL ONLY', enabled: true, backends: ['natural'] },
    { index: 3, comment: 'comfy+tags', content: 'COMFY TAGS', enabled: true, backends: ['comfyui', 'tags'] },
  ]
  const run = promptMode => selectPlannerContext({ entries, backend: 'comfyui', promptMode }).staticRules
  assert.match(run('tags'), /BOTH[\s\S]*TAGS ONLY[\s\S]*COMFY TAGS/); assert.doesNotMatch(run('tags'), /NATURAL ONLY/)
  assert.match(run('natural'), /NATURAL ONLY/); assert.doesNotMatch(run('natural'), /TAGS ONLY|COMFY TAGS/)
  assert.doesNotMatch(selectPlannerContext({ entries, backend: 'novelai', promptMode: 'tags' }).staticRules, /COMFY TAGS/)
})


test('natural models never receive (tag:1.2) weights, even when weightMode is convert', async () => {
  const { compileJob } = await import('../lib/index.js')
  const workflow = { prompt: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }, bindings: { positive: [{ node: '1', input: 'text' }] }, summary: { model: 'z_image_turbo_bf16.safetensors' } }
  const params = { tag: 'a girl, (red scarf:1.3), snowy street' }
  const natural = compileJob({ workflow, params, config: { promptMode: 'auto', imageBackend: 'comfyui', weightMode: 'convert' }, definitions: {} })
  assert.doesNotMatch(natural.prompt['1'].inputs.text, /:1\.3/)
  const tags = compileJob({ workflow: { ...workflow, summary: { model: 'waiIllustriousSDXL_v170.safetensors' } }, params, config: { promptMode: 'auto', imageBackend: 'comfyui', weightMode: 'convert' }, definitions: {} })
  assert.match(tags.prompt['1'].inputs.text, /red scarf:1\.3/)
})
