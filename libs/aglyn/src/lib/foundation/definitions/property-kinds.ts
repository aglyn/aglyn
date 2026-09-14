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

import { type AglynAttributeSchema, FieldComponentType } from './components.types'
import type {
  NonValueFieldKind,
  ReusableComponentProp,
  ReusableComponentPropType,
} from './platform.types'

/**
 * Component and layout property kinds (AGL-2893): one per attribute field kind
 * that holds a value, so a property offers every control a coded component
 * can declare for an attribute, configured with the same settings.
 *
 * Two tables, both complete by type. {@link FIELD_KIND_PROPERTY_TYPES} is
 * keyed by every value-holding {@link FieldComponentType} and
 * {@link NON_VALUE_FIELD_KINDS} by the rest, so a field kind added to the
 * attribute schema does not compile until it is one or the other.
 * {@link REUSABLE_PROP_KINDS} is keyed by every property kind, which is itself
 * derived from the field kinds (`ReusableComponentPropType`), so a new kind
 * does not compile until it says how it is edited and how its value travels.
 */

/**
 * Why each field kind that holds no value is not a property kind. A property
 * is one value a page sets; each of these is something else.
 */
export const NON_VALUE_FIELD_KINDS: Readonly<Record<NonValueFieldKind, string>> = {
  [FieldComponentType.BUTTON]: 'A button runs an action; it holds no value.',
  [FieldComponentType.BUTTON_GROUP]:
    'A row of buttons runs actions; it holds no value.',
  [FieldComponentType.FIELD_ARRAY]:
    'A field array repeats a group of other fields; each of those is a value of its own.',
  [FieldComponentType.INPUT_ADDON_BUTTON_GROUP]:
    'An input add-on decorates another field; it holds no value.',
  [FieldComponentType.INPUT_ADDON_GROUP]:
    'An input add-on decorates another field; it holds no value.',
  [FieldComponentType.PLAIN_TEXT]: 'Plain text is displayed, never edited.',
  [FieldComponentType.SUB_FORM]:
    'A sub-form groups other fields under a title; each of those is a value of its own.',
  [FieldComponentType.TAB_ITEM]:
    'A tab groups other fields; each of those is a value of its own.',
  [FieldComponentType.TABS]:
    'Tabs group other fields; each of those is a value of its own.',
  [FieldComponentType.WIZARD]:
    'A wizard steps through other fields; each of those is a value of its own.',
}

/**
 * The property kind a field of each value-holding kind is declared as.
 *
 * A field kind keeps its own stored value as its property kind, except the six
 * whose kind was named before this table existed (`LegacyNamedFieldKind`).
 */
export const FIELD_KIND_PROPERTY_TYPES: Readonly<
  Record<Exclude<FieldComponentType, NonValueFieldKind>, ReusableComponentPropType>
> = {
  [FieldComponentType.BREAKPOINT_SPAN]: FieldComponentType.BREAKPOINT_SPAN,
  [FieldComponentType.CATEGORY_SELECT]: FieldComponentType.CATEGORY_SELECT,
  [FieldComponentType.CHECKBOX]: FieldComponentType.CHECKBOX,
  [FieldComponentType.COLLECTION_SELECT]: FieldComponentType.COLLECTION_SELECT,
  [FieldComponentType.COLOR_PICKER]: FieldComponentType.COLOR_PICKER,
  [FieldComponentType.CSS_BORDER]: FieldComponentType.CSS_BORDER,
  [FieldComponentType.CSS_DIMENSION]: FieldComponentType.CSS_DIMENSION,
  [FieldComponentType.CSS_GRADIENT]: FieldComponentType.CSS_GRADIENT,
  [FieldComponentType.DATA_TABLE]: FieldComponentType.DATA_TABLE,
  [FieldComponentType.DATASET_FIELD_SELECT]:
    FieldComponentType.DATASET_FIELD_SELECT,
  [FieldComponentType.DATASET_SELECT]: FieldComponentType.DATASET_SELECT,
  [FieldComponentType.DATE_PICKER]: FieldComponentType.DATE_PICKER,
  [FieldComponentType.DUAL_LIST_SELECT]: FieldComponentType.DUAL_LIST_SELECT,
  [FieldComponentType.FORM_SELECT]: FieldComponentType.FORM_SELECT,
  [FieldComponentType.ICON_PICKER]: 'icon',
  [FieldComponentType.MARKDOWN]: FieldComponentType.MARKDOWN,
  [FieldComponentType.NODE_SELECT]: FieldComponentType.NODE_SELECT,
  [FieldComponentType.PLUGIN_SELECT]: FieldComponentType.PLUGIN_SELECT,
  [FieldComponentType.PLUGIN_SETTINGS]: FieldComponentType.PLUGIN_SETTINGS,
  [FieldComponentType.PRESET_CHOICE]: FieldComponentType.PRESET_CHOICE,
  [FieldComponentType.PRODUCT_SELECT]: FieldComponentType.PRODUCT_SELECT,
  [FieldComponentType.RADIO]: FieldComponentType.RADIO,
  [FieldComponentType.SCREEN_SELECT]: 'href',
  [FieldComponentType.SELECT]: 'choice',
  [FieldComponentType.SLIDER]: FieldComponentType.SLIDER,
  [FieldComponentType.SWITCH]: 'boolean',
  [FieldComponentType.TEXT_FIELD]: 'text',
  [FieldComponentType.TEXTAREA]: 'richText',
  [FieldComponentType.THEME_SCALE]: FieldComponentType.THEME_SCALE,
  [FieldComponentType.TIME_PICKER]: FieldComponentType.TIME_PICKER,
  [FieldComponentType.TOGGLE_BUTTON]: FieldComponentType.TOGGLE_BUTTON,
}

