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

/**
 * The date and time fields of a form (AGL-3825). A picker is MUI X's, so a
 * visitor gets a calendar and a clock; what the FORM gets is the day as
 * `2026-10-15` and the time as `14:30`, posted under the field's name, held
 * back by "required" like any other field, and announced as a change.
 */

import { act, render, type RenderOptions } from '@testing-library/react'
import dayjs from 'dayjs'
import type { ReactElement } from 'react'
import { AglynFormControl, AglynFormLabel } from './form-controls'
import {
  AglynDatePicker,
  AglynTimePicker,
  datePickerSchema,
  formPickerPresets,
  parsePickerDay,
  parsePickerTime,
  pickerAnswer,
  timePickerSchema,
} from './form-pickers'

const formData = (form: HTMLFormElement) => Object.fromEntries(new FormData(form).entries())

/** Renders and lets the picker's field settle, as it does after mounting. */
async function settled(ui: ReactElement, options?: RenderOptions) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui, options)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return result
}

describe('what a picker posts', () => {
  it('reads and writes the ISO day, and nothing that is not one', () => {
    expect(pickerAnswer(parsePickerDay('2026-10-15'), 'date')).toBe('2026-10-15')
    expect(parsePickerDay('2026-02-30')).toBeNull()
    expect(parsePickerDay('10/15/2026')).toBeNull()
    expect(parsePickerDay(undefined)).toBeNull()
  })

  it('reads and writes the 24-hour time, and nothing that is not one', () => {
    expect(pickerAnswer(parsePickerTime('14:30'), 'time')).toBe('14:30')
    expect(pickerAnswer(parsePickerTime('09:05'), 'time')).toBe('09:05')
    expect(parsePickerTime('24:00')).toBeNull()
    expect(parsePickerTime('2:30 PM')).toBeNull()
    expect(pickerAnswer(null, 'date')).toBe('')
  })
})

describe('a Date Picker in a form', () => {
  it('posts the day under its name, and nothing under the picker’s own field', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-15T15:00:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick'] })
    try {
      const { container } = await settled(
        <form>
          <AglynFormControl>
            <AglynFormLabel>Job date</AglynFormLabel>
            <AglynDatePicker name="job_date" defaultToday />
          </AglynFormControl>
        </form>,
      )
      expect(formData(container.querySelector('form') as HTMLFormElement)).toEqual({
        job_date: dayjs().format('YYYY-MM-DD'),
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('holds a required, empty picker back the way the browser holds any field back', async () => {
    const { container } = await settled(
      <form>
        <AglynDatePicker name="when" required />
      </form>,
    )
    const form = container.querySelector('form') as HTMLFormElement
    const answer = container.querySelector('input[name="when"]') as HTMLInputElement
    expect(answer.type).toBe('text')
    expect(answer.readOnly).toBe(false)
    expect(answer.required).toBe(true)
    expect(form.checkValidity()).toBe(false)
    expect(formData(form)).toEqual({ when: '' })
  })

  it('announces a picked day as a change that bubbles, for a form or a calculator to hear', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const heard: string[] = []
    host.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement
      heard.push(`${input.name}=${input.value}`)
    })
    await settled(<AglynDatePicker name="job_date" defaultToday />, { container: host })
    expect(heard).toEqual([`job_date=${dayjs().format('YYYY-MM-DD')}`])
  })

  it('offers its settings, and a ready-made labelled field', () => {
    const names = (datePickerSchema.attributes ?? []).map((attribute) => attribute.name)
    expect(names).toEqual(expect.arrayContaining(['name', 'required', 'disablePast', 'disableFuture', 'minDate', 'maxDate', 'defaultToday']))
    expect(datePickerSchema.flags?.selfClosing).toBeDefined()
    expect(formPickerPresets.map((preset) => preset.displayName)).toEqual(['Date Picker', 'Time Picker', 'Date field', 'Time field'])
  })
})

describe('a Time Picker in a form', () => {
  it('posts nothing until a time is picked, under its own name only', async () => {
    const { container } = await settled(
      <form>
        <AglynTimePicker name="arrival" minutesStep="15" clock="12" minTime="09:00" maxTime="17:00" />
      </form>,
    )
    expect(formData(container.querySelector('form') as HTMLFormElement)).toEqual({ arrival: '' })
  })

  it('offers its settings', () => {
    const names = (timePickerSchema.attributes ?? []).map((attribute) => attribute.name)
    expect(names).toEqual(expect.arrayContaining(['name', 'required', 'minutesStep', 'minTime', 'maxTime', 'clock']))
  })
})
