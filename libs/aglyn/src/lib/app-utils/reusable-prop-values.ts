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
  compileLinearTest,
  explainLinearTest,
  type LinearTest,
} from '@aglyn/shared-util-tools/linear-regex'
import isEmpty from 'lodash-es/isEmpty.js'
import type {
  ReusableComponentIcon,
  ReusableComponentProp,
  ReusableComponentPropCondition,
  ReusableComponentPropRule,
} from '../foundation/definitions/platform.types'
import {
  reusablePropTakesSeveral,
  reusablePropValueClass,
} from '../foundation/definitions/property-kinds'
import { COMPONENT_PROP_TOKEN_PREFIX } from './reusable-component-keys'

/**
 * What a component or layout property is worth on one page (AGL-1247,
 * AGL-2893): the page's own value where it set one, the declaration's default
 * where it did not, and nothing at all where the property's condition does
 * not hold.
 *
 * One module decides this for every surface that renders a property — the
 * component graft, detach, the component and layout editors' canvases, and a
 * layout composed around a screen — so no two of them can disagree about
 * which value wins.
 */

/**
 * Spellings of "no" a visibility directive accepts, beyond a real `false`.
 *
 * `'false'` and `'0'` are in here because the substitution these run
 * against is textual: every token substitutes as text, so a `boolean` prop set
 * to `false` in the Attributes panel arrives as the STRING `'false'` — which
 * plain JS truthiness would read as "yes, hide".
 */
const FALSY_DIRECTIVE_VALUES = new Set(['', 'false', '0', 'off', 'no'])

/**
 * Whether a value says yes, no, or nothing at all.
 *
 * The spellings a visibility directive accepts, because the value travels the
 * same textual path to get here: `false`, `'false'`, `'0'`, `'off'`, `'no'` and
 * `''` all read as no. `undefined` means there is nothing to read — the value
 * is absent, or is still an unsubstituted token.
 *
 * The unresolved-token case is deliberately "no opinion": a definition binding
 * a prop nobody declared leaves `{{prop.ghost}}` in place verbatim (only
 * declared names are substituted), and the literal string is neither obviously
 * true nor obviously false. Treating it as either would let one typo blank a
 * section of a live page.
 */
export function readYesNoValue(value: unknown): boolean | undefined {
  if (value == null) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return Boolean(value)
  const trimmed = value.trim()
  if (trimmed.includes('{{')) return undefined
  return !FALSY_DIRECTIVE_VALUES.has(trimmed.toLowerCase())
}

/**
 * The icon an instance picked for an `icon` prop, or `undefined` when it
 * picked none.
 *
 * Stored as a whole {@link ReusableComponentIcon} so the path travels with the
 * id. A bare id — written by anything other than the Attributes panel — still
 * counts as a pick; it simply arrives with no path to draw on a published
 * page.
 */