/**
 * How a property's value reaches a field bound to exactly that property.
 *
 * - `text`: substituted as text, and an unset property with no default is
 *   empty — copy that is absent renders as nothing.
 * - `boolean`: a real `true` or `false`, read with the Yes / no spellings; an
 *   unset Yes / no is a no.
 * - `number`: a real number when the value is numeric; unset leaves the
 *   element its own default.
 * - `icon`: the icon's id, with its SVG path written beside it.
 * - `value`: the value exactly as stored — a color token, a CSS length, a
 *   list of answers — and unset leaves the element its own default.
 */
export type ReusablePropValueClass =
  | 'text'
  | 'boolean'
  | 'number'
  | 'icon'
  | 'value'

/** Where a kind is listed in the Properties dialog's type picker. */
export type ReusablePropKindGroup =
  | 'Text'
  | 'Media and links'
  | 'Numbers'
  | 'Choices'
  | 'Style'
  | 'Date and time'
  | 'Site content'

/** Everything a property kind needs to be declared, edited and bound. */
export interface ReusablePropKind {
  /** The attribute field kind whose control edits the property. */
  field: FieldComponentType
  /** The kind's name in the Properties dialog. */
  label: string
  group: ReusablePropKindGroup
  value: ReusablePropValueClass
  /**
   * Whether the kind lists answers a page picks from: `required` for a kind
   * that is nothing without them, `optional` for a checkbox, which is a single
   * tick box until it is given answers.
   */
  options?: 'required' | 'optional'
  /**
   * The attribute field's own props this kind is configured with, declared as
   * attribute fields so the Properties dialog edits them with the same
   * renderer. Stored on the property's `settings`.
   */
  settings?: readonly AglynAttributeSchema[]
  /** Extra props the field is always drawn with, e.g. `type: 'number'`. */
  fieldProps?: Readonly<Record<string, unknown>>
}

/** A slider's range, as the Slider attribute field reads it. */
const SLIDER_SETTINGS: readonly AglynAttributeSchema[] = [
  {
    name: 'min',
    label: 'Lowest value',
    component: FieldComponentType.TEXT_FIELD,
    type: 'number',
    placeholder: '0',
  },
  {
    name: 'max',
    label: 'Highest value',
    component: FieldComponentType.TEXT_FIELD,
    type: 'number',
    placeholder: '100',
  },
  {
    name: 'step',
    label: 'Step',
    component: FieldComponentType.TEXT_FIELD,
    type: 'number',
    placeholder: '1',
  },
]

/**
 * The theme scales a Theme scale property can offer — the three the Styles
 * panel offers through the same control.
 */
export const THEME_SCALE_PROPERTY_SCALES = [
  { value: 'fontSize', label: 'Font sizes' },
  { value: 'fontWeight', label: 'Font weights' },
  { value: 'zIndex', label: 'Stacking layers' },
] as const

/**
 * The preset lists a Theme preset property can offer — the ones the Styles
 * panel draws its preset pickers from.
 */
export const PRESET_CHOICE_PROPERTY_PRESETS = [
  { value: 'cornerRadius', label: 'Corner radius' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'fontFamily', label: 'Font family' },
  { value: 'typographyVariant', label: 'Text style' },
  { value: 'gap', label: 'Gap' },
] as const

