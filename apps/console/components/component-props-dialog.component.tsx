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

'use client'

import type * as Aglyn from '@aglyn/aglyn'
import {
  COMPONENT_PROP_NAME_PATTERN,
  FieldComponentType,
  stripUndefinedDeep,
  REUSABLE_PROP_KIND_GROUPS,
  REUSABLE_PROP_KINDS,
  reusablePropHasAnswers,
  reusablePropKind,
  reusablePropPatternProblem,
  reusablePropTakesSeveral,
  reusablePropValueClass,
} from '@aglyn/aglyn'
import { mdiDelete, mdiPlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  AttributeFieldsForm,
  PropertyValuesForm,
  type PropertyOwnerNoun,
} from '@aglyn/besigner-ui'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormHelperText,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

/**
 * Kinds whose default is free text in one shape or another — a word, a
 * number, an image address, a link — so a default typed under one still
 * means something under another.
 */
const TEXT_SHAPED_TYPES: ReadonlySet<string> = new Set([
  'text',
  'richText',
  'image',
  'href',
  'number',
])

/** Every kind, listed under the group the type picker shows it in. */
const TYPES_BY_GROUP = REUSABLE_PROP_KIND_GROUPS.map((group) => ({
  group,
  types: (Object.keys(REUSABLE_PROP_KINDS) as Aglyn.ReusableComponentPropType[]).filter(
    (type) => REUSABLE_PROP_KINDS[type].group === group,
  ),
}))

/**
 * The patch that changes a property's type, keeping the default only where it
 * still means something.
 *
 * A headline typed as the default of a Text property is not a yes or a no:
 * carried into a Yes / no property it would read as Yes, which nobody chose.
 * So a default survives a change between text-shaped kinds and is dropped on
 * any change into or out of the others, leaving that kind's own "not set".
 * Answers stay with a kind that takes them, and a kind's settings and an
 * Icon's path belong to the kind they were set for. The condition stays: it
 * is about when this property applies, whatever it holds.
 */
export function retypeComponentProp(
  prop: Aglyn.ReusableComponentProp,
  type: Aglyn.ReusableComponentPropType,
): Partial<Aglyn.ReusableComponentProp> {
  const from = prop.type ?? 'text'
  if (from === type) return { type }
  const keepsDefault = TEXT_SHAPED_TYPES.has(from) && TEXT_SHAPED_TYPES.has(type)
  const takesAnswers = reusablePropKind(type).options
  return {
    type,
    ...(keepsDefault ? {} : { defaultValue: undefined }),
    options:
      takesAnswers === 'required'
        ? (prop.options ?? [])
        : takesAnswers === 'optional'
          ? prop.options
          : undefined,
    settings: undefined,
    defaultIconPath: undefined,
  }
}

/** What is wrong with one property, field by field — `''` where nothing is. */
export interface ComponentPropErrors {
  name: string
  choices: string
  settings: string
  condition: string
}

/** One rule as the dialog edits it: a property, an operator, a value. */
export interface PropertyRuleDraft {
  when: string
  operator: PropertyRuleOperator
  operand?: unknown
}

/** The operators a rule offers — the attribute schema's condition operators. */
export type PropertyRuleOperator =
  | 'is'
  | 'isNot'
  | 'isOneOf'
  | 'isNotOneOf'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'matches'
  | 'doesNotMatch'
  | 'greaterThan'
  | 'greaterThanOrEqualTo'
  | 'lessThan'
  | 'lessThanOrEqualTo'

export const PROPERTY_RULE_OPERATOR_LABELS: Readonly<
  Record<PropertyRuleOperator, string>
> = {
  is: 'is',
  isNot: 'is not',
  isOneOf: 'is one of',
  isNotOneOf: 'is none of',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  matches: 'matches the pattern',
  doesNotMatch: 'does not match the pattern',
  greaterThan: 'is more than',
  greaterThanOrEqualTo: 'is at least',
  lessThan: 'is less than',
  lessThanOrEqualTo: 'is at most',
}

const COMPARISONS: readonly PropertyRuleOperator[] = [
  'greaterThan',
  'greaterThanOrEqualTo',
  'lessThan',
  'lessThanOrEqualTo',
]

/**
 * The operators that can say something about a property: every value can be
 * empty or not; one value can be compared with `is`; a number can be
 * compared; an answer can be one of several; and text can match a pattern.
 * A property holding several answers is a list, which only empty or not
 * empty can describe.
 */
