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

import { renderHook } from '@testing-library/react'
import { createWedgeDetector, typingIntoField, useScannerWedge } from './scanner-wedge'

function feed(detector: ReturnType<typeof createWedgeDetector>, keys: string[], gapMs: number, startMs = 1000) {
  let found: string | null = null
  keys.forEach((key, index) => {
    found = detector.push(key, startMs + index * gapMs) ?? found
  })
  return found
}

describe('keyboard-mode scanners (AGL-3619)', () => {
  it('reads a burst of keys ending in Enter as a scan', () => {
    expect(feed(createWedgeDetector(), [...'0123456789012', 'Enter'], 8)).toBe('0123456789012')
  })

  it('keeps the capitals a scanner shifts for', () => {
    expect(feed(createWedgeDetector(), ['Shift', 'S', 'K', 'U', '-', '1', 'Enter'], 6)).toBe('SKU-1')
  })

  it('never takes a person typing for a scanner', () => {
    expect(feed(createWedgeDetector(), [...'12345678', 'Enter'], 120)).toBeNull()
  })

  it('drops a slow start and keeps the burst that follows it', () => {
    const detector = createWedgeDetector()
    detector.push('x', 0)
    expect(feed(detector, [...'40001234', 'Enter'], 5, 500)).toBe('40001234')
  })

  it('ignores a short burst and a burst with no Enter', () => {
    expect(feed(createWedgeDetector(), ['1', '2', 'Enter'], 5)).toBeNull()
    expect(feed(createWedgeDetector(), [...'12345678'], 5)).toBeNull()
  })

  it('knows a text field from a button', () => {
    const input = document.createElement('input')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(typingIntoField(input)).toBe(true)
    expect(typingIntoField(document.createElement('textarea'))).toBe(true)
    expect(typingIntoField(checkbox)).toBe(false)
    expect(typingIntoField(document.createElement('button'))).toBe(false)
    expect(typingIntoField(null)).toBe(false)
  })

  it('hands a scan made with focus on a button to the register, and leaves fields alone', () => {
    // A scanner's pace, whatever the test machine's: 5 ms a key.
    let clock = 0
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 5))
    const onScan = jest.fn()
    const { unmount } = renderHook(() => useScannerWedge(onScan))
    const button = document.createElement('button')
    const input = document.createElement('input')
    document.body.append(button, input)
    const type = (target: HTMLElement, keys: string[]) => {
      for (const key of keys) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      }
    }
    type(button, [...'0123456789012', 'Enter'])
    expect(onScan).toHaveBeenCalledWith('0123456789012')
    type(input, [...'99999999', 'Enter'])
    expect(onScan).toHaveBeenCalledTimes(1)
    unmount()
    type(button, [...'0123456789012', 'Enter'])
    expect(onScan).toHaveBeenCalledTimes(1)
    now.mockRestore()
  })
})
