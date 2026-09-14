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
 * The properties a published component or layout declares (AGL-2933), held to
 * the marketplace sanitizer before they reach another org's site.
 *
 * A declaration is publisher-written data that renders inside the installer's
 * console and, through `{{prop.*}}`, on their live pages: a Link default
 * becomes an `href`, an Image default a `src`, a Formatted document default a
 * body, and labels and help text are drawn in the Attributes panel. Each is
 * checked by the rule the published tree's own values meet.
 *
 * **A refused default becomes no default; the property is kept.** Its field
 * still shows on every instance and its `{{prop.*}}` still resolves, empty.
 * Dropping the property instead would leave every binding to it rendering as
 * a raw token and every page value stored under its name orphaned — a bad
 * default is not a reason to break the component around it. The same goes
 * for a refused label, help text or option label: the text is cleared and
 * the property, or the option, stays.
 *
 * Not re-exported from the model barrel: this reaches the author-HTML
 * sanitizer, which no browser bundle that imports the listing model needs.
 * Publish, install and update import it by path.
 */

import {
  sanitizeAuthorHtml,
  type AuthorHtmlRemoval,
} from '@aglyn/aglyn/app-utils/author-html'
import { COMPONENT_PROP_NAME_PATTERN } from '@aglyn/aglyn/app-utils/reusable-component-keys'
import { FieldComponentType } from '@aglyn/aglyn/foundation/definitions/components.types'
import {
  isReusablePropType,
  reusablePropKind,
  reusablePropTakesSeveral,
} from '@aglyn/aglyn/foundation/definitions/property-kinds'
import type {
  ReusableComponentProp,
  ReusableComponentPropCondition,
  ReusableComponentPropOption,
  ReusableComponentPropRule,
} from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  MARKETPLACE_DEFINITION_MAX_BYTES,
  MARKETPLACE_SAFE_HREF,
  MARKETPLACE_SAFE_SRC,
} from './marketplace'

/** The most properties one published component or layout may declare. */
export const MARKETPLACE_PROPS_MAX_COUNT = 200

const LABEL_MAX_LENGTH = 200
const DESCRIPTION_MAX_LENGTH = 1000
const TEXT_DEFAULT_MAX_LENGTH = 10_000
const DOCUMENT_DEFAULT_MAX_LENGTH = 50_000
const SETTING_STRING_MAX_LENGTH = 200
const CONDITION_MAX_DEPTH = 8

/** An icon id as the catalog names one: `mdiRocket`. */
const ICON_ID = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/

/** SVG path data and nothing else — the only thing an icon path is drawn as. */
const SVG_PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]{1,20000}$/

/**
 * Markup in text that is only ever drawn as text. Refused rather than escaped:
 * a label is not somewhere markup belongs, so its presence says the value was
 * written for some other reader.
 */
const MARKUP = /<[A-Za-z!/?]/

/**
 * A scheme a browser will execute, spelled the way a browser reads it — with
 * the C0 controls and spaces it strips while resolving one removed first, so
 * `java\tscript:` is caught.
 */
function startsWithScriptScheme(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase()
  return (
    /^(javascript|vbscript|livescript):/.test(stripped) ||
    /^data:(text\/html|application\/xhtml|image\/svg)/.test(stripped)
  )
}

/**
 * CSS a Style property's value could smuggle into a declaration: a fetched
 * resource, a script-bearing legacy expression, an import, or the punctuation
 * that ends one declaration and starts another.
 */
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|@import|[;{}<>]|\\/i

/** Markdown link and image targets: inline `](…)` and reference `[id]: …`. */
const MARKDOWN_INLINE_TARGET = /\]\(\s*<?([^)\s>]*)/g
const MARKDOWN_REFERENCE_TARGET = /^\s{0,3}\[[^\]]+\]:\s*<?(\S*?)>?(?:\s|$)/gm

/** The sanitized declarations, or why the list was refused outright. */
export type MarketplacePropsResult =
  | {
      ok: true
      props: ReusableComponentProp[]
      /** Names of the properties whose default was refused and cleared. */
      clearedDefaults: string[]
    }
  | { ok: false; error: string }

