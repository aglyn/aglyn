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
import {
  pluginAiCapabilities,
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  registerPluginAiCapability,
  type PluginAiCapability,
} from './plugin-ai-capabilities'
import { resetPluginServicesForTests, unregisterPluginServices } from './plugin-services'

/**
 * A `notes` plugin contributes the operation "note" to AI builds; the
 * builder finds it by op, never by plugin, and it is gone when notes unloads.
 */

function noteCapability(overrides: Partial<PluginAiCapability> = {}): PluginAiCapability {
  return {
    op: 'note',
    noun: 'note',
    where: 'Notes → Drafts',
    intents: ['a pinned note'],
    argsSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'The note', maxLength: 200 },
        minutes: { type: 'integer', description: 'Read time', minimum: 1, maximum: 30 },
        tags: { type: 'array', description: 'Tags', items: { type: 'string', enum: ['a', 'b'] }, maxItems: 2 },
        pinned: { type: 'boolean', description: 'Pinned' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    maxPerPlan: 2,
    freeAllowed: true,
    draftResource: 'note',
    estimateCredits: () => 0,
    degrade: 'omit',
    ...overrides,
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('ai capabilities', () => {
  it('finds a registered operation by op, with its owner, until the owner unloads', () => {
    registerPluginAiCapability(noteCapability(), { pluginId: 'notes' })
    expect(pluginAiCapability('note')?.pluginId).toBe('notes')
    expect(pluginAiCapabilities().map((one) => one.capability.op)).toEqual(['note'])
    unregisterPluginServices('notes')
    expect(pluginAiCapability('note')).toBeNull()
  })

  it('keeps one owner per op, and lets the owner re-register its own', () => {
    registerPluginAiCapability(noteCapability(), { pluginId: 'notes' })
    expect(() => registerPluginAiCapability(noteCapability(), { pluginId: 'other' })).toThrow(
      /already registered by "notes"; refused "other"/,
    )
    registerPluginAiCapability(noteCapability({ maxPerPlan: 3 }), { pluginId: 'notes' })
    expect(pluginAiCapability('note')?.capability.maxPerPlan).toBe(3)
  })

  it('takes the owner from the loader marker', () => {
    setRegisteringPluginId('notes')
    registerPluginAiCapability(noteCapability())
    setRegisteringPluginId(undefined)
    expect(pluginAiCapability('note')?.pluginId).toBe('notes')
  })

  it('refuses a malformed capability', () => {
    const options = { pluginId: 'notes' }
    expect(() => registerPluginAiCapability(noteCapability({ op: 'Note!' }), options)).toThrow(/lowercase/)
    expect(() =>
      registerPluginAiCapability(noteCapability({ runnerKind: 'page' }), options),
    ).toThrow(/exactly one/)
    expect(() =>
      registerPluginAiCapability(noteCapability({ draftResource: undefined }), options),
    ).toThrow(/exactly one/)
    expect(() => registerPluginAiCapability(noteCapability({ maxPerPlan: 0 }), options)).toThrow(/maxPerPlan/)
    const schema = noteCapability().argsSchema
    expect(() =>
      registerPluginAiCapability(noteCapability({ argsSchema: { ...schema, required: ['nope'] } }), options),
    ).toThrow(/does not declare/)
  })

  it('checks arguments against the schema', () => {
    const { argsSchema } = noteCapability()
    expect(pluginAiCapabilityArgsProblems(argsSchema, { body: 'Hi', minutes: 3, tags: ['a'], pinned: true })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(argsSchema, {})).toEqual(['"body" is required'])
    expect(
      pluginAiCapabilityArgsProblems(argsSchema, {
        body: 'x'.repeat(201),
        minutes: 2.5,
        tags: ['c'],
        pinned: 'yes',
        extra: 1,
      }),
    ).toEqual([
      '"body" must be at most 200 characters',
      '"minutes" must be a whole number',
      '"tags" holds "c", which is not one of a, b',
      '"pinned" must be true or false',
      '"extra" is not an argument',
    ])
    expect(pluginAiCapabilityArgsProblems(argsSchema, { body: 'x', minutes: 31, tags: ['a', 'b', 'a'] })).toEqual([
      '"minutes" must be at most 30',
      '"tags" must hold at most 2',
    ])
  })
})
