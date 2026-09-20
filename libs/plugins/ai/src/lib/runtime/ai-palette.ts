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

import type { JsonLinealOrder } from '@aglyn/aglyn/app-utils/lineal-order'

/**
 * The element palette as a model sees it (AGL-2905).
 *
 * `ai-palette.generated.ts` is produced from the registered plugin bundles by
 * `tools/scripts/generate-ai-palette.mts` and holds the data; this module
 * holds the shapes that data is typed against and the small readers over it,
 * so a regeneration never rewrites a type.
 */

/** The document kinds a model is asked to compose. */
export type AiSurface = 'screen' | 'email' | 'form' | 'layout' | 'component'

export const AI_SURFACE_NAMES: readonly AiSurface[] = [
  'screen',
  'email',
  'form',
  'layout',
  'component',
]

/**
 * The subset of JSON Schema a prop declaration is expressed in. Enough to
 * validate what an attribute field can persist; nothing the field editor
 * cannot itself model.
 */
export interface AiPropSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean'
  enum?: readonly string[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  description?: string
}

export interface AiPropsSchema {
  type: 'object'
  properties: Record<string, AiPropSchema>
  required: readonly string[]
  additionalProperties: false
}

/**
 * What a string prop MEANS, which decides how the validator checks it.
 *
 * - `text` — copy the visitor reads; held to a length ceiling.
 * - `url` — a navigable address: an `https:` URL or a root-relative path.
 * - `screen` — a screen id, checked against the screens the host has.
 * - `media` — an image or video source: a DAM reference or an `https:` URL.
 */
export type AiPropRole = 'text' | 'url' | 'screen' | 'media'

/**
 * A `restrictChildren` / `restrictParent` directive as generated data: the
 * same tuple the schema declares, with the flag spelled as the string the
 * enum holds so a JSON emitter can write it.
 */
export type AiLinealOrder = JsonLinealOrder

export interface AiPaletteEntry {
  pluginId: string
  kind: 'element' | 'plaintext' | 'markdown'
  category: string
  displayName: string
  /** One sentence, from the schema's own description. */
  summary: string
  /** Whether the editor lets anything be dropped inside this element. */
  acceptsChildren: boolean
  restrictChildren?: AiLinealOrder
  restrictParent?: AiLinealOrder
  propsSchema: AiPropsSchema
  /** Roles of the string props the validator treats specially. */
  propRoles: Record<string, AiPropRole>
  /**
   * The attribute field kind each declared prop is edited with, as its
   * `FieldComponentType` value (`switch`, `select`, `screen-select`, …): what
   * the editor reads to decide which component properties a field can be
   * bound to (AGL-2908).
   */
  propFields: Record<string, string>
  /** Length ceilings for `text` props, in characters. */
  textLimits: Record<string, number>
  /** Names of the presets that place this component. */
  presets: readonly string[]
}

/**
 * What every NODE can do, as against what one component declares (AGL-3156).
 *
 * Generated from the node capabilities core declares, beside the per-component
 * schemas rather than out of them: repeating is not a Stack's feature, so no
 * component schema names it and a palette built from schemas alone advertises
 * it on nothing. Declared ONCE for the whole palette — a model may write these
 * props on any element the surface allows.
 */
export interface AiNodeCapability {
  /** Stable id, as core declares it. */
  id: string
  displayName: string
  /** One sentence, for the prompt catalog. */
  summary: string
  propsSchema: AiPropsSchema
  propRoles: Record<string, AiPropRole>
  propFields: Record<string, string>
  textLimits: Record<string, number>
  /** Props offered only on a node that holds a child list. */
  childrenOnlyProps: readonly string[]
  /**
   * Declared attributes the palette deliberately does not offer: a picker
   * that chooses a record the site holds, which a model cannot name from a
   * description. Recorded so a field left off on purpose reads differently
   * from one that went missing.
   */
  omittedProps: readonly string[]
}

/**
 * The capability props a node with this child contract may carry, merged into
 * one map the prop sanitizer can read beside the element's own declarations.
 */
