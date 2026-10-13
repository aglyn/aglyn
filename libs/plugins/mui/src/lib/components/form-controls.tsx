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

import * as Aglyn from '@aglyn/aglyn'
import {
  mdiCheckboxMarkedOutline,
  mdiFormDropdown,
  mdiFormTextbox,
  mdiFormatText,
  mdiRadioboxMarked,
  mdiStarOutline,
  mdiTextShort,
  mdiTagOutline,
  mdiFormSelect,
} from '@aglyn/shared-data-mdi'
import Checkbox, { type CheckboxProps } from '@mui/material/Checkbox'
import FormControl, { type FormControlProps } from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormHelperText, {
  type FormHelperTextProps,
} from '@mui/material/FormHelperText'
import FormLabel, { type FormLabelProps } from '@mui/material/FormLabel'
import NativeSelect from '@mui/material/NativeSelect'
import OutlinedInput from '@mui/material/OutlinedInput'
import Radio, { type RadioProps } from '@mui/material/Radio'
import RadioGroup, { type RadioGroupProps } from '@mui/material/RadioGroup'
import Rating, { type RatingProps } from '@mui/material/Rating'
import {
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useId,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_TEXT_CONTENT } from '../constants/field-presets'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

/*
 * MUI's FORM ELEMENTS, ONE BESIGNER ELEMENT EACH.
 *
 * A field is not one element: it is a Form Control holding a label, an input
 * and a line of help text, exactly as MUI builds it. Each piece is placed,
 * selected and styled on its own — a label's color, an input's fill and
 * corners, the help text's size — with the ordinary Styles panel, and the
 * presets at the bottom of this file are just ready-made arrangements of
 * them. Nothing here knows about forms submitting: an input carries a NAME,
 * and whatever form it sits in sends what the browser sends.
 *
 * Component ids are persisted in documents; never rename them.
 */
export const FORM_CONTROL_ID: Aglyn.ComponentId = 'muiFormControl'
export const FORM_LABEL_ID: Aglyn.ComponentId = 'muiFormLabel'
export const INPUT_ID: Aglyn.ComponentId = 'muiInput'
export const FORM_HELPER_TEXT_ID: Aglyn.ComponentId = 'muiFormHelperText'
export const SELECT_ID: Aglyn.ComponentId = 'muiSelect'
export const SELECT_OPTION_ID: Aglyn.ComponentId = 'muiSelectOption'
export const CHECKBOX_ID: Aglyn.ComponentId = 'muiCheckbox'
export const RADIO_GROUP_ID: Aglyn.ComponentId = 'muiRadioGroup'
export const RADIO_ID: Aglyn.ComponentId = 'muiRadio'
export const CHOICE_LABEL_ID: Aglyn.ComponentId = 'muiFormControlLabel'
export const RATING_ID: Aglyn.ComponentId = 'muiRating'

/**
 * The id a Form Control gives the input inside it, so the Form Label beside
 * that input names it (`for=`) without the author wiring anything.
 */
const FieldIdContext = createContext<string | undefined>(undefined)

export interface AglynFormControlProps extends FormControlProps {
  children?: ReactNode
}

/** A field's frame: label, input and help text together. */
export const AglynFormControl = forwardRef<HTMLDivElement, AglynFormControlProps>(
  (props, ref) => {
    const id = `field-${useId().replace(/:/g, '')}`
    return (
      <FieldIdContext.Provider value={id}>
        <FormControl ref={ref} {...dropClearedProps(props)} />
      </FieldIdContext.Provider>
    )
  },
)
AglynFormControl.displayName = 'AglynFormControl'

/** The label above an input, linked to it by the Form Control. */
export const AglynFormLabel = forwardRef<HTMLLabelElement, FormLabelProps>(
  (props, ref) => {
    const id = useContext(FieldIdContext)
    return (
      <FormLabel
        ref={ref as never}
        component="label"
        {...(id ? { htmlFor: id } : {})}
        {...dropClearedProps(props)}
      />
    )
  },
)
AglynFormLabel.displayName = 'AglynFormLabel'

