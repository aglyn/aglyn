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

import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import { forwardRef, type MouseEvent, useCallback, useEffect, useState } from 'react'
import InlineFormControl, {
  type InlineFormControlProps,
} from './inline-form-control'

export type ButtonGroupFormControl = {
  name?: string
  label?: JSX.Children
  helperText?: JSX.Children
  options?: Array<{
    value?: string
    label?: string
    icon?: MdiIconProps
  }>
}

export interface ToggleButtonFormControlProps extends InlineFormControlProps {
  schema: ButtonGroupFormControl
}

export const ToggleButtonFormControl = forwardRef<
  any,
  ToggleButtonFormControlProps
>((props, ref) => {
  const { schema, value, onChange, ...rest } = props

  const [localValue, setLocalValue] = useState<string>(value || '')

  useEffect(() => {
    setLocalValue(value || '')
  }, [value])

  const handleChange = useCallback(
    (e: MouseEvent<HTMLElement>, value: string) => {
      setLocalValue(value)
      onChange?.(e, value)
    },
    [onChange],
  )

  return (
    <InlineFormControl
      ref={ref}
      label={schema.label}
      helperText={
        <>
          {schema.helperText} {<b>- {localValue || 'not set'}</b>}
        </>
      }
      {...rest}
    >
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        onChange={handleChange}
        value={localValue}
      >
        {schema.options?.map((i) => (
          <ToggleButton
            key={i.value}
            value={i.value}
            aria-label={i.label}
            sx={{ p: 0.5 }}
          >
            <Tooltip title={i.label}>
              <MdiIcon fontSize="small" {...i.icon} />
            </Tooltip>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </InlineFormControl>
  )
})
ToggleButtonFormControl.displayName = 'ToggleButtonFormControl'

export default ToggleButtonFormControl
