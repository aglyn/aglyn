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
  ArtifactTypeOwnerUnavailableError,
  artifactTypeOwner,
  listDeclaredArtifactTypes,
  resetArtifactTypeOwnersForTests,
  resolveArtifactTypeOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-types'

/**
 * EVERY DECLARED ARTIFACT TYPE HAS ITS OWNER IN THIS CONSOLE'S SERVER
 * (AGL-3080).
 *
 * The marketplace publishes, installs and updates a dataset schema by asking
 * the plugin that keeps datasets (`plugin-manager/plugin-artifact-types`).
 * The owner registers from its plugin's `consoleServerDeclarations` entry and
 * is declared in `plugins.config.json` too, so a boot that skipped it refuses
 * every install of the type instead of reading it as a type nobody keeps.
 * This is the spec that finds out if boot stopped registering one.
 *
 * ⚑ It runs THIS APP'S OWN boot manifest and never imports a plugin: an app
 * may not depend on one.
 *
 * ⛔ The boot runs ONCE and the answers are captured around it: the manifest
 * memoizes, so a reset between tests would leave later ones asserting against
 * a boot that never runs again.
 */

import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'

/** Each type this console's marketplace sells and another plugin keeps. */
const KEPT: Record<string, string> = {
  datasetSchema: 'data',
}

let ownersBeforeBoot: Array<string | null>
let refusalBeforeBoot: unknown
let ownersAfterBoot: Record<string, ReturnType<typeof artifactTypeOwner>>

beforeAll(async () => {
  resetArtifactTypeOwnersForTests()
  ownersBeforeBoot = Object.keys(KEPT).map((type) => artifactTypeOwner(type)?.pluginId ?? null)
  refusalBeforeBoot = await resolveArtifactTypeOwner('datasetSchema').catch(
    (error: unknown) => error,
  )
  await registerPluginServerDeclarations()
  ownersAfterBoot = Object.fromEntries(
    listDeclaredArtifactTypes().map((declared) => [declared.type, artifactTypeOwner(declared.type)]),
  )
})

describe('the plugins that keep the artifact types, in this console', () => {
  it('THE CONTROL: with boot not run, a declared type refuses rather than answering nobody', () => {
    expect(ownersBeforeBoot).toEqual(Object.keys(KEPT).map(() => null))
    expect(refusalBeforeBoot).toBeInstanceOf(ArtifactTypeOwnerUnavailableError)
  })

  it('declares exactly the types this console expects, each by its plugin', () => {
    expect(
      Object.fromEntries(listDeclaredArtifactTypes().map((declared) => [declared.type, declared.pluginId])),
    ).toEqual(KEPT)
  })

  it.each(Object.entries(KEPT))('registers %s at boot, from %s', (type, pluginId) => {
    const registered = ownersAfterBoot[type]
    expect(registered?.pluginId).toBe(pluginId)
    for (const answer of ['snapshot', 'admits', 'prepare', 'locate'] as const) {
      expect(typeof registered?.owner[answer]).toBe('function')
    }
  })
})
