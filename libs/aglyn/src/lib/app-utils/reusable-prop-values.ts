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

import isEmpty from 'lodash-es/isEmpty'
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
 * One rule against the value it names, with data-driven-forms' own precedence
 * — the same order `parseCondition` applies, which a spec runs both against so
 * the Attributes panel and a published page can never disagree.
 */
export function evaluateReusablePropRule(
  rule: Omit<ReusableComponentPropRule, 'when'>,
  value: unknown,
): boolean {
  if (rule.isNotEmpty) return !isEmptyValue(value)
  if (rule.isEmpty) return isEmptyValue(value)
  if (rule.pattern) {
    const matched = new RegExp(rule.pattern, rule.flags).test(
      value as string,
    )
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
