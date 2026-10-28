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

import { NODE_MAX_INTERACTIONS } from './node-interactions'
import {
  PORTABLE_COMPONENT_ID_ALLOWLIST,
  PORTABLE_DEFINITION_MAX_BYTES,
  sanitizePortableDefinition,
  type PortableDefinitionNodes,
} from './node-definition-sanitizer'
import { isSafeNodeUrl } from './node-url-policy'
import { CLIENT_INTERACTION_STEP_LABELS } from './site-interactions'

/**
 * What a site starter's pages and layout may hold (AGL-4049), and the one
 * pass that makes them so.
 *
 * A starter is a whole site, so it has to carry what a real site is made of:
 * the grids, cards, accordions and icons the default site is built from and
 * the AI site build lays out, with their styles and their interactions. The
 * portable rule every other artifact is published under keeps none of that —
 * it is for a component dropped into someone else's page — so a starter gets
 * its own allowlist here, a superset of the portable one, and keeps `sx` and
 * `interactions` once they are checked. Nothing else is widened: the template,
 * layout and component doors still publish under the portable rule.
 *
 * Kept safe the same way, plus two checks of its own:
 *   - only the component ids below, nothing bound to the source site's data
 *     (content collections, datasets) or to another plugin;
 *   - the portable prop hardening (no `on*`, no `dangerouslySetInnerHTML`, an
 *     `href`/`src` only to a safe address) and the size cap;
 *   - a style may load an image only from where an image `src` may, and never
 *     from a protocol-relative address;
 *   - an interaction may only scroll, show, hide, open, close, toggle a class,
 *     stick the navigation or play a video: no script, markup, redirect or
 *     tracking rides a starter onto the sites created from it.
 *
 * The publish door runs every page and the layout through
 * {@link sanitizeSiteStarterNodes}; the first-party seed holds its pages to the
 * same pass, so a seeded and a published starter store one shape. Pure.
 */

/**
 * The component ids a starter's pages may hold: the portable allowlist, what
 * `default-site.ts` builds, and the presentational elements the AI site build
 * lays out (its palette's page surface, less anything bound to a site's data).
 */
export const SITE_STARTER_COMPONENT_IDS: readonly string[] = [
  ...new Set([
    ...PORTABLE_COMPONENT_ID_ALLOWLIST,
    // The default site (`default-site.ts`).
    'icon',
    'muiAccordion',
    'muiAccordionDetails',
    'muiAccordionSummary',
    'muiCard',
    'muiCardContent',
    'muiGrid',
    'themeModeSwitcher',
    // The AI site build's presentational elements.
    'dataTable',
    'muiBox',
    'muiBreadcrumbs',
    'muiCardActions',
    'muiCardHeader',
    'muiImageList',
    'muiImageListItem',
    'video',
  ]),
].sort()

/** The node marking where a page's content grafts into its layout. */
export const SITE_STARTER_LAYOUT_SLOT_ID = 'layoutSlot'

/** A starter's layout may hold the same, plus the slot its pages render in. */
export const SITE_STARTER_LAYOUT_COMPONENT_IDS: readonly string[] = [
  ...SITE_STARTER_COMPONENT_IDS,
  SITE_STARTER_LAYOUT_SLOT_ID,
].sort()

/**
 * The interaction steps a starter may carry: each acts on the page it is on
 * and nothing else. Scripts, markup, redirects, attributes, alerts, popups and
 * analytics are left out, as is every step a plugin declares.
 */
