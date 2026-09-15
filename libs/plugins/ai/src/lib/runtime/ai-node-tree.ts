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
  AI_TEXT_LIMITS,
  isHeadlineVariant,
  type AiPaletteEntry,
  type AiPropSchema,
  type AiSurface,
} from './ai-palette'
import {
  AI_PALETTE,
  AI_SURFACES,
  AI_SX_TOKENS,
} from './ai-palette.generated'
import { linealRelationshipPermits } from '@aglyn/aglyn/app-utils/lineal-order'
import {
  NODE_MAP_MAX_BYTES,
  nodeMapBytes,
} from '@aglyn/aglyn/app-utils/measure-node-map'
import { parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import {
  COMPONENT_PROP_NAME_PATTERN,
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import { createIdUrlSafe } from '@aglyn/aglyn/foundation/constants/app'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { NodeType, type NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiComponentPropTypes } from '../model/ai-site-inventory'

import { sanitizeMarketplaceDefinition } from '@aglyn/aglyn/app-utils/node-definition-sanitizer'

/**
 * The one path an AI-emitted node tree takes into storage (AGL-2905).
 *
 * A model answers with a flat node map in the shape the canvas persists.
 * Nothing about that map is trusted: the component ids, the parent/child
 * pairs, every prop and every `sx` key are what the model chose to write,
 * and the renderer spreads props onto the DOM. So the tree is first held to
 * the same sanitizer a marketplace install passes — reachability from the
 * root, the surface's component allowlist, the persisted node keys, `href`
 * and `src` protocols, a size cap — and then to what a listing never needed
 * checking because a human authored it in the editor:
 *
 * - the parent/child restrictions the besigner enforces on drop
 *   (`restrictChildren` / `restrictParent`), and whether an element can hold
 *   children at all;
 * - every prop against the generated palette's schema — unknown props are
 *   dropped, enum values coerced case-insensitively, a required prop that is
 *   missing refuses the tree;
 * - `sx` against a fixed key set and a value grammar of theme tokens, numbers
 *   and CSS lengths or keywords, with nothing that can reach a URL or a
 *   stylesheet;
 * - copy length by role — a headline, a paragraph, a button label;
 * - links to a screen the host has, a root-relative path or an `https:` URL,
 *   and media to a DAM reference or an `https:` URL;
 * - the stored-node-map byte ceiling, measured the way the save measures it.
 *
 * ## The site's own records, when the caller names them (AGL-2935)
 *
 * A reusable-component instance, a form picked on the Forms page and a
 * dataset are each "a reference into another document", which is why the
 * palette leaves them off: from a description alone a model can only invent
 * an id. A generator that has read the site's inventory can name real ones,
 * and the building doctrine requires it to — a repeat is placed as
 * instances of one component, and a form is bound by id rather than drawn
 * inline. So the three are admitted exactly as screen links are: only
 * against the ids the caller supplies. With no `componentIds` an instance is
 * still refused; with no `formIds` or `datasetIds` the binding is dropped.
 *
 * What comes out is the flat `NodesMap` `encodeStoredNodes` takes, with every
 * id minted fresh the way a preset graft mints them, so nothing the model
 * wrote can collide with a node already on the canvas. `sourceIds` maps each
 * minted id back to the id the model wrote, so a caller can quote a refused
 * subtree in the model's own words. Every drop is listed in `repairs`; every
 * refusal names its `code`. The function never throws.
 */

export type AiNodeTreeRefusalCode =
  /** Not an object with a `rootId` and a `nodes` map, or an unknown surface. */
  | 'invalid-input'
  /** The root node carries a component the surface does not start with. */
  | 'root'
  /** A structural failure the sanitizer named: missing node, empty tree. */
  | 'structure'
  /** A component id outside the surface's allowlist. */
  | 'component'
  /** A parent/child pair the besigner would refuse on drop. */
  | 'lineage'
  /** A prop the palette marks required is absent. */
  | 'required-prop'
  /** Over the sanitizer's or the stored-node-map's byte ceiling. */
  | 'too-large'
  /** A component instance naming a component the site does not have. */
  | 'reference'

export type AiNodeTreeResult =
  | {
      ok: true
      rootId: string
      nodes: NodesMap
      repairs: string[]
      /** Each minted id → the id the model wrote for that node. */
      sourceIds: Record<string, string>
    }
  | { ok: false; error: string; code: AiNodeTreeRefusalCode }

export interface AiNodeTreeContext {
  /** Screen ids a `screen` prop may name. Absent: any well-formed id. */
  screenIds?: Iterable<string>
  /** DAM media ids a `media` prop may reference. Absent: any well-formed reference. */
  assetIds?: Iterable<string>
  /**
   * Reusable components an instance may place. Absent: no instance is
   * admitted, which is the palette's own rule for a tree nobody grounded.
   */
  componentIds?: Iterable<string>
  /** Declared props per component id, which an instance's values are held to. */
  componentProps?: Record<string, AiComponentPropTypes>
  /** Forms on the Forms page a Form element may bind by `formId`. */
  formIds?: Iterable<string>
  /** Datasets a Form element may write to by `datasetId`. */
  datasetIds?: Iterable<string>
  /**
   * Binding tokens a `url` or `media` prop may hold whole — an Image whose
   * `src` is `{{entry.coverImage}}` on a page template, filled per record
   * when the page renders (AGL-2909). Absent: a token in either role is
   * dropped like any other value that is not an address.
   */
  bindingTokens?: Iterable<string>
}

/**
 * `sx` keys a model may set: spacing, color, typography, layout, borders,
 * display, flex and grid. Fixed rather than derived — MUI's system accepts
 * far more (pseudo-selectors, nested selectors, arbitrary CSS properties)
 * and every one of those is a way to reach outside the element.
 */
export const AI_SX_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  // spacing
  'm',
  'mt',
  'mr',
  'mb',
  'ml',
  'mx',
  'my',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'p',
  'pt',
  'pr',
  'pb',
  'pl',
  'px',
  'py',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gap',
  'rowGap',
  'columnGap',
  // color
  'color',
  'bgcolor',
  'backgroundColor',
  'borderColor',
  'opacity',
  // typography
  'typography',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'whiteSpace',
  'textOverflow',
  'overflowWrap',
  'wordBreak',
  // layout
  'width',
  'minWidth',
  'maxWidth',
  'height',
  'minHeight',
  'maxHeight',
  'boxSizing',
  'overflow',
  'overflowX',
  'overflowY',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'aspectRatio',
  'objectFit',
  // borders
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderWidth',
  'borderStyle',
  'borderRadius',
  'boxShadow',
  // display
  'display',
  'visibility',
  // flex
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignContent',
  'alignSelf',
  'justifySelf',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'order',
  // grid
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumn',
  'gridRow',
  'gridArea',
  'gridAutoFlow',
  'gridAutoColumns',
  'gridAutoRows',
  'justifyItems',
  'placeItems',
  'placeContent',
])