export interface AglynInputProps {
  /** What the answer is sent as. */
  name?: string
  type?: 'text' | 'email' | 'tel' | 'url' | 'number'
  /** Several lines (a message box) instead of one. */
  multiline?: boolean
  /** Lines a multi-line input starts at. */
  minRows?: number
  placeholder?: string
  required?: boolean
  /**
   * A name for assistive technology when no Form Label sits beside the
   * input — a sign-up row with only a placeholder, for one.
   */
  ariaLabel?: string
  fullWidth?: boolean
  [key: string]: any
}

/** The box a visitor types in. */
export const AglynInput = forwardRef<HTMLDivElement, AglynInputProps>(
  (props, ref) => {
    const {
      name,
      type,
      multiline,
      minRows,
      placeholder,
      required,
      ariaLabel,
      datasetFieldId: _datasetFieldId,
      ...rest
    } = dropClearedProps(props)
    const id = useContext(FieldIdContext)
    return (
      <OutlinedInput
        ref={ref}
        // The label is its own element above the box, so the outline never
        // carries a notch for a floating one.
        notched={false}
        {...(id ? { id } : {})}
        name={name || undefined}
        type={multiline ? undefined : type || 'text'}
        multiline={Boolean(multiline)}
        {...(multiline ? { minRows: minRows || 3 } : {})}
        placeholder={placeholder || undefined}
        required={Boolean(required)}
        inputProps={ariaLabel ? { 'aria-label': ariaLabel } : undefined}
        {...rest}
      />
    )
  },
)
AglynInput.displayName = 'AglynInput'

/** One line of help or guidance under a field. */
export const AglynFormHelperText = forwardRef<
  HTMLParagraphElement,
  FormHelperTextProps
>((props, ref) => <FormHelperText ref={ref} {...dropClearedProps(props)} />)
AglynFormHelperText.displayName = 'AglynFormHelperText'

export interface AglynSelectProps {
  name?: string
  required?: boolean
  /** Shown until a choice is made; never sent as an answer. */
  placeholder?: string
  ariaLabel?: string
  fullWidth?: boolean
  children?: ReactNode
  [key: string]: any
}

/**
 * A dropdown. Its choices are Select Option elements inside it — the
 * browser's own list, so every choice is a real element a page can edit.
 */
export const AglynSelect = forwardRef<HTMLDivElement, AglynSelectProps>(
  (props, ref) => {
    const {
      name,
      required,
      placeholder,
      ariaLabel,
      children,
      datasetFieldId: _datasetFieldId,
      ...rest
    } = dropClearedProps(props)
    const id = useContext(FieldIdContext)
    return (
      <NativeSelect
        ref={ref}
        input={<OutlinedInput notched={false} />}
        defaultValue=""
        inputProps={{
          ...(id ? { id } : {}),
          name: name || undefined,
          required: Boolean(required),
          ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        }}
        {...rest}
      >
        <option value="" disabled={Boolean(required)}>
          {placeholder || ''}
        </option>
        {children}
      </NativeSelect>
    )
  },
)
AglynSelect.displayName = 'AglynSelect'

export interface AglynSelectOptionProps {
  value?: string
  children?: ReactNode
}

/** One choice in a Select. */
export const AglynSelectOption = forwardRef<
  HTMLOptionElement,
  AglynSelectOptionProps
>((props, ref) => {
  const { value, children, ...rest } = dropClearedProps(props)
  const text = typeof children === 'string' ? children : ''
  return (
    <option ref={ref} value={value ?? text} {...(rest as object)}>
      {children}
    </option>
  )
})
AglynSelectOption.displayName = 'AglynSelectOption'

/**
 * The props an answer element hands MUI: cleared values dropped, and the
 * dataset mapping — authoring data read off the node, never a DOM attribute —
 * taken out.
 */
function withoutMapping<T extends object>(props: T): T {
  const { datasetFieldId: _datasetFieldId, ...rest } = dropClearedProps(
    props as T & { datasetFieldId?: unknown },
  )
  return rest as T
}

/** A tick box. Put it in a Choice Label to give it words. */
export const AglynCheckbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  (props, ref) => <Checkbox ref={ref} {...withoutMapping(props)} />,
)
AglynCheckbox.displayName = 'AglynCheckbox'

/** A set of Radio choices sharing one name; one may be picked. */
export const AglynRadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  (props, ref) => <RadioGroup ref={ref} {...withoutMapping(props)} />,
)
AglynRadioGroup.displayName = 'AglynRadioGroup'

