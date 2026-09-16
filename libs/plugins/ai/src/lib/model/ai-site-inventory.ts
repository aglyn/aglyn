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
 * CAPPED three times, and the three are different numbers on purpose
 * (AGL-2937). The reader holds each kind to `AI_SITE_INVENTORY_MAX_PER_KIND`;
 * the prompt block LISTS only `AI_SITE_INVENTORY_LISTED_PER_KIND` of them and
 * is held to `AI_SITE_INVENTORY_MAX_CHARS` besides; and the rest are answered
 * on request, through the lookup tool the generation loop offers beside every
 * door's own (`tools/ai-inventory-lookup-tool.ts`).
 *
 * The listing cap is what a prompt can afford: the block is volatile, so it
 * is billed at full input rate on every request and every re-ask, and a site
 * with two hundred components would spend most of a plan's prompt on rows it
 * will not use. The read cap is what a LOOKUP can answer from, which is a
 * different question — a search for "pricing card" is worth nothing if the
 * card was never read. A kind cut by either is named in `truncated`, so the
 * model is told more exist rather than concluding they do not.
 *
 * The shapes live here, apart from the reader (`runtime/site-inventory.ts`),
 * so the prompt block, the validators and their specs can hold an inventory
 * without loading the Admin SDK the reader needs.
 */

/**
 * Rows per kind the reader holds. Above the listing cap on purpose: the rows
 * past it are what the lookup tool searches, and a row never read cannot be
 * found. One projection of a few fields each, so the read is small even at
 * this cap.
 */
export const AI_SITE_INVENTORY_MAX_PER_KIND = 200

/** Rows per kind the prompt block lists; the rest are found by lookup. */
export const AI_SITE_INVENTORY_LISTED_PER_KIND = 40

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

/** One inventory record, whatever kind it is. */
export type AiInventoryRow =
  | AiInventoryComponent
  | AiInventoryLayout
  | AiInventoryTemplate
  | AiInventoryForm
  | AiInventoryDataset
  | AiInventoryCollection
  | AiInventoryScreen

/**
 * The rows of one kind. The inventory's fields are named after their kinds,
 * so this is a lookup rather than a switch, and it is the one place that
 * relies on the correspondence: the prompt block, the lookup tool and their
 * specs all read a kind through it.
 */
export function aiInventoryRows(
  inventory: AiSiteInventory,
  kind: AiInventoryKind,
): readonly AiInventoryRow[] {
  return inventory[kind]
}

/** The heading one kind's lines are listed under, naming its columns in order. */
export const AI_INVENTORY_KIND_HEADINGS: Readonly<Record<AiInventoryKind, string>> = {
  components: 'Reusable components (id \u00b7 name \u00b7 props an instance fills)',
  layouts: 'Layouts (id \u00b7 name)',
  templates: 'Templates (id \u00b7 name \u00b7 kind)',
  forms: 'Forms (id \u00b7 name \u00b7 fields)',
  datasets: 'Datasets (id \u00b7 name \u00b7 fields)',
  collections: 'Content collections (id \u00b7 name \u00b7 slug)',
  screens: 'Screens (id \u00b7 name \u00b7 slug)',
}

/**
 * One record as a line, in the order its heading names the columns. The one
 * renderer: the prompt block and the lookup tool's answer read alike, so a
 * row found by lookup is the same shape as a row that was listed.
 */
export function aiInventoryLine(kind: AiInventoryKind, row: AiInventoryRow): string {
  const head = `${row.id} \u00b7 ${row.name}`
  switch (kind) {
    case 'components': {
      const props = Object.entries((row as AiInventoryComponent).props)
        .map(([name, type]) => `${name}:${type}`)
        .join(', ')
      return `${head} \u00b7 ${props || 'no props'}`
    }
    case 'layouts':
      return head
    case 'templates':
      return `${head} \u00b7 ${(row as AiInventoryTemplate).kind}`
    case 'forms':
      return `${head} \u00b7 ${(row as AiInventoryForm).fields.join(', ')}`
    case 'datasets':
      return `${head} \u00b7 ${(row as AiInventoryDataset).fields.join(', ')}`
    case 'collections':
      return `${head} \u00b7 ${(row as AiInventoryCollection).slug}`
    case 'screens': {
      const screen = row as AiInventoryScreen
      return `${head} \u00b7 ${screen.slug}${screen.template ? ' \u00b7 entry template' : ''}`
    }
  }
}

/** Every word of a record a lookup searches: its line, which holds them all. */
export function aiInventoryHaystack(kind: AiInventoryKind, row: AiInventoryRow): string {
  return aiInventoryLine(kind, row).toLowerCase()
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