/**
 * Every property kind (AGL-2893): which control edits it, what the dialog
 * calls it, and how its value reaches a bound field.
 */
export const REUSABLE_PROP_KINDS: Readonly<
  Record<ReusableComponentPropType, ReusablePropKind>
> = {
  text: {
    field: FieldComponentType.TEXT_FIELD,
    label: 'Text',
    group: 'Text',
    value: 'text',
  },
  richText: {
    field: FieldComponentType.TEXTAREA,
    label: 'Long text',
    group: 'Text',
    value: 'text',
  },
  [FieldComponentType.MARKDOWN]: {
    field: FieldComponentType.MARKDOWN,
    label: 'Formatted document',
    group: 'Text',
    value: 'value',
  },
  [FieldComponentType.DATA_TABLE]: {
    field: FieldComponentType.DATA_TABLE,
    label: 'Table',
    group: 'Text',
    value: 'value',
  },
  image: {
    field: FieldComponentType.TEXT_FIELD,
    label: 'Image',
    group: 'Media and links',
    value: 'text',
  },
  href: {
    field: FieldComponentType.SCREEN_SELECT,
    label: 'Link',
    group: 'Media and links',
    value: 'text',
  },
  icon: {
    field: FieldComponentType.ICON_PICKER,
    label: 'Icon',
    group: 'Media and links',
    value: 'icon',
  },
  number: {
    field: FieldComponentType.TEXT_FIELD,
    label: 'Number',
    group: 'Numbers',
    value: 'number',
    fieldProps: { type: 'number' },
  },
  [FieldComponentType.SLIDER]: {
    field: FieldComponentType.SLIDER,
    label: 'Slider',
    group: 'Numbers',
    value: 'number',
    settings: SLIDER_SETTINGS,
  },
  boolean: {
    field: FieldComponentType.SWITCH,
    label: 'Yes / no',
    group: 'Choices',
    value: 'boolean',
  },
  [FieldComponentType.CHECKBOX]: {
    field: FieldComponentType.CHECKBOX,
    label: 'Checkbox',
    group: 'Choices',
    value: 'boolean',
    options: 'optional',
  },
  choice: {
    field: FieldComponentType.SELECT,
    label: 'Choice',
    group: 'Choices',
    value: 'value',
    options: 'required',
    settings: [
      {
        name: 'isMulti',
        label: 'A page can pick several answers',
        component: FieldComponentType.SWITCH,
      },
    ],
  },
  [FieldComponentType.RADIO]: {
    field: FieldComponentType.RADIO,
    label: 'Radio buttons',
    group: 'Choices',
    value: 'value',
    options: 'required',
  },
  [FieldComponentType.TOGGLE_BUTTON]: {
    field: FieldComponentType.TOGGLE_BUTTON,
    label: 'Toggle buttons',
    group: 'Choices',
    value: 'value',
    options: 'required',
  },
  [FieldComponentType.DUAL_LIST_SELECT]: {
    field: FieldComponentType.DUAL_LIST_SELECT,
    label: 'Pick list',
    group: 'Choices',
    value: 'value',
    options: 'required',
  },
  [FieldComponentType.COLOR_PICKER]: {
    field: FieldComponentType.COLOR_PICKER,
    label: 'Color',
    group: 'Style',
    value: 'value',
  },
  [FieldComponentType.CSS_DIMENSION]: {
    field: FieldComponentType.CSS_DIMENSION,
    label: 'Size',
    group: 'Style',
    value: 'value',
  },
  [FieldComponentType.CSS_BORDER]: {
    field: FieldComponentType.CSS_BORDER,
    label: 'Border',
    group: 'Style',
    value: 'value',
  },
  [FieldComponentType.CSS_GRADIENT]: {
    field: FieldComponentType.CSS_GRADIENT,
    label: 'Background fill',
    group: 'Style',
    value: 'value',
  },
  [FieldComponentType.BREAKPOINT_SPAN]: {
    field: FieldComponentType.BREAKPOINT_SPAN,
    label: 'Column span',
    group: 'Style',
    value: 'value',
  },
  [FieldComponentType.PRESET_CHOICE]: {
    field: FieldComponentType.PRESET_CHOICE,
    label: 'Theme preset',
    group: 'Style',
    value: 'value',
    settings: [
      {
        name: 'presets',
        label: 'Presets',
        component: FieldComponentType.SELECT,
        options: [...PRESET_CHOICE_PROPERTY_PRESETS],
      },
    ],
  },
  [FieldComponentType.THEME_SCALE]: {
    field: FieldComponentType.THEME_SCALE,
    label: 'Theme scale',
    group: 'Style',
    value: 'value',
    settings: [
      {
        name: 'scale',
        label: 'Scale',
        component: FieldComponentType.SELECT,
        options: [...THEME_SCALE_PROPERTY_SCALES],
      },
    ],
  },
  [FieldComponentType.DATE_PICKER]: {
    field: FieldComponentType.DATE_PICKER,
    label: 'Date',
    group: 'Date and time',
    value: 'value',
  },
  [FieldComponentType.TIME_PICKER]: {
    field: FieldComponentType.TIME_PICKER,
    label: 'Time',
    group: 'Date and time',
    value: 'value',
  },
  [FieldComponentType.NODE_SELECT]: {
    field: FieldComponentType.NODE_SELECT,
    label: 'Element on the page',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.PRODUCT_SELECT]: {
    field: FieldComponentType.PRODUCT_SELECT,
    label: 'Product',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.COLLECTION_SELECT]: {
    field: FieldComponentType.COLLECTION_SELECT,
    label: 'Collection',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.CATEGORY_SELECT]: {
    field: FieldComponentType.CATEGORY_SELECT,
    label: 'Category',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.DATASET_SELECT]: {
    field: FieldComponentType.DATASET_SELECT,
    label: 'Dataset',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.DATASET_FIELD_SELECT]: {
    field: FieldComponentType.DATASET_FIELD_SELECT,
    label: 'Dataset field',
    group: 'Site content',
    value: 'value',
    settings: [
      {
        name: 'datasetId',
        label: 'Dataset',
        description:
          'The dataset whose fields are offered. Leave it empty to offer the ' +
          'fields of the dataset the placed element sits inside.',
        component: FieldComponentType.DATASET_SELECT,
      },
    ],
  },
  [FieldComponentType.FORM_SELECT]: {
    field: FieldComponentType.FORM_SELECT,
    label: 'Form',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.PLUGIN_SELECT]: {
    field: FieldComponentType.PLUGIN_SELECT,
    label: 'Plugin',
    group: 'Site content',
    value: 'value',
  },
  [FieldComponentType.PLUGIN_SETTINGS]: {
    field: FieldComponentType.PLUGIN_SETTINGS,
    label: 'Plugin settings',
    group: 'Site content',
    value: 'value',
    settings: [
      {
        name: 'pluginProperty',
        label: 'Plugin property',
        description:
          'The Plugin property whose chosen plugin these settings are for.',
        component: FieldComponentType.SELECT,
      },
    ],
  },
}

