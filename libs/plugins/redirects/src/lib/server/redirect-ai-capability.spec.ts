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

import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerRedirectsConsoleServerDeclarations } from '../declarations.console-server'
import { checkRedirectDraftContent } from '../model/redirect-draft-content'
import { redirectAiCapability, redirectDraftContentFromArgs, registerRedirectAiCapability } from './redirect-ai-capability'

/**
 * The `redirect` build operation (AGL-3745): what the planner is offered, the
 * gates it sits behind, and the content its item hands the writer.
 */
describe('the redirect build operation', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('is a well-formed capability the redirects writer executes, at no cost, never on Free', () => {
    expect(pluginAiCapabilityProblem(redirectAiCapability)).toBeNull()
    expect(redirectAiCapability).toMatchObject({
      op: 'redirect',
      draftResource: 'redirect',
      feature: 'redirects',
      quota: 'redirectsPerHost',
      freeAllowed: false,
      live: true,
      degrade: 'omit',
    })
    expect(redirectAiCapability.runnerKind).toBeUndefined()
    expect(redirectAiCapability.pageBlocks).toBeUndefined()
    expect(redirectAiCapability.estimateCredits({ action: 'create', source: '/a', destination: '/b' })).toBe(0)
  })

  it('offers only the rule’s own fields, and says the change is live', () => {
    expect(Object.keys(redirectAiCapability.argsSchema.properties).sort()).toEqual(
      ['action', 'destination', 'enabled', 'kind', 'newSource', 'priority', 'replacesLivePage', 'source', 'statusCode'].sort(),
    )
    expect(redirectAiCapability.argsSchema.required).toEqual(['action', 'source'])
    expect(redirectAiCapability.intents.join(' ')).toContain('Live as soon as the build runs')
  })

  it('holds a planned item to its schema', () => {
    const schema = redirectAiCapability.argsSchema
    expect(pluginAiCapabilityArgsProblems(schema, { action: 'create', source: '/old-menu', destination: '/menu' })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { action: 'create', source: '/a', destination: '/b', statusCode: '303' })).toEqual([
      '"statusCode" must be one of 301, 302, 307, 308',
    ])
    expect(pluginAiCapabilityArgsProblems(schema, { action: 'move', source: '/a' })).toHaveLength(1)
    expect(pluginAiCapabilityArgsProblems(schema, { source: '/a', note: 'x' })).toEqual([
      '"action" is required',
      '"note" is not an argument',
    ])
  })

  it('hands the writer the arguments, the status code as the number a rule stores', () => {
    const content = redirectDraftContentFromArgs({ action: 'create', source: '/shop', destination: '/store', statusCode: '301' })
    expect(content).toEqual({ action: 'create', source: '/shop', destination: '/store', statusCode: 301 })
    expect(checkRedirectDraftContent(content).ok).toBe(true)
    expect(
      redirectAiCapability.draftContent?.({ name: 'Old menu', args: { action: 'remove', source: '/old-menu' } }, { hostId: 'h', dependencies: {} }),
    ).toEqual({ action: 'remove', source: '/old-menu' })
  })

  it('registers under this plugin, and the console declarations register it with its writer', () => {
    registerRedirectAiCapability()
    expect(pluginAiCapability('redirect')?.pluginId).toBe('redirects')
    resetPluginServicesForTests()
    registerRedirectsConsoleServerDeclarations()
    expect(pluginAiCapability('redirect')?.pluginId).toBe('redirects')
    const writer = pluginResourceDraftWriter('redirect')
    expect(writer?.pluginId).toBe('redirects')
    // The boot-time check answers without the Admin SDK.
    expect(writer?.writer.check({ action: 'create', source: '/a', destination: '/b' }, { hostId: 'h' }).ok).toBe(true)
  })
})