export function readInstanceIconValue(
  value: unknown,
): ReusableComponentIcon | undefined {
  if (typeof value === 'string') {
    return value.trim() ? { iconId: value.trim() } : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const { iconId, iconPath } = value as ReusableComponentIcon
  if (typeof iconId !== 'string' || !iconId) return undefined
  return typeof iconPath === 'string' && iconPath
    ? { iconId, iconPath }
    : { iconId }
}

type DeclaredProp = Pick<
  ReusableComponentProp,
  'name' | 'type' | 'options' | 'settings' | 'defaultValue' | 'defaultIconPath' | 'condition'
>

/**
 * What a stored value counts as for its property, or `undefined` where it set
 * nothing.
 *
 * `''` is unset, so clearing a field hands the page back to the default. An
 * icon pick is read whole. A list is a value only for a property that takes
 * several, where a single stored answer counts as a list of one; any other
 * object is unset too — the only object a property value is ever written as is
 * an icon or a list, so one anywhere else is a value left behind when the
 * property's type changed, and stringifying it would put `[object Object]` on
 * the page.
 */
export function readReusablePropValue(
  value: unknown,
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
): unknown {
  if (value == null || value === '') return undefined
  const valueClass = reusablePropValueClass(prop)
  if (valueClass === 'icon') return readInstanceIconValue(value)
  if (reusablePropTakesSeveral(prop)) {
    const list = Array.isArray(value) ? value : [value]
    const answers = list.filter(
      (entry) => typeof entry === 'string' || typeof entry === 'number',
    )
    return answers.length ? answers : undefined
  }
  if (typeof value === 'object') return undefined
  return value
}

/**
 * What a property is worth where a page set nothing: its declared default,
 * read the way a page's own value is read — an Icon's default as the pick it
 * stands for, id and path together.
 */
export function reusablePropDefaultValue(
  prop: DeclaredProp | null | undefined,
): unknown {
  return prop ? readDefaultValue(prop) : undefined
}

/** A declaration's default, read the way a page's own value is read. */
function readDefaultValue(prop: DeclaredProp): unknown {
  if (reusablePropValueClass(prop) === 'icon') {
    const iconId =
      typeof prop.defaultValue === 'string' ? prop.defaultValue : undefined
    if (!iconId) return undefined
    return prop.defaultIconPath
      ? { iconId, iconPath: prop.defaultIconPath }
      : { iconId }
  }
  return readReusablePropValue(prop.defaultValue, prop)
}

/**
 * The value a property's condition rules compare, given what it is worth: a
 * Yes / no as a real boolean, a number as a number, an icon as its id, and
 * everything else as stored — so a rule written against the value a control
 * shows matches the value the page stored, whatever spelling it was stored in.
 */
export function reusablePropConditionValue(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
  value: unknown,
): unknown {
  switch (reusablePropValueClass(prop)) {
    case 'boolean':
      return readYesNoValue(value) === true
    case 'number': {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.trim() !== '') {
        const numeric = Number(value)
        return Number.isFinite(numeric) ? numeric : value
      }
      return value
    }
    case 'icon':
      return readInstanceIconValue(value)?.iconId
    default:
      return value
  }
}

/**
 * data-driven-forms' idea of empty: a number and `true` are never empty, an
 * invalid date is, and everything else is empty the way lodash's `isEmpty`
 * says.
 */
function isEmptyValue(value: unknown): boolean {
  if (value instanceof Date) return Number.isNaN(value.getTime())
  return typeof value === 'number' || value === true ? false : isEmpty(value)
}

/**
 * The longest pattern a property condition may carry (AGL-2893) — the bound a
 * marketplace declaration has always been held to.
 */
export const REUSABLE_PROP_PATTERN_MAX_LENGTH = 500

/**
 * The longest value a condition's pattern is matched against (AGL-2893). The
 * match is linear in the value, and this keeps the most a page can be made to
 * spend on one rule to a few milliseconds; a longer value holds no pattern
 * rule, the way a pattern that cannot be matched holds none.
 */
export const REUSABLE_PROP_PATTERN_INPUT_MAX_LENGTH = 2000

/**
 * Why a condition's pattern cannot be matched on a page, or `undefined` when
 * it can (AGL-2893).
 *
 * A condition is written by whoever declared the property — a marketplace
 * publisher, a template, a document written without the Properties dialog —
 * and matched on every page that places the component and in the console of
 * everyone editing one. So a pattern is matched by a linear-time engine
 * (`compileLinearTest`), never by `RegExp`: a backtracking matcher takes
 * seconds on `^(a+)+$` against a 28-character value, and the time doubles
 * with each character. No check of a pattern's shape can make `RegExp` safe —
 * `^a*a*a*a*a*a*a*a*$` nests no quantifier and takes a minute on 61
 * characters — so the engine is the bound, not a heuristic.
 *
 * What it names: a pattern that is not text or is longer than
 * {@link REUSABLE_PROP_PATTERN_MAX_LENGTH}; flags `RegExp` would refuse or the
 * engine does not implement (`u`, `v`); syntax outside the engine's subset
 * (lookaround, backreferences, named groups); and anything
 * `RegExp` itself refuses. One answer for the Properties dialog, every
 * server-side write of a declaration, and the evaluator below.
 */
export function reusablePropPatternProblem(
  pattern: unknown,
  flags?: unknown,
): string | undefined {
  if (typeof pattern !== 'string') return 'a pattern is text'
  if (flags !== undefined && typeof flags !== 'string') {
    return 'its flags are not text'
  }
  if (pattern.length > REUSABLE_PROP_PATTERN_MAX_LENGTH) {
    return `it is longer than ${REUSABLE_PROP_PATTERN_MAX_LENGTH} characters`
  }
  const flagText = typeof flags === 'string' ? flags : ''
  const reason = explainLinearTest(pattern, flagText)
  if (reason) return reason
  try {
    // Only ever constructed, never run: `RegExp` is the authority on what is
    // a regular expression, and the engine on what it can match safely.
    new RegExp(pattern, flagText)
  } catch {
    return 'it is not a regular expression'
  }
  return undefined
}