export function nodeCapabilityProps(
  capabilities: Readonly<Record<string, AiNodeCapability>>,
  acceptsChildren: boolean,
): {
  properties: Record<string, AiPropSchema>
  propRoles: Record<string, AiPropRole>
  textLimits: Record<string, number>
} {
  const properties: Record<string, AiPropSchema> = {}
  const propRoles: Record<string, AiPropRole> = {}
  const textLimits: Record<string, number> = {}
  for (const capability of Object.values(capabilities)) {
    for (const [name, schema] of Object.entries(
      capability.propsSchema.properties,
    )) {
      if (!acceptsChildren && capability.childrenOnlyProps.includes(name))
        continue
      properties[name] = schema
      const role = capability.propRoles[name]
      if (role) propRoles[name] = role
      const limit = capability.textLimits[name]
      if (limit !== undefined) textLimits[name] = limit
    }
  }
  return { properties, propRoles, textLimits }
}

/**
 * What a node capability declared in core and one carried by the palette
 * disagree about (AGL-3156).
 *
 * `check:ai-palette` pins the generated file to the generator's output for its
 * inputs, which cannot notice a capability leaving those inputs: when repeat
 * stopped being a component's attribute, the generator regenerated cleanly and
 * the palette simply stopped mentioning it. This reads the core declarations
 * instead and asks whether the palette still accounts for each one, so the
 * next generic capability cannot vanish the same way.
 *
 * `offeredFieldKinds` is every field kind the palette DOES carry somewhere,
 * derived from the generated entries rather than restated here: a capability
 * attribute drawn with one of those kinds has no excuse for being omitted.
 */
export function auditNodeCapabilities(
  declared: ReadonlyArray<{
    id: string
    label: string
    attributes: ReadonlyArray<{ name: string; component: string }>
  }>,
  carried: Readonly<Record<string, AiNodeCapability>>,
  offeredFieldKinds: ReadonlySet<string>,
): string[] {
  const problems: string[] = []
  for (const capability of declared) {
    const entry = carried[capability.id]
    if (!entry) {
      problems.push(
        `the palette carries no node capability "${capability.id}": a model cannot use it at all`,
      )
      continue
    }
    if (!Object.keys(entry.propsSchema.properties).length) {
      problems.push(
        `node capability "${capability.id}" is carried with no prop a model can write`,
      )
    }
    for (const attribute of capability.attributes) {
      if (entry.propsSchema.properties[attribute.name]) continue
      if (!entry.omittedProps.includes(attribute.name)) {
        problems.push(
          `node capability "${capability.id}" declares "${attribute.name}", which the palette neither offers nor records as omitted`,
        )
        continue
      }
      if (offeredFieldKinds.has(attribute.component)) {
        problems.push(
          `node capability "${capability.id}" omits "${attribute.name}", whose "${attribute.component}" field the palette offers elsewhere`,
        )
      }
    }
  }
  for (const id of Object.keys(carried)) {
    if (!declared.some((capability) => capability.id === id)) {
      problems.push(
        `the palette carries node capability "${id}", which core no longer declares`,
      )
    }
  }
  return problems
}

export interface AiSurfaceDefinition {
  /** The component id at the top of a tree for this surface. */
  root: string
  /** Every component id a node in this surface may carry. */
  allow: readonly string[]
}

/**
 * Theme vocabulary an `sx` value may name, read off the theme sources so the
 * validator's allowlist is derived rather than typed by hand.
 */
export interface AiSxTokens {
  /** Dotted palette paths such as `primary.main`. */
  palette: readonly string[]
  /** Responsive object keys. */
  breakpoints: readonly string[]
  /** Values `typography` may take. */
  typographyVariants: readonly string[]
}

/**
 * Text ceilings per role of copy (AGL-2905). A headline is one line of a
 * hero, body copy is a paragraph or two, and a button label has to fit a
 * button.
 */
export const AI_TEXT_LIMITS = {
  headline: 120,
  body: 2_000,
  button: 40,
  /** A short label, title or caption. */
  label: 200,
} as const

/**
 * Prompt budget per surface catalog, in characters at four per token.
 * Asserted by a spec so a component that grows its description cannot
 * silently push a system prompt past what the route pays for.
 */
export const AI_PALETTE_CATALOG_MAX_TOKENS = 2_500
export const AI_PALETTE_CATALOG_MAX_CHARS = AI_PALETTE_CATALOG_MAX_TOKENS * 4

/** The model's own token estimate: characters over four. */
export function estimateCatalogTokens(catalog: string): number {
  return Math.ceil(catalog.length / 4)
}

