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
 * The site's inventory as a model sees it (AGL-2935): what the site already
 * has, so a plan reuses before it creates (doctrine rule 7).
 *
 * COMPACT by construction (AGL-2937): ids, names, prop shapes and slugs —
 * never a node tree, never a record's content. A component is its name and
 * the props an instance fills in; a form is its field names; a dataset its
 * field names. That is everything a planner needs to decide "reuse this"
 * and a generator needs to place a reference, and it is a few hundred
 * tokens where the trees would be tens of thousands.
 *
 * CAPPED twice. The reader takes each kind to `AI_SITE_INVENTORY_MAX_PER_KIND`
 * and the prompt block is held to `AI_SITE_INVENTORY_MAX_CHARS`; a kind cut
 * by either is named in `truncated`, so the model is told more exist rather
 * than concluding they do not.
 *
 * The shapes live here, apart from the reader (`runtime/site-inventory.ts`),
 * so the prompt block, the validators and their specs can hold an inventory
 * without loading the Admin SDK the reader needs.
 */

export const AI_SITE_INVENTORY_MAX_PER_KIND = 40

/** The rendered block's ceiling: 2,000 tokens at four characters a token. */
export const AI_SITE_INVENTORY_MAX_CHARS = 8_000

export type AiInventoryKind =
  | 'components'
  | 'layouts'
  | 'templates'
  | 'forms'
  | 'datasets'
  | 'collections'
  | 'screens'

export const AI_INVENTORY_KINDS: readonly AiInventoryKind[] = [
  'components',
  'layouts',
  'templates',
  'forms',
  'datasets',
  'collections',
  'screens',
]

/**
 * A reusable component's declared props as an instance may fill them: prop
 * name → its declared type (`text`, `image`, `href`, `number`, `boolean`, …).
 */
export type AiComponentPropTypes = Record<string, string>

export interface AiInventoryComponent {
  id: string
  name: string
  /** The props an instance fills in: name → declared type. */
  props: AiComponentPropTypes
}

export interface AiInventoryLayout {
  id: string
  name: string
  /** The layout this one nests inside, when it nests. */
  parentId: string | null
}

export interface AiInventoryTemplate {
  id: string
  name: string
  kind: string
}

export interface AiInventoryForm {
  id: string
  name: string
  fields: string[]
}

export interface AiInventoryDataset {
  id: string
  name: string
  fields: string[]
}

export interface AiInventoryCollection {
  id: string
  name: string
  slug: string
}

export interface AiInventoryScreen {
  id: string
  name: string
  slug: string
  layoutId: string | null
  /** A collection's entry template rather than a page of its own. */
  template: boolean
}

/**
 * The site's one theme, as a planner and the email rule read it: a short
 * description, the light scheme's colors by palette path, and the families
 * the theme loads.
 */
export interface AiInventoryTheme {
  summary: string[]
  colors: Record<string, string>
  fonts: string[]
}

export interface AiSiteInventory {
  hostId: string
  components: AiInventoryComponent[]
  layouts: AiInventoryLayout[]
  templates: AiInventoryTemplate[]
  forms: AiInventoryForm[]
  datasets: AiInventoryDataset[]
  collections: AiInventoryCollection[]
  screens: AiInventoryScreen[]
  theme: AiInventoryTheme | null
  /** Kinds with more records than are listed. */
  truncated: AiInventoryKind[]
}

/** A site the org does not own; the inventory is never read for it. */
export class AiInventoryScopeError extends Error {
  constructor(hostId: string) {
    super(`host ${hostId} is not a site of the workspace that asked`)
    this.name = 'AiInventoryScopeError'
  }
}

export function emptyAiSiteInventory(hostId: string): AiSiteInventory {
  return {
    hostId,
    components: [],
    layouts: [],
    templates: [],
    forms: [],
    datasets: [],
    collections: [],
    screens: [],
    theme: null,
    truncated: [],
  }
}
