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

import type { LinealDirectiveFlag } from '../foundation/definitions/components.types'

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
export type AiLinealOrder = [
  directiveType: `${LinealDirectiveFlag}`,
  directiveDefinition: string[] | { plugins?: string[]; components?: string[] },
]

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
  /** Length ceilings for `text` props, in characters. */
  textLimits: Record<string, number>
  /** Names of the presets that place this component. */
  presets: readonly string[]
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

/** Typography variants that read as headlines, for the `children` ceiling. */
export function isHeadlineVariant(variant: unknown): boolean {
  return typeof variant === 'string' && /^(display\w*|h[1-6]|heading)$/.test(variant)
}
