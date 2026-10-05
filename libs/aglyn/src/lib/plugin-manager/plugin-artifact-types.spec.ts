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
 * An installer never reads an empty registry as "nobody keeps this type"
 * (AGL-3080).
 *
 * The marketplace asks `resolveArtifactTypeOwner` before it publishes,
 * installs or updates a copy another plugin keeps. These cases hold the three
 * answers apart: nothing declared (`null`), declared and registered (the
 * owner), and declared but missing (the app's declarations step runs once
 * more, then a THROW), and they pin who may register what.
 *
 * The declarations are staged rather than read from the config, so the
 * registry's rules are held whatever the build declares.
 */

let mockDeclared: unknown = []

jest.mock('./first-party-plugins.generated', () => {
  const actual = jest.requireActual('./first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_ARTIFACT_TYPES_DECLARED() {
      return mockDeclared
    },
  }
})

import {
  artifactTypeOwner,
  ArtifactTypeOwnerUnavailableError,
  declaredArtifactTypeOwner,
  listDeclaredArtifactTypes,
  registerArtifactTypeOwner,
  resetArtifactTypeOwnersForTests,
  resolveArtifactTypeOwner,
  type PluginArtifactOwner,
} from './plugin-artifact-types'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'

const refused = { ok: false as const, status: 400, error: 'no' }

const stubOwner = (): PluginArtifactOwner => ({
  snapshot: async () => refused,
  admits: async () => null,
  prepare: async () => refused,
  locate: async () => refused,
})

beforeEach(() => {
  mockDeclared = [{ pluginId: 'acme', type: 'widgetKit' }]
  resetArtifactTypeOwnersForTests()
  resetPluginDeclarationsRepairForTests()
})

describe('the declared artifact types', () => {
  it('names each type with the plugin that keeps it', () => {
    expect(listDeclaredArtifactTypes()).toEqual([{ pluginId: 'acme', type: 'widgetKit' }])
    expect(declaredArtifactTypeOwner('widgetKit')).toEqual({ pluginId: 'acme', type: 'widgetKit' })
    expect(declaredArtifactTypeOwner('component')).toBeNull()
  })
})

describe('resolveArtifactTypeOwner', () => {
  it('answers null for a type no plugin declares, and asks nobody', async () => {
    const repair = jest.fn(async (): Promise<void> => undefined)
    registerPluginDeclarationsRepair(repair)
    await expect(resolveArtifactTypeOwner('component')).resolves.toBeNull()
    expect(repair).not.toHaveBeenCalled()
  })

  it('answers the registered owner', async () => {
    const owner = stubOwner()
    registerArtifactTypeOwner('widgetKit', owner, { pluginId: 'acme' })
    await expect(resolveArtifactTypeOwner('widgetKit')).resolves.toBe(owner)
  })

  it('THROWS when the declared owner is missing, rather than answering nobody', async () => {
    await expect(resolveArtifactTypeOwner('widgetKit')).rejects.toBeInstanceOf(
      ArtifactTypeOwnerUnavailableError,
    )
  })

  it('runs the app’s declarations step once more before refusing', async () => {
    const owner = stubOwner()
    const repair = jest.fn(async () => {
      registerArtifactTypeOwner('widgetKit', owner, { pluginId: 'acme' })
    })
    registerPluginDeclarationsRepair(repair)
    await expect(resolveArtifactTypeOwner('widgetKit')).resolves.toBe(owner)
    expect(repair).toHaveBeenCalledTimes(1)
  })

  it('still refuses when the declarations step itself fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDeclarationsRepair(async () => {
      throw new Error('boot failed')
    })
    await expect(resolveArtifactTypeOwner('widgetKit')).rejects.toBeInstanceOf(
      ArtifactTypeOwnerUnavailableError,
    )
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('registerArtifactTypeOwner', () => {
  it('refuses a type nobody declared', () => {
    expect(() =>
      registerArtifactTypeOwner('gadget', stubOwner(), { pluginId: 'acme' }),
    ).toThrow(/not declared/)
    expect(artifactTypeOwner('gadget')).toBeNull()
  })

  it('refuses an owner other than the plugin that declared the type', () => {
    expect(() =>
      registerArtifactTypeOwner('widgetKit', stubOwner(), { pluginId: 'other' }),
    ).toThrow(/declared by "acme"/)
    expect(artifactTypeOwner('widgetKit')).toBeNull()
  })

  it('refuses an owner with no plugin', () => {
    expect(() => registerArtifactTypeOwner('widgetKit', stubOwner())).toThrow(/no owner/)
  })

  it('lets the owner replace its own answers, and unregister only its own', () => {
    const first = registerArtifactTypeOwner('widgetKit', stubOwner(), { pluginId: 'acme' })
    const second = stubOwner()
    registerArtifactTypeOwner('widgetKit', second, { pluginId: 'acme' })
    first()
    expect(artifactTypeOwner('widgetKit')).toEqual({ pluginId: 'acme', owner: second })
  })
})
