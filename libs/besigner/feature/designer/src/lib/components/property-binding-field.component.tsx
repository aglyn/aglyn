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

import type * as Aglyn from '@aglyn/aglyn'
import { FieldComponentType, matchComponentPropToken } from '@aglyn/aglyn'
import {
  type FieldBindAction,
  FormFieldGrid,
  type FormFieldGridProps,
  useFieldApi,
} from '@aglyn/shared-ui-jsx-forms'
import { Box, ButtonBase, TextField } from '@mui/material'
import {
  type ComponentType,
  type FocusEvent,
  forwardRef,
  type MouseEvent,
  type ReactNode,
  useMemo,
  useState,
} from 'react'

import type { BindingOption } from '../contexts/binding-picker-context'
import { componentPropBindingOptions } from '../hooks/use-insert-token-options'
import {
  TOKEN_PILL_ATTR,
  TOKEN_PILL_GROUP_ATTR,
} from '../utils/token-editable-dom'
import {
  type ResolvedTokenLabel,
  resolveTokenLabel,
  type TokenLabelContext,
} from '../utils/token-segments'
import { InsertTokenMenu } from './insert-token-menu.component'
import { TokenPillPopover, tokenPillContainerSx } from './token-pill.component'

/**
 * Binding a field that has no text to type a token into.
 *
 * A free-text attribute has always taken `{{prop.headline}}`: the token is
 * typed, or picked with the `{}` in the box, and substitution does the rest.
 * A switch, a checkbox or a dropdown has no text to type into, so inside a
 * reusable component it could only ever hold the component's own value — and
 * a property of the matching kind had nothing to drive.
 *
 * This wraps such a field, inside a component editor only. Unbound, it is the
 * field exactly as before, with a `{}` among its corner controls. Bound, the
 * control gives way to the property it is bound to, drawn as the pill a text
 * field would draw — because the control would otherwise go on showing a
 * value the page no longer uses.
 *
 * The stored value is the same exact `{{prop.<name>}}` token a text field
 * holds, so the graft needs nothing new to find it, and a binding to a
 * property of the wrong kind is simply never offered.
 */

/** Mapper key for {@link PropertyBindingField} (editor-internal, never persisted). */
export const PROPERTY_BINDING_FIELD_COMPONENT = 'aglyn-property-binding-field'

/**
 * The property kinds each field kind can be bound to, keyed by the attribute
 * type a component schema DECLARES.
 *
 * Declared rather than rendered: a Screen picker renders as a plain select,
 * and what it holds is a link, not a choice.
 */
export const PROPERTY_BINDING_TYPES: Readonly<
  Partial<Record<string, readonly Aglyn.ReusableComponentPropType[]>>
> = {
  [FieldComponentType.SWITCH]: ['boolean'],
  [FieldComponentType.CHECKBOX]: ['boolean'],
  [FieldComponentType.SELECT]: ['choice'],
  [FieldComponentType.SCREEN_SELECT]: ['href'],
}

/** What each kind of property is called in the panel's own words. */
const PROPERTY_KIND_LABEL: Readonly<
  Partial<Record<Aglyn.ReusableComponentPropType, string>>
> = {
  boolean: 'Yes / no',
  choice: 'Choice',
  href: 'Link',
}

/**
 * The values of a `choice` property that a dropdown does not offer.
 *
 * A choice reaches the dropdown's element as its VALUE, and an element handed
 * a value outside its own list draws as though nothing were chosen. The
 * dialog that declares a choice cannot see the dropdowns it will drive, so the
 * mismatch is only knowable here, where the two meet.
 */
export function unofferedChoiceValues(
  prop: Pick<Aglyn.ReusableComponentProp, 'type' | 'options'> | undefined,
  fieldOptions: unknown,
): string[] {
  if (prop?.type !== 'choice' || !Array.isArray(fieldOptions)) return []
  const offered = new Set(
    fieldOptions.map((option) =>
      String((option as { value?: unknown } | null)?.value ?? ''),
    ),
  )
  return (prop.options ?? [])
    .map((option) => option?.value)
    .filter((value): value is string => Boolean(value) && !offered.has(value))
}

/** A component-mapper entry: a component, or `{ component, ...defaults }`. */
export type PropertyBindingControl =
  | ComponentType<any>
  | { component: ComponentType<any>; [key: string]: unknown }

export interface PropertyBindingOptions {
  /** The attribute type the component schema declares for this field. */
  declaredComponent: unknown
  /**
   * The props the edited component declares, or `undefined` outside a
   * component editor — where `{{prop.*}}` resolves to nothing, so there is
   * nothing to bind to.
   */
  componentProps: readonly Aglyn.ReusableComponentProp[] | null | undefined
  /** The mapper entry this field renders with while unbound. */
  control: PropertyBindingControl | undefined
  /** Display-name inputs for the bound pill. */
  tokenLabelContext?: TokenLabelContext
}