export function propertyRuleOperators(
  target: Aglyn.ReusableComponentProp | undefined,
): PropertyRuleOperator[] {
  if (!target) return ['isEmpty', 'isNotEmpty']
  if (reusablePropTakesSeveral(target)) return ['isNotEmpty', 'isEmpty']
  const valueClass = reusablePropValueClass(target)
  if (valueClass === 'boolean') return ['is', 'isNot']
  const operators: PropertyRuleOperator[] = ['is', 'isNot']
  if (reusablePropHasAnswers(target)) operators.push('isOneOf', 'isNotOneOf')
  if (valueClass === 'number') operators.push(...COMPARISONS)
  operators.push('isEmpty', 'isNotEmpty')
  if (valueClass === 'text' || valueClass === 'value') {
    operators.push('matches', 'doesNotMatch')
  }
  return operators
}

/** A rule the dialog edits, as the condition stores it. */
export function propertyRuleFor(
  draft: PropertyRuleDraft,
): Aglyn.ReusableComponentPropRule {
  const { when, operator, operand } = draft
  switch (operator) {
    case 'is':
      return { when, is: operand as never }
    case 'isNot':
      return { when, is: operand as never, notMatch: true }
    case 'isOneOf':
      return { when, is: (Array.isArray(operand) ? operand : []) as never }
    case 'isNotOneOf':
      return {
        when,
        is: (Array.isArray(operand) ? operand : []) as never,
        notMatch: true,
      }
    case 'isEmpty':
      return { when, isEmpty: true }
    case 'isNotEmpty':
      return { when, isNotEmpty: true }
    case 'matches':
      return { when, pattern: String(operand ?? '') }
    case 'doesNotMatch':
      return { when, pattern: String(operand ?? ''), notMatch: true }
    default:
      return { when, [operator]: Number(operand) }
  }
}

/** A stored rule as the dialog edits it, or `null` for one it cannot show. */
export function describePropertyRule(
  rule: Aglyn.ReusableComponentPropRule,
): PropertyRuleDraft | null {
  const { when } = rule
  if (typeof when !== 'string') return null
  if (rule.isEmpty) return { when, operator: 'isEmpty' }
  if (rule.isNotEmpty) return { when, operator: 'isNotEmpty' }
  if (typeof rule.pattern === 'string') {
    return {
      when,
      operator: rule.notMatch ? 'doesNotMatch' : 'matches',
      operand: rule.pattern,
    }
  }
  for (const operator of COMPARISONS) {
    if (Object.prototype.hasOwnProperty.call(rule, operator)) {
      return { when, operator, operand: rule[operator as keyof typeof rule] }
    }
  }
  if (Array.isArray(rule.is)) {
    return {
      when,
      operator: rule.notMatch ? 'isNotOneOf' : 'isOneOf',
      operand: [...rule.is],
    }
  }
  return { when, operator: rule.notMatch ? 'isNot' : 'is', operand: rule.is }
}

/** A condition as the dialog edits it: rules, and whether all or any must hold. */
export interface PropertyConditionDraft {
  join: 'all' | 'any'
  rules: PropertyRuleDraft[]
}

const isRule = (entry: unknown): entry is Aglyn.ReusableComponentPropRule =>
  Boolean(entry) &&
  typeof entry === 'object' &&
  typeof (entry as { when?: unknown }).when === 'string'

/**
 * A stored condition as the dialog edits it, or `null` when it is a shape the
 * dialog cannot show — nested `and`, `or` or `not`, written some other way.
 */
export function readPropertyCondition(
  condition: Aglyn.ReusableComponentProp['condition'],
): PropertyConditionDraft | null {
  if (condition == null) return { join: 'all', rules: [] }
  const read = (entries: unknown[], join: 'all' | 'any') => {
    if (!entries.every(isRule)) return null
    const rules = entries.map((entry) => describePropertyRule(entry))
    return rules.every(Boolean)
      ? { join, rules: rules as PropertyRuleDraft[] }
      : null
  }
  if (Array.isArray(condition)) return read(condition, 'all')
  if (isRule(condition)) return read([condition], 'all')
  if ('and' in condition && Array.isArray(condition.and)) {
    return read(condition.and, 'all')
  }
  if ('or' in condition && Array.isArray(condition.or)) {
    return read(condition.or, 'any')
  }
  return null
}

/** The condition the dialog's rules store, or `undefined` for none. */
export function writePropertyCondition(
  draft: PropertyConditionDraft,
): Aglyn.ReusableComponentProp['condition'] {
  const rules = draft.rules.map(propertyRuleFor)
  if (!rules.length) return undefined
  if (rules.length === 1) return rules[0]
  return draft.join === 'any' ? { or: rules } : rules
}

