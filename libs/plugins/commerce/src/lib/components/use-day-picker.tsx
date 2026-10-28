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

import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import dayjs from 'dayjs'
import {
  addCheckInDays,
  CHECK_IN_USE_DAY_MAX_AHEAD_DAYS,
  isCheckInDayKey,
} from '../model/commerce-check-in-product'

const DAY_FORMAT = 'YYYY-MM-DD'

export interface UseDayPickerProps {
  /** The chosen day, `YYYY-MM-DD`, or '' for none. */
  value: string
  onChange: (dayKey: string) => void
  /** Today on the store's calendar: the first day it offers. */
  todayKey: string
  label?: string
  helperText?: string
  /** Days after `todayKey` only (a rain check moves a pass to a later day). */
  afterKey?: string
  size?: 'small' | 'medium'
  disabled?: boolean
}

/**
 * The day a pass is for (AGL-4043): the MUI X date picker the form builder's
 * date field uses, offering today on the store's calendar up to two years
 * ahead and never a day that has passed. Its own chunk, loaded only where a
 * product asks for a day, so a product page without one never downloads the
 * picker. Clearing it is "the day you buy".
 */
export function UseDayPicker(props: UseDayPickerProps) {
  const { value, onChange, todayKey, label, helperText, afterKey, size, disabled } = props
  const first = afterKey && afterKey >= todayKey ? addCheckInDays(afterKey, 1) : todayKey
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        label={label ?? 'Day you will use it'}
        value={isCheckInDayKey(value) ? dayjs(value) : null}
        onChange={(picked) => onChange(picked?.isValid() ? picked.format(DAY_FORMAT) : '')}
        minDate={dayjs(first)}
        maxDate={dayjs(addCheckInDays(todayKey, CHECK_IN_USE_DAY_MAX_AHEAD_DAYS))}
        disabled={disabled}
        slotProps={{
          textField: { size: size ?? 'small', helperText },
          field: { clearable: true },
        }}
      />
    </LocalizationProvider>
  )
}

UseDayPicker.displayName = 'UseDayPicker'

export default UseDayPicker