/** Compiled patterns by flags and source; `null` for one that cannot be. */
const compiledPatterns = new Map<string, LinearTest | null>()

/** Enough for every pattern a site's components declare, and then some. */
const COMPILED_PATTERNS_MAX = 256

function compiledPattern(pattern: unknown, flags: unknown): LinearTest | null {
  if (typeof pattern !== 'string') return null
  if (flags !== undefined && typeof flags !== 'string') return null
  // A flags string never holds `/`, so no two pairs share a key.
  const key = `${flags ?? ''}/${pattern}`
  const cached = compiledPatterns.get(key)
  if (cached !== undefined) return cached
  const compiled =
    reusablePropPatternProblem(pattern, flags) === undefined
      ? compileLinearTest(pattern, (flags as string | undefined) ?? '')
      : null
  if (compiledPatterns.size >= COMPILED_PATTERNS_MAX) compiledPatterns.clear()
  compiledPatterns.set(key, compiled)
  return compiled
}

/**
 * Whether a value matches a condition's pattern — what
 * `new RegExp(pattern, flags).test(value)` answers — or `undefined` when the
 * pattern cannot be matched safely (see {@link reusablePropPatternProblem}) or
 * the value is longer than {@link REUSABLE_PROP_PATTERN_INPUT_MAX_LENGTH}.
 * Never throws.
 */
export function matchReusablePropPattern(
  pattern: unknown,
  flags: unknown,
  value: unknown,
): boolean | undefined {
  const compiled = compiledPattern(pattern, flags)
  if (!compiled) return undefined
  let text: string
  try {
    // `test` reads its argument as text, and so must this.
    text = String(value)
  } catch {
    return undefined
  }
  if (text.length > REUSABLE_PROP_PATTERN_INPUT_MAX_LENGTH) return undefined
  return compiled.test(text)
}

/**
 * One rule against the value it names, with data-driven-forms' own precedence
 * — the same order `parseCondition` applies, which a spec runs both against so
 * the Attributes panel and a published page can never disagree.
 *
 * A pattern rule whose pattern cannot be matched safely, or whose value is too
 * long to match, holds nothing — whichever way it reads the pattern — so the
 * property renders as one whose condition is unmet (AGL-2893). A throw here
 * used to reach the tenant loader's catch and turn every page placing the
 * component into a 404.
 */
export function evaluateReusablePropRule(
  rule: Omit<ReusableComponentPropRule, 'when'>,
  value: unknown,
): boolean {
  if (rule.isNotEmpty) return !isEmptyValue(value)
  if (rule.isEmpty) return isEmptyValue(value)
  if (rule.pattern) {
    const matched = matchReusablePropPattern(rule.pattern, rule.flags, value)
    if (matched === undefined) return false
    return rule.notMatch ? !matched : matched
  }
  const compare = value as number
  if (Object.prototype.hasOwnProperty.call(rule, 'greaterThan')) {
    return compare > (rule.greaterThan as number)
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'greaterThanOrEqualTo')) {
    return compare >= (rule.greaterThanOrEqualTo as number)
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'lessThan')) {
    return compare < (rule.lessThan as number)
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'lessThanOrEqualTo')) {
    return compare <= (rule.lessThanOrEqualTo as number)
  }
  const matched = Array.isArray(rule.is)
    ? (rule.is as unknown[]).includes(value)
    : value === rule.is
  return rule.notMatch ? !matched : matched
}

/**
 * Whether a condition holds against the values its rules name.
 *
 * A list must all hold, `and` must all hold, `or` needs one, `not` negates —
 * data-driven-forms' `parseCondition`, minus what a stored document cannot
 * carry. A shape it does not recognize holds nothing, which is also what
 * `parseCondition` answers for a rule with no `when`.
 */
