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

import type { PluginFigureColumn, PluginFigureRow, PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { bookingFigureReader } from './booking-figures'

function table(columns: PluginFigureColumn[], rows: PluginFigureRow[], extra: Partial<PluginFigureTable> = {}): PluginFigureTable {
  return {
    title: 'Figures',
    source: { label: 'Console', path: null },
    period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
    columns,
    rows,
    omitted: 0,
    notes: [],
    ...extra,
  }
}

describe('bookings in the weekly summary (AGL-3867)', () => {
  const summary = bookingFigureReader(() => {
    throw new Error('not read')
  }).weeklySummary
  const columns: PluginFigureColumn[] = [
    { key: 'service', label: 'Service', kind: 'text' },
    { key: 'booked', label: 'Booked', kind: 'count' },
    { key: 'canceled', label: 'Canceled', kind: 'count' },
    { key: 'change', label: 'Change in bookings', kind: 'change' },
  ]

  it('says the week’s bookings, cancellations and busiest services', () => {
    const bookings = table(columns, [
      { service: 'All services', booked: 6, canceled: 1, change: 20 },
      { service: 'Haircut', booked: 4, canceled: 1, change: null },
      { service: 'Color', booked: 2, canceled: 0, change: null },
    ])
    expect(summary?.lines(bookings)).toEqual(['Bookings: 6 (+20%), 1 canceled (Haircut 4, Color 2)'])
    expect(summary?.headline?.(bookings)).toEqual({ count: 6, one: 'booking', many: 'bookings' })
  })

  it('says nothing for a week with none', () => {
    expect(summary?.lines(table(columns, [{ service: 'All services', booked: 0, canceled: 0, change: null }]))).toEqual([])
  })
})
