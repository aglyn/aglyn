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
import { funnelFigureReaders } from './funnel-figures'

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

describe('funnels in the weekly summary (AGL-3867)', () => {
  const [overview] = funnelFigureReaders(() => {
    throw new Error('not read')
  })

  it('says how many started and finished each busy funnel', () => {
    const funnels = table(
      [
        { key: 'funnel', label: 'Funnel', kind: 'text' },
        { key: 'entered', label: 'Visits that entered', kind: 'count' },
        { key: 'completed', label: 'Visits that completed', kind: 'count' },
      ],
      [
        { funnel: 'Checkout', entered: 120, completed: 30 },
        { funnel: 'Unused', entered: 0, completed: 0 },
      ],
    )
    expect(overview.weeklySummary?.summarize(funnels)).toEqual({
      title: 'Funnels',
      rows: [{ label: 'Checkout', value: '120 started · 30 finished' }],
    })
  })
})