/**
 * The field, wrapped to take a property binding when it can, or unchanged.
 *
 * Unchanged outside a component editor, for a field whose kind takes no
 * binding, for a read-only or disabled field (a control that writes an
 * unwritable field is a lie), for a checkbox LIST or a multiple-choice
 * dropdown — each holds a list, and a property supplies one value — and
 * whenever the control to fall back to is unknown, since a wrapper with
 * nothing to render would blank the field.
 */
export function withPropertyBinding<T extends Record<string, unknown>>(
  field: T,
  options: PropertyBindingOptions,
): T {
  const { declaredComponent, componentProps, control, tokenLabelContext } =
    options
  if (!componentProps || !control) return field
  const types = PROPERTY_BINDING_TYPES[String(declaredComponent)]
  if (!types?.length) return field
  if (field['isReadOnly'] || field['isDisabled']) return field
  if (declaredComponent === FieldComponentType.CHECKBOX && field['options']) {
    return field
  }
  if (field['isMulti'] || field['multiple']) return field
  const kinds = types
    .map((type) => PROPERTY_KIND_LABEL[type])
    .filter(Boolean)
    .join(' or ')
  return {
    ...field,
    component: PROPERTY_BINDING_FIELD_COMPONENT,
    bindingControl: control,
    bindingOptions: componentPropBindingOptions(componentProps, types),
    bindingProps: componentProps.filter((prop) =>
      types.includes(prop?.type ?? 'text'),
    ),
    bindingKinds: kinds,
    bindingEmptyText:
      `This component has no ${kinds || 'matching'} properties yet. Add one ` +
      'under File ▸ Properties…, then bind it here.',
    tokenLabelContext,
  }
}

/** The mapper entry split into the component and the defaults it carries. */
function splitControl(control: PropertyBindingControl | undefined): {
  Control: ComponentType<any> | undefined
  defaults: Record<string, unknown>
} {
  if (!control) return { Control: undefined, defaults: {} }
  if (typeof control === 'object' && 'component' in control) {
    const { component, ...defaults } = control
    return { Control: component, defaults }
  }
  return { Control: control as ComponentType<any>, defaults: {} }
}

