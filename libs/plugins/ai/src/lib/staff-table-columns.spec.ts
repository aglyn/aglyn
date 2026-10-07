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
import type { LazyWidget } from './lazy-widget'
import { registerAiConsole } from './plugin'

const registered = (slot: string) =>
  listConsoleWidgets(slot, [AI_PLUGIN_ID]).map(({ widget }) => widget)

/**
 * The component a registration stands for. Every one is registered lazily
 * (AGL-3649), so the registry holds a stand-in that loads it when drawn.
 */
const loaded = (component: unknown) => (component as LazyWidget).load()

beforeAll(() => {
  registerAiConsole()
})

describe('the AI staff table columns are registered (AGL-2984)', () => {
  it('contributes the AI spend column to the Organizations list, sorted by its own header', async () => {
    const widgets = registered(CONSOLE_WIDGET_SLOTS.staffOrgsListColumn)
    expect(widgets.map((widget) => widget.widgetId)).toEqual(['ai-orgs-spend'])
    const { Header, ...column } = widgets[0].column ?? {}
    expect(column).toEqual({ header: 'AI spend (month)', align: 'right' })
    expect(await loaded(Header)).toBe(StaffOrgsAiSpendHeader)
    expect(await loaded(widgets[0].Component)).toBe(StaffOrgsAiSpendCell)
  })

  it('contributes Assist, AI credits used and AI overage billed ($) to the usage table, in that order, with the pool line above it', async () => {
    const widgets = registered(CONSOLE_WIDGET_SLOTS.staffOrgUsageColumn)
    const columns = widgets.filter((widget) => widget.column)
    expect(columns.map((widget) => widget.column)).toEqual([
      { header: 'Assist', align: 'right' },
      { header: 'AI credits used', align: 'right' },
      { header: 'AI overage billed ($)', align: 'right' },
    ])
    expect(await Promise.all(columns.map((widget) => loaded(widget.Component)))).toEqual([
      StaffOrgUsageAssistCell,
      StaffOrgUsageAiCreditsCell,
      StaffOrgUsageAiOverageCell,
    ])
    expect(
      await Promise.all(
        widgets.filter((widget) => !widget.column).map((widget) => loaded(widget.Component)),
      ),
    ).toEqual([StaffOrgUsageAiPool])
  })
})