/** The dialog's groups, in the order the type picker lists them. */
export const REUSABLE_PROP_KIND_GROUPS: readonly ReusablePropKindGroup[] = [
  'Text',
  'Media and links',
  'Numbers',
  'Choices',
  'Style',
  'Date and time',
  'Site content',
]

/**
 * A property's kind. A property with no type, or one this build does not
 * know, is Text — the kind every property was before types existed.
 */
export function reusablePropKind(
  type: string | null | undefined,
): ReusablePropKind {
  return (
    REUSABLE_PROP_KINDS[(type ?? 'text') as ReusableComponentPropType] ??
    REUSABLE_PROP_KINDS.text
  )
}

/** Whether a string names a property kind. */
export function isReusablePropType(
  type: unknown,
): type is ReusableComponentPropType {
  return (
    typeof type === 'string' &&
    Object.prototype.hasOwnProperty.call(REUSABLE_PROP_KINDS, type)
  )
}

/**
 * Whether a property holds several values — a list of answers — rather than
 * one: a pick list always, a checkbox once it has answers, a choice set to
 * take several.
 */
export function reusablePropTakesSeveral(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
): boolean {
  switch (prop?.type) {
    case FieldComponentType.DUAL_LIST_SELECT:
      return true
    case FieldComponentType.CHECKBOX:
      return Boolean(prop.options?.length)
    case 'choice':
      return prop.settings?.['isMulti'] === true
    default:
      return false
  }
}

/**
 * How a property's value travels to a bound field, for this property rather
 * than its kind: a checkbox with answers is a list of them, not a yes or a no.
 */
export function reusablePropValueClass(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
): ReusablePropValueClass {
  if (prop?.type === FieldComponentType.CHECKBOX && reusablePropTakesSeveral(prop)) {
    return 'value'
  }
  return reusablePropKind(prop?.type).value
}

/**
 * What a value IS, for deciding which fields and properties can stand in for
 * each other: a yes or a no, one answer from a list, several answers, a
 * number, a link, an icon, a document — or, for every other kind, a value only
 * a field of that same kind understands.
 */
