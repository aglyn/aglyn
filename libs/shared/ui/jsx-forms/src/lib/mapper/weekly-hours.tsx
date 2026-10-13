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

import { OpeningHoursPicker } from '@aglyn/shared-ui-jsx/components/weekly-hours-picker.component'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'

export interface WeeklyHoursProps extends BaseFieldProps {
  FormFieldGridProps?: FormFieldGridProps
  /** Word for an interval on the add button: "hours" or "window". */
  intervalNoun?: string
}

/**
 * A week of opening hours picked by clicking. The persisted value is still
 * the hours text, one `Mo-Fr 09:00-17:00` line per set of days, so whatever
 * reads it is untouched; the author never types that syntax.
 */
export const WeeklyHoursField = (props: WeeklyHoursProps) => {
  const { input, label, helperText, isDisabled, isReadOnly, help, intervalNoun, FormFieldGridProps = {} } =
    useFieldApi(props)
  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <OpeningHoursPicker
        label={label}
        value={typeof input.value === 'string' ? input.value : ''}
        onChange={(text) => input.onChange(text)}
        helperText={helperText}
        disabled={isDisabled || isReadOnly}
        intervalNoun={intervalNoun}
      />
    </FormFieldGrid>
  )
}

export default WeeklyHoursField