/** Every rule a condition holds, however it is nested. */
function conditionRules(condition: unknown): Aglyn.ReusableComponentPropRule[] {
  if (condition == null || typeof condition !== 'object') return []
  if (Array.isArray(condition)) return condition.flatMap(conditionRules)
  if (isRule(condition)) return [condition]
  const nested = condition as { and?: unknown; or?: unknown; not?: unknown }
  return [nested.and, nested.or, nested.not].flatMap((entry) =>
    Array.isArray(entry) ? entry.flatMap(conditionRules) : conditionRules(entry),
  )
}

/**
 * The draft with every condition that named `from` naming `to` instead — what
 * renaming a property in the dialog does to the rules that read it, so a
 * rename does not quietly switch another property's condition off.
 */
export function renameConditionReferences(
  draft: readonly Aglyn.ReusableComponentProp[],
  from: string,
  to: string,
): Aglyn.ReusableComponentProp[] {
  if (!from || from === to) return [...draft]
  const rename = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(rename)
    if (!entry || typeof entry !== 'object') return entry
    if (isRule(entry)) return entry.when === from ? { ...entry, when: to } : entry
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry)) next[key] = rename(value)
    return next
  }
  return draft.map((prop) =>
    prop.condition == null
      ? prop
      : { ...prop, condition: rename(prop.condition) as Aglyn.ReusableComponentProp['condition'] },
  )
}

/**
 * Every property's problems, in draft order.
 *
 * A name is checked against the pattern the graft requires and against every
 * name before it. A kind that lists answers needs them, and each answer needs
 * a value no other answer has: the value is what a bound field receives, so an
 * empty one could never be picked and a repeated one would be two labels for
 * one result. A kind's settings need what the kind cannot be drawn without. A
 * condition's rules must name another property this one can read, with a
 * value the operator can compare.
 */
export function componentPropErrors(
  draft: readonly Aglyn.ReusableComponentProp[],
): ComponentPropErrors[] {
  const seen = new Set<string>()
  const names = new Map(
    draft.map((prop) => [prop.name?.trim() ?? '', prop] as const),
  )
  return draft.map((prop) => {
    const name = prop.name?.trim() ?? ''
    let nameError = ''
    if (!name) nameError = 'A name is required'
    else if (!COMPONENT_PROP_NAME_PATTERN.test(name)) {
      nameError =
        'Letters, numbers and underscores only, not starting with a number'
    } else if (seen.has(name)) nameError = 'Already used by another property'
    if (name) seen.add(name)

    const kind = reusablePropKind(prop.type)
    let choicesError = ''
    if (kind.options) {
      const values = (prop.options ?? []).map((option) =>
        (option?.value ?? '').trim(),
      )
      const repeated = values.find(
        (value, index) => value && values.indexOf(value) !== index,
      )
      if (!values.length && kind.options === 'required') {
        choicesError = 'Add at least one choice'
      } else if (values.some((value) => !value)) {
        choicesError = 'Every choice needs a value'
      } else if (repeated) {
        choicesError = `Two choices share the value "${repeated}"`
      }
    }

    let settingsError = ''
    const settings = prop.settings ?? {}
    switch (prop.type) {
      case FieldComponentType.THEME_SCALE:
        if (!settings['scale']) settingsError = 'Choose the scale to offer'
        break
      case FieldComponentType.PRESET_CHOICE:
        if (!settings['presets']) settingsError = 'Choose the presets to offer'
        break
      case FieldComponentType.PLUGIN_SETTINGS: {
        const plugin = names.get(String(settings['pluginProperty'] ?? ''))
        if (plugin?.type !== FieldComponentType.PLUGIN_SELECT) {
          settingsError =
            'Choose the Plugin property whose plugin these settings are for'
        }
        break
      }
      case FieldComponentType.SLIDER: {
        const min = Number(settings['min'] ?? 0)
        const max = Number(settings['max'] ?? 100)
        if (!(min < max)) {
          settingsError = 'The highest value must be above the lowest'
        }
        break
      }
    }

    let conditionError = ''
    for (const rule of conditionRules(prop.condition)) {
      const target = names.get(rule.when)
      if (!rule.when || !target) {
        conditionError = 'A rule reads a property this component does not declare'
      } else if (rule.when === name) {
        conditionError = 'A property cannot depend on itself'
      } else if (typeof rule.pattern === 'string') {
        // The rule every page matches the pattern by (AGL-2893), so a
        // pattern saved here is one the published page can evaluate.
        const problem = reusablePropPatternProblem(rule.pattern, rule.flags)
        if (problem) {
          conditionError = `"${rule.pattern}" is not a pattern that can be matched: ${problem}`
        }
      } else if (
        COMPARISONS.some(
          (operator) =>
            Object.prototype.hasOwnProperty.call(rule, operator) &&
            !Number.isFinite(rule[operator as keyof typeof rule] as number),
        )
      ) {
        conditionError = 'Compare with a number'
      } else if (Array.isArray(rule.is) && !rule.is.length) {
        conditionError = 'Choose at least one answer'
      } else if (
        (rule.is === undefined || rule.is === '') &&
        !rule.isEmpty &&
        !rule.isNotEmpty &&
        !COMPARISONS.some((operator) =>
          Object.prototype.hasOwnProperty.call(rule, operator),
        )
      ) {
        conditionError = 'Choose the value to compare with'
      }
      if (conditionError) break
    }

    return {
      name: nameError,
      choices: choicesError,
      settings: settingsError,
      condition: conditionError,
    }
  })
}

