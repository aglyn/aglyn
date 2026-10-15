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
import { mdiCalendarMonthOutline, mdiClockOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs, { type Dayjs } from 'dayjs'
import {
  forwardRef,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  category,
  FIELD_ARIA_LABEL,
  FIELD_DATASET_FIELD,
  FIELD_FULL_WIDTH,
  FIELD_INPUT_SIZE,
  FIELD_NAME,
  FIELD_REQUIRED,
  FieldIdContext,
  FORM_CONTROL_ID,
  FORM_LABEL_ID,
  node,
  nodeSxList,
  preset,
  useFilledInputs,
} from './form-controls'

/*
 * THE DATE AND TIME FIELDS OF A FORM: MUI X's pickers, one element each.
 *
 * They are their own module, loaded only on a page that places one, because
 * the pickers and their date library are the heaviest thing a form can hold
 * and most forms hold neither. They sit in a Form Control beside a Form
 * Label exactly like an Input, and like every form element they know nothing
 * about the form around them: each carries a NAME, and the form sends what
 * the browser sends.
 *
 * What the browser sends is the part that needed care. A picker's own field
 * would post the day as the visitor reads it ("10/15/2026"), which changes
 * with the language and cannot be sorted or stored as a date. So the picker
 * is left unnamed and the answer is posted from an input of our own, as the
 * ISO day (`2026-10-15`) or the 24-hour time (`14:30`) — the same text the
 * browser's own date and time inputs post, and what a dataset date stores.
 *
 * Component ids are persisted in documents; never rename them.
 */
export const DATE_PICKER_ID: Aglyn.ComponentId = 'muiDatePicker'
export const TIME_PICKER_ID: Aglyn.ComponentId = 'muiTimePicker'

const DAY = 'YYYY-MM-DD'
const CLOCK = 'HH:mm'

/** `2026-10-15` as a picker value, or `null` for anything that is not a day. */
export function parsePickerDay(value: unknown): Dayjs | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const day = dayjs(text)
  return day.isValid() && day.format(DAY) === text ? day : null
}

/** `14:30` as a picker value (today at that time), or `null`. */
export function parsePickerTime(value: unknown): Dayjs | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value.trim() : '')
  if (!match) return null
  return dayjs().hour(Number(match[1])).minute(Number(match[2])).second(0).millisecond(0)
}

/** What a picked value posts as: the ISO day or the 24-hour time, or nothing. */
export function pickerAnswer(value: Dayjs | null, kind: 'date' | 'time'): string {
  if (!value || !value.isValid()) return ''
  return value.format(kind === 'date' ? DAY : CLOCK)
}

interface PickerFieldProps {
  /** What the answer is sent as. */
  name?: string
  required?: boolean
  /**
   * A name for assistive technology when no Form Label sits beside the
   * picker.
   */
  ariaLabel?: string
  fullWidth?: boolean
  size?: 'small' | 'medium'
  [key: string]: any
}

export interface AglynDatePickerProps extends PickerFieldProps {
  /** Days before today cannot be picked. */
  disablePast?: boolean
  /** Days after today cannot be picked. */
  disableFuture?: boolean
  /** The first day that can be picked, as `YYYY-MM-DD`. */
  minDate?: string
  /** The last day that can be picked, as `YYYY-MM-DD`. */
  maxDate?: string
  /** Starts filled in with today. */
  defaultToday?: boolean
}

export interface AglynTimePickerProps extends PickerFieldProps {
  /** The minutes the clock steps by. */
  minutesStep?: number | string
  /** The earliest time that can be picked, as `HH:mm`. */
  minTime?: string
  /** The latest time that can be picked, as `HH:mm`. */
  maxTime?: string
  /** `12` or `24`; anything else follows the visitor's language. */
  clock?: string
}

/**
 * The input a picker's answer is posted from. It is a real text input, not
 * `type="hidden"` and not read-only, because those two are exactly the inputs
 * the browser never checks: a required picker left empty must stop the form
 * like any other required field. It sits invisibly under the picker, so the
 * browser's "Please fill in this field" points at the picker, and it hands
 * focus to the picker when that happens.
 *
 * Every change is announced as a bubbling `change` event, so anything that
 * listens on the field — a form, a calculator — hears a picked date the way
 * it hears a typed word.
 */
function PickerAnswer(props: {
  name?: string
  value: string
  required?: boolean
  onInvalid: () => void
}) {
  const { name, value, required, onInvalid } = props
  const ref = useRef<HTMLInputElement>(null)
  const announced = useRef(value)
  useEffect(() => {
    if (announced.current === value) return
    announced.current = value
    ref.current?.dispatchEvent(new Event('change', { bubbles: true }))
  }, [value])
  return (
    <input
      ref={ref}
      type="text"
      name={name || undefined}
      value={value}
      required={Boolean(required)}
      onChange={() => undefined}
      onInvalid={onInvalid}
      tabIndex={-1}
      aria-hidden="true"
      autoComplete="off"
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: '100%',
        height: 1,
        padding: 0,
        border: 0,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  )
}

