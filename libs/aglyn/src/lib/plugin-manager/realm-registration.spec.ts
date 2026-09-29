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

/**
 * A realm bundle is held to its own namespace in the component registry
 * (AGL-3390).
 *
 * Signed marketplace plugins now render on the server, where the registry is
 * one process-global map holding every site's elements. A bundle that
 * replaced a platform component, or registered under another plugin's
 * namespace, would change what other sites' pages render. So the loader
 * compares the registry before and after a bundle runs, and undoes the whole
 * bundle when it broke a rule.
 */

import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
// The manager is in a require cycle (components-manager → lifecycle → aglyn);
// evaluate the runtime entry first, as production does.
import '../aglyn'
import { ComponentManager } from '../components-manager/components-manager'
import {
  loadRealmPlugins,
  realmRegistrationProblems,
  type RealmBundleModule,
  type RealmPluginInstall,
  type RealmRegistry,
  sha256Hex,
  snapshotRealmRegistry,
} from './realm-plugins'

type Registrar = (registry: ComponentManager) => void

const Widget = (): null => null

function registryWithButton(): ComponentManager {
  const registry = new ComponentManager()
  registry.registerComponent(Widget as never, { $id: 'button', pluginId: 'mui' } as never)
  return registry
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyBase64 = Buffer.from(
  (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  'base64url',
).toString('base64')

/**
 * A signed install whose bundle, once "imported", runs `registrar` — the
 * bytes only have to hash and verify; `importModule` stands in for the import.
 */
async function signedInstall(
  listingId: string,
  identity: string | undefined,
): Promise<{ install: RealmPluginInstall; bytes: ArrayBuffer }> {
  const bytes = new TextEncoder().encode(`/* ${listingId} */`).buffer.slice(0) as ArrayBuffer
  const sha256 = await sha256Hex(bytes)
  const signature = nodeSign(null, Buffer.from(sha256, 'utf8'), privateKey).toString('base64')
  return {
    bytes,
    install: {
      listingId,
      version: '1.0.0',
      sha256,
      signature,
      trust: 'realm',
      ...(identity ? { identity } : {}),
    },
  }
}

async function load(
  registry: ComponentManager,
  bundles: Array<{ listingId: string; identity?: string; registrar: Registrar }>,
): Promise<string[]> {
  const byBytes = new Map<string, Registrar>()
  const installs: RealmPluginInstall[] = []
  const bodies = new Map<string, ArrayBuffer>()
  for (const bundle of bundles) {
    const { install, bytes } = await signedInstall(bundle.listingId, bundle.identity)
    installs.push(install)
    bodies.set(install.sha256, bytes)
    byBytes.set(install.sha256, bundle.registrar)
  }
  const errors: string[] = []
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  global.fetch = jest.fn(async (url: string) => {
    const sha = String(url).split('/').pop()?.replace(/\.[a-z]+$/, '') ?? ''
    const match = [...bodies.entries()].find(([key]) => String(url).includes(key))
    return {
      ok: Boolean(match),
      status: match ? 200 : 404,
      arrayBuffer: async () => match?.[1] ?? new ArrayBuffer(0),
      sha,
    }
  }) as never
  await loadRealmPlugins(installs, {
    artifactsBase: 'https://artifacts.example',
    publicKeyBase64,
    registry: registry as unknown as RealmRegistry,
    importModule: async (bytes): Promise<RealmBundleModule> => {
      const registrar = byBytes.get(await sha256Hex(bytes))
      return { register: () => registrar?.(registry) }
    },
  })
  return errors
}

afterEach(() => jest.restoreAllMocks())

describe('realmRegistrationProblems (AGL-3390)', () => {
  const identity = 'aglyn.calculator'
  const before = {
    factories: { button: Widget },
    schemas: { button: { pluginId: 'mui' } },
    presets: { p1: { pluginId: 'mui' } },
  }
  const withComponent = (id: string, pluginId?: string) => ({
    ...before,
    factories: { ...before.factories, [id]: Widget },
    schemas: { ...before.schemas, [id]: { pluginId } },
  })

  it('accepts components in its own namespace, under its identity', () => {
    expect(
      realmRegistrationProblems(before, withComponent('aglyn.calculator.scope', identity), {
        identity,
      }),
    ).toEqual([])
  })

  it('refuses a component that replaces or removes one already registered', () => {
    const replaced = { ...before, factories: { button: () => 'evil' } }
    expect(realmRegistrationProblems(before, replaced, { identity })).toEqual([
      'replaces component button',
    ])
    const removed = { ...before, factories: {}, schemas: {} }
    expect(realmRegistrationProblems(before, removed, { identity })).toEqual([
      'removes component button',
    ])
  })

  it("refuses another plugin's namespace, with or without an identity", () => {
    expect(
      realmRegistrationProblems(before, withComponent('acme.quote.scope', 'acme.quote'), {
        identity,
      }),
    ).toEqual(['registers acme.quote.scope outside its namespace'])
    expect(
      realmRegistrationProblems(before, withComponent('aglyn.calculator.scope'), {}),
    ).toEqual(['registers aglyn.calculator.scope outside its namespace'])
  })

  it('holds a plugin with an identity to namespaced ids and its own plugin id', () => {
    expect(
      realmRegistrationProblems(before, withComponent('countdown', identity), { identity }),
    ).toEqual(['registers countdown, which is not aglyn.calculator.<role>'])
    expect(
      realmRegistrationProblems(before, withComponent('aglyn.calculator.scope', 'mui'), {
        identity,
      }),
    ).toEqual(['registers aglyn.calculator.scope under another plugin id'])
  })

  it('lets a plugin published before identities add plain ids of its own', () => {
    expect(
      realmRegistrationProblems(before, withComponent('countdown', 'promo-countdown'), {}),
    ).toEqual([])
  })

  it('holds presets to the same rules', () => {
    const replaced = { ...before, presets: { p1: { pluginId: identity } } }
    expect(realmRegistrationProblems(before, replaced, { identity })).toEqual([
      'replaces preset p1',
    ])
    const foreign = { ...before, presets: { ...before.presets, p2: { pluginId: 'mui' } } }
    expect(realmRegistrationProblems(before, foreign, { identity })).toEqual([
      'registers preset p2 under another plugin id',
    ])
  })
})

describe('the loader undoes a bundle that breaks a rule (AGL-3390)', () => {
  it('keeps a bundle that registers in its own namespace', async () => {
    const registry = registryWithButton()

    const errors = await load(registry, [
      {
        listingId: 'listing-calc',
        identity: 'aglyn.calculator',
        registrar: (r) =>
          r.registerComponent(Widget as never, {
            $id: 'aglyn.calculator.scope',
            pluginId: 'aglyn.calculator',
          } as never),
      },
    ])

    expect(errors).toEqual([])
    // MobX wraps a stored function, so presence is what can be asserted.
    expect(registry.getFactory('aglyn.calculator.scope')).toBeDefined()
  })

  it('restores a platform component a bundle replaced, and drops the rest of it', async () => {
    const registry = registryWithButton()
    const original = registry.getFactory('button')

    const errors = await load(registry, [
      {
        listingId: 'listing-evil',
        identity: 'acme.evil',
        registrar: (r) => {
          r.registerComponent(Widget as never, {
            $id: 'acme.evil.scope',
            pluginId: 'acme.evil',
          } as never)
          r.registerComponent((() => 'evil') as never, {
            $id: 'button',
            pluginId: 'mui',
          } as never)
        },
      },
    ])

    expect(registry.getFactory('button')).toBe(original)
    expect(registry.getSchema('button')?.pluginId).toBe('mui')
    expect(registry.getFactory('acme.evil.scope')).toBeUndefined()
    expect(errors.join('\n')).toContain('replaces component button')
  })

  it("blames each bundle only for its own registrations when they load together", async () => {
    const registry = registryWithButton()
    const register = (id: string, identity: string): Registrar => (r) =>
      r.registerComponent(Widget as never, { $id: id, pluginId: identity } as never)

    const errors = await load(registry, [
      { listingId: 'l-1', identity: 'a.one', registrar: register('a.one.x', 'a.one') },
      { listingId: 'l-2', identity: 'b.two', registrar: register('b.two.y', 'b.two') },
    ])

    expect(errors).toEqual([])
    expect(registry.getFactory('a.one.x')).toBeDefined()
    expect(registry.getFactory('b.two.y')).toBeDefined()
  })

  it('takes a snapshot that does not move with the registry', () => {
    const registry = registryWithButton()
    const snapshot = snapshotRealmRegistry(registry as unknown as RealmRegistry)
    registry.unregisterComponent('button')
    expect('button' in snapshot.factories).toBe(true)
  })
})
