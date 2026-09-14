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
  definePluginServiceContract,
  hasPluginService,
  registerPluginService,
  resetPluginServicesForTests,
  resolvePluginService,
  resolvePluginServices,
  unregisterPluginServices,
} from './plugin-services'

/** The worked example: an AI provider contract several plugins fill. */
interface FakeProvider {
  id: string
  complete(prompt: string): string
}

const PROVIDERS = definePluginServiceContract<FakeProvider>('fake.ai.provider', {
  multiple: true,
})
const ROUTER = definePluginServiceContract<{ pick(): string }>('fake.ai.router', {
  multiple: false,
})

const provider = (id: string): FakeProvider => ({
  id,
  complete: (prompt) => `${id}:${prompt}`,
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('definePluginServiceContract', () => {
  it('is idempotent by id and refuses a redefinition that changes the shape', () => {
    expect(
      definePluginServiceContract('fake.ai.provider', { multiple: true }),
    ).toBe(PROVIDERS)
    expect(() =>
      definePluginServiceContract('fake.ai.provider', { multiple: false }),
    ).toThrow(/already defined with multiple=true/)
    expect(() => definePluginServiceContract('  ', { multiple: true })).toThrow(
      /needs an id/,
    )
  })
})

describe('registerPluginService', () => {
  it('attributes a registration to the plugin whose register fn is running', () => {
    setRegisteringPluginId('ai')
    registerPluginService(PROVIDERS, provider('anthropic'))
    setRegisteringPluginId(undefined)
    expect(resolvePluginServices(PROVIDERS)).toEqual([
      expect.objectContaining({ pluginId: 'ai', priority: 0 }),
    ])
  })

  it('takes an explicit owner at module scope and refuses an anonymous one', () => {
    registerPluginService(PROVIDERS, provider('local'), { pluginId: 'acme-llm' })
    expect(resolvePluginServices(PROVIDERS)[0].pluginId).toBe('acme-llm')
    expect(() => registerPluginService(PROVIDERS, provider('x'))).toThrow(
      /no owner/,
    )
  })

  it('refuses a contract nobody defined', () => {
    const unknown = { id: 'fake.nothing', multiple: true } as never
    expect(() => registerPluginService(unknown, {}, { pluginId: 'p' })).toThrow(
      /not defined/,
    )
    expect(() => resolvePluginServices(unknown)).toThrow(/not defined/)
  })

  it('lets a SECOND, unrelated plugin adopt a multiple contract', () => {
    registerPluginService(PROVIDERS, provider('anthropic'), { pluginId: 'ai' })
    registerPluginService(PROVIDERS, provider('ollama'), {
      pluginId: 'acme-llm',
      priority: 5,
    })
    const resolved = resolvePluginServices(PROVIDERS)
    expect(resolved.map((entry) => `${entry.pluginId}/${entry.impl.id}`)).toEqual([
      'acme-llm/ollama',
      'ai/anthropic',
    ])
    expect(resolvePluginService(PROVIDERS)?.complete('hi')).toBe('ollama:hi')
  })

  it('a plugin re-registering replaces its own entry rather than doubling it', () => {
    registerPluginService(PROVIDERS, provider('v1'), { pluginId: 'ai' })
    registerPluginService(PROVIDERS, provider('v2'), { pluginId: 'ai' })
    expect(resolvePluginServices(PROVIDERS).map((entry) => entry.impl.id)).toEqual([
      'v2',
    ])
  })

  it('one plugin registers several implementations on a multiple contract, told apart by key', () => {
    registerPluginService(PROVIDERS, provider('anthropic'), { pluginId: 'ai', key: 'anthropic' })
    registerPluginService(PROVIDERS, provider('compat'), { pluginId: 'ai', key: 'compat' })
    // Re-registering one key replaces that one and leaves the other.
    registerPluginService(PROVIDERS, provider('anthropic-2'), { pluginId: 'ai', key: 'anthropic' })
    expect(resolvePluginServices(PROVIDERS).map((entry) => entry.impl.id)).toEqual([
      'compat',
      'anthropic-2',
    ])
    unregisterPluginServices('ai')
    expect(resolvePluginServices(PROVIDERS)).toEqual([])
  })

  it('a single contract refuses a second plugin and keeps the incumbent', () => {
    registerPluginService(ROUTER, { pick: () => 'a' }, { pluginId: 'ai' })
    expect(() =>
      registerPluginService(ROUTER, { pick: () => 'b' }, { pluginId: 'other' }),
    ).toThrow(/already registered by "ai"; refused "other"/)
    expect(resolvePluginService(ROUTER)?.pick()).toBe('a')
    // Its owner may still replace it.
    registerPluginService(ROUTER, { pick: () => 'a2' }, { pluginId: 'ai' })
    expect(resolvePluginService(ROUTER)?.pick()).toBe('a2')
  })
})

describe('reset and unregister', () => {
  it('unregisterPluginServices drops one plugin everywhere; reset drops all', () => {
    registerPluginService(PROVIDERS, provider('a'), { pluginId: 'ai' })
    registerPluginService(PROVIDERS, provider('b'), { pluginId: 'acme-llm' })
    registerPluginService(ROUTER, { pick: () => 'a' }, { pluginId: 'ai' })
    unregisterPluginServices('ai')
    expect(resolvePluginServices(PROVIDERS).map((entry) => entry.pluginId)).toEqual([
      'acme-llm',
    ])
    expect(hasPluginService(ROUTER)).toBe(false)
    resetPluginServicesForTests()
    expect(hasPluginService(PROVIDERS)).toBe(false)
    expect(resolvePluginService(PROVIDERS)).toBeUndefined()
  })
})
