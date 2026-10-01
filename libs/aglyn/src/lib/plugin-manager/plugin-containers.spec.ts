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

import { listPluginOrgCollections } from './plugin-host-collections'
import { listPluginContainerKinds, pluginContainerKind } from './plugin-containers'

/**
 * The container kinds, as compiled from the plugins' declarations. Nothing
 * here names a kind: what is held is that every declared one is readable
 * where a picker will look for it.
 */

describe('declared container kinds', () => {
  it('answers null for a kind no plugin keeps', () => {
    expect(pluginContainerKind('no-such-kind')).toBeNull()
    expect(pluginContainerKind('')).toBeNull()
  })

  it('answers each declared kind by name, as a copy', () => {
    for (const row of listPluginContainerKinds()) {
      const found = pluginContainerKind(` ${row.kind} `)
      expect(found).toEqual(row)
      expect(found).not.toBe(row)
    }
  })

  it('stores each kind in an org collection its own plugin declares', () => {
    const owned = new Set(
      listPluginOrgCollections().map((collection) => `${collection.pluginId}/${collection.name}`),
    )
    for (const row of listPluginContainerKinds()) {
      expect(owned).toContain(`${row.pluginId}/${row.orgCollection}`)
    }
  })

  it('names what a picker calls one, several and where one is made', () => {
    for (const row of listPluginContainerKinds()) {
      expect(row.label.trim()).not.toBe('')
      expect(row.pluralLabel.trim()).not.toBe('')
      expect(row.ownerLabel.trim()).not.toBe('')
    }
  })
})
