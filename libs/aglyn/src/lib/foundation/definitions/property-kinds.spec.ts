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

import { FieldComponentType } from './components.types'
import type { ReusableComponentPropType } from './platform.types'
import {
  attributeFieldValueShape,
  FIELD_KIND_PROPERTY_TYPES,
  isReusablePropType,
  NON_VALUE_FIELD_KINDS,
  REUSABLE_PROP_KIND_GROUPS,
  REUSABLE_PROP_KINDS,
  reusablePropBindsToField,
  reusablePropKind,
  reusablePropTakesSeveral,
  reusablePropValueClass,
} from './property-kinds'

/**
 * Property kinds are the attribute schema's field kinds (AGL-2893).
 *
 * The type system already refuses a field kind that is in neither table and a
 * property kind with no definition. What only a spec can pin is that the two
 * tables agree with each other: that every field kind is in exactly ONE of
 * them, that the kind a field declares as edits with that very field, and that
 * nothing else slipped into the list the Properties dialog offers.
 */

const FIELD_KINDS = Object.values(FieldComponentType) as FieldComponentType[]
const VALUE_FIELD_KINDS = Object.keys(
  FIELD_KIND_PROPERTY_TYPES,
) as FieldComponentType[]
const NON_VALUE_KINDS = Object.keys(NON_VALUE_FIELD_KINDS)
const PROP_TYPES = Object.keys(REUSABLE_PROP_KINDS) as ReusableComponentPropType[]

/** The kinds whose property kind was named before this table existed. */
const LEGACY_NAMES: Partial<Record<FieldComponentType, string>> = {
  [FieldComponentType.TEXT_FIELD]: 'text',
  [FieldComponentType.TEXTAREA]: 'richText',
  [FieldComponentType.SWITCH]: 'boolean',
  [FieldComponentType.SELECT]: 'choice',
  [FieldComponentType.ICON_PICKER]: 'icon',
  [FieldComponentType.SCREEN_SELECT]: 'href',
}

