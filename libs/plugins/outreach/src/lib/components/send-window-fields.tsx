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

import {
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { OutreachSendWindow } from '../model/outreach.types'

/** Weekdays in the order a week reads, as `OutreachSendWindow.days` numbers them. */
const DAYS: ReadonlyArray<[number, string, string]> = [
  [1, 'Mon', 'Monday'],
  [2, 'Tue', 'Tuesday'],
  [3, 'Wed', 'Wednesday'],
  [4, 'Thu', 'Thursday'],
  [5, 'Fri', 'Friday'],
  [6, 'Sat', 'Saturday'],
  [0, 'Sun', 'Sunday'],
]

/** Office hours on weekdays: where an override starts. */
export const OUTREACH_DEFAULT_WINDOW: OutreachSendWindow = {
  days: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}

/** `540` → `"09:00"`, the value a time input takes. */
export function minutesToClock(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) return ''
  const bounded = Math.min(minutes, 24 * 60 - 1)
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`
}

/** `"09:00"` → `540`; `NaN` for anything else, so the validator names it. */
export function clockToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return Number.NaN
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : Number.NaN
}

export interface OutreachSendWindowFieldsProps {
  /** The sequence's own hours, or `null` to send in its mailbox's. */
  window: OutreachSendWindow | null
  onChange(window: OutreachSendWindow | null): void
  /** The issue to show under the days, and under the hours. */
  daysIssue?: string
  hoursIssue?: string
  disabled?: boolean
}

/**
 * A sequence's sending hours (AGL-2980): its mailbox's by default, or days
 * and hours of its own, read in the mailbox's timezone either way.
 */
export function OutreachSendWindowFields(props: OutreachSendWindowFieldsProps) {
  const { window, disabled } = props
  return (
    <Stack spacing={1.5}>
      <FormControlLabel
        control={
          <Switch
            checked={window !== null}
            onChange={(event) =>
              props.onChange(
                event.target.checked ? { ...OUTREACH_DEFAULT_WINDOW } : null,
              )
            }
            disabled={disabled}
          />
        }
        label="Sending hours of its own"
      />
      {window === null ? (
        <Typography variant="body2" color="text.secondary">
          Sends in its mailbox’s sending hours.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <Stack spacing={0.5}>
            <ToggleButtonGroup
              value={window.days}
              onChange={(_event, days: number[]) =>
                props.onChange({ ...window, days: [...days].sort() })
              }
              aria-label="Days it sends on"
              size="small"
              disabled={disabled}
              sx={{ flexWrap: 'wrap' }}
            >
              {DAYS.map(([day, short, long]) => (
                <ToggleButton key={day} value={day} aria-label={long}>
                  {short}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {props.daysIssue ? (
              <FormHelperText error>{props.daysIssue}</FormHelperText>
            ) : null}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              type="time"
              label="From"
              value={minutesToClock(window.startMinute)}
              onChange={(event) =>
                props.onChange({
                  ...window,
                  startMinute: clockToMinutes(event.target.value),
                })
              }
              disabled={disabled}
              error={Boolean(props.hoursIssue)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="time"
              label="Until"
              value={minutesToClock(window.endMinute)}
              onChange={(event) =>
                props.onChange({
                  ...window,
                  endMinute: clockToMinutes(event.target.value),
                })
              }
              disabled={disabled}
              error={Boolean(props.hoursIssue)}
              helperText={props.hoursIssue}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}
OutreachSendWindowFields.displayName = 'OutreachSendWindowFields'

export default OutreachSendWindowFields