/** A text field's value if it is plain text within `max`, else nothing. */
function plainText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length > max || MARKUP.test(value)) return undefined
  return value
}

/**
 * Whether a Long text or Formatted document default is one the installer can
 * be handed: no markup the author-HTML sanitizer would strip, and no link or
 * image target with a scheme a browser would execute.
 *
 * A test, not a transform: a default the sanitizer would have to rewrite is
 * not what the publisher wrote, so it is refused whole rather than stored as
 * someone's guess at what was meant.
 */
function isSafeDocument(value: string): boolean {
  if (value.length > DOCUMENT_DEFAULT_MAX_LENGTH) return false
  if (value.includes('<')) {
    const removals: AuthorHtmlRemoval[] = []
    sanitizeAuthorHtml(value, removals)
    if (removals.length) return false
  }
  for (const match of value.matchAll(MARKDOWN_INLINE_TARGET)) {
    if (match[1] && startsWithScriptScheme(match[1])) return false
  }
  for (const match of value.matchAll(MARKDOWN_REFERENCE_TARGET)) {
    if (match[1] && startsWithScriptScheme(match[1])) return false
  }
  return !startsWithScriptScheme(value)
}

/**
 * A stored property value of a kind with no rule of its own: text, a number,
 * a Yes / no, or a list of texts and numbers — the shapes
 * `ReusableComponentPropValue` admits besides an icon — each text passing
 * `stringOk`. `undefined` when it is anything else.
 */
function plainValue(
  value: unknown,
  stringOk: (text: string) => boolean,
): unknown {
  const isText = (entry: unknown): entry is string =>
    typeof entry === 'string' &&
    entry.length <= TEXT_DEFAULT_MAX_LENGTH &&
    stringOk(entry)
  const isNumber = (entry: unknown): entry is number =>
    typeof entry === 'number' && Number.isFinite(entry)
  if (isText(value) || isNumber(value) || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value) && value.every((entry) => isText(entry) || isNumber(entry))) {
    return [...value]
  }
  return undefined
}

/** One answer or a list of answers, as the property's kind takes them. */
function answers(
  value: unknown,
  several: boolean,
): unknown {
  const isAnswer = (entry: unknown) =>
    (typeof entry === 'string' &&
      entry.length <= TEXT_DEFAULT_MAX_LENGTH &&
      !startsWithScriptScheme(entry)) ||
    (typeof entry === 'number' && Number.isFinite(entry))
  if (Array.isArray(value)) {
    return several && value.every(isAnswer) ? [...value] : undefined
  }
  return isAnswer(value) ? value : undefined
}

/**
 * A declaration's default held to its kind's rule: the value to store, or
 * `undefined` when the default is refused. `iconPath` rides along for an Icon.
 */
function sanitizeDefault(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'>,
  value: unknown,
  iconPath: unknown,
): { value: unknown; iconPath?: string } | undefined {
  const kind = reusablePropKind(prop.type)
  switch (prop.type ?? 'text') {
    case 'href': {
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      return MARKETPLACE_SAFE_HREF.test(trimmed) ? { value: trimmed } : undefined
    }
    case 'image': {
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      return MARKETPLACE_SAFE_SRC.test(trimmed) ? { value: trimmed } : undefined
    }
    case 'richText':
    case FieldComponentType.MARKDOWN:
      return typeof value === 'string' && isSafeDocument(value)
        ? { value }
        : undefined
    case 'icon': {
      if (typeof value !== 'string' || !ICON_ID.test(value)) return undefined
      if (iconPath === undefined || iconPath === null || iconPath === '') {
        return { value }
      }
      return typeof iconPath === 'string' && SVG_PATH_DATA.test(iconPath)
        ? { value, iconPath }
        : undefined
    }
    case 'text': {
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { value }
      }
      return typeof value === 'string' &&
        value.length <= TEXT_DEFAULT_MAX_LENGTH &&
        !startsWithScriptScheme(value)
        ? { value }
        : undefined
    }
  }
  switch (kind.value) {
    case 'number': {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? { value } : undefined
      }
      return typeof value === 'string' &&
        value.trim() !== '' &&
        Number.isFinite(Number(value))
        ? { value }
        : undefined
    }
    case 'boolean': {
      if (reusablePropTakesSeveral(prop)) {
        const list = answers(value, true)
        return list === undefined ? undefined : { value: list }
      }
      return typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 10) ||
        (typeof value === 'number' && Number.isFinite(value))
        ? { value }
        : undefined
    }
  }
  if (kind.options) {
    const list = answers(value, reusablePropTakesSeveral(prop))
    return list === undefined ? undefined : { value: list }
  }
  const stringOk =
    kind.group === 'Style'
      ? (text: string) => !UNSAFE_STYLE_VALUE.test(text) && !startsWithScriptScheme(text)
      : (text: string) => !startsWithScriptScheme(text)
  const safe = plainValue(value, stringOk)
  return safe === undefined ? undefined : { value: safe }
}