/** The frame both pickers share: the adapter, the answer input, the field. */
function PickerFrame(props: {
  name?: string
  required?: boolean
  answer: string
  fullWidth?: boolean
  rest: Record<string, unknown>
  focusPicker: () => void
  children: ReactNode
}) {
  const { name, required, answer, fullWidth, rest, focusPicker, children } = props
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box
        {...rest}
        sx={[
          {
            position: 'relative',
            display: fullWidth ? 'flex' : 'inline-flex',
            flexDirection: 'column',
            width: fullWidth ? '100%' : undefined,
          },
          ...nodeSxList(rest['sx']),
        ] as SxProps<Theme>}
      >
        {children}
        <PickerAnswer name={name} value={answer} required={required} onInvalid={focusPicker} />
      </Box>
    </LocalizationProvider>
  )
}

/** The text field slot both pickers draw: linked to the Form Label, never floating a label of its own. */
function textFieldSlot(options: {
  id?: string
  ariaLabel?: string
  size?: 'small' | 'medium'
  fullWidth?: boolean
  filled: boolean
  required?: boolean
}) {
  const { id, ariaLabel, size, fullWidth, filled, required } = options
  return {
    ...(id ? { id } : {}),
    size: size === 'small' ? ('small' as const) : ('medium' as const),
    fullWidth: Boolean(fullWidth),
    variant: filled ? ('filled' as const) : ('outlined' as const),
    // The Form Label above is the label; the picker's own would float inside.
    label: undefined,
    required: Boolean(required),
    ...(ariaLabel ? { inputProps: { 'aria-label': ariaLabel } } : {}),
  }
}

/** A day a visitor picks from a calendar; sends it as `2026-10-15`. */
export const AglynDatePicker = forwardRef<HTMLDivElement, AglynDatePickerProps>(
  (props, ref) => {
    const {
      name,
      required,
      ariaLabel,
      fullWidth,
      size,
      disablePast,
      disableFuture,
      minDate,
      maxDate,
      defaultToday,
      datasetFieldId: _datasetFieldId,
      ...rest
    } = dropClearedProps(props)
    const id = useContext(FieldIdContext)
    const filled = useFilledInputs()
    const [value, setValue] = useState<Dayjs | null>(null)
    // Today is filled in after the page opens: the server's today and the
    // visitor's are not always the same day.
    useEffect(() => {
      if (defaultToday) setValue((current) => current ?? dayjs().startOf('day'))
    }, [defaultToday])
    const fieldRef = useRef<HTMLDivElement>(null)
    return (
      <PickerFrame
        name={name}
        required={required}
        answer={pickerAnswer(value, 'date')}
        fullWidth={fullWidth}
        rest={{ ...rest, ref }}
        focusPicker={() => fieldRef.current?.querySelector<HTMLElement>('[tabindex="0"], input')?.focus()}
      >
        <DatePicker
          value={value}
          onChange={(next) => setValue(next && next.isValid() ? next : null)}
          disablePast={Boolean(disablePast)}
          disableFuture={Boolean(disableFuture)}
          {...(parsePickerDay(minDate) ? { minDate: parsePickerDay(minDate) as Dayjs } : {})}
          {...(parsePickerDay(maxDate) ? { maxDate: parsePickerDay(maxDate) as Dayjs } : {})}
          slotProps={{
            textField: {
              ...textFieldSlot({ id, ariaLabel, size, fullWidth, filled, required }),
              ref: fieldRef,
            },
          }}
        />
      </PickerFrame>
    )
  },
)
AglynDatePicker.displayName = 'AglynDatePicker'

/** A time a visitor picks from a clock; sends it as `14:30`. */
export const AglynTimePicker = forwardRef<HTMLDivElement, AglynTimePickerProps>(
  (props, ref) => {
    const {
      name,
      required,
      ariaLabel,
      fullWidth,
      size,
      minutesStep,
      minTime,
      maxTime,
      clock,
      datasetFieldId: _datasetFieldId,
      ...rest
    } = dropClearedProps(props)
    const id = useContext(FieldIdContext)
    const filled = useFilledInputs()
    const [value, setValue] = useState<Dayjs | null>(null)
    const fieldRef = useRef<HTMLDivElement>(null)
    const step = Number(minutesStep)
    return (
      <PickerFrame
        name={name}
        required={required}
        answer={pickerAnswer(value, 'time')}
        fullWidth={fullWidth}
        rest={{ ...rest, ref }}
        focusPicker={() => fieldRef.current?.querySelector<HTMLElement>('[tabindex="0"], input')?.focus()}
      >
        <TimePicker
          value={value}
          onChange={(next) => setValue(next && next.isValid() ? next : null)}
          {...(Number.isInteger(step) && step > 1 ? { minutesStep: step } : {})}
          {...(parsePickerTime(minTime) ? { minTime: parsePickerTime(minTime) as Dayjs } : {})}
          {...(parsePickerTime(maxTime) ? { maxTime: parsePickerTime(maxTime) as Dayjs } : {})}
          {...(clock === '12' ? { ampm: true } : clock === '24' ? { ampm: false } : {})}
          slotProps={{
            textField: {
              ...textFieldSlot({ id, ariaLabel, size, fullWidth, filled, required }),
              ref: fieldRef,
            },
          }}
        />
      </PickerFrame>
    )
  },
)
AglynTimePicker.displayName = 'AglynTimePicker'