type ReusableValueShape = string

const BOOLEAN_SHAPE = 'boolean'
const OPTION_SHAPE = 'option'
const OPTIONS_SHAPE = 'options'
const NUMBER_SHAPE = 'number'
const LINK_SHAPE = 'link'
const ICON_SHAPE = 'icon'
const DOCUMENT_SHAPE = 'document'
const TEXT_SHAPE = 'text'

/** The shape of the value a property holds. */
export function reusablePropValueShape(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
): ReusableValueShape {
  const type = prop?.type ?? 'text'
  switch (type) {
    case 'text':
    case 'image':
      return TEXT_SHAPE
    case 'richText':
    case FieldComponentType.MARKDOWN:
      return DOCUMENT_SHAPE
    case 'href':
      return LINK_SHAPE
    case 'icon':
      return ICON_SHAPE
    case 'number':
    case FieldComponentType.SLIDER:
      return NUMBER_SHAPE
    case 'boolean':
      return BOOLEAN_SHAPE
    case FieldComponentType.CHECKBOX:
      return reusablePropTakesSeveral(prop) ? OPTIONS_SHAPE : BOOLEAN_SHAPE
    case 'choice':
      return reusablePropTakesSeveral(prop) ? OPTIONS_SHAPE : OPTION_SHAPE
    case FieldComponentType.RADIO:
    case FieldComponentType.TOGGLE_BUTTON:
      return OPTION_SHAPE
    case FieldComponentType.DUAL_LIST_SELECT:
      return OPTIONS_SHAPE
    default:
      return isReusablePropType(type) ? type : TEXT_SHAPE
  }
}

/** The declared attribute a binding is being considered for. */
export interface BindableAttributeField {
  component?: unknown
  options?: unknown
  isMulti?: unknown
  multiple?: unknown
}

/**
 * The shape of the value an attribute field holds, judged by the kind its
 * schema DECLARES (a Screen picker is drawn as a dropdown, and still holds a
 * link). `undefined` for a free-text field, which takes any property's token
 * typed into it and needs no shape to match, and for a kind that holds no
 * value.
 */
export function attributeFieldValueShape(
  field: BindableAttributeField | null | undefined,
): ReusableValueShape | undefined {
  const component = String(field?.component ?? '')
  const several = Boolean(field?.isMulti || field?.multiple)
  switch (component) {
    case FieldComponentType.TEXT_FIELD:
    case FieldComponentType.TEXTAREA:
      return undefined
    case FieldComponentType.MARKDOWN:
      return DOCUMENT_SHAPE
    case FieldComponentType.SWITCH:
      return BOOLEAN_SHAPE
    case FieldComponentType.CHECKBOX:
      return Array.isArray(field?.options) ? OPTIONS_SHAPE : BOOLEAN_SHAPE
    case FieldComponentType.SELECT:
      return several ? OPTIONS_SHAPE : OPTION_SHAPE
    case FieldComponentType.RADIO:
    case FieldComponentType.TOGGLE_BUTTON:
      return OPTION_SHAPE
    case FieldComponentType.DUAL_LIST_SELECT:
      return OPTIONS_SHAPE
    case FieldComponentType.SLIDER:
      return NUMBER_SHAPE
    case FieldComponentType.SCREEN_SELECT:
      return LINK_SHAPE
    case FieldComponentType.ICON_PICKER:
      return ICON_SHAPE
    default: {
      const type = (FIELD_KIND_PROPERTY_TYPES as Record<string, string>)[
        component
      ]
      return type ? reusablePropValueShape({ type: type as never }) : undefined
    }
  }
}

/**
 * Whether a field can be bound to a property: they hold the same shape of
 * value. A switch takes a Yes / no or a single checkbox, a dropdown takes a
 * Choice, Radio buttons or Toggle buttons, a color picker takes a Color, and
 * so on — never a property whose value the field could not show.
 */
export function reusablePropBindsToField(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
  field: BindableAttributeField | null | undefined,
): boolean {
  const fieldShape = attributeFieldValueShape(field)
  return fieldShape !== undefined && fieldShape === reusablePropValueShape(prop)
}

/**
 * Whether a property's value is one or several answers from its own list —
 * the kinds whose bound dropdowns must offer the same values.
 */
export function reusablePropHasAnswers(
  prop: Pick<ReusableComponentProp, 'type' | 'options' | 'settings'> | null | undefined,
): boolean {
  const shape = reusablePropValueShape(prop)
  return shape === OPTION_SHAPE || shape === OPTIONS_SHAPE
}