/** The answers a property offers, each with a value; a refused label is cleared. */
function sanitizeOptions(raw: unknown): ReusableComponentPropOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const options: ReusableComponentPropOption[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const rawValue = (entry as { value?: unknown }).value
    const value =
      typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? String(rawValue)
        : rawValue
    if (typeof value !== 'string' || value.length > SETTING_STRING_MAX_LENGTH) {
      continue
    }
    const label = plainText((entry as { label?: unknown }).label, LABEL_MAX_LENGTH)
    options.push(label === undefined ? { value } : { value, label })
  }
  return options
}

/** A kind's settings: flat, primitive, and short. */
function sanitizeSettings(
  raw: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const settings: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('__') || key.length > 64) continue
    if (typeof value === 'boolean') settings[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) settings[key] = value
    else if (typeof value === 'string') {
      const text = plainText(value, SETTING_STRING_MAX_LENGTH)
      if (text !== undefined) settings[key] = text
    }
  }
  return settings
}

const RULE_PRIMITIVE_KEYS = ['notMatch', 'isEmpty', 'isNotEmpty'] as const
const RULE_NUMBER_KEYS = [
  'greaterThan',
  'greaterThanOrEqualTo',
  'lessThan',
  'lessThanOrEqualTo',
] as const

/** A condition's serializable shape, rebuilt key by key. */
function sanitizeCondition(
  raw: unknown,
  depth = 0,
): ReusableComponentPropCondition | ReusableComponentPropCondition[] | undefined {
  if (depth > CONDITION_MAX_DEPTH || !raw || typeof raw !== 'object') {
    return undefined
  }
  if (Array.isArray(raw)) {
    const list = raw
      .map((entry) => sanitizeCondition(entry, depth + 1))
      .filter((entry): entry is ReusableComponentPropCondition =>
        Boolean(entry) && !Array.isArray(entry),
      )
    return list.length ? list : undefined
  }
  const value = raw as Record<string, unknown>
  for (const key of ['and', 'or'] as const) {
    if (key in value) {
      const list = sanitizeCondition(value[key], depth + 1)
      if (!list) return undefined
      return { [key]: Array.isArray(list) ? list : [list] } as ReusableComponentPropCondition
    }
  }
  if ('not' in value) {
    const inner = sanitizeCondition(value['not'], depth + 1)
    return inner ? { not: inner } : undefined
  }
  if (typeof value['when'] !== 'string' || !COMPONENT_PROP_NAME_PATTERN.test(value['when'])) {
    return undefined
  }
  const rule: ReusableComponentPropRule = { when: value['when'] }
  const is = value['is']
  if (
    typeof is === 'string' ||
    typeof is === 'boolean' ||
    (typeof is === 'number' && Number.isFinite(is))
  ) {
    rule.is = is
  } else if (
    Array.isArray(is) &&
    is.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
  ) {
    rule.is = [...is]
  }
  for (const key of RULE_PRIMITIVE_KEYS) {
    if (typeof value[key] === 'boolean') rule[key] = value[key] as boolean
  }
  for (const key of RULE_NUMBER_KEYS) {
    const entry = value[key]
    if (typeof entry === 'number' && Number.isFinite(entry)) rule[key] = entry
  }
  if (typeof value['pattern'] === 'string' && value['pattern'].length <= 500) {
    rule.pattern = value['pattern']
  }
  if (typeof value['flags'] === 'string' && /^[dgimsuvy]{0,8}$/.test(value['flags'])) {
    rule.flags = value['flags']
  }
  return rule
}

