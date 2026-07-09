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

import { FormFieldGrid, validationError } from '../mapper'
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
    ...rest
  } = useFieldApi({
    ...props,
  })
  const invalid = validationError(meta, validateOnMount)
  const hasError = Boolean(invalid)
  const text =
    invalid ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <FormControl
        required={isRequired}
        error={hasError}
        component="fieldset"
        {...FormControlProps}
      >
        <FormGroup {...FormGroupProps}>
          <FormLabel
            htmlFor={input.id || input.name}
            sx={{ marginBottom: 1 }}
            {...FormLabelProps}
          >
            {label}
          </FormLabel>
          <div>
            <ToggleButtonGroup
              color="primary"
              id={input.id || input.name}
              {...input}
              {...ToggleButtonGroupProps}
              disabled={isDisabled || isReadOnly}
              value={input.value}
              onChange={input.onChange}
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