/** One choice in a Radio Group. Put it in a Choice Label to give it words. */
export const AglynRadio = forwardRef<HTMLButtonElement, RadioProps>(
  (props, ref) => <Radio ref={ref} {...dropClearedProps(props)} />,
)
AglynRadio.displayName = 'AglynRadio'

export interface AglynChoiceLabelProps {
  /** The words beside the tick box or radio. */
  label?: string
  children?: ReactNode
  [key: string]: any
}

/**
 * The words beside a Checkbox or Radio, clickable as one with it — MUI's
 * FormControlLabel, holding the control as its child element.
 */
export const AglynChoiceLabel = forwardRef<HTMLLabelElement, AglynChoiceLabelProps>(
  (props, ref) => {
    const { label, children, ...rest } = dropClearedProps(props)
    return (
      <FormControlLabel
        ref={ref}
        label={label ?? ''}
        // The control is whatever element the author placed inside; a
        // `display: contents` holder keeps it the label's direct box.
        control={<span style={{ display: 'contents' }}>{children}</span>}
        {...rest}
      />
    )
  },
)
AglynChoiceLabel.displayName = 'AglynChoiceLabel'

/** Stars a visitor picks; sends the number chosen. */
export const AglynRating = forwardRef<HTMLSpanElement, RatingProps>(
  (props, ref) => <Rating ref={ref} {...withoutMapping(props)} />,
)
AglynRating.displayName = 'AglynRating'

// ── Attributes ──────────────────────────────────────────────────────────────

const FIELD_NAME: Aglyn.AglynAttributeSchema = {
  name: 'name',
  label: 'Field name',
  description:
    'What the answer is sent as — the key it is stored under in submissions. ' +
    'Two inputs in one form need two names (radios share their group’s).',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
}
/**
 * Which field of the form's dataset this answer is stored under — the same
 * picker the all-in-one Form Field had, listing the fields of the dataset
 * chosen on the Form around it. Stored by id, so renaming the dataset field
 * never breaks the mapping; left empty, the answer matches by name.
 */
const FIELD_DATASET_FIELD: Aglyn.AglynAttributeSchema = {
  name: 'datasetFieldId',
  label: 'Maps to schema field',
  description:
    'The field of the form’s dataset this answer is stored under. Left ' +
    'empty, it matches a dataset field by its Field name.',
  component: Aglyn.FieldComponentType.DATASET_FIELD_SELECT,
}
const FIELD_REQUIRED: Aglyn.AglynAttributeSchema = {
  name: 'required',
  label: 'Required?',
  description: 'The form will not send until this is answered.',
  component: Aglyn.FieldComponentType.SWITCH,
}
const FIELD_ARIA_LABEL: Aglyn.AglynAttributeSchema = {
  name: 'ariaLabel',
  label: 'Accessible label',
  description:
    'Names the input for screen readers when there is no Form Label beside ' +
    'it. Not shown on the page.',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
}
const FIELD_FULL_WIDTH: Aglyn.AglynAttributeSchema = {
  name: 'fullWidth',
  label: 'Full width?',
  description: 'Fills the width of whatever holds it.',
  component: Aglyn.FieldComponentType.SWITCH,
}
const FIELD_PLACEHOLDER: Aglyn.AglynAttributeSchema = {
  name: 'placeholder',
  label: 'Placeholder',
  description:
    'A gray hint inside the empty input, such as you@company.com. It is ' +
    'not a label: it disappears as soon as someone types.',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
}
const FIELD_CHOICE_VALUE: Aglyn.AglynAttributeSchema = {
  name: 'value',
  label: 'Value',
  description: 'What is sent when this is chosen.',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
}

const category = Aglyn.ComponentCategory.FORMS

export const formControlSchema: Aglyn.ComponentSchema<AglynFormControlProps> = {
  $id: FORM_CONTROL_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Form Control',
  description:
    'One field’s frame: holds a Form Label, an input and Helper Text, and ' +
    'links the label to the input.',
  category,
  icon: { path: mdiFormTextbox.path, sx: { color: 'info.main' } },
  attributes: [
    FIELD_FULL_WIDTH,
    {
      ...FIELD_REQUIRED,
      description: 'Marks the label with an asterisk. Set Required? on the input too.',
    },
  ],
}

