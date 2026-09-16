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
 * WHAT A BUNDLE MOVE CAN BREAK WITHOUT BREAKING A RENDER.
 *
 * A canvas element that changes packages resolves either way — the renderer
 * looks a node up by `componentId` alone. Three other things do NOT follow it,
 * and each fails silently:
 *
 *  1. **The persisted component ids.** They are the same strings they always
 *     were, whichever package holds them, and renaming one orphans every node
 *     already saved under it.
 *  2. **The `pluginId` a preset stamps.** It is copied verbatim onto the node
 *     at insertion, and `requiredSitePlugins` reads it to decide which bundles
 *     load before first paint. A preset still naming the old bundle keeps
 *     minting nodes that render a beat late.
 *  3. **The catalog entry.** The catalog and the submissions already stored
 *     belong to the workspace, so the bundle is on for every workspace and
 *     carries no release flag; a site switches it off for itself, and core's
 *     submit route, publish check and published render all honor that switch
 *     through `FORMS_PLUGIN_ID` (AGL-3029).
 */

import {
  FIRST_PARTY_PLUGINS,
  FORMS_PLUGIN_ID,
  PUBLISHED_SITE_IMPACT,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
  subtractDisabledPlugins,
} from '@aglyn/aglyn'
import { formBlockPresets, formPresets } from './components/form'
import { BUNDLE_ID } from './constants/bundle-common'
import { FORMS_BUNDLE } from './plugin'

/** Persisted in screen documents; never rename without a data migration. */
const PERSISTED_COMPONENT_IDS = ['form', 'formField']

type PresetNode = {
  componentId?: string
  pluginId?: string
  nodes?: PresetNode[]
}

const walk = (node: PresetNode, visit: (node: PresetNode) => void) => {
  visit(node)
  for (const child of node.nodes ?? []) walk(child, visit)
}

describe('the forms bundle', () => {
  it('keeps the component ids that are already in screen documents', () => {
    expect(FORMS_BUNDLE.map((entry) => entry.schema.$id).sort()).toEqual(
      [...PERSISTED_COMPONENT_IDS].sort(),
    )
  })

  it('declares every schema under this bundle', () => {
    for (const entry of FORMS_BUNDLE) {
      expect({ id: entry.schema.$id, pluginId: entry.schema.pluginId }).toEqual({
        id: entry.schema.$id,
        pluginId: BUNDLE_ID,
      })
    }
  })

  it('registers no component id twice', () => {
    const ids = FORMS_BUNDLE.map((entry) => entry.schema.$id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every preset a unique id, namespaced by this bundle', () => {
    const presets = [...formPresets, ...formBlockPresets]
    const ids = presets.map((preset) => preset.$id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(String(id).startsWith(`${BUNDLE_ID}:`)).toBe(true)
  })
})

/**
 * THE ASSERTION THIS FILE EXISTS FOR.
 *
 * `pluginId` is written into a saved node from the preset literal and from
 * nowhere else — no registration step stamps it — so a preset that names the
 * wrong bundle is a data defect being minted on every insertion, and it is
 * invisible on the canvas. `booking` left `mui` with this unchecked and the
 * cost only appeared weeks later, when the render-narrowing path started
 * reading the field.
 */
describe('every node a forms preset places names the bundle that registers it', () => {
  const registered = new Set(FORMS_BUNDLE.map((entry) => entry.schema.$id))

  it('stamps this bundle on each of its OWN component nodes', () => {
    for (const preset of [...formPresets, ...formBlockPresets]) {
      walk(preset.data as PresetNode, (node) => {
        if (!registered.has(node.componentId as string)) return
        expect({
          preset: preset.displayName,
          componentId: node.componentId,
          pluginId: node.pluginId,
        }).toEqual({
          preset: preset.displayName,
          componentId: node.componentId,
          pluginId: BUNDLE_ID,
        })
      })
    }
  })

  it('THE CONTROL: it does NOT stamp this bundle on borrowed elements', () => {
    // Without this the rule above is satisfied by stamping `forms` on
    // everything, which would be the same defect pointed the other way: the
    // Contact Section's heading and stack are mui elements, and a page holding
    // one needs the MUI bundle in front of the render, not this one.
    const borrowed: string[] = []
    for (const preset of formBlockPresets) {
      walk(preset.data as PresetNode, (node) => {
        if (registered.has(node.componentId as string)) return
        borrowed.push(String(node.pluginId))
      })
    }
    expect(borrowed.length).toBeGreaterThan(0)
    expect(new Set(borrowed)).toEqual(new Set(['mui']))
  })

  it('never pre-assigns node ids — fresh ones are minted at insertion', () => {
    for (const preset of [...formPresets, ...formBlockPresets]) {
      walk(preset.data as PresetNode, (node) => {
        expect((node as { $id?: string | null }).$id ?? null).toBeNull()
      })
    }
  })
})

describe('forms is in the catalog, on for every workspace and switchable per site (AGL-3029)', () => {
  const entry = FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === BUNDLE_ID)

  it('is listed at all, under the id core names it by', () => {
    expect(entry).toBeDefined()
    expect(BUNDLE_ID).toBe(FORMS_PLUGIN_ID)
  })

  it('is on for every workspace, and therefore carries no release flag', () => {
    expect({
      alwaysOn: entry?.alwaysOn,
      alwaysOnForWorkspace: entry?.alwaysOnForWorkspace,
      releaseFlag: entry?.releaseFlag,
    }).toEqual({ alwaysOn: undefined, alwaysOnForWorkspace: true, releaseFlag: undefined })
  })

  it('declares that switching it off reaches published pages, and asks first', () => {
    expect(PUBLISHED_SITE_IMPACT[BUNDLE_ID]).toBe('elements')
    expect(entry?.siteOff?.confirm).toBe(true)
    expect(entry?.siteOff?.pages?.heading).toMatch(/stop rendering and stop accepting submissions/)
  })

  it('survives an org that has enumerated its plugins without it', () => {
    // The switchboard writes an explicit list. A workspace-locked id is
    // unioned back in, so a workspace saved before this bundle existed still
    // gets it.
    expect(resolveEnabledPlugins({ enabledPlugins: ['mui'] })).toContain(
      BUNDLE_ID,
    )
  })

  it('is on for a site whose document never switched it off', () => {
    for (const host of [undefined, {}, { disabledPlugins: ['commerce'] }]) {
      expect(resolveHostEnabledPlugins({ enabledPlugins: ['mui'] }, host)).toContain(BUNDLE_ID)
    }
  })

  it('is off for a SITE that names it in its deny-list', () => {
    // No hole behind the switch: the tenant stops drawing the form, the submit
    // route refuses it and publishing refuses to put one live, all from this
    // same answer.
    expect(
      subtractDisabledPlugins([BUNDLE_ID, 'commerce'], [BUNDLE_ID]),
    ).toEqual(['commerce'])
  })
})
