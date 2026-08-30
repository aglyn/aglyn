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
 *  3. **The catalog entry.** This bundle registers site components, so a
 *     workspace that could switch it off would blank live pages; it is
 *     `alwaysOn` for that reason, and always-on is what excuses it from
 *     carrying a release flag.
 */

import {
  FIRST_PARTY_PLUGINS,
  PUBLISHED_SITE_IMPACT,
  resolveEnabledPlugins,
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

describe('forms is in the catalog as an always-on bundle', () => {
  const entry = FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === BUNDLE_ID)

  it('is listed at all', () => {
    expect(entry).toBeDefined()
  })

  it('is always-on, and therefore carries no release flag', () => {
    expect({
      alwaysOn: entry?.alwaysOn,
      releaseFlag: entry?.releaseFlag,
    }).toEqual({ alwaysOn: true, releaseFlag: undefined })
  })

  it('declares that switching it off would break published pages', () => {
    // It registers site components, so this is the honest verdict — and it is
    // the reason the switch is not offered.
    expect(PUBLISHED_SITE_IMPACT[BUNDLE_ID]).toBe('elements')
  })

  it('survives an org that has enumerated its plugins without it', () => {
    // The switchboard writes an explicit list. An always-on id is unioned back
    // in, so a workspace saved before this bundle existed still gets it.
    expect(resolveEnabledPlugins({ enabledPlugins: ['mui'] })).toContain(
      BUNDLE_ID,
    )
  })

  it('survives a SITE that names it in its deny-list', () => {
    // The per-site list is where a form would actually be lost: a site with
    // `disabledPlugins: ['forms']` would render a hole on the page holding its
    // contact form while `/api/forms/submit` kept answering.
    expect(
      subtractDisabledPlugins([BUNDLE_ID, 'commerce'], [BUNDLE_ID, 'commerce']),
    ).toEqual([BUNDLE_ID])
  })
})
