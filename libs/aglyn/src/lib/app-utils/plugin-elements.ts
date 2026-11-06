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

import type {
  PluginCapabilities,
  PluginElementDeclaration,
  PluginPropSchema,
} from './plugin-manifest'

/**
 * WHAT A PLACED PLUGIN SHOWS IN THE EDITOR, APART FROM THE VALIDATOR (AGL-4201).
 *
 * These resolvers read a pinned install's declared props and elements. They
 * were in `plugin-manifest.ts`, and the mui plugin's site module calls
 * `resolvePluginElements` (its install-to-preset mapper), so every published
 * page loaded the whole manifest module, and with it every validator that
 * module imports. When the connections validator joined it (AGL-4193), every
 * published page grew by about 19 KB on the wire. They import only types from
 * the manifest, so a caller of these pays for these and nothing else.
 * The sandboxed element's component id lives here for the same reason.
 * `plugin-manifest.ts` re-exports all of it, so its API is unchanged.
 */

/** Component id of the sandboxed plugin canvas element (plugins-mui). */
export const PLUGIN_COMPONENT_ID = 'marketplacePlugin'

/** One editable setting on a placed plugin, resolved for the attributes panel. */
export interface PluginPropField {
  name: string
  type: NonNullable<PluginPropSchema['type']>
  label: string
  description?: string
  default?: string | number | boolean
  options?: Array<{ value: string; label?: string }>
}

/**
 * The settings an author may edit on a placed plugin (AGL-1049).
 *
 * Driven by `capabilities.props` — THE allowlist — and decorated by
 * `propSchema` where the publisher supplied one. That order is the whole
 * security property: the list of editable settings can never be longer than
 * the list of props that cross the bridge, whatever the schema says, so a
 * publisher cannot describe their way into a prop they did not declare.
 *
 * A plugin published before `propSchema` existed still gets a field per
 * declared prop, as plain text. That is the difference between guessing key
 * names in a JSON textarea and being shown them, and it needs no manifest
 * change to work — which matters, because every plugin installed today
 * predates this.
 */
export function resolvePluginPropFields(
  manifest: { capabilities?: PluginCapabilities } | null | undefined,
): PluginPropField[] {
  const props = manifest?.capabilities?.props ?? []
  const schema = new Map(
    (manifest?.capabilities?.propSchema ?? []).map((entry) => [
      entry.name,
      entry,
    ]),
  )
  return props.map((name) => {
    const declared = schema.get(name)
    return {
      name,
      type: declared?.type ?? 'string',
      label: declared?.label ?? name,
      ...(declared?.description ? { description: declared.description } : {}),
      ...(declared?.default !== undefined ? { default: declared.default } : {}),
      ...(declared?.options ? { options: declared.options } : {}),
    }
  })
}

/**
 * Keys an author has set that the plugin will silently ignore.
 *
 * The failure this exists to surface: `filterPluginProps` drops anything not
 * in the allowlist, so a typo does not fail — it just quietly does nothing,
 * which is the worst of the options. Naming the key is the whole fix.
 */
export function unknownPluginPropKeys(
  manifest: { capabilities?: PluginCapabilities } | null | undefined,
  values: Record<string, unknown> | null | undefined,
): string[] {
  if (!values) return []
  const allowed = new Set(manifest?.capabilities?.props ?? [])
  return Object.keys(values).filter((key) => !allowed.has(key))
}

/** A declared element, resolved for the palette. */
export interface PluginPaletteElement {
  listingId: string
  elementId: string
  displayName: string
  description?: string
  category: string
  /** mdi icon NAME; the surface looks it up, never renders it as markup. */
  icon?: string
  fields: PluginPropField[]
}

/**
 * The palette entries an installed plugin contributes (AGL-1031).
 *
 * Resolved from the PINNED install, which is what makes the two guarantees in
 * the issue hold without extra machinery: an element only appears where the
 * plugin is installed, and a revoked or downgraded version's elements vanish
 * with it, because the palette is rebuilt from whatever the pin now points at.
 *
 * Attributes come back through `resolvePluginPropFields`, so an element's
 * editable fields are bounded by `capabilities.props` exactly like the generic
 * plugin element's are. A declared element cannot widen what crosses the
 * bridge; it only gives the same props a better name and a better editor.
 */
export function resolvePluginElements(
  install:
    | {
        listingId?: string
        capabilities?: PluginCapabilities
        manifest?: { elements?: PluginElementDeclaration[] }
        elements?: PluginElementDeclaration[]
      }
    | null
    | undefined,
): PluginPaletteElement[] {
  const listingId = install?.listingId
  if (!listingId) return []
  const declared = install?.elements ?? install?.manifest?.elements ?? []
  const capabilities = install?.capabilities
  return declared.map((element) => ({
    listingId,
    elementId: element.id,
    displayName: element.displayName,
    ...(element.description ? { description: element.description } : {}),
    category: element.category ?? 'Data Display',
    ...(element.icon ? { icon: element.icon } : {}),
    // Per-element attributes when declared; otherwise the plugin's whole
    // declared prop set, which is still better than a JSON box.
    fields: element.attributes?.length
      ? resolvePluginPropFields({
          capabilities: {
            props: element.attributes.map((attribute) => attribute.name),
            propSchema: element.attributes,
          },
        })
      : resolvePluginPropFields({ capabilities }),
  }))
}