export function evaluateReusablePropCondition(
  condition: ReusableComponentPropCondition | ReusableComponentPropCondition[] | null | undefined,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (condition == null) return true
  if (Array.isArray(condition)) {
    return condition.every((entry) => evaluateReusablePropCondition(entry, values))
  }
  if (typeof condition !== 'object') return false
  if ('and' in condition) {
    const and = (condition as { and: unknown }).and
    return (Array.isArray(and) ? and : [and]).every((entry) =>
      evaluateReusablePropCondition(entry as ReusableComponentPropCondition, values),
    )
  }
  if ('or' in condition) {
    const or = (condition as { or: unknown }).or
    return (Array.isArray(or) ? or : [or]).some((entry) =>
      evaluateReusablePropCondition(entry as ReusableComponentPropCondition, values),
    )
  }
  if ('not' in condition) {
    return !evaluateReusablePropCondition(
      (condition as { not: ReusableComponentPropCondition }).not,
      values,
    )
  }
  const rule = condition as ReusableComponentPropRule
  if (typeof rule.when !== 'string' || !rule.when) return false
  return evaluateReusablePropRule(rule, values[rule.when])
}

type StoredCondition =
  | ReusableComponentPropCondition
  | ReusableComponentPropCondition[]

/**
 * A condition with every rule whose pattern cannot be matched removed
 * (AGL-2893), or `undefined` when nothing is left of it. Handed back as it was
 * when nothing needed removing.
 *
 * A rule that names a pattern is read for that pattern; the rest of it means
 * nothing without one, so the whole rule goes, the way a rule that names no
 * property does. A list or `and` keeps the rules left and goes when none are;
 * an `or` likewise; a `not` goes with its rule. Removing a rule can loosen an
 * `and` or tighten an `or`, and either is a condition a page can evaluate,
 * where the rule removed was one no page could.
 */
function withoutUnmatchablePatterns(
  condition: unknown,
): StoredCondition | undefined {
  if (condition == null || typeof condition !== 'object') {
    return condition as StoredCondition | undefined
  }
  const cleanList = (list: unknown[]) => {
    const kept = list
      .map((entry) => withoutUnmatchablePatterns(entry))
      .filter((entry) => entry !== undefined)
    const unchanged =
      kept.length === list.length && kept.every((entry, at) => entry === list[at])
    return { kept: kept as ReusableComponentPropCondition[], unchanged }
  }
  if (Array.isArray(condition)) {
    const { kept, unchanged } = cleanList(condition)
    if (unchanged) return condition as ReusableComponentPropCondition[]
    return kept.length ? kept : undefined
  }
  const value = condition as Record<string, unknown>
  for (const key of ['and', 'or'] as const) {
    if (!(key in value)) continue
    const inner = value[key]
    const { kept, unchanged } = cleanList(Array.isArray(inner) ? inner : [inner])
    if (unchanged) return condition as ReusableComponentPropCondition
    return kept.length
      ? ({ ...value, [key]: kept } as ReusableComponentPropCondition)
      : undefined
  }
  if ('not' in value) {
    const inner = withoutUnmatchablePatterns(value['not'])
    if (inner === value['not']) return condition as ReusableComponentPropCondition
    return inner === undefined
      ? undefined
      : ({ ...value, not: inner } as ReusableComponentPropCondition)
  }
  // Read as the evaluator reads it: an empty pattern names none.
  if (value['pattern'] && reusablePropPatternProblem(value['pattern'], value['flags'])) {
    return undefined
  }
  return condition as ReusableComponentPropCondition
}

/**
 * Declared properties as a server-side write stores them: each condition
 * without the rules whose pattern cannot be matched, and a property whose
 * condition is left with nothing stored with none (AGL-2893). Anything that is
 * not a list of declarations comes back as it was, as does a list with nothing
 * to remove.
 *
 * The page never needs this — a rule it cannot match holds nothing there — but
 * a stored declaration is read by the Properties dialog, copied by templates
 * and published to the marketplace, and a pattern that can never be matched
 * should stop there rather than travel.
 */
export function withMatchableConditions<T>(props: T): T {
  if (!Array.isArray(props)) return props
  let changed = false
  const next = props.map((prop) => {
    if (!prop || typeof prop !== 'object' || !('condition' in prop)) return prop
    const { condition, ...rest } = prop as { condition?: unknown }
    const kept = withoutUnmatchablePatterns(condition)
    if (kept === condition) return prop
    changed = true
    return kept === undefined ? rest : { ...rest, condition: kept }
  })
  return (changed ? next : props) as T
}

/** Text a value substitutes as wherever its token sits inside other text. */
function substitutedText(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') {
    return readInstanceIconValue(value)?.iconId ?? ''
  }
  return String(value)
}