/**
 * Holds a published component's or layout's declared properties to the
 * marketplace sanitizer.
 *
 * Every property with a usable name is kept, in order, with only the keys a
 * declaration has. What each default, label, help text and option label must
 * satisfy is the rule the published tree's own values meet — see the module
 * comment — and whatever fails it is cleared rather than taken as grounds to
 * lose the property. An entry with no usable name is skipped: nothing can
 * bind to it, so it is not a property. A second entry with a name already
 * taken is skipped for the same reason — bindings resolve to the first.
 *
 * Refuses outright only a declaration list too large to publish, which is
 * the same answer the tree gets.
 *
 * Idempotent, so install and update run it again over what publish stored.
 */
export function sanitizeMarketplaceProps(raw: unknown): MarketplacePropsResult {
  if (!Array.isArray(raw)) return { ok: true, props: [], clearedDefaults: [] }
  if (raw.length > MARKETPLACE_PROPS_MAX_COUNT) {
    return {
      ok: false,
      error:
        `This declares ${raw.length} properties — a listing may declare at ` +
        `most ${MARKETPLACE_PROPS_MAX_COUNT}.`,
    }
  }
  const props: ReusableComponentProp[] = []
  const clearedDefaults: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const source = entry as Record<string, unknown>
    const name = source['name']
    if (typeof name !== 'string' || !COMPONENT_PROP_NAME_PATTERN.test(name)) {
      continue
    }
    if (seen.has(name)) continue
    seen.add(name)

    const prop: ReusableComponentProp = { name }
    // An unknown kind reads as Text everywhere, so it is kept as written and
    // its default held to Text's rule by `reusablePropKind`.
    if (typeof source['type'] === 'string' && source['type'].length <= 64) {
      prop.type = source['type'] as ReusableComponentProp['type']
    }
    const label = plainText(source['label'], LABEL_MAX_LENGTH)
    if (label !== undefined) prop.label = label
    const description = plainText(source['description'], DESCRIPTION_MAX_LENGTH)
    if (description !== undefined) prop.description = description
    const options = sanitizeOptions(source['options'])
    if (options) prop.options = options
    const settings = sanitizeSettings(source['settings'])
    if (settings) prop.settings = settings
    const condition = sanitizeCondition(source['condition'])
    if (condition) prop.condition = condition

    const rawDefault = source['defaultValue']
    if (rawDefault !== undefined && rawDefault !== null) {
      const kindProp = isReusablePropType(prop.type) ? prop : { ...prop, type: 'text' as const }
      const safe = sanitizeDefault(kindProp, rawDefault, source['defaultIconPath'])
      if (safe === undefined) {
        clearedDefaults.push(name)
      } else {
        prop.defaultValue = safe.value as ReusableComponentProp['defaultValue']
        if (safe.iconPath) prop.defaultIconPath = safe.iconPath
      }
    }
    props.push(prop)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(props)
  } catch {
    return { ok: false, error: 'Properties are not serializable' }
  }
  if (serialized.length > MARKETPLACE_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Properties are too large to publish' }
  }
  return { ok: true, props, clearedDefaults }
}

/**
 * The properties a stored listing version carries, re-held to the sanitizer,
 * or `undefined` for a version published before properties were carried.
 *
 * The distinction is what install and update act on: a version with a list —
 * even an empty one — says what the component declares, so it replaces what
 * the installed copy has; a version with none says nothing, so the installed
 * copy keeps its own.
 */
export function readPublishedProps(
  raw: unknown,
): ReusableComponentProp[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const sanitized = sanitizeMarketplaceProps(raw)
  // Publish refused anything too large, so a stored list that is must have
  // been written some other way; it says nothing trustworthy about what the
  // component declares, and is treated as saying nothing.
  return sanitized.ok ? sanitized.props : undefined
}
