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

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({ __esModule: true, scopedToHost: (ref: unknown) => ref }))

import type { PluginFigureColumn, PluginFigureRow, PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { crmClosedDealsFigureReader, crmPipelineFigureReader } from './deal-figures'
import { crmPeopleFigureReader } from './people-figures'

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

const unused = () => {
  throw new Error('not read')
}

describe('the CRM in the weekly summary (AGL-3867)', () => {
  it('lists new leads and contacts under each site, and leads the subject with new leads', () => {
    const summary = crmPeopleFigureReader(unused).weeklySummary
    const people = table(
      [
        { key: 'figure', label: 'Figure', kind: 'text' },
        { key: 'current', label: 'This window', kind: 'count' },
        { key: 'change', label: 'Change', kind: 'change' },
      ],
      [
        { figure: 'New leads', current: 9, change: 50 },
        { figure: 'New contacts', current: 3, change: null },
      ],
    )
    expect(summary?.per).toBe('site')
    expect(summary?.lines(people)).toEqual(['New leads: 9 (+50%) · New contacts: 3'])
    expect(summary?.headline?.(people)).toEqual({ count: 9, one: 'new lead', many: 'new leads' })
  })

  it('lists deals won and lost and the open pipeline once for the workspace', () => {
    const closed = crmClosedDealsFigureReader(unused)
    const pipeline = crmPipelineFigureReader(unused)
    expect(closed.weeklySummary?.per).toBeUndefined()
    expect(
      closed.weeklySummary?.lines(
        table(
          [
            { key: 'won', label: 'Won', kind: 'count' },
            { key: 'lost', label: 'Lost', kind: 'count' },
            { key: 'wonValue', label: 'Value won', kind: 'money', currency: 'USD' },
          ],
          [{ won: 2, lost: 1, wonValue: 5_000 }],
        ),
      ),
    ).toEqual(['Deals: 2 won ($5,000.00), 1 lost'])
    expect(
      pipeline.weeklySummary?.lines(
        table(
          [
            { key: 'pipeline', label: 'Pipeline', kind: 'text' },
            { key: 'deals', label: 'Open deals', kind: 'count' },
            { key: 'value', label: 'Value', kind: 'money', currency: 'USD' },
          ],
          [{ pipeline: 'All pipelines', deals: 12, value: 40_000 }],
        ),
      ),
    ).toEqual(['Open pipeline: 12 deals worth $40,000.00'])
  })
})