describe('property kinds follow the attribute field kinds (AGL-2893)', () => {
  it('sorts every field kind into exactly one table', () => {
    for (const kind of FIELD_KINDS) {
      const inValue = VALUE_FIELD_KINDS.includes(kind)
      const inNonValue = NON_VALUE_KINDS.includes(kind)
      expect({ kind, sorted: inValue !== inNonValue }).toEqual({
        kind,
        sorted: true,
      })
    }
    expect(VALUE_FIELD_KINDS.length + NON_VALUE_KINDS.length).toBe(
      FIELD_KINDS.length,
    )
  })

  it('gives each field kind that holds no value a reason', () => {
    for (const reason of Object.values(NON_VALUE_FIELD_KINDS)) {
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('edits the property kind a field declares as with that same field', () => {
    for (const kind of VALUE_FIELD_KINDS) {
      const type = FIELD_KIND_PROPERTY_TYPES[kind as keyof typeof FIELD_KIND_PROPERTY_TYPES]
      expect({ kind, field: REUSABLE_PROP_KINDS[type]?.field }).toEqual({
        kind,
        field: kind,
      })
    }
  })

  it('names a field kind property by the field kind, except the six named before', () => {
    for (const kind of VALUE_FIELD_KINDS) {
      const type = FIELD_KIND_PROPERTY_TYPES[kind as keyof typeof FIELD_KIND_PROPERTY_TYPES]
      expect({ kind, type }).toEqual({ kind, type: LEGACY_NAMES[kind] ?? kind })
    }
  })

  it('offers nothing a field kind does not declare, beyond the two text-field variants', () => {
    const declared = new Set<string>(Object.values(FIELD_KIND_PROPERTY_TYPES))
    const undeclared = PROP_TYPES.filter((type) => !declared.has(type))
    expect(undeclared.sort()).toEqual(['image', 'number'])
    for (const type of undeclared) {
      expect(REUSABLE_PROP_KINDS[type].field).toBe(FieldComponentType.TEXT_FIELD)
    }
    for (const type of PROP_TYPES) {
      expect(NON_VALUE_KINDS).not.toContain(REUSABLE_PROP_KINDS[type].field)
    }
  })

  it('keeps every kind a stored property already names, on its original field', () => {
    expect(
      Object.fromEntries(
        ['text', 'richText', 'image', 'href', 'number', 'boolean', 'choice', 'icon'].map(
          (type) => [type, reusablePropKind(type).field],
        ),
      ),
    ).toEqual({
      text: FieldComponentType.TEXT_FIELD,
      richText: FieldComponentType.TEXTAREA,
      image: FieldComponentType.TEXT_FIELD,
      href: FieldComponentType.SCREEN_SELECT,
      number: FieldComponentType.TEXT_FIELD,
      boolean: FieldComponentType.SWITCH,
      choice: FieldComponentType.SELECT,
      icon: FieldComponentType.ICON_PICKER,
    })
  })

  it('lists every kind under a group the dialog shows, with a name of its own', () => {
    const labels = PROP_TYPES.map((type) => REUSABLE_PROP_KINDS[type].label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const type of PROP_TYPES) {
      expect(REUSABLE_PROP_KIND_GROUPS).toContain(REUSABLE_PROP_KINDS[type].group)
    }
  })

  it('configures a kind only with fields that hold a value themselves', () => {
    for (const type of PROP_TYPES) {
      for (const setting of REUSABLE_PROP_KINDS[type].settings ?? []) {
        expect(VALUE_FIELD_KINDS).toContain(setting.component)
      }
    }
  })

  it('reads a property with no type, or a type it does not know, as Text', () => {
    expect(reusablePropKind(undefined)).toBe(REUSABLE_PROP_KINDS.text)
    expect(reusablePropKind('not-a-kind')).toBe(REUSABLE_PROP_KINDS.text)
    expect(isReusablePropType('color-picker')).toBe(true)
    expect(isReusablePropType('toString')).toBe(false)
  })
})

describe('which fields a property can be bound to (AGL-2893)', () => {
  it('binds every kind a field is declared with to that field', () => {
    for (const type of PROP_TYPES) {
      const kind = REUSABLE_PROP_KINDS[type]
      if (kind.field === FieldComponentType.TEXT_FIELD) continue
      if (kind.field === FieldComponentType.TEXTAREA) continue
      expect({
        type,
        binds: reusablePropBindsToField(
          { type, ...(kind.options === 'required' ? { options: [] } : {}) },
          { component: kind.field },
        ),
      }).toEqual({ type, binds: true })
    }
  })

  it('leaves free text to the token a text field takes, whatever the property', () => {
    expect(attributeFieldValueShape({ component: FieldComponentType.TEXT_FIELD })).toBeUndefined()
    expect(
      reusablePropBindsToField({ type: 'text' }, { component: FieldComponentType.TEXT_FIELD }),
    ).toBe(false)
  })

  it('lets a switch and a single checkbox stand in for each other', () => {
    const checkbox = { component: FieldComponentType.CHECKBOX }
    const toggle = { component: FieldComponentType.SWITCH }
    expect(reusablePropBindsToField({ type: 'boolean' }, checkbox)).toBe(true)
    expect(reusablePropBindsToField({ type: 'checkbox' }, toggle)).toBe(true)
  })

  it('binds one answer to any control that picks one, and a list only to a list', () => {
    const answers = [{ value: 'a' }, { value: 'b' }]
    const dropdown = { component: FieldComponentType.SELECT, options: answers }
    const multiDropdown = { ...dropdown, isMulti: true }
    for (const type of ['choice', 'radio', 'toggle-button'] as const) {
      expect(reusablePropBindsToField({ type, options: answers }, dropdown)).toBe(true)
      expect(reusablePropBindsToField({ type, options: answers }, multiDropdown)).toBe(
        false,
      )
    }
    const several = { type: 'choice' as const, options: answers, settings: { isMulti: true } }
    expect(reusablePropTakesSeveral(several)).toBe(true)
    expect(reusablePropBindsToField(several, multiDropdown)).toBe(true)
    expect(
      reusablePropBindsToField(several, {
        component: FieldComponentType.CHECKBOX,
        options: answers,
      }),
    ).toBe(true)
    expect(
      reusablePropBindsToField(several, { component: FieldComponentType.DUAL_LIST_SELECT }),
    ).toBe(true)
    expect(reusablePropBindsToField(several, dropdown)).toBe(false)
  })

  it('reads a checkbox with answers as a list, and one without as a yes or a no', () => {
    expect(reusablePropValueClass({ type: 'checkbox' })).toBe('boolean')
    expect(reusablePropValueClass({ type: 'checkbox', options: [{ value: 'a' }] })).toBe(
      'value',
    )
    expect(
      reusablePropBindsToField(
        { type: 'checkbox', options: [{ value: 'a' }] },
        { component: FieldComponentType.SWITCH },
      ),
    ).toBe(false)
  })

  it('never binds a property to a field that holds a different kind of value', () => {
    expect(
      reusablePropBindsToField({ type: 'color-picker' }, { component: FieldComponentType.CSS_DIMENSION }),
    ).toBe(false)
    expect(
      reusablePropBindsToField({ type: 'choice' }, { component: FieldComponentType.SWITCH }),
    ).toBe(false)
    expect(
      reusablePropBindsToField({ type: 'number' }, { component: FieldComponentType.SLIDER }),
    ).toBe(true)
    expect(
      reusablePropBindsToField({ type: 'richText' }, { component: FieldComponentType.MARKDOWN }),
    ).toBe(true)
    expect(
      reusablePropBindsToField({ type: 'href' }, { component: FieldComponentType.SCREEN_SELECT }),
    ).toBe(true)
  })
})