/**
 * The documents a generator emits (AGL-2935). Each is composed on one
 * surface of the palette and held to its own budget below.
 */
export type AiOutputKind =
  | 'page'
  | 'template'
  | 'component'
  | 'layout'
  | 'form'
  | 'email'

export const AI_OUTPUT_KINDS: readonly AiOutputKind[] = [
  'page',
  'template',
  'component',
  'layout',
  'form',
  'email',
]

/** The surface each output kind is composed on. */
export const AI_OUTPUT_SURFACE: Record<AiOutputKind, AiSurface> = {
  page: 'screen',
  template: 'screen',
  component: 'component',
  layout: 'layout',
  form: 'form',
  email: 'email',
}

/**
 * What the rule-17 scorer measures on an emitted tree:
 *
 * - `nodes` — how many elements the tree carries;
 * - `bytes` — the stored node map, in the unit the save ceiling uses
 *   (`nodeMapBytes`, msgpack);
 * - `imageBytes` — what the placed library images request at the slot's
 *   variant, from each asset's recorded size;
 * - `embeds` — third-party players and frames the output loads;
 * - `fontFamilies` — families named beyond the theme's own;
 * - `emailHtmlBytes` — an email's rendered HTML, which is what a mail
 *   client clips.
 */
export type AiBudgetMetric =
  | 'nodes'
  | 'bytes'
  | 'imageBytes'
  | 'embeds'
  | 'fontFamilies'
  | 'emailHtmlBytes'

export type AiOutputBudget = Record<Exclude<AiBudgetMetric, 'emailHtmlBytes'>, number> & {
  emailHtmlBytes?: number
}

/**
 * The size past which Gmail clips a message and hides the rest behind a
 * "View entire message" link — the unsubscribe footer included.
 */
export const AI_EMAIL_CLIP_BYTES = 102_000

/**
 * The budget per output kind (AGL-2935, rule 17), beside the catalog budget
 * above for the same reason: a generator that grows its output past what
 * its kind is for is caught by a number, not noticed by a reader.
 *
 * A page is a few hundred elements and tens of kilobytes of stored map; a
 * reusable component is one repeated block; a layout is the chrome every
 * page loads, so it carries the least imagery; a form is fields and a
 * button; an email is held to the clipping threshold on its rendered HTML.
 * No kind names a font beyond the theme's.
 */
export const AI_OUTPUT_BUDGETS: Record<AiOutputKind, AiOutputBudget> = {
  page: {
    nodes: 400,
    bytes: 60_000,
    imageBytes: 1_500_000,
    embeds: 1,
    fontFamilies: 0,
  },
  template: {
    nodes: 400,
    bytes: 60_000,
    imageBytes: 1_500_000,
    embeds: 1,
    fontFamilies: 0,
  },
  component: {
    nodes: 80,
    bytes: 12_000,
    imageBytes: 500_000,
    embeds: 1,
    fontFamilies: 0,
  },
  layout: {
    nodes: 160,
    bytes: 24_000,
    imageBytes: 200_000,
    embeds: 0,
    fontFamilies: 0,
  },
  form: {
    nodes: 60,
    bytes: 8_000,
    imageBytes: 0,
    embeds: 0,
    fontFamilies: 0,
  },
  email: {
    nodes: 150,
    bytes: 24_000,
    imageBytes: 1_000_000,
    embeds: 0,
    fontFamilies: 0,
    emailHtmlBytes: AI_EMAIL_CLIP_BYTES,
  },
}

/**
 * What a first visit to a generated output is estimated to transfer — the
 * weight the proposal shows before anything is applied (rule 17). A page
 * starts from the platform's measured page weight; a component or a layout
 * reports only what it adds to a page; an email is not a page load.
 */
export interface AiLoadEstimate {
  /** The measured weight of a published page before this output's own bytes; 0 for a fragment. */
  pageBytes: number
  /** The stored node map, in the save's own bytes. */
  documentBytes: number
  /** What the placed library images request at their slots. */
  imageBytes: number
  /** Images the estimate could not size: no recorded size, or not from the library. */
  imagesUnmeasured: number
  embeds: number
  totalBytes: number
}

/** Typography variants that read as headlines, for the `children` ceiling. */
export function isHeadlineVariant(variant: unknown): boolean {
  return typeof variant === 'string' && /^(display\w*|h[1-6]|heading)$/.test(variant)
}