// ── Schemas ─────────────────────────────────────────────────────────────────

export const datePickerSchema: Aglyn.ComponentSchema<AglynDatePickerProps> = {
  $id: DATE_PICKER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Date Picker',
  description:
    'A date a visitor picks from a calendar. It is sent as the day, such as 2026-10-15.',
  category,
  icon: { path: mdiCalendarMonthOutline.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    FIELD_REQUIRED,
    {
      name: 'disablePast',
      label: 'No past dates?',
      description:
        'Days before today cannot be picked: for a booking, a delivery or a job date.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'disableFuture',
      label: 'No future dates?',
      description:
        'Days after today cannot be picked: for a date of birth or the day something happened.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'minDate',
      label: 'Earliest date',
      description: 'The first day that can be picked. Leave it empty for no limit.',
      component: Aglyn.FieldComponentType.DATE_PICKER,
    },
    {
      name: 'maxDate',
      label: 'Latest date',
      description: 'The last day that can be picked. Leave it empty for no limit.',
      component: Aglyn.FieldComponentType.DATE_PICKER,
    },
    {
      name: 'defaultToday',
      label: 'Start on today?',
      description:
        'Fills in today’s date when the page opens; the visitor can still change it.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    FIELD_INPUT_SIZE,
    FIELD_FULL_WIDTH,
    FIELD_ARIA_LABEL,
  ],
}

export const timePickerSchema: Aglyn.ComponentSchema<AglynTimePickerProps> = {
  $id: TIME_PICKER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Time Picker',
  description:
    'A time of day a visitor picks from a clock. It is sent in 24-hour time, such as 14:30.',
  category,
  icon: { path: mdiClockOutline.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    FIELD_NAME,
    FIELD_DATASET_FIELD,
    FIELD_REQUIRED,
    {
      name: 'minutesStep',
      label: 'Minutes in steps of',
      description: 'The minutes offered: every minute, or every 5, 10, 15 or 30.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '1', label: '1 minute' },
        { value: '5', label: '5 minutes' },
        { value: '10', label: '10 minutes' },
        { value: '15', label: '15 minutes' },
        { value: '30', label: '30 minutes' },
      ],
    },
    {
      name: 'minTime',
      label: 'Earliest time',
      description: 'The earliest time that can be picked, such as your opening time.',
      component: Aglyn.FieldComponentType.TIME_PICKER,
    },
    {
      name: 'maxTime',
      label: 'Latest time',
      description: 'The latest time that can be picked, such as your closing time.',
      component: Aglyn.FieldComponentType.TIME_PICKER,
    },
    {
      name: 'clock',
      label: 'Clock',
      description:
        'How the time is shown to the visitor. Automatic follows their language; it is always sent in 24-hour time.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: '12', label: '12-hour (2:30 PM)' },
        { value: '24', label: '24-hour (14:30)' },
      ],
    },
    FIELD_INPUT_SIZE,
    FIELD_FULL_WIDTH,
    FIELD_ARIA_LABEL,
  ],
}

// ── Presets ─────────────────────────────────────────────────────────────────

export const formPickerPresets: Aglyn.PresetSchema[] = [
  preset(
    generatePresetId(DATE_PICKER_ID),
    'Date Picker',
    'A calendar date on its own.',
    mdiCalendarMonthOutline.path,
    node(DATE_PICKER_ID, { name: 'date' }),
  ),
  preset(
    generatePresetId(TIME_PICKER_ID),
    'Time Picker',
    'A time of day on its own.',
    mdiClockOutline.path,
    node(TIME_PICKER_ID, { name: 'time' }),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'date'),
    'Date field',
    'A label and a date picked from a calendar.',
    mdiCalendarMonthOutline.path,
    node(FORM_CONTROL_ID, { fullWidth: true }, [
      node(FORM_LABEL_ID, { children: 'Date' }),
      node(DATE_PICKER_ID, { name: 'date', fullWidth: true }),
    ]),
  ),
  preset(
    generatePresetId(FORM_CONTROL_ID, 'time'),
    'Time field',
    'A label and a time picked from a clock.',
    mdiClockOutline.path,
    node(FORM_CONTROL_ID, { fullWidth: true }, [
      node(FORM_LABEL_ID, { children: 'Time' }),
      node(TIME_PICKER_ID, { name: 'time', fullWidth: true }),
    ]),
  ),
]