/** A default with nothing in it: unset, empty text, or no answers. */
const isEmptyDefault = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/**
 * The draft as it is saved: trimmed, with only the fields its kind uses.
 *
 * A default for a kind with answers is kept only while it still names them —
 * editing an answer's value would otherwise leave the default pointing at a
 * value no page can pick, and every page that sets nothing would render it.
 * `false` and `0` are real defaults and survive.
 */
export function cleanComponentProps(
  draft: readonly Aglyn.ReusableComponentProp[],
): Aglyn.ReusableComponentProp[] {
  return draft.map((prop) => {
    const type = prop.type ?? 'text'
    const kind = reusablePropKind(type)
    const answers = kind.options
      ? (prop.options ?? []).map((option) => ({
          value: (option?.value ?? '').trim(),
          ...(option?.label?.trim() && { label: option.label.trim() }),
        }))
      : undefined
    const options =
      answers && (answers.length || kind.options === 'required')
        ? answers
        : undefined
    const settingNames = new Set((kind.settings ?? []).map((setting) => setting.name))
    const settings: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(prop.settings ?? {})) {
      if (!settingNames.has(key) || isEmptyDefault(value)) continue
      const declared = kind.settings?.find((setting) => setting.name === key)
      if (declared?.['type'] === 'number') {
        const numeric = Number(value)
        if (Number.isFinite(numeric)) settings[key] = numeric
      } else {
        settings[key] = value
      }
    }
    const cleanedProp = {
      ...prop,
      type,
      options,
      settings,
    } as Aglyn.ReusableComponentProp
    let defaultValue = prop.defaultValue
    if (options) {
      const offered = new Set(options.map((option) => option.value))
      if (reusablePropTakesSeveral(cleanedProp)) {
        const picked = (Array.isArray(defaultValue) ? defaultValue : [defaultValue])
          .filter((value) => offered.has(String(value)))
        defaultValue = picked.length ? (picked as string[]) : undefined
      } else if (!offered.has(String(defaultValue))) {
        // A single checkbox with answers is a list; without them it is a
        // yes or a no, and a yes or a no is not one of the answers.
        defaultValue =
          type === FieldComponentType.CHECKBOX && !options.length
            ? defaultValue
            : undefined
      }
    }
    if (isEmptyDefault(defaultValue)) defaultValue = undefined
    // An Icon's default travels with its path, and only with it: the path is
    // what a published page draws.
    const defaultIconPath =
      type === 'icon' && defaultValue ? prop.defaultIconPath : undefined
    // Stored as a plain Firestore map, which refuses an `undefined` anywhere
    // inside it — and a list or a condition built in the dialog can hold one.
    return stripUndefinedDeep({
      name: prop.name.trim(),
      type,
      ...(prop.label?.trim() && { label: prop.label.trim() }),
      ...(prop.description?.trim() && { description: prop.description.trim() }),
      ...(defaultValue !== undefined && { defaultValue }),
      ...(options && { options }),
      ...(Object.keys(settings).length && { settings }),
      ...(defaultIconPath && { defaultIconPath }),
      ...(prop.condition != null && { condition: prop.condition }),
    })
  })
}

/**
 * A kind's answers, edited as rows of plain fields: the label a page author
 * picks from, and the value the bound field receives.
 */