/**
 * Substrings no string a model wrote may carry, in a prop or an `sx` value.
 * Exported for the theme tool's component style values (AGL-2938), which are
 * the same kind of CSS value written into a theme instead of a node.
 */
export const HOSTILE_TEXT =
  /<\s*\/?\s*(script|iframe|object|embed|svg|style|link|meta|base|frame|form|input|img)\b|javascript:|vbscript:|data:text\/html|expression\s*\(|url\s*\(|@import|!important|\bon[a-z]+\s*=/i

/**
 * A CSS value a model may write into `sx`: lengths, numbers, keywords,
 * shorthands (`1px solid`), functions with plain arguments (`repeat(3, 1fr)`,
 * `rgba(0, 0, 0, 0.2)`), hex colors and theme tokens. No quotes, no
 * semicolons, no braces, no angle brackets, no colons — which is what keeps
 * a `url(`, a selector or a second declaration out.
 */
export const SX_VALUE = /^[A-Za-z0-9#.,%()\s\-_/+*]{1,100}$/

/**
 * Node fields the sanitizer strips that a model has no business writing —
 * each is a way to reach past the node's own box, and each is named in
 * `repairs` so a route can tell the model what it lost.
 */
const STRIPPED_NODE_KEYS = [
  'className',
  'interactions',
  'styleOverrides',
  'attrOverrides',
  'presetRef',
] as const

const SCREEN_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_SX_KEYS = 40
/** A string prop with no role of its own — a color, a CSS length, an icon id. */
const PLAIN_STRING_MAX = 500

const paletteTokens = new Set<string>(AI_SX_TOKENS.palette)
const breakpoints = new Set<string>(AI_SX_TOKENS.breakpoints)
const typographyVariants = new Set<string>(AI_SX_TOKENS.typographyVariants)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** A path on this site: one leading slash, never a scheme-relative `//`. */
function isRootRelativePath(value: string): boolean {
  return /^\/(?!\/)[^\s<>"'`\\]*$/.test(value)
}

function sxValueAllowed(key: string, value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || HOSTILE_TEXT.test(trimmed)) return false
  if (paletteTokens.has(trimmed)) return true
  if (key === 'typography' && typographyVariants.has(trimmed)) return true
  return SX_VALUE.test(trimmed)
}

/**
 * The allowed slice of an `sx` object, with a line per key or value dropped.
 * Responsive objects keep only breakpoint keys; anything deeper — a
 * pseudo-selector, a nested selector, an array — is not a value at all.
 */
function sanitizeSx(
  nodeId: string,
  sx: unknown,
  repairs: string[],
): Record<string, unknown> | undefined {
  if (!isRecord(sx)) {
    if (sx !== undefined)
      repairs.push(`${nodeId}: sx is not an object; dropped`)
    return undefined
  }
  const out: Record<string, unknown> = {}
  let kept = 0
  for (const [key, value] of Object.entries(sx)) {
    if (!AI_SX_ALLOWED_KEYS.has(key)) {
      repairs.push(`${nodeId}: sx.${key} is not an allowed style; dropped`)
      continue
    }
    if (kept >= MAX_SX_KEYS) {
      repairs.push(
        `${nodeId}: sx.${key} is past the ${MAX_SX_KEYS}-key ceiling; dropped`,
      )
      continue
    }
    if (isRecord(value)) {
      const responsive: Record<string, unknown> = {}
      for (const [breakpoint, inner] of Object.entries(value)) {
        if (!breakpoints.has(breakpoint)) {
          repairs.push(
            `${nodeId}: sx.${key}.${breakpoint} is not a breakpoint; dropped`,
          )
          continue
        }
        if (!sxValueAllowed(key, inner)) {
          repairs.push(
            `${nodeId}: sx.${key}.${breakpoint} is not an allowed value; dropped`,
          )
          continue
        }
        responsive[breakpoint] =
          typeof inner === 'string' ? inner.trim() : inner
      }
      if (Object.keys(responsive).length) {
        out[key] = responsive
        kept += 1
      }
      continue
    }
    if (!sxValueAllowed(key, value)) {
      repairs.push(`${nodeId}: sx.${key} is not an allowed value; dropped`)
      continue
    }
    out[key] = typeof value === 'string' ? value.trim() : value
    kept += 1
  }
  return kept ? out : undefined
}

function coerceEnum(schema: AiPropSchema, value: unknown): string | undefined {
  if (typeof value !== 'string' || !schema.enum) return undefined
  const wanted = value.trim().toLowerCase()
  return schema.enum.find((option) => option.toLowerCase() === wanted)
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function coerceNumber(
  schema: AiPropSchema,
  value: unknown,
): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN
  if (!Number.isFinite(parsed)) return undefined
  if (schema.type === 'integer' && !Number.isInteger(parsed)) return undefined
  if (schema.minimum !== undefined && parsed < schema.minimum) return undefined
  if (schema.maximum !== undefined && parsed > schema.maximum) return undefined
  return parsed
}

function textLimitFor(
  entry: AiPaletteEntry,
  name: string,
  props: Record<string, unknown>,
): number {
  const declared = entry.textLimits[name]
  // A heading's copy is held to the headline ceiling, decided by the variant
  // the same node carries; anything else keeps the ceiling the palette
  // assigned to the prop.
  if (name === 'children' && isHeadlineVariant(props.variant)) {
    return Math.min(declared ?? AI_TEXT_LIMITS.body, AI_TEXT_LIMITS.headline)
  }
  return declared ?? AI_TEXT_LIMITS.body
}

/**
 * One string prop against its role. Returns the value to store, or
 * `undefined` with the reason pushed to `repairs`. A binding token the
 * caller admitted passes a `url` or `media` role whole.
 */
function sanitizeString(
  nodeId: string,
  entry: AiPaletteEntry,
  name: string,
  schema: AiPropSchema,
  raw: string,
  props: Record<string, unknown>,
  screenIds: Set<string> | null,
  assetIds: Set<string> | null,
  repairs: string[],
  bindingTokens: ReadonlySet<string> | null = null,
): string | undefined {
  let value = raw.trim()
  if (HOSTILE_TEXT.test(value)) {
    repairs.push(`${nodeId}.${name} carried markup or script; dropped`)
    return undefined
  }
  const role = entry.propRoles[name]
  switch (role) {
    case 'text': {
      const limit = textLimitFor(entry, name, props)
      if (value.length > limit) {
        value = value.slice(0, limit).trimEnd()
        repairs.push(
          `${nodeId}.${name} was over ${limit} characters; truncated`,
        )
      }
      break
    }
    case 'url': {
      if (bindingTokens?.has(value)) break
      if (!isHttpsUrl(value) && !isRootRelativePath(value)) {
        repairs.push(
          `${nodeId}.${name} is neither an https: URL nor a path on this site; dropped`,
        )
        return undefined
      }
      break
    }
    case 'screen': {
      if (screenIds ? !screenIds.has(value) : !SCREEN_ID.test(value)) {
        repairs.push(
          `${nodeId}.${name} names a screen this site does not have; dropped`,
        )
        return undefined
      }
      break
    }
    case 'media': {
      if (bindingTokens?.has(value)) break
      if (isHttpsUrl(value)) break
      const ref = parseMediaRef(value)
      if (!ref || (assetIds && !assetIds.has(ref.mediaId))) {
        repairs.push(
          `${nodeId}.${name} is neither a media reference this site holds nor an https: URL; dropped`,
        )
        return undefined
      }
      break
    }
    default: {
      if (value.length > PLAIN_STRING_MAX) {
        repairs.push(
          `${nodeId}.${name} is over ${PLAIN_STRING_MAX} characters; dropped`,
        )
        return undefined
      }
    }
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    repairs.push(`${nodeId}.${name} does not match its pattern; dropped`)
    return undefined
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    repairs.push(
      `${nodeId}.${name} is shorter than ${schema.minLength} characters; dropped`,
    )
    return undefined
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    value = value.slice(0, schema.maxLength).trimEnd()
    repairs.push(
      `${nodeId}.${name} was over ${schema.maxLength} characters; truncated`,
    )
  }
  return value
}

function sanitizeProps(
  nodeId: string,
  entry: AiPaletteEntry,
  raw: unknown,
  screenIds: Set<string> | null,
  assetIds: Set<string> | null,
  repairs: string[],
  bindingTokens: ReadonlySet<string> | null = null,
): { props: Record<string, unknown> } | { missing: string } {
  const source = isRecord(raw) ? raw : {}
  const props: Record<string, unknown> = {}
  const declared = entry.propsSchema.properties
  for (const [name, value] of Object.entries(source)) {
    // `sx` is read off the node instead; a model that put it here meant the
    // same thing, and the caller has already moved it.
    if (name === 'sx' || value === undefined || value === null) continue
    const schema = declared[name]
    if (!schema) {
      repairs.push(
        `${nodeId}.${name} is not a prop of ${entry.displayName}; dropped`,
      )
      continue
    }
    if (schema.enum) {
      const coerced = coerceEnum(schema, value)
      if (coerced === undefined) {
        repairs.push(
          `${nodeId}.${name} is not one of ${schema.enum.join('|')}; dropped`,
        )
        continue
      }
      if (coerced !== value) {
        repairs.push(
          `${nodeId}.${name} was spelled "${String(value)}"; normalized to "${coerced}"`,
        )
      }
      props[name] = coerced
      continue
    }
    switch (schema.type) {
      case 'boolean': {
        const coerced = coerceBoolean(value)
        if (coerced === undefined) {
          repairs.push(`${nodeId}.${name} is not a boolean; dropped`)
          continue
        }
        props[name] = coerced
        break
      }
      case 'number':
      case 'integer': {
        const coerced = coerceNumber(schema, value)
        if (coerced === undefined) {
          repairs.push(`${nodeId}.${name} is not a number in range; dropped`)
          continue
        }
        props[name] = coerced
        break
      }
      default: {
        const text =
          typeof value === 'string'
            ? value
            : typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : undefined
        if (text === undefined) {
          repairs.push(`${nodeId}.${name} is not text; dropped`)
          continue
        }
        const cleaned = sanitizeString(
          nodeId,
          entry,
          name,
          schema,
          text,
          source,
          screenIds,
          assetIds,
          repairs,
          bindingTokens,
        )
        if (cleaned === undefined) continue
        props[name] = cleaned
      }
    }
  }
  for (const name of entry.propsSchema.required) {
    if (props[name] === undefined) return { missing: name }
  }
  return { props }
}

/** Surfaces that compose page elements, and so may place a component instance. */
const INSTANCE_SURFACES: ReadonlySet<AiSurface> = new Set([
  'screen',
  'layout',
  'component',
])

const FORM_COMPONENT_ID = 'form'

/** The instance prop naming the component it places; stored on every instance node. */
export const AI_INSTANCE_REF_PROP = 'refId'

interface ReferenceSets {
  componentIds: Set<string> | null
  componentProps: Record<string, AiComponentPropTypes>
  formIds: Set<string> | null
  datasetIds: Set<string> | null
  assetIds: Set<string> | null
}

/**
 * One value an instance fills in for a declared prop, held to what the
 * declaration's type can hold: a picture from the library, a link, a number,
 * a switch, or copy.
 */
function instancePropValue(
  nodeId: string,
  name: string,
  type: string,
  raw: unknown,
  assetIds: Set<string> | null,
  repairs: string[],
): unknown {
  if (type === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number(raw)
    if (raw === '' || !Number.isFinite(parsed)) {
      repairs.push(`${nodeId}.propValues.${name} is not a number; dropped`)
      return undefined
    }
    return parsed
  }
  if (type === 'boolean') {
    const coerced = coerceBoolean(raw)
    if (coerced === undefined) {
      repairs.push(`${nodeId}.propValues.${name} is not a boolean; dropped`)
    }
    return coerced
  }
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    repairs.push(`${nodeId}.propValues.${name} is not a value; dropped`)
    return undefined
  }
  const value = String(raw).trim()
  if (HOSTILE_TEXT.test(value)) {
    repairs.push(`${nodeId}.propValues.${name} carried markup or script; dropped`)
    return undefined
  }
  if (type === 'image') {
    if (isHttpsUrl(value)) return value
    const ref = parseMediaRef(value)
    if (!ref || (assetIds && !assetIds.has(ref.mediaId))) {
      repairs.push(
        `${nodeId}.propValues.${name} is neither a media reference this site holds nor an https: URL; dropped`,
      )
      return undefined
    }
    return value
  }
  if (type === 'href') {
    if (isHttpsUrl(value) || isRootRelativePath(value)) return value
    repairs.push(
      `${nodeId}.propValues.${name} is neither an https: URL nor a path on this site; dropped`,
    )
    return undefined
  }
  if (value.length > AI_TEXT_LIMITS.body) {
    repairs.push(
      `${nodeId}.propValues.${name} was over ${AI_TEXT_LIMITS.body} characters; truncated`,
    )
    return value.slice(0, AI_TEXT_LIMITS.body).trimEnd()
  }
  return value
}

/**
 * The site-record props of one node — an instance's `refId` and
 * `propValues`, a Form's `formId` and `datasetId` — checked against the ids
 * the caller supplied. They leave `props` before the palette pass, which
 * would drop them as undeclared, and come back in `kept` once checked.
 */
function sanitizeReferenceProps(
  nodeId: string,
  componentId: string,
  props: Record<string, unknown>,
  refs: ReferenceSets,
  repairs: string[],
): { props: Record<string, unknown>; kept: Record<string, unknown> } | { refusal: string } {
  const rest: Record<string, unknown> = { ...props }
  const kept: Record<string, unknown> = {}
  if (componentId === REUSABLE_INSTANCE_COMPONENT_ID) {
    const refId = typeof rest[AI_INSTANCE_REF_PROP] === 'string' ? String(rest[AI_INSTANCE_REF_PROP]).trim() : ''
    delete rest[AI_INSTANCE_REF_PROP]
    if (!refId || !refs.componentIds?.has(refId)) {
      return {
        refusal: `Reusable Component (${nodeId}) names a component this site does not have`,
      }
    }
    kept[AI_INSTANCE_REF_PROP] = refId
    const rawValues = rest[REUSABLE_INSTANCE_PROP_VALUES_KEY]
    delete rest[REUSABLE_INSTANCE_PROP_VALUES_KEY]
    if (rawValues !== undefined && !isRecord(rawValues)) {
      repairs.push(`${nodeId}.propValues is not an object; dropped`)
    }
    const declared = refs.componentProps[refId]
    const values: Record<string, unknown> = {}
    for (const [name, raw] of Object.entries(isRecord(rawValues) ? rawValues : {})) {
      if (raw === undefined || raw === null) continue
      if (!COMPONENT_PROP_NAME_PATTERN.test(name)) {
        repairs.push(`${nodeId}.propValues.${name} is not a prop name; dropped`)
        continue
      }
      if (declared && !(name in declared)) {
        repairs.push(`${nodeId}.propValues.${name} is not a prop of that component; dropped`)
        continue
      }
      const value = instancePropValue(
        nodeId,
        name,
        declared?.[name] ?? 'text',
        raw,
        refs.assetIds,
        repairs,
      )
      if (value !== undefined) values[name] = value
    }
    if (Object.keys(values).length) kept[REUSABLE_INSTANCE_PROP_VALUES_KEY] = values
    return { props: rest, kept }
  }
  if (componentId === FORM_COMPONENT_ID) {
    const bindings: Array<[prop: string, ids: Set<string> | null, record: string]> = [
      ['formId', refs.formIds, 'form'],
      ['datasetId', refs.datasetIds, 'dataset'],
    ]
    for (const [prop, ids, record] of bindings) {
      const raw = rest[prop]
      delete rest[prop]
      if (raw === undefined || raw === null || raw === '') continue
      const id = typeof raw === 'string' ? raw.trim() : ''
      if (id && ids?.has(id)) {
        kept[prop] = id
      } else {
        repairs.push(`${nodeId}.${prop} names a ${record} this site does not have; dropped`)
      }
    }
  }
  return { props: rest, kept }
}

function refusalCode(error: string): AiNodeTreeRefusalCode {
  if (/too large/i.test(error)) return 'too-large'
  if (/cannot be published/i.test(error)) return 'component'
  return 'structure'
}

/**
 * Whether the root the model wrote is the surface's root: the canvas wrapper
 * for a document surface (which the sanitizer exempts by the same shape), or
 * the named component otherwise.
 */
function rootMatches(surfaceRoot: string, componentId: unknown): boolean {
  if (surfaceRoot === 'div') {
    return componentId == null || componentId === '' || componentId === 'div'
  }
  return componentId === surfaceRoot
}

export function validateAiNodeTree(
  input: unknown,
  surface: AiSurface,
  context?: AiNodeTreeContext,
): AiNodeTreeResult {
  try {
    return validate(input, surface, context)
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-input',
      error: `The tree could not be read: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export type AiNodePatchResult =
  | {
      ok: true
      props: Record<string, unknown>
      sx: Record<string, unknown> | undefined
      repairs: string[]
    }
  | { ok: false; error: string; code: AiNodeTreeRefusalCode }

/**
 * One element's prop and style patch, held to the rules `validateAiNodeTree`
 * holds an element it places — for an edit to an element already on the
 * canvas, where there is no tree to validate.
 *
 * The same passes run: unknown props dropped, enums coerced, every string
 * held to its role and screened for markup, `sx` held to the key set and the
 * value grammar. The one difference is `required`: a patch is merged over the
 * props the element already has, so a required prop the patch does not name
 * is not missing.
 */
export function validateAiNodePatch(
  componentId: string,
  patch: { props?: unknown; sx?: unknown },
  context?: AiNodeTreeContext,
): AiNodePatchResult {
  const entry = AI_PALETTE[componentId]
  if (!entry) {
    return {
      ok: false,
      code: 'component',
      error: `Component "${componentId}" is not in the palette`,
    }
  }
  const repairs: string[] = []
  const props = sanitizeProps(
    componentId,
    { ...entry, propsSchema: { ...entry.propsSchema, required: [] } },
    patch.props,
    context?.screenIds ? new Set(context.screenIds) : null,
    context?.assetIds ? new Set(context.assetIds) : null,
    repairs,
  )
  const sx =
    patch.sx === undefined ? undefined : sanitizeSx(componentId, patch.sx, repairs)
  return {
    ok: true,
    props: 'props' in props ? props.props : {},
    sx,
    repairs,
  }
}

function validate(
  input: unknown,
  surface: AiSurface,
  context: AiNodeTreeContext | undefined,
): AiNodeTreeResult {
  const definition = AI_SURFACES[surface]
  if (!definition) {
    return {
      ok: false,
      code: 'invalid-input',
      error: `Unknown surface "${surface}"`,
    }
  }
  if (
    !isRecord(input) ||
    typeof input.rootId !== 'string' ||
    !isRecord(input.nodes)
  ) {
    return {
      ok: false,
      code: 'invalid-input',
      error: 'Expected an object with a string rootId and a nodes map',
    }
  }
  const rootId = input.rootId
  const nodes = input.nodes as Record<string, unknown>
  const root = nodes[rootId]
  if (!isRecord(root)) {
    return {
      ok: false,
      code: 'structure',
      error: 'Definition has no root node',
    }
  }
  if (!rootMatches(definition.root, root.componentId)) {
    return {
      ok: false,
      code: 'root',
      error: `A ${surface} starts with ${definition.root === 'div' ? 'the document wrapper' : `"${definition.root}"`}, not "${String(root.componentId)}"`,
    }
  }

  // The sanitizer keeps only the persisted node keys, and `sx` is not one of
  // them for a listing. Read it off every node first — from the node field
  // or from `props.sx`, which a model writes just as readily — and put it
  // back, checked, on the nodes that survive.
  const sxByNodeId = new Map<string, unknown>()
  const hiddenByNodeId = new Set<string>()
  for (const [id, node] of Object.entries(nodes)) {
    if (!isRecord(node)) continue
    const sx =
      node.sx !== undefined
        ? node.sx
        : isRecord(node.props)
          ? node.props.sx
          : undefined
    if (sx !== undefined) sxByNodeId.set(id, sx)
    if (node.hidden === true) hiddenByNodeId.add(id)
  }

  // A DAM reference (a `media:` value) is not a URL the sanitizer's
  // `src` policy admits — a listing must not carry another tenant's asset —
  // but on the tenant's own page it is exactly what an image should name.
  // Lift those values out before sanitizing and hand them back to the prop
  // pass, which holds them to the asset set the caller supplied.
  // A binding token the caller admitted (AGL-2909) is lifted the same way:
  // `{{entry.coverImage}}` is no address the sanitizer knows, and the prop
  // pass holds it to the tokens the caller named.
  const bindingTokens = context?.bindingTokens ? new Set(context.bindingTokens) : null
  const mediaByNodeId = new Map<string, Record<string, string>>()
  const forSanitizer: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (!isRecord(node) || !isRecord(node.props)) {
      forSanitizer[id] = node
      continue
    }
    const roles = AI_PALETTE[String(node.componentId)]?.propRoles ?? {}
    const props: Record<string, unknown> = { ...node.props }
    const lifted: Record<string, string> = {}
    for (const [key, value] of Object.entries(props)) {
      if (typeof value !== 'string') continue
      const role = roles[key]
      if (
        (role === 'media' && parseMediaRef(value.trim())) ||
        ((role === 'media' || role === 'url') && bindingTokens?.has(value.trim()))
      ) {
        lifted[key] = value
        delete props[key]
      }
    }
    if (Object.keys(lifted).length) mediaByNodeId.set(id, lifted)
    forSanitizer[id] = { ...node, props }
  }

  const refs: ReferenceSets = {
    componentIds: context?.componentIds ? new Set(context.componentIds) : null,
    componentProps: context?.componentProps ?? {},
    formIds: context?.formIds ? new Set(context.formIds) : null,
    datasetIds: context?.datasetIds ? new Set(context.datasetIds) : null,
    assetIds: context?.assetIds ? new Set(context.assetIds) : null,
  }
  // An instance is admitted only where the caller grounded it in the site's
  // components; the reference itself is checked on the node below.
  const allow =
    refs.componentIds && INSTANCE_SURFACES.has(surface)
      ? [...definition.allow, REUSABLE_INSTANCE_COMPONENT_ID]
      : definition.allow
  const sanitized = sanitizeMarketplaceDefinition(
    { rootId, nodes: forSanitizer },
    { componentIds: allow },
  )
  if (sanitized.ok === false) {
    return {
      ok: false,
      code: refusalCode(sanitized.error),
      error: sanitized.error,
    }
  }

  const screenIds = context?.screenIds ? new Set(context.screenIds) : null
  const assetIds = refs.assetIds
  const repairs: string[] = []
  const output: NodesMap = {}
  const rootIsWrapper =
    rootMatches('div', root.componentId) && definition.root === 'div'
  const minted = new Map<string, string>()
  const mint = (id: string): string => {
    const fresh =
      id === rootId && rootIsWrapper
        ? CANVAS_ROOT_ELEMENT_ID
        : createIdUrlSafe()
    minted.set(id, fresh)
    return fresh
  }

  /** Each visited node's parent by the model's own ids, for the parentId check. */
  const parentOf = new Map<string, string>()
  const queue: Array<{ id: string; parentId: string | null }> = [
    { id: rootId, parentId: null },
  ]
  mint(rootId)
  while (queue.length) {
    const { id, parentId } = queue.shift() as {
      id: string
      parentId: string | null
    }
    const node = sanitized.nodes[id]
    const entry = AI_PALETTE[node.componentId]
    if (!entry) {
      return {
        ok: false,
        code: 'component',
        error: `Component "${node.componentId}" is not in the palette`,
      }
    }
    const newId = minted.get(id) as string
    const raw = nodes[id]
    if (isRecord(raw)) {
      // The sanitizer drops silently; the model is told what went.
      for (const key of STRIPPED_NODE_KEYS) {
        if (raw[key] !== undefined) {
          repairs.push(
            `${id}.${key} is not something a generated node may set; dropped`,
          )
        }
      }
      if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
        repairs.push(`${id}.hidden is not a boolean; dropped`)
      }
      if (raw.nodes !== undefined && !Array.isArray(raw.nodes)) {
        repairs.push(
          `${id}.nodes is not a list of child ids; its children were dropped`,
        )
      }
      if (
        raw.parentId !== undefined &&
        raw.parentId !== null &&
        raw.parentId !== (parentId === null ? null : parentOf.get(id))
      ) {
        repairs.push(
          `${id}.parentId disagreed with where the tree places it; recomputed`,
        )
      }
      if (isRecord(raw.props)) {
        const lifted = mediaByNodeId.get(id) ?? {}
        for (const key of Object.keys(raw.props)) {
          if (
            key !== 'sx' &&
            lifted[key] === undefined &&
            node.props?.[key] === undefined &&
            raw.props[key] !== undefined
          ) {
            repairs.push(
              `${id}.${key} was an unsafe handler, address or markup; dropped`,
            )
          }
        }
      }
    }
    const children: string[] = []
    for (const childId of node.nodes ?? []) {
      if (minted.has(childId)) {
        repairs.push(
          `${childId} was listed under more than one parent; the later listing was dropped`,
        )
        continue
      }
      const child = sanitized.nodes[childId]
      if (!child) continue
      const childEntry = AI_PALETTE[child.componentId]
      if (!childEntry) {
        return {
          ok: false,
          code: 'component',
          error: `Component "${child.componentId}" is not in the palette`,
        }
      }
      if (!entry.acceptsChildren) {
        return {
          ok: false,
          code: 'lineage',
          error: `${entry.displayName} (${id}) cannot hold other elements, but lists ${childId}`,
        }
      }
      if (
        !linealRelationshipPermits(
          {
            componentId: child.componentId,
            pluginId: childEntry.pluginId,
            restrictParent: childEntry.restrictParent,
          },
          {
            componentId: node.componentId,
            pluginId: entry.pluginId,
            restrictChildren: entry.restrictChildren,
          },
        )
      ) {
        return {
          ok: false,
          code: 'lineage',
          error: `${childEntry.displayName} (${childId}) cannot be placed inside ${entry.displayName} (${id})`,
        }
      }
      children.push(mint(childId))
      parentOf.set(childId, id)
      queue.push({ id: childId, parentId: newId })
    }

    const reference = sanitizeReferenceProps(
      id,
      node.componentId,
      { ...node.props, ...mediaByNodeId.get(id) },
      refs,
      repairs,
    )
    if ('refusal' in reference) {
      return { ok: false, code: 'reference', error: reference.refusal }
    }
    const propsResult = sanitizeProps(
      id,
      entry,
      reference.props,
      screenIds,
      assetIds,
      repairs,
      bindingTokens,
    )
    if ('missing' in propsResult) {
      return {
        ok: false,
        code: 'required-prop',
        error: `${entry.displayName} (${id}) is missing its required "${propsResult.missing}" prop`,
      }
    }
    const sx = sanitizeSx(id, sxByNodeId.get(id), repairs)
    output[newId] = {
      $id: newId,
      type: NodeType.NODE,
      componentId: node.componentId,
      pluginId: entry.pluginId,
      parentId,
      nodes: children,
      props: { ...propsResult.props, ...reference.kept },
      ...(sx ? { sx } : {}),
      ...(hiddenByNodeId.has(id) ? { hidden: true } : {}),
    }
  }

  // The save's own measurement (msgpack), not a JSON string length: the
  // ceiling is stated in those bytes, and a UTF-16 length reads multi-byte
  // copy as smaller than the document the save will refuse.
  const bytes = nodeMapBytes(output)
  if (bytes > NODE_MAP_MAX_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      error: `The tree is ${bytes} bytes; the stored ceiling is ${NODE_MAP_MAX_BYTES}`,
    }
  }
  const sourceIds: Record<string, string> = {}
  for (const [source, fresh] of minted) sourceIds[fresh] = source
  return {
    ok: true,
    rootId: minted.get(rootId) as string,
    nodes: output,
    repairs,
    sourceIds,
  }
}