export const formLabelSchema: Aglyn.ComponentSchema<FormLabelProps> = {
  $id: FORM_LABEL_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Form Label',
  description: 'The words that name a field, above its input.',
  category,
  icon: { path: mdiTagOutline.path, sx: { color: 'info.main' } },
  flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [FIELD_TEXT_CONTENT],
}

export const inputSchema: Aglyn.ComponentSchema<AglynInputProps> = {
  $id: INPUT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Input',
  description: 'A box a visitor types in: text, email, phone, link or number.',
  category,
  icon: { path: mdiTextShort.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    {
      name: 'type',
      label: 'Type',
      description: 'What goes in it. Email, phone and link bring the right phone keyboard.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'text', label: 'Text' },
        { value: 'email', label: 'Email' },
        { value: 'tel', label: 'Phone' },
        { value: 'url', label: 'Link' },
        { value: 'number', label: 'Number' },
      ],
    },
    FIELD_PLACEHOLDER,
    FIELD_REQUIRED,
    {
      name: 'multiline',
      label: 'Several lines?',
      description: 'A message box instead of a single line.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    FIELD_FULL_WIDTH,
    FIELD_ARIA_LABEL,
  ],
}

export const formHelperTextSchema: Aglyn.ComponentSchema<FormHelperTextProps> = {
  $id: FORM_HELPER_TEXT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Helper Text',
  description: 'A line of guidance under a field.',
  category,
  icon: { path: mdiFormatText.path, sx: { color: 'info.main' } },
  flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [FIELD_TEXT_CONTENT],
}

export const selectSchema: Aglyn.ComponentSchema<AglynSelectProps> = {
  $id: SELECT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Select',
  description: 'A dropdown of Select Options; one may be picked.',
  category,
  icon: { path: mdiFormDropdown.path, sx: { color: 'info.main' } },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: [SELECT_OPTION_ID] },
  ],
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    { ...FIELD_PLACEHOLDER, description: 'Shown until a choice is made; never sent.' },
    FIELD_REQUIRED,
    FIELD_FULL_WIDTH,
    FIELD_ARIA_LABEL,
  ],
}

export const selectOptionSchema: Aglyn.ComponentSchema<AglynSelectOptionProps> = {
  $id: SELECT_OPTION_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Select Option',
  description: 'One choice in a Select.',
  category,
  icon: { path: mdiFormSelect.path, sx: { color: 'info.main' } },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    { ...FIELD_CHOICE_VALUE, description: 'What is sent. Leave empty to send the text.' },
  ],
}

export const checkboxSchema: Aglyn.ComponentSchema<CheckboxProps> = {
  $id: CHECKBOX_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Checkbox',
  description: 'A tick box. Put it in a Choice Label to give it words.',
  category,
  icon: { path: mdiCheckboxMarkedOutline.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    { ...FIELD_CHOICE_VALUE, description: 'What is sent when ticked, such as Yes.' },
    FIELD_REQUIRED,
  ],
}

export const radioGroupSchema: Aglyn.ComponentSchema<RadioGroupProps> = {
  $id: RADIO_GROUP_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Radio Group',
  description: 'A set of Radio choices; one may be picked.',
  category,
  icon: { path: mdiRadioboxMarked.path, sx: { color: 'info.main' } },
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    {
      name: 'row',
      label: 'In a row?',
      description: 'Side by side instead of one under another.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
  ],
}