interface BoundPropertyInputProps {
  token: string
  resolved: ResolvedTokenLabel
  onOpen: (anchor: HTMLElement) => void
  /** The field's own label, so the button says what it changes. */
  fieldLabel?: string
  // Injected by MUI InputBase:
  className?: string
  disabled?: boolean
  id?: string
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

/**
 * The bound property, drawn INSIDE a real outlined field so the label, notch,
 * helper text and focus ring are the ones every other attribute has.
 *
 * The pill is a button rather than the passive span a text field draws: here
 * it is the whole value, so it has to be reachable by keyboard, and pressing
 * it is how the binding is changed or removed.
 */
const BoundPropertyInput = forwardRef<HTMLButtonElement, BoundPropertyInputProps>(
  function BoundPropertyInput(props, ref) {
    const {
      token,
      resolved,
      onOpen,
      fieldLabel,
      className,
      disabled,
      id,
      onFocus,
      onBlur,
      'aria-describedby': describedBy,
    } = props
    const pillAttributes = {
      [TOKEN_PILL_ATTR]: token,
      [TOKEN_PILL_GROUP_ATTR]: resolved.known ? resolved.group : 'unknown',
    }
    return (
      <Box
        className={className}
        sx={{ ...tokenPillContainerSx, display: 'flex', alignItems: 'center' }}
      >
        <ButtonBase
          ref={ref}
          id={id}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-label={`${fieldLabel ? `${fieldLabel}: ` : ''}bound to ${resolved.label}. Change or remove the binding`}
          title={token}
          onFocus={onFocus}
          onBlur={onBlur}
          onClick={(event: MouseEvent<HTMLElement>) =>
            onOpen(event.currentTarget)
          }
          {...pillAttributes}
        >
          {resolved.label}
        </ButtonBase>
      </Box>
    )
  },
)

export interface PropertyBindingFieldProps {
  [key: string]: unknown
  name: string
  label?: ReactNode
  help?: unknown
  description?: ReactNode
  helperText?: ReactNode
  bindingControl?: PropertyBindingControl
  bindingOptions?: BindingOption[]
  /** The declared props this field can be bound to. */
  bindingProps?: readonly Aglyn.ReusableComponentProp[]
  /** Those props' kinds in the panel's words, e.g. `Choice`. */
  bindingKinds?: string
  bindingEmptyText?: string
  tokenLabelContext?: TokenLabelContext
  FormFieldGridProps?: FormFieldGridProps
}

/**
 * What a bound field says under the property it follows, and whether that is
 * a problem.
 *
 * Three ways a binding can be wrong while still looking bound, each named in
 * words an author can act on: the property is gone (it was renamed or
 * removed, so nothing substitutes), the property is the wrong kind (a token
 * written some other way than this field's picker), or — for a dropdown —
 * some of the property's choices are values the dropdown does not offer.
 */
export function describePropertyBinding(options: {
  token: string
  resolved: ResolvedTokenLabel
  bindingProps?: readonly Aglyn.ReusableComponentProp[]
  bindingKinds?: string
  fieldOptions?: unknown
}): { text: string; error: boolean } {
  const { token, resolved, bindingProps, bindingKinds, fieldOptions } = options
  const name = matchComponentPropToken(token)
  const prop = (bindingProps ?? []).find((entry) => entry?.name === name)
  if (!prop) {
    return resolved.known
      ? {
          text:
            `${resolved.label} is not a ${bindingKinds || 'matching'} ` +
            'property, so it cannot set this field. Bind one that is, or ' +
            'remove the binding.',
          error: true,
        }
      : {
          text:
            'This component declares no property by that name, so pages ' +
            'cannot set it. Bind a property it declares, or remove the ' +
            'binding.',
          error: true,
        }
  }
  const unoffered = unofferedChoiceValues(prop, fieldOptions)
  if (unoffered.length) {
    const offered = (Array.isArray(fieldOptions) ? fieldOptions : [])
      .map((option) => {
        const { value, label } = (option ?? {}) as {
          value?: unknown
          label?: unknown
        }
        const text = String(value ?? '')
        return label != null && String(label) !== text
          ? `${String(label)} (${text})`
          : text
      })
      .filter(Boolean)
    return {
      text:
        `This field does not offer ${unoffered.join(', ')}, so a page that ` +
        `chooses ${unoffered.length === 1 ? 'it' : 'one of those'} gets the ` +
        `field's own default. Give ${resolved.label} values from: ` +
        `${offered.join(', ')}.`,
      error: true,
    }
  }
  return {
    text: `Each page sets this with the ${resolved.label} property.`,
    error: false,
  }
}

/**
 * The data-driven-forms field registered as
 * {@link PROPERTY_BINDING_FIELD_COMPONENT}. The token flows through
 * react-final-form like any other value, so the Attributes panel's debounced
 * autosave commits a binding exactly as it commits a tick.
 */
export function PropertyBindingField(props: PropertyBindingFieldProps) {
  const {
    bindingControl,
    bindingOptions = [],
    bindingProps,
    bindingKinds,
    bindingEmptyText,
    tokenLabelContext = {},
    ...fieldProps
  } = props
  const { input } = useFieldApi({ name: fieldProps.name } as never) as {
    input: { value: unknown; onChange: (value: unknown) => void }
  }
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [pillAnchor, setPillAnchor] = useState<HTMLElement | null>(null)

  const bound =
    matchComponentPropToken(input.value) != null
      ? String(input.value).trim()
      : null
  const resolved = useMemo(
    () => (bound ? resolveTokenLabel(bound, tokenLabelContext) : undefined),
    [bound, tokenLabelContext],
  )
  const labelText =
    typeof fieldProps.label === 'string' && fieldProps.label
      ? fieldProps.label
      : undefined
  const bind: FieldBindAction = {
    label: bound
      ? `Change the property ${labelText ?? 'this field'} is bound to`
      : `Bind ${labelText ?? 'this field'} to a property`,
    onOpen: setMenuAnchor,
  }
  const gridProps: FormFieldGridProps = {
    ...(fieldProps.FormFieldGridProps ?? {}),
    bind,
  }

  const { Control, defaults } = splitControl(bindingControl)

  const menus = (
    <>
      <InsertTokenMenu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        options={bindingOptions}
        emptyText={bindingEmptyText}
        onInsert={(token) => {
          setMenuAnchor(null)
          input.onChange(token)
        }}
      />
      <TokenPillPopover
        anchorEl={pillAnchor}
        token={bound ?? ''}
        onClose={() => setPillAnchor(null)}
        onReplace={() => {
          setMenuAnchor(pillAnchor)
          setPillAnchor(null)
        }}
        onRemove={() => {
          setPillAnchor(null)
          // Unset rather than `false` or `''`: the element goes back to its
          // own default, which is what it rendered before it was bound.
          input.onChange(undefined)
        }}
      />
    </>
  )

  if (bound && resolved) {
    const described = describePropertyBinding({
      token: bound,
      resolved,
      bindingProps,
      bindingKinds,
      fieldOptions: fieldProps['options'],
    })
    return (
      <>
        <FormFieldGrid
          help={fieldProps.help as FormFieldGridProps['help']}
          {...gridProps}
        >
          <TextField
            fullWidth
            label={fieldProps.label}
            value=""
            helperText={described.text}
            error={described.error}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                readOnly: true,
                inputComponent: BoundPropertyInput as never,
                inputProps: {
                  token: bound,
                  resolved,
                  fieldLabel: labelText,
                  onOpen: setPillAnchor,
                },
              },
            }}
          />
        </FormFieldGrid>
        {menus}
      </>
    )
  }

  if (!Control) return null
  return (
    <>
      <Control {...defaults} {...fieldProps} FormFieldGridProps={gridProps} />
      {menus}
    </>
  )
}
PropertyBindingField.displayName = 'PropertyBindingField'

export default PropertyBindingField