function ChoiceOptionsEditor(props: {
  options: Aglyn.ReusableComponentPropOption[]
  error: string
  optional?: boolean
  onChange: (options: Aglyn.ReusableComponentPropOption[]) => void
}) {
  const { options, error, optional, onChange } = props
  const edit = (index: number, patch: Partial<Aglyn.ReusableComponentPropOption>) =>
    onChange(
      options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    )
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {'Choices. A page picks one by its label, and the field this property '}
        {'is bound to receives its value — for a dropdown, use the values it '}
        {'offers, which the Attributes panel lists when you bind it.'}
        {optional ? ' Leave the list empty for a single tick box.' : ''}
      </Typography>
      {options.map((option, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            label="Label"
            size="small"
            value={option.label ?? ''}
            placeholder={option.value}
            onChange={(event) => edit(index, { label: event.target.value })}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Value"
            size="small"
            value={option.value ?? ''}
            onChange={(event) => edit(index, { value: event.target.value })}
            sx={{ flex: 1 }}
          />
          <IconButton
            aria-label={`Remove choice ${option.label || option.value || index + 1}`}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            <MdiIcon path={mdiDelete.path} />
          </IconButton>
        </Stack>
      ))}
      <Box>
        <Button
          size="small"
          startIcon={<MdiIcon path={mdiPlus.path} />}
          onClick={() => onChange([...options, { value: '', label: '' }])}
        >
          {'Add choice'}
        </Button>
      </Box>
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </Stack>
  )
}

/** The value a rule compares against, edited with the named property's control. */
function RuleOperandField(props: {
  rule: PropertyRuleDraft
  target: Aglyn.ReusableComponentProp | undefined
  onChange: (operand: unknown) => void
}) {
  const { rule, target, onChange } = props
  const { operator } = rule
  if (operator === 'isEmpty' || operator === 'isNotEmpty' || !target) return null
  const answers = (target.options ?? [])
    .filter((option) => option?.value)
    .map((option) => ({ value: option.value, label: option.label || option.value }))
  if (operator === 'isOneOf' || operator === 'isNotOneOf') {
    return (
      <AttributeFieldsForm
        fields={[
          {
            name: 'operand',
            label: 'Answers',
            component: FieldComponentType.SELECT,
            options: answers,
            isMulti: true,
          },
        ]}
        values={{ operand: rule.operand }}
        onChange={(values) => onChange(values['operand'])}
      />
    )
  }
  if (operator === 'matches' || operator === 'doesNotMatch') {
    return (
      <AttributeFieldsForm
        fields={[
          { name: 'operand', label: 'Pattern', component: FieldComponentType.TEXT_FIELD },
        ]}
        values={{ operand: rule.operand }}
        onChange={(values) => onChange(values['operand'])}
      />
    )
  }
  if (COMPARISONS.includes(operator)) {
    return (
      <AttributeFieldsForm
        fields={[
          {
            name: 'operand',
            label: 'Number',
            component: FieldComponentType.TEXT_FIELD,
            type: 'number',
          },
        ]}
        values={{ operand: rule.operand }}
        onChange={(values) => onChange(values['operand'])}
      />
    )
  }
  // `is` and `is not` compare with a value of the property's own kind, so the
  // operand is edited with that property's control.
  return (
    <PropertyValuesForm
      declared={[
        {
          ...target,
          name: 'operand',
          label: 'Value',
          description: undefined,
          condition: undefined,
          defaultValue: undefined,
        },
      ]}
      role="default"
      values={{ operand: rule.operand }}
      onChange={(values) => onChange(values['operand'])}
    />
  )
}

/**
 * When a property shows and applies: rules over the other properties, all or
 * any of which must hold — the attribute schema's condition, edited as rows.
 */
