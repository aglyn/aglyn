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
import { automationRunFigureReader } from './automation-run-figures'

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

describe('automations in the weekly summary (AGL-3867)', () => {
  const summary = automationRunFigureReader(() => {
    throw new Error('not read')
  }).weeklySummary

  it('says how many runs finished and failed', () => {
    const runs = table(
      [
        { key: 'automation', label: 'Automation', kind: 'text' },
        { key: 'succeeded', label: 'Succeeded', kind: 'count' },
        { key: 'failed', label: 'Failed', kind: 'count' },
      ],
      [{ automation: 'All automations', succeeded: 54, failed: 2 }],
    )
    expect(summary?.lines(runs)).toEqual(['Automations: 54 runs finished, 2 failed'])
    expect(summary?.lines(table(runs.columns, [{ automation: 'All automations', succeeded: 0, failed: 0 }]))).toEqual([])
  })
})