export const SITE_STARTER_INTERACTION_STEP_TYPES: ReadonlySet<string> = new Set([
  'addClass',
  'closeDrawer',
  'closeMenu',
  'hideElement',
  'openDrawer',
  'openMenu',
  'playVideo',
  'removeClass',
  'scrollTo',
  'showElement',
  'stickyNav',
  'toggleClass',
  'toggleDrawer',
  'toggleElement',
  'toggleMenu',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** How a refusal names a node: its component, then its id. */
const nodeName = (id: string, node: Record<string, any>) =>
  `the ${String(node?.componentId ?? 'element')} "${id}"`

const stepLabel = (type: string): string =>
  (CLIENT_INTERACTION_STEP_LABELS as Readonly<Record<string, string>>)[type] ?? type

/** Every `url(…)` address in a style value. */
const styleUrls = (value: string): string[] =>
  [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2].trim())

/** Why a node's styles cannot ride a starter, or null when they can. */
function styleRefusal(id: string, node: Record<string, any>, sx: unknown, depth = 0): string | null {
  if (depth > 12) return `The styles on ${nodeName(id, node)} are nested too deeply`
  if (typeof sx === 'string') {
    if (/url\(/i.test(sx) && !styleUrls(sx).length) {
      return `A style on ${nodeName(id, node)} loads an address a starter cannot read`
    }
    for (const address of styleUrls(sx)) {
      if (address.startsWith('//') || !isSafeNodeUrl('src', address)) {
        return `A style on ${nodeName(id, node)} loads "${address.slice(0, 120)}", which a starter cannot carry`
      }
    }
    return null
  }
  if (sx === null || typeof sx === 'number' || typeof sx === 'boolean') return null
  if (Array.isArray(sx)) {
    for (const entry of sx) {
      const refusal = styleRefusal(id, node, entry, depth + 1)
      if (refusal) return refusal
    }
    return null
  }
  if (isRecord(sx)) {
    for (const entry of Object.values(sx)) {
      const refusal = styleRefusal(id, node, entry, depth + 1)
      if (refusal) return refusal
    }
    return null
  }
  return `The styles on ${nodeName(id, node)} hold something that is not a style`
}

/** Why a node's interactions cannot ride a starter, or null when they can. */
function interactionsRefusal(id: string, node: Record<string, any>, interactions: unknown): string | null {
  if (!Array.isArray(interactions)) return `The interactions on ${nodeName(id, node)} are not a list`
  if (interactions.length > NODE_MAX_INTERACTIONS) {
    return `${nodeName(id, node)} has more than ${NODE_MAX_INTERACTIONS} interactions`
  }
  for (const interaction of interactions) {
    if (!isRecord(interaction) || !Array.isArray(interaction['steps'])) {
      return `An interaction on ${nodeName(id, node)} is not one`
    }
    for (const step of interaction['steps'] as unknown[]) {
      const type = isRecord(step) && typeof step['type'] === 'string' ? step['type'] : ''
      if (!SITE_STARTER_INTERACTION_STEP_TYPES.has(type)) {
        return (
          `An interaction on ${nodeName(id, node)} runs "${stepLabel(type || 'an unknown step')}", ` +
          'which a starter cannot carry: a starter brings no scripts, markup, redirects or ' +
          'tracking to the sites created from it'
        )
      }
    }
  }
  return null
}

/** A starter's node as stored: a portable node, with its checked styles and interactions. */
export type SiteStarterNodes = Record<
  string,
  PortableDefinitionNodes[string] & { sx?: unknown; interactions?: unknown[] }
>

/** A JSON copy, so a stored starter never shares an object with its source. */
const copied = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * A starter page's or layout's nodes as a starter stores them, or why they
 * cannot be: the portable pass under {@link SITE_STARTER_COMPONENT_IDS} (or
 * the layout list), then each kept node's checked `sx` and `interactions`
 * put back. Callers decode stored nodes first (`decodeStoredNodes`).
 */
export function sanitizeSiteStarterNodes(
  definition: { rootId: string; nodes: Record<string, any> },
  options: {
    /** A layout: the slot its pages render in is allowed too. */
    layout?: boolean
    /** The properties a layout's tree binds to, as `sanitizePortableDefinition` takes them. */
    declaredProps?: ReadonlyArray<{ name?: unknown; type?: unknown }>
  } = {},
): { ok: true; rootId: string; nodes: SiteStarterNodes } | { ok: false; error: string } {
  const portable = sanitizePortableDefinition(definition, {
    componentIds: options.layout ? SITE_STARTER_LAYOUT_COMPONENT_IDS : SITE_STARTER_COMPONENT_IDS,
    ...(options.declaredProps && { declaredProps: options.declaredProps }),
  })
  if (portable.ok === false) return portable
  const nodes: SiteStarterNodes = {}
  for (const [id, kept] of Object.entries(portable.nodes)) {
    const source = definition.nodes[id] ?? {}
    const node: SiteStarterNodes[string] = { ...kept }
    if (source.sx !== undefined && source.sx !== null) {
      const refusal = styleRefusal(id, source, source.sx)
      if (refusal) return { ok: false, error: refusal }
      node['sx'] = copied(source.sx)
    }
    if (source.interactions !== undefined && source.interactions !== null) {
      const refusal = interactionsRefusal(id, source, source.interactions)
      if (refusal) return { ok: false, error: refusal }
      if ((source.interactions as unknown[]).length) node['interactions'] = copied(source.interactions)
    }
    nodes[id] = node
  }
  if (JSON.stringify(nodes).length > PORTABLE_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Definition is too large to publish' }
  }
  return { ok: true, rootId: portable.rootId, nodes }
}