/** Every property's value for one page, in the three forms the graft reads. */
export interface ResolvedReusablePropValues {
  /** `prop.<name>` → the text each `{{prop.<name>}}` substitutes as. */
  tokens: Record<string, string>
  /**
   * Name → what a field bound to exactly that token receives, before its kind
   * finishes it; absent where the property has nothing to give.
   */
  values: Record<string, unknown>
  /** Name → the SVG path an Icon property's pick or default draws with. */
  iconPaths: Record<string, string>
  /** The names whose condition does not hold on this page. */
  off: Set<string>
}

/**
 * What each declared property is worth on one page.
 *
 * `values` is the page's own map — an instance's `propValues`, or a screen's
 * values for its layout — and a property it leaves unset takes its default.
 * A property whose condition does not hold renders as one with no value and no
 * default. Conditions compare what each property is worth before any condition
 * applies, which is what the Attributes panel compares too, so a field and the
 * page it sets agree.
 *
 * `defaultsOnly` is the editor's view of its own definition: a property with no
 * default keeps its token, so a slot nothing fills stays visible.
 */
export function resolveReusablePropValues(
  declared: readonly DeclaredProp[] | null | undefined,
  values?: Readonly<Record<string, unknown>> | null,
  options?: { defaultsOnly?: boolean },
): ResolvedReusablePropValues {
  const resolved: ResolvedReusablePropValues = {
    tokens: {},
    values: {},
    iconPaths: {},
    off: new Set(),
  }
  const props = (declared ?? []).filter(
    (prop): prop is DeclaredProp => Boolean(prop?.name),
  )
  if (!props.length) return resolved
  const worth = new Map<string, unknown>()
  const compared: Record<string, unknown> = {}
  for (const prop of props) {
    const own = options?.defaultsOnly
      ? undefined
      : readReusablePropValue(values?.[prop.name], prop)
    const value = own === undefined ? readDefaultValue(prop) : own
    worth.set(prop.name, value)
    compared[prop.name] = reusablePropConditionValue(prop, value)
  }
  for (const prop of props) {
    if (!evaluateReusablePropCondition(prop.condition, compared)) {
      resolved.off.add(prop.name)
      if (!options?.defaultsOnly) {
        resolved.tokens[`${COMPONENT_PROP_TOKEN_PREFIX}${prop.name}`] = ''
      }
      continue
    }
    const value = worth.get(prop.name)
    if (options?.defaultsOnly && value === undefined) continue
    resolved.tokens[`${COMPONENT_PROP_TOKEN_PREFIX}${prop.name}`] =
      substitutedText(value)
    if (value !== undefined) resolved.values[prop.name] = value
    const iconPath =
      reusablePropValueClass(prop) === 'icon'
        ? (value as ReusableComponentIcon | undefined)?.iconPath
        : undefined
    if (iconPath) resolved.iconPaths[prop.name] = iconPath
  }
  return resolved
}

/**
 * Token map of a definition's OWN defaults, with no instance in the picture.
 *
 * What the component editor draws with (AGL-2870). A page substitutes an unset
 * prop as `''`, which is right there — an unset prop renders nothing — and
 * wrong here, where a prop with no default has nothing to preview and should
 * keep showing its raw token so the author can see at a glance which slots are
 * still unfilled.
 *
 * `false` and `0` are real defaults and survive; only `null`, `undefined` and
 * `''` are treated as "no default set".
 */
export function buildComponentDefaultTokens(
  declared: readonly DeclaredProp[] | null | undefined,
): Record<string, string> {
  return resolveReusablePropValues(declared, undefined, { defaultsOnly: true })
    .tokens
}

/**
 * The icon paths a definition's OWN defaults draw with — what the component
 * editor shows beside {@link buildComponentDefaultTokens}.
 */
export function buildComponentDefaultIconPaths(
  declared: readonly DeclaredProp[] | null | undefined,
): Record<string, string> {
  return resolveReusablePropValues(declared, undefined, { defaultsOnly: true })
    .iconPaths
}

/**
 * The values a definition's OWN defaults hand their bound fields — what the
 * component editor draws with beside {@link buildComponentDefaultTokens}.
 */
export function buildComponentDefaultValues(
  declared: readonly DeclaredProp[] | null | undefined,
): Record<string, unknown> {
  return resolveReusablePropValues(declared, undefined, { defaultsOnly: true })
    .values
}