function PropertyConditionEditor(props: {
  prop: Aglyn.ReusableComponentProp
  declared: readonly Aglyn.ReusableComponentProp[]
  error: string
  noun: PropertyOwnerNoun
  onChange: (condition: Aglyn.ReusableComponentProp['condition']) => void
}) {
  const { prop, declared, error, noun, onChange } = props
  const draft = useMemo(() => readPropertyCondition(prop.condition), [prop.condition])
  const others = declared.filter(
    (candidate) => candidate.name && candidate.name !== prop.name,
  )
  if (!draft) {
    return (
      <Stack spacing={1}>
        <Alert severity="info">
          {'This property has a condition written outside this dialog. It still '}
          {'applies; remove it to write a new one here.'}
        </Alert>
        <Box>
          <Button size="small" color="inherit" onClick={() => onChange(undefined)}>
            {'Remove condition'}
          </Button>
        </Box>
      </Stack>
    )
  }
  const write = (next: PropertyConditionDraft) => onChange(writePropertyCondition(next))
  const editRule = (index: number, patch: Partial<PropertyRuleDraft>) =>
    write({
      ...draft,
      rules: draft.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    })
  const firstRule = (): PropertyRuleDraft | undefined => {
    const target = others[0]
    if (!target) return undefined
    const operator = propertyRuleOperators(target)[0]
    return {
      when: target.name,
      operator,
      operand: reusablePropValueClass(target) === 'boolean' ? true : undefined,
    }
  }
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {draft.rules.length
          ? `Shown, and applied, only on a ${noun === 'layout' ? 'screen' : 'page'} where`
          : `Always shown. Add a condition to show and apply this property only when other properties of this ${noun} meet it.`}
      </Typography>
      {draft.rules.length > 1 ? (
        <TextField
          select
          size="small"
          label="Condition"
          value={draft.join}
          onChange={(event) =>
            write({ ...draft, join: event.target.value as 'all' | 'any' })
          }
          sx={{ maxWidth: 260 }}
        >
          <MenuItem value="all">{'All of these hold'}</MenuItem>
          <MenuItem value="any">{'Any of these holds'}</MenuItem>
        </TextField>
      ) : null}
      {draft.rules.map((rule, index) => {
        const target = others.find((candidate) => candidate.name === rule.when)
        const operators = propertyRuleOperators(target)
        return (
          <Stack
            key={index}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'flex-start' } }}
          >
            <TextField
              select
              size="small"
              label="Property"
              value={target ? rule.when : ''}
              onChange={(event) => {
                const next = others.find(
                  (candidate) => candidate.name === event.target.value,
                )
                editRule(index, {
                  when: event.target.value,
                  operator: propertyRuleOperators(next)[0],
                  operand:
                    next && reusablePropValueClass(next) === 'boolean' ? true : undefined,
                })
              }}
              sx={{ minWidth: 160 }}
            >
              {others.map((candidate) => (
                <MenuItem key={candidate.name} value={candidate.name}>
                  {candidate.label || candidate.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Operator"
              value={operators.includes(rule.operator) ? rule.operator : operators[0]}
              onChange={(event) =>
                editRule(index, {
                  operator: event.target.value as PropertyRuleOperator,
                  operand:
                    target && reusablePropValueClass(target) === 'boolean'
                      ? true
                      : undefined,
                })
              }
              sx={{ minWidth: 150 }}
            >
              {operators.map((operator) => (
                <MenuItem key={operator} value={operator}>
                  {PROPERTY_RULE_OPERATOR_LABELS[operator]}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <RuleOperandField
                key={`${rule.when}:${rule.operator}:${target?.type ?? ''}`}
                rule={rule}
                target={target}
                onChange={(operand) => editRule(index, { operand })}
              />
            </Box>
            <IconButton
              aria-label={`Remove rule ${index + 1}`}
              onClick={() =>
                write({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })
              }
            >
              <MdiIcon path={mdiDelete.path} />
            </IconButton>
          </Stack>
        )
      })}
      <Box>
        <Button
          size="small"
          startIcon={<MdiIcon path={mdiPlus.path} />}
          disabled={!others.length}
          onClick={() => {
            const rule = firstRule()
            if (rule) write({ ...draft, rules: [...draft.rules, rule] })
          }}
        >
          {draft.rules.length ? 'Add rule' : 'Add condition'}
        </Button>
      </Box>
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </Stack>
  )
}

/** A kind's settings, edited with the Attributes panel's own controls. */
function PropertySettingsEditor(props: {
  prop: Aglyn.ReusableComponentProp
  declared: readonly Aglyn.ReusableComponentProp[]
  error: string
  onChange: (settings: Aglyn.ReusableComponentProp['settings']) => void
}) {
  const { prop, declared, error, onChange } = props
  const kind = reusablePropKind(prop.type)
  const fields = useMemo(
    () =>
      (kind.settings ?? []).map((setting) => ({
        ...setting,
        name: `settings.${setting.name}`,
        ...(setting.name === 'pluginProperty'
          ? {
              options: declared
                .filter(
                  (candidate) =>
                    candidate.type === FieldComponentType.PLUGIN_SELECT &&
                    candidate.name,
                )
                .map((candidate) => ({
                  value: candidate.name,
                  label: candidate.label || candidate.name,
                })),
            }
          : {}),
      })),
    [kind, declared],
  )
  if (!fields.length) return null
  return (
    <Stack spacing={0.5}>
      <AttributeFieldsForm
        fields={fields}
        values={{ settings: prop.settings ?? {} }}
        onChange={(values) =>
          onChange(
            (values['settings'] as Aglyn.ReusableComponentProp['settings']) ?? {},
          )
        }
      />
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </Stack>
  )
}

/** A property's default as the Default field holds it. */
function defaultFormValue(prop: Aglyn.ReusableComponentProp): unknown {
  return prop.defaultValue
}

/** The Default field's value as the property stores it. */
function defaultPatch(
  prop: Aglyn.ReusableComponentProp,
  value: unknown,
): Partial<Aglyn.ReusableComponentProp> {
  if (prop.type === 'icon') {
    const icon = value as Aglyn.ReusableComponentIcon | undefined
    return {
      defaultValue: icon?.iconId || undefined,
      defaultIconPath: icon?.iconPath || undefined,
    }
  }
  return {
    defaultValue: isEmptyDefault(value)
      ? undefined
      : (value as Aglyn.ReusableComponentPropValue),
  }
}

export interface ComponentPropsDialogProps {
  open: boolean
  /** Props currently declared on the version being edited. */
  value: Aglyn.ReusableComponentProp[] | undefined
  onClose: () => void
  onSave: (props: Aglyn.ReusableComponentProp[]) => Promise<void> | void
  /** Whose properties these are: a reusable component's, or a layout's. */
  noun?: PropertyOwnerNoun
}

/**
 * Declares the properties a reusable component or a layout exposes (AGL-1247,
 * AGL-2893) — the authoring half of the feature whose renderer half is the
 * graft.
 *
 * Every kind a coded component can declare for an attribute is offered, and
 * each property's Default, settings and condition are edited with the
 * Attributes panel's own controls, so what is declared here is exactly what a
 * page sets.
 *
 * Renaming is called out rather than prevented: values are keyed by property
 * NAME, so a rename orphans every value already set on every page. The
 * warning is worth more than a block here — the author may genuinely be
 * fixing a typo on a property nothing uses yet.
 */
export function ComponentPropsDialog(props: ComponentPropsDialogProps) {
  const { open, value, onClose, onSave, noun = 'component' } = props
  const [draft, setDraft] = useState<Aglyn.ReusableComponentProp[]>([])
  const [saving, setSaving] = useState(false)
  // A key per row that survives renames and reordering, so each row's own
  // forms keep their state while the author types a name.
  const [rowKeys, setRowKeys] = useState<number[]>([])
  const [nextKey, setNextKey] = useState(0)

  // Re-seed each time the dialog opens so a cancelled edit is truly
  // discarded rather than lingering into the next open.
  useEffect(() => {
    if (!open) return
    const seeded = value?.length ? value.map((prop) => ({ ...prop })) : []
    setDraft(seeded)
    setRowKeys(seeded.map((_, index) => index))
    setNextKey(seeded.length)
  }, [open, value])

  const originalNames = useMemo(
    () => new Set((value ?? []).map((prop) => prop.name)),
    [value],
  )

  const errors = useMemo(() => componentPropErrors(draft), [draft])

  const hasErrors = errors.some(
    (error) => error.name || error.choices || error.settings || error.condition,
  )
  // A name that existed before and no longer does orphans whatever the
  // pages already set for it.
  const renamed = useMemo(() => {
    const next = new Set(draft.map((prop) => prop.name?.trim()))
    return [...originalNames].filter((name) => name && !next.has(name))
  }, [draft, originalNames])

  const update = (index: number, patch: Partial<Aglyn.ReusableComponentProp>) =>
    setDraft((current) => {
      const before = current[index]?.name ?? ''
      const edited = current.map((prop, i) =>
        i === index ? { ...prop, ...patch } : prop,
      )
      return typeof patch.name === 'string' && patch.name !== before
        ? renameConditionReferences(edited, before, patch.name)
        : edited
    })

  const handleSave = async () => {
    if (hasErrors || saving) return
    setSaving(true)
    try {
      await onSave(cleanComponentProps(draft))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const owner = noun === 'layout' ? 'layout' : 'component'
  const placement = noun === 'layout' ? 'screen that uses it' : 'place you use it'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {noun === 'layout' ? 'Layout properties' : 'Component properties'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {`Properties let one ${owner} show different content on each ${
            noun === 'layout' ? 'screen' : 'page'
          }. `}
          {'Add one here, then use its token — for example '}
          <code>{'{{prop.headline}}'}</code>
          {` — anywhere inside this ${owner}, or bind a field to it with its {} button. `}
          {noun === 'layout'
            ? `Each ${placement} sets its own values under Screen Properties.`
            : `Each ${placement} gets its own fields in the Attributes panel.`}
        </Typography>

        {draft.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {'No properties yet.'}
          </Typography>
        ) : null}

        <Stack spacing={2} divider={<Divider flexItem />}>
          {draft.map((prop, index) => {
            const kind = reusablePropKind(prop.type)
            const rowKey = rowKeys[index] ?? index
            return (
              <Stack key={rowKey} spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <TextField
                    label="Name"
                    size="small"
                    value={prop.name ?? ''}
                    error={Boolean(errors[index]?.name)}
                    helperText={
                      errors[index]?.name || `{{prop.${prop.name || '…'}}}`
                    }
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    select
                    label="Type"
                    size="small"
                    value={prop.type ?? 'text'}
                    onChange={(event) =>
                      update(
                        index,
                        retypeComponentProp(
                          prop,
                          event.target.value as Aglyn.ReusableComponentPropType,
                        ),
                      )
                    }
                    sx={{ minWidth: 170 }}
                  >
                    {TYPES_BY_GROUP.flatMap(({ group, types }) => [
                      // A disabled heading row rather than a list subheader:
                      // the select makes every child it is given pickable,
                      // and a group name is not a kind.
                      <MenuItem
                        key={`group-${group}`}
                        value={`group:${group}`}
                        disabled
                        sx={{
                          typography: 'overline',
                          lineHeight: 2,
                          '&.Mui-disabled': { opacity: 1 },
                        }}
                      >
                        {group}
                      </MenuItem>,
                      ...types.map((type) => (
                        <MenuItem key={type} value={type}>
                          {REUSABLE_PROP_KINDS[type].label}
                        </MenuItem>
                      )),
                    ])}
                  </TextField>
                  <TextField
                    label="Label"
                    size="small"
                    value={prop.label ?? ''}
                    helperText={
                      noun === 'layout' ? 'Shown in Screen Properties' : 'Shown in Attributes'
                    }
                    onChange={(event) =>
                      update(index, { label: event.target.value })
                    }
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    aria-label={`Remove ${prop.name || 'property'}`}
                    onClick={() => {
                      setDraft((current) => current.filter((_, i) => i !== index))
                      setRowKeys((current) => current.filter((_, i) => i !== index))
                    }}
                  >
                    <MdiIcon path={mdiDelete.path} />
                  </IconButton>
                </Stack>
                <Stack
                  spacing={1.5}
                  sx={{
                    pl: { sm: 2 },
                    borderLeft: { sm: 2 },
                    borderColor: { sm: 'divider' },
                  }}
                >
                  <TextField
                    label="Help"
                    size="small"
                    value={prop.description ?? ''}
                    helperText="Shown beside the field wherever it is set"
                    onChange={(event) =>
                      update(index, { description: event.target.value })
                    }
                    fullWidth
                  />
                  {kind.options ? (
                    <ChoiceOptionsEditor
                      options={prop.options ?? []}
                      error={errors[index]?.choices ?? ''}
                      optional={kind.options === 'optional'}
                      onChange={(options) => update(index, { options })}
                    />
                  ) : null}
                  <PropertySettingsEditor
                    key={`settings:${prop.type ?? 'text'}`}
                    prop={prop}
                    declared={draft}
                    error={errors[index]?.settings ?? ''}
                    onChange={(settings) => update(index, { settings })}
                  />
                  <Stack spacing={0.5}>
                    <PropertyValuesForm
                      key={`default:${prop.type ?? 'text'}:${JSON.stringify(
                        prop.options ?? [],
                      )}:${JSON.stringify(prop.settings ?? {})}`}
                      declared={[
                        {
                          ...prop,
                          name: 'value',
                          label: 'Default',
                          description: undefined,
                          condition: undefined,
                        },
                      ]}
                      role="default"
                      noun={noun}
                      values={{ value: defaultFormValue(prop) }}
                      onChange={(values) =>
                        update(index, defaultPatch(prop, values['value']))
                      }
                    />
                    <Typography variant="caption" color="text.secondary">
                      {`Used where a ${noun === 'layout' ? 'screen' : 'page'} sets nothing.`}
                    </Typography>
                  </Stack>
                  <PropertyConditionEditor
                    prop={prop}
                    declared={draft}
                    error={errors[index]?.condition ?? ''}
                    noun={noun}
                    onChange={(condition) => update(index, { condition })}
                  />
                </Stack>
              </Stack>
            )
          })}
        </Stack>

        <Button
          startIcon={<MdiIcon path={mdiPlus.path} />}
          onClick={() => {
            setDraft((current) => [...current, { name: '', type: 'text' }])
            setRowKeys((current) => [...current, nextKey])
            setNextKey((key) => key + 1)
          }}
          sx={{ mt: 2 }}
        >
          {'Add property'}
        </Button>

        {renamed.length ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {renamed.length === 1
              ? `"${renamed[0]}" was renamed or removed. `
              : `${renamed.length} properties were renamed or removed. `}
            {`${noun === 'layout' ? 'Screens' : 'Pages'} using this ${owner} keep whatever they set for the old `}
            {'name, but it will no longer be used — they fall back to '}
            {'the default.'}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          {'Cancel'}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={hasErrors || saving}
        >
          {'Save properties'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ComponentPropsDialog