export const radioSchema: Aglyn.ComponentSchema<RadioProps> = {
  $id: RADIO_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Radio',
  description: 'One choice in a Radio Group. Put it in a Choice Label to give it words.',
  category,
  icon: { path: mdiRadioboxMarked.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [FIELD_CHOICE_VALUE, FIELD_REQUIRED],
}

export const choiceLabelSchema: Aglyn.ComponentSchema<AglynChoiceLabelProps> = {
  $id: CHOICE_LABEL_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Choice Label',
  description: 'The words beside a Checkbox or Radio placed inside it; clicking them ticks it.',
  category,
  icon: { path: mdiTagOutline.path, sx: { color: 'info.main' } },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: [CHECKBOX_ID, RADIO_ID] },
  ],
  attributes: [
    {
      name: 'label',
      label: 'Text',
      description: 'The words beside the box.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const ratingSchema: Aglyn.ComponentSchema<RatingProps> = {
  $id: RATING_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Rating',
  description: 'Stars a visitor picks; sends the number chosen.',
  category,
  icon: { path: mdiStarOutline.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    {
      name: 'max',
      label: 'Stars',
      description: 'How many stars to show.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
  ],
}

// ── Presets: ready-made arrangements of the pieces above ────────────────────

const node = (
  componentId: Aglyn.ComponentId,
  props?: Record<string, unknown>,
  nodes?: Aglyn.NodePresetData[],
  sx?: Record<string, unknown>,
): Aglyn.NodePresetData =>
  ({
    $id: null,
    componentId,
    pluginId: BUNDLE_ID,
    ...(props ? { props } : {}),
    ...(nodes ? { nodes } : {}),
    ...(sx ? { sx } : {}),
  }) as Aglyn.NodePresetData

/** A labelled text field: Form Control › Form Label + Input. */
export const textFieldPreset = (
  label: string,
  input: Record<string, unknown>,
): Aglyn.NodePresetData =>
  node(FORM_CONTROL_ID, { fullWidth: true }, [
    node(FORM_LABEL_ID, { children: label }),
    node(INPUT_ID, { fullWidth: true, ...input }),
  ])

const preset = (
  $id: string,
  displayName: string,
  description: string,
  icon: string,
  data: Aglyn.NodePresetData,
): Aglyn.PresetSchema => ({
  $id,
  type: Aglyn.NodeType.PRESET,
  displayName,
  description,
  pluginId: BUNDLE_ID,
  category,
  icon: { path: icon, sx: { color: 'info.main' } },
  data,
})

export const formControlPresets: Aglyn.PresetSchema[] = [
  preset(
    generatePresetId(FORM_CONTROL_ID, 'text'),
    'Text field',
    'A label and a one-line input.',
    mdiFormTextbox.path,
    textFieldPreset('Name', { name: 'name' }),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'email'),
    'Email field',
    'A label and an email input.',
    mdiFormTextbox.path,
    textFieldPreset('Email', { name: 'email', type: 'email', required: true }),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'message'),
    'Message field',
    'A label and a several-line input.',
    mdiFormTextbox.path,
    textFieldPreset('Message', { name: 'message', multiline: true, minRows: 4 }),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'select'),
    'Dropdown field',
    'A label and a Select with three options.',
    mdiFormDropdown.path,
    node(FORM_CONTROL_ID, { fullWidth: true }, [
      node(FORM_LABEL_ID, { children: 'Choose one' }),
      node(SELECT_ID, { name: 'choice', fullWidth: true, placeholder: 'Choose…' }, [
        node(SELECT_OPTION_ID, { children: 'Option one' }),
        node(SELECT_OPTION_ID, { children: 'Option two' }),
        node(SELECT_OPTION_ID, { children: 'Option three' }),
      ]),
    ]),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'radio'),
    'Radio choice field',
    'A label and a Radio Group with three choices.',
    mdiRadioboxMarked.path,
    node(FORM_CONTROL_ID, {}, [
      node(FORM_LABEL_ID, { children: 'Pick one' }),
      node(RADIO_GROUP_ID, { name: 'pick' }, [
        node(CHOICE_LABEL_ID, { label: 'First' }, [node(RADIO_ID, { value: 'First' })]),
        node(CHOICE_LABEL_ID, { label: 'Second' }, [node(RADIO_ID, { value: 'Second' })]),
        node(CHOICE_LABEL_ID, { label: 'Third' }, [node(RADIO_ID, { value: 'Third' })]),
      ]),
    ]),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'checkbox'),
    'Checkbox',
    'A tick box with words beside it.',
    mdiCheckboxMarkedOutline.path,
    node(CHOICE_LABEL_ID, { label: 'Yes, please' }, [
      node(CHECKBOX_ID, { name: 'agree', value: 'Yes' }),
    ]),
  ),
  preset(
    generatePresetId(FORM_HELPER_TEXT_ID),
    'Helper Text',
    'A line of guidance under a field.',
    mdiFormatText.path,
    node(FORM_HELPER_TEXT_ID, { children: 'We never share your address.' }),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'rating'),
    'Rating field',
    'A label and five stars.',
    mdiStarOutline.path,
    node(FORM_CONTROL_ID, {}, [
      node(FORM_LABEL_ID, { children: 'How did we do?' }),
      node(RATING_ID, { name: 'rating' }),
    ]),
  ),
]
