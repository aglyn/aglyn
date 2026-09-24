/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import { resetPluginServicesForTests, unregisterPluginServices } from './plugin-services'
import {
  normalizePluginTextGenerationPurpose,
  pluginTextGenerator,
  registerPluginTextGenerator,
  type PluginTextGenerationRequest,
  type PluginTextGenerator,
} from './plugin-text-generation'

/**
 * The seam with no model in it (AGL-3324): a `quill` plugin generates, a
 * `mailer` plugin that knows nothing about quill asks for a draft through
 * the one generator registered — refused where quill refuses, and told
 * nobody generates when nobody does.
 */

function quillPlugin() {
  const asked: PluginTextGenerationRequest[] = []
  const generator: PluginTextGenerator = {
    generate: async (request) => {
      asked.push(request)
      if (request.uid === 'viewer') {
        return { ok: false, status: 403, reason: 'permission', error: 'Your role does not include Generate' }
      }
      return {
        ok: true,
        text: `Dear reader, ${request.prompt}`,
        model: 'quill-1',
        usage: { inputTokens: 12, outputTokens: 5 },
      }
    },
  }
  return { asked, generator }
}

/** The mailer: it asks for the generator, never for the plugin behind it. */
async function draft(uid: string, prompt: string): Promise<{ text: string | null; refused: string | null }> {
  const found = pluginTextGenerator()
  if (!found) return { text: null, refused: 'Nobody generates text here' }
  const answer = await found.generator.generate({
    orgId: 'org-1',
    hostId: null,
    uid,
    staff: false,
    org: null,
    purpose: 'mailer-draft',
    system: 'Write letters.',
    prompt,
  })
  return answer.ok === true ? { text: answer.text, refused: null } : { text: null, refused: answer.error }
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('text generation', () => {
  it('lets a plugin draft through the one generator, under the generator’s own rules', async () => {
    const quill = quillPlugin()
    setRegisteringPluginId('quill')
    registerPluginTextGenerator(quill.generator)
    setRegisteringPluginId(undefined)

    expect(pluginTextGenerator()).toEqual({ pluginId: 'quill', generator: quill.generator })
    expect(await draft('uid-1', 'thank them')).toEqual({ text: 'Dear reader, thank them', refused: null })
    expect(await draft('viewer', 'thank them')).toEqual({
      text: null,
      refused: 'Your role does not include Generate',
    })
    expect(quill.asked.map((request) => request.purpose)).toEqual(['mailer-draft', 'mailer-draft'])
  })

  it('answers null when nobody generates, and after the generator unloads', async () => {
    expect(pluginTextGenerator()).toBeNull()
    expect(await draft('uid-1', 'thank them')).toEqual({ text: null, refused: 'Nobody generates text here' })
    registerPluginTextGenerator(quillPlugin().generator, { pluginId: 'quill' })
    unregisterPluginServices('quill')
    expect(pluginTextGenerator()).toBeNull()
  })

  it('is a slot: a second plugin’s generator is refused naming both, and the same plugin replaces its own', () => {
    const first = quillPlugin().generator
    registerPluginTextGenerator(first, { pluginId: 'quill' })
    expect(() => registerPluginTextGenerator(quillPlugin().generator, { pluginId: 'pen' })).toThrow(
      /already registered by "quill".*refused "pen"/,
    )
    const replacement = quillPlugin().generator
    registerPluginTextGenerator(replacement, { pluginId: 'quill' })
    expect(pluginTextGenerator()?.generator).toBe(replacement)
  })

  it('keys a purpose the way the ledger can hold it', () => {
    expect(normalizePluginTextGenerationPurpose('outreach-curate')).toBe('outreach-curate')
    expect(normalizePluginTextGenerationPurpose('Outreach.curate step')).toBe('outreach-curate-step')
    expect(normalizePluginTextGenerationPurpose('')).toBe('plugin')
  })
})
