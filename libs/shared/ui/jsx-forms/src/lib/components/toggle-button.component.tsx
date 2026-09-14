/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  type ExtendedFieldMeta,
  FormFieldGrid,
  validationError,
} from '../mapper'
import { buildFieldClear } from '../mapper/form-field-grid'
import {
  useFieldApi,
  type UseFieldApiConfig,
} from '@data-driven-forms/react-form-renderer'
import {
  FormControl,
  FormGroup,
  FormHelperText,
  FormLabel,
  ToggleButton,
  ToggleButtonGroup,
  type ToggleButtonGroupProps,
  type ToggleButtonProps as MuiToggleButtonProps,
} from '@mui/material'

export type ToggleButtonProps = UseFieldApiConfig & {
  ToggleButtonProps?: Partial<MuiToggleButtonProps>
  ToggleButtonGroupProps?: Partial<ToggleButtonGroupProps>
}

export const ToggleButtonComponent = (props: ToggleButtonProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    isRequired,
    label,
    helperText,
    description,
    validateOnMount,
    meta,
    FormFieldGridProps = {},
    FormControlProps = {},
    FormGroupProps = {},
    FormControlLabelProps = {},
    ToggleButtonProps = {},
    ToggleButtonGroupProps = {},
    FormLabelProps = {},
    FormHelperTextProps = {},
    inputProps,
    options,
    help,
    clearable,
    ...rest
  } = useFieldApi({
    ...props,
  })
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const hasError = Boolean(invalid)
  const text =
    invalid ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description
  const clear = buildFieldClear({
    clearable,
    label,
    hasValue:
      input.value !== '' && input.value !== undefined && input.value !== null,
    locked: Boolean(isDisabled || isReadOnly),
    onClear: () => input.onChange(undefined),
  })

  return (
    <FormFieldGrid help={help} clear={clear} {...FormFieldGridProps}>
      <FormControl
        required={isRequired}
        error={hasError}
        component="fieldset"
        {...FormControlProps}
      >
        <FormGroup {...FormGroupProps}>
          <FormLabel
            htmlFor={input.name}
            sx={{ marginBottom: 1 }}
            {...FormLabelProps}
          >
            {label}
          </FormLabel>
          <div>
            <ToggleButtonGroup
              color="primary"
              id={input.name}
              {...input}
              {...ToggleButtonGroupProps}
              disabled={isDisabled || isReadOnly}
              value={input.value}
              // The group's own answer, not the clicked button's: pressing the
              // chosen button again answers `null`, which is how an exclusive
              // group is switched back off. The event's target still names the
              // button, so reading it could never deselect anything.
              onChange={(_event: unknown, value: unknown) =>
                input.onChange(value ?? undefined)
              }
              exclusive
              {...rest}
            >
              {Array.isArray(options) &&
                options.map(({ value, label, children, ...option }) => (
                  <ToggleButton
                    {...ToggleButtonProps}
                    key={value}
                    value={value}
                    disabled={isDisabled || isReadOnly}
                    {...option}
                  >
                    {label || children}
                  </ToggleButton>
                ))}
            </ToggleButtonGroup>
          </div>
          {text && (
            <FormHelperText {...FormHelperTextProps}>{text}</FormHelperText>
          )}
        </FormGroup>
      </FormControl>
    </FormFieldGrid>
  )
}
ToggleButtonComponent.displayName = 'ToggleButtonComponent'

export default ToggleButtonComponent
