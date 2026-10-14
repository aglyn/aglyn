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
 * WHICH ZONE-ONLY SECTIONS HAVE SOMETHING TO SHOW (AGL-3713).
 *
 * `useFilledZones` answers the rail's `filledZones` from the same gate the
 * zone renders from (`useSlotWidgets`), so a section such as Products ▸
 * Integrations is offered exactly when its page would draw a card. Held
 * here: only the zones the sections name are asked about, nothing is asked
 * for a hub that names none, an unsettled answer is empty rather than
 * partial, and a table column is not a card.
 */

import type { ConsoleNavSection } from '@aglyn/aglyn'
import { renderHook } from '@testing-library/react'
import { useFilledZones } from '../hooks/use-filled-zones'

type Widget = { slot: string; column?: unknown }
const mockAnswer: { widgets: Widget[]; ready: boolean } = { widgets: [], ready: true }
const mockAsked: Array<readonly string[]> = []

jest.mock('../components/plugin-widget-slot.component', () => ({
  useSlotWidgets: (slots: readonly string[]) => {
    mockAsked.push(slots)
    // A new list every call, as the real hook builds one every render.
    return { widgets: [...mockAnswer.widgets], ready: mockAnswer.ready }
  },
}))

const SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'payments', label: 'Payments', group: 'Settings' },
  { id: 'channels', label: 'Sales channels', onlyWithZones: ['commerceSettingsChannels'] },
  { id: 'integrations', label: 'Integrations', onlyWithZones: ['commerceSettings'] },
]

beforeEach(() => {
  mockAsked.length = 0
  mockAnswer.widgets = []
  mockAnswer.ready = true
})

describe('useFilledZones', () => {
  it('asks only for the zones zone-only sections name', () => {
    renderHook(() => useFilledZones(SECTIONS))
    expect(mockAsked.at(-1)).toEqual(['commerceSettings', 'commerceSettingsChannels'])
  })

  it('asks for nothing on a hub that names no zone-only section', () => {
    renderHook(() => useFilledZones([{ id: 'catalog', label: 'Catalog' }]))
    expect(mockAsked.at(-1)).toEqual([])
    renderHook(() => useFilledZones(undefined))
    expect(mockAsked.at(-1)).toEqual([])
  })

  it('answers the zones that have a card', () => {
    mockAnswer.widgets = [{ slot: 'commerceSettings' }, { slot: 'commerceSettings' }]
    const { result } = renderHook(() => useFilledZones(SECTIONS))
    expect([...result.current]).toEqual(['commerceSettings'])
  })

  it('does not count a table column as a card', () => {
    mockAnswer.widgets = [{ slot: 'commerceSettingsChannels', column: { id: 'feed' } }]
    const { result } = renderHook(() => useFilledZones(SECTIONS))
    expect(result.current.size).toBe(0)
  })

  it('answers nothing until every gate has settled', () => {
    mockAnswer.widgets = [{ slot: 'commerceSettings' }]
    mockAnswer.ready = false
    const { result, rerender } = renderHook(() => useFilledZones(SECTIONS))
    expect(result.current.size).toBe(0)
    mockAnswer.ready = true
    rerender()
    expect(result.current.has('commerceSettings')).toBe(true)
  })

  it('keeps the same set across renders while the answer is unchanged', () => {
    mockAnswer.widgets = [{ slot: 'commerceSettings' }]
    const { result, rerender } = renderHook(() => useFilledZones(SECTIONS))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
