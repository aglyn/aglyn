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
import { marketingFigureReaders } from './marketing-figures'

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

describe('campaigns in the weekly summary (AGL-3867)', () => {
  const campaigns = marketingFigureReaders(() => {
    throw new Error('not read')
  }).find(({ id }) => id === 'marketing.campaigns')

  it('says how many emails went out, how many they reached, and how many opened and clicked', () => {
    const sent = table(
      [
        { key: 'campaign', label: 'Campaign', kind: 'text' },
        { key: 'delivered', label: 'Delivered', kind: 'count' },
        { key: 'openRate', label: 'Opened', kind: 'percent' },
        { key: 'clickRate', label: 'Clicked', kind: 'percent' },
      ],
      [
        { campaign: 'All campaigns', delivered: 1_200, openRate: 40, clickRate: 5 },
        { campaign: 'Spring sale', delivered: 1_200, openRate: 40, clickRate: 5 },
      ],
    )
    expect(campaigns?.weeklySummary?.summarize(sent)).toEqual({
      title: 'Campaigns',
      stats: [
        { label: 'Email sent', value: '1' },
        { label: 'Delivered', value: '1,200' },
        { label: 'Opened', value: '40%' },
        { label: 'Clicked', value: '5%' },
      ],
    })
  })
})
