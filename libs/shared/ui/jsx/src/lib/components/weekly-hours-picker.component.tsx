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

import { mdiClose, mdiPlus } from '@aglyn/shared-data-mdi'
import {
  Box,
  Button,
  FormHelperText,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useMemo } from 'react'

import {
  clockLabel,
  type WeeklyHours,
  type WeeklyHoursInterval,
  WEEKLY_HOURS_DAYS,
  weeklyHoursFromText,
  weeklyHoursToText,
} from '../utils/weekly-hours'
import { MdiIcon } from './mdi-icon'

const LAST_MINUTE = 23 * 60 + 59

/** Every quarter hour, plus 11:59 PM so a day can run to midnight. */
const TIME_OPTIONS: number[] = [...Array.from({ length: 96 }, (_, step) => step * 15), LAST_MINUTE]

const DEFAULT_INTERVAL: WeeklyHoursInterval = { start: 9 * 60, end: 17 * 60 }

export interface WeeklyHoursPickerProps {
  value: WeeklyHours
  onChange: (hours: WeeklyHours) => void
  /** Shown above the days, e.g. "Pickup hours". */
  label?: ReactNode
  helperText?: ReactNode
  disabled?: boolean
  /** What a day gets when it is switched on or given another interval. */
  defaultInterval?: WeeklyHoursInterval
  /** Word for an interval on the add button: "hours" or "window". */
  intervalNoun?: string
  /**
   * Every interval ends on the day it starts: the To menu offers only times
   * after From. Off by default, where a To before From runs past midnight.
   */
  sameDay?: boolean
}

/**
 * A week of opening hours chosen by clicking: a switch per day, and for an
 * open day one or more from/to times picked from a menu. Nothing is typed.
 */
export function WeeklyHoursPicker(props: WeeklyHoursPickerProps) {
  const {
    value,
    onChange,
    label,
    helperText,
    disabled,
    defaultInterval = DEFAULT_INTERVAL,
    intervalNoun = 'hours',
    sameDay = false,
  } = props

  const setDay = (index: number, intervals: WeeklyHoursInterval[]) =>
    onChange(value.map((day, i) => (i === index ? intervals : day)))

  const optionsFor = (current: number, after?: number) => {
    const options = TIME_OPTIONS.includes(current)
      ? TIME_OPTIONS
      : [...TIME_OPTIONS, current].sort((a, b) => a - b)
    return after === undefined
      ? options
      : options.filter((minutes) => minutes > after || minutes === current)
  }

  const changed = (
    interval: WeeklyHoursInterval,
    edge: 'start' | 'end',
    minutes: number,
  ): WeeklyHoursInterval => {
    const next = { ...interval, [edge]: minutes }
    // A From moved past its To drags the To along, keeping the length.
    if (sameDay && next.end <= next.start) {
      next.end = Math.min(next.start + Math.max(interval.end - interval.start, 60), LAST_MINUTE)
    }
    return next
  }

  return (
    <Box role="group" aria-label={typeof label === 'string' ? label : undefined}>
      {label ? (
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {label}
        </Typography>
      ) : null}
      <Stack spacing={0.75}>
        {WEEKLY_HOURS_DAYS.map(({ index, name }) => {
          const intervals = value[index] ?? []
          const open = intervals.length > 0
          const last = intervals[intervals.length - 1]
          return (
            <Stack
              key={index}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}
            >
              <Stack direction="row" sx={{ alignItems: 'center', minWidth: 150 }}>
                <Switch
                  size="small"
                  checked={open}
                  disabled={disabled}
                  onChange={(event) =>
                    setDay(index, event.target.checked ? [{ ...defaultInterval }] : [])
                  }
                  slotProps={{ input: { 'aria-label': `Open on ${name}` } }}
                />
                <Typography variant="body2">{name}</Typography>
              </Stack>
              {open ? (
                <Stack spacing={0.75} sx={{ flex: 1 }}>
                  {intervals.map((interval, position) => (
                    <Stack key={position} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      {(['start', 'end'] as const).map((edge) => (
                        <TextField
                          key={edge}
                          select
                          size="small"
                          label={edge === 'start' ? 'From' : 'To'}
                          value={interval[edge]}
                          disabled={disabled}
                          onChange={(event) =>
                            setDay(
                              index,
                              intervals.map((item, i) =>
                                i === position
                                  ? changed(item, edge, Number(event.target.value))
                                  : item,
                              ),
                            )
                          }
                          slotProps={{
                            htmlInput: {
                              'aria-label': `${name} ${edge === 'start' ? 'from' : 'to'}${
                                intervals.length > 1 ? ` ${position + 1}` : ''
                              }`,
                            },
                            select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } },
                          }}
                          sx={{ minWidth: 128, flex: 1 }}
                        >
                          {optionsFor(
                            interval[edge],
                            sameDay && edge === 'end' ? interval.start : undefined,
                          ).map((minutes) => (
                            <MenuItem key={minutes} value={minutes}>
                              {clockLabel(minutes)}
                            </MenuItem>
                          ))}
                        </TextField>
                      ))}
                      <Tooltip title={`Remove these ${intervalNoun}`}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={disabled}
                            aria-label={`Remove ${name} ${intervalNoun}${
                              intervals.length > 1 ? ` ${position + 1}` : ''
                            }`}
                            onClick={() =>
                              setDay(
                                index,
                                intervals.filter((_, i) => i !== position),
                              )
                            }
                          >
                            <MdiIcon path={mdiClose.path} fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  ))}
                  <Box>
                    <Button
                      size="small"
                      disabled={disabled}
                      startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
                      aria-label={`Add ${intervalNoun} on ${name}`}
                      onClick={() => {
                        // A second interval starts an hour after the first ends,
                        // the usual shape of a lunch break.
                        const start = Math.min(last.end + 60, 22 * 60)
                        setDay(index, [
                          ...intervals,
                          { start, end: Math.min(start + 4 * 60, LAST_MINUTE) },
                        ])
                      }}
                    >
                      {`Add ${intervalNoun}`}
                    </Button>
                  </Box>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ pt: { sm: 0.75 } }}>
                  {'Closed'}
                </Typography>
              )}
            </Stack>
          )
        })}
      </Stack>
      {helperText ? <FormHelperText>{helperText}</FormHelperText> : null}
    </Box>
  )
}

export interface OpeningHoursPickerProps
  extends Omit<WeeklyHoursPickerProps, 'value' | 'onChange'> {
  /** Hours text, one `Mo-Fr 09:00-17:00` line per set of days. */
  value: string | null | undefined
  onChange: (text: string) => void
}

/**
 * {@link WeeklyHoursPicker} over the stored hours text: reads the lines into a
 * week and writes the week back as lines, so what is saved is unchanged.
 */
export function OpeningHoursPicker(props: OpeningHoursPickerProps) {
  const { value, onChange, helperText, ...rest } = props
  const { hours, unreadLines } = useMemo(() => weeklyHoursFromText(value ?? ''), [value])
  return (
    <WeeklyHoursPicker
      {...rest}
      value={hours}
      onChange={(next) => onChange(weeklyHoursToText(next))}
      helperText={
        unreadLines.length ? (
          <Typography component="span" variant="caption" color="warning.main">
            {`Some saved hours could not be read (line ${unreadLines.join(', ')}) and are not shown. ` +
              'Set the days again here and save to replace them.'}
          </Typography>
        ) : (
          helperText
        )
      }
    />
  )
}

export default WeeklyHoursPicker
