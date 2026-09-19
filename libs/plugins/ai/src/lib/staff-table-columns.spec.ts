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
 * The AI plugin's staff table columns are registered on their zones
 * (AGL-2984), in the order the tables draw them: the AI spend column on the
 * Organizations list, sorted by its own header; and on the usage table
 * Assist, AI credits used and AI overage billed, with the credit pool line
 * above it. A column that is not registered is one the table never draws,
 * and nothing else fails.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import {
  StaffOrgUsageAiCreditsCell,
  StaffOrgUsageAiOverageCell,
  StaffOrgUsageAiPool,
  StaffOrgUsageAssistCell,
} from './components/staff-org-usage-ai-columns.component'
import {
  StaffOrgsAiSpendCell,
  StaffOrgsAiSpendHeader,
} from './components/staff-orgs-ai-spend-column.component'
import { AI_PLUGIN_ID } from './constants'
import { registerAiConsole } from './plugin'

const registered = (slot: string) =>
  listConsoleWidgets(slot, [AI_PLUGIN_ID]).map(({ widget }) => widget)

beforeAll(() => {
  registerAiConsole()
})

describe('the AI staff table columns are registered (AGL-2984)', () => {
  it('contributes the AI spend column to the Organizations list, sorted by its own header', () => {
    const widgets = registered(CONSOLE_WIDGET_SLOTS.staffOrgsListColumn)
    expect(widgets.map((widget) => widget.widgetId)).toEqual(['ai-orgs-spend'])
    expect(widgets[0].column).toEqual({
      header: 'AI spend (month)',
      align: 'right',
      Header: StaffOrgsAiSpendHeader,
    })
    expect(widgets[0].Component).toBe(StaffOrgsAiSpendCell)
  })

  it('contributes Assist, AI credits used and AI overage billed ($) to the usage table, in that order, with the pool line above it', () => {
    const widgets = registered(CONSOLE_WIDGET_SLOTS.staffOrgUsageColumn)
    const columns = widgets.filter((widget) => widget.column)
    expect(columns.map((widget) => widget.column)).toEqual([
      { header: 'Assist', align: 'right' },
      { header: 'AI credits used', align: 'right' },
      { header: 'AI overage billed ($)', align: 'right' },
    ])
    expect(columns.map((widget) => widget.Component)).toEqual([
      StaffOrgUsageAssistCell,
      StaffOrgUsageAiCreditsCell,
      StaffOrgUsageAiOverageCell,
    ])
    expect(
      widgets.filter((widget) => !widget.column).map((widget) => widget.Component),
    ).toEqual([StaffOrgUsageAiPool])
  })
})
