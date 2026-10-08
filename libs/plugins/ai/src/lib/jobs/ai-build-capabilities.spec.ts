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
 *
 * @jest-environment node
 */

/**
 * This plugin's build operations (AGL-3616), as `aiBuildOps` admits them.
 * A site function is built by the `logic` runner and written by the logic
 * plugin's `function` writer, so it is offered only where that plugin runs:
 * its writer registered, released, and switched on for the site.
 */

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  aiJobStepRunnerFor: () => null,
}))

import { pluginAiCapabilityArgsProblems, pluginAiCapabilityProblem } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import {
  AI_OWNED_CAPABILITIES,
  AI_OWNED_OP_WRITERS,
  aiBuildIntents,
  aiBuildOps,
  type AiBuildOpsContext,
} from './ai-build-capabilities'

const FUNCTION = AI_OWNED_CAPABILITIES.find((one) => one.op === 'function')
const EDIT = AI_OWNED_CAPABILITIES.find((one) => one.op === 'edit')
const capabilities = () => AI_OWNED_CAPABILITIES.map((capability) => ({ pluginId: 'ai', capability }))
const context = (patch: Record<string, unknown> = {}): AiBuildOpsContext => ({
  orgId: 'org-1',
  hostId: 'host-1',
  org: { plan: 'free' },
  host: { orgId: 'org-1' },
  freeTaste: true,
  ...patch,
}) as AiBuildOpsContext

describe('the site function operation', () => {
  it('is well-formed: run by the logic runner, free of a feature, one generation', () => {
    expect(FUNCTION).toBeDefined()
    expect(pluginAiCapabilityProblem(FUNCTION as never)).toBeNull()
    expect(FUNCTION).toMatchObject({
      runnerKind: 'logic',
      quota: 'functionsPerHost',
      freeAllowed: true,
      degrade: 'omit',
      argsSchema: { properties: {} },
    })
    expect(FUNCTION?.feature).toBeUndefined()
    expect(FUNCTION?.estimateCredits({})).toBe(50)
    expect(AI_OWNED_OP_WRITERS['function']).toBe('function')
  })

  it('is offered where the logic plugin writes functions and runs on the site', async () => {
    const released = jest.fn(async (ids: string[]) => ids)
    const ops = await aiBuildOps(context(), {
      capabilities,
      hasRunner: () => true,
      releasedPlugins: released,
      writerOwner: (resource) => (resource === 'function' ? 'logic' : null),
    })
    expect(ops.get('function')).toBe(FUNCTION)
    expect(released).toHaveBeenCalledWith(['logic'], 'org-1')
    expect(aiBuildIntents(ops)).toContain(FUNCTION?.intents[0])
  })

  it('is not offered where no plugin writes functions, the plugin is unreleased, or Logic is off for the site', async () => {
    const deps = { capabilities, hasRunner: () => true }
    const unwritten = await aiBuildOps(context(), { ...deps, releasedPlugins: async (ids) => ids, writerOwner: () => null })
    expect(unwritten.has('function')).toBe(false)
    const unreleased = await aiBuildOps(context(), { ...deps, releasedPlugins: async () => [], writerOwner: () => 'logic' })
    expect(unreleased.has('function')).toBe(false)
    const off = await aiBuildOps(context({ host: { orgId: 'org-1', disabledPlugins: ['logic'] } }), {
      ...deps,
      releasedPlugins: async (ids) => ids,
      writerOwner: () => 'logic',
    })
    expect(off.has('function')).toBe(false)
    // The rest of this plugin's operations do not depend on Logic.
    expect(off.has('page')).toBe(true)
  })
})

describe('the campaign and automation operations', () => {
  it('are offered only where the plugin that writes them runs on the site', async () => {
    const owners: Record<string, string> = { campaign: 'marketing', automation: 'workflows' }
    const deps = {
      capabilities,
      hasRunner: () => true,
      writerOwner: (resource: string) => owners[resource] ?? null,
    }
    const paid = { org: { plan: 'pro' }, freeTaste: false }
    const on = await aiBuildOps(context(paid), { ...deps, releasedPlugins: async (ids) => ids })
    expect(on.has('campaign')).toBe(true)
    expect(on.has('workflow')).toBe(true)
    const marketingOff = await aiBuildOps(context({ ...paid, host: { orgId: 'org-1', disabledPlugins: ['marketing'] } }), {
      ...deps,
      releasedPlugins: async (ids) => ids,
    })
    expect(marketingOff.has('campaign')).toBe(false)
    expect(marketingOff.has('workflow')).toBe(true)
    const unwritten = await aiBuildOps(context(paid), { ...deps, releasedPlugins: async (ids) => ids, writerOwner: () => null })
    expect(unwritten.has('campaign')).toBe(false)
    expect(unwritten.has('workflow')).toBe(false)
  })
})

describe('the page change operation', () => {
  it('is well-formed: run by the edit runner, one generation, naming an existing page or layout', () => {
    expect(EDIT).toBeDefined()
    expect(pluginAiCapabilityProblem(EDIT as never)).toBeNull()
    expect(EDIT).toMatchObject({ runnerKind: 'edit', freeAllowed: false, maxPerPlan: 3, degrade: 'omit' })
    expect(EDIT?.feature).toBeUndefined()
    expect(EDIT?.estimateCredits({ target: 'home' })).toBe(50)
    const schema = EDIT?.argsSchema as NonNullable<typeof EDIT>['argsSchema']
    expect(pluginAiCapabilityArgsProblems(schema, { target: 'home', targetKind: 'screen' })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, {})).toEqual(['"target" is required'])
    expect(pluginAiCapabilityArgsProblems(schema, { target: 'home', targetKind: 'component' })).toEqual([
      '"targetKind" must be one of screen, layout',
    ])
  })

  it('is offered where the edit runner is loaded, and not on the Free taste', async () => {
    const deps = { capabilities, releasedPlugins: async (ids: string[]) => ids, writerOwner: () => 'logic' }
    const paid = await aiBuildOps(context({ org: { plan: 'starter' }, freeTaste: false }), { ...deps, hasRunner: () => true })
    expect(paid.get('edit')).toBe(EDIT)
    expect(aiBuildIntents(paid)).toContain(EDIT?.intents[0])
    const free = await aiBuildOps(context(), { ...deps, hasRunner: () => true })
    expect(free.has('edit')).toBe(false)
    const unloaded = await aiBuildOps(context({ org: { plan: 'pro' }, freeTaste: false }), {
      ...deps,
      hasRunner: (kind) => kind !== 'edit',
    })
    expect(unloaded.has('edit')).toBe(false)
  })
})
