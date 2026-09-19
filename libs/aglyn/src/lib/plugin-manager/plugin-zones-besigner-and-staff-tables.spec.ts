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

import {
  CONSOLE_STAFF_WIDGET_SLOTS,
  CONSOLE_WIDGET_SLOTS,
  isConsoleStaffWidgetSlot,
  listConsoleWidgets,
  registerConsoleExtension,
  unregisterConsoleExtension,
} from './feature-plugins'

const Control = (): null => null
const Cell = (): null => null

/**
 * The zones AGL-2984 adds: the besigner toolbar, and the columns of the two
 * staff tables. Each is proven with two unrelated plugins — a contrast
 * checker and a copy assistant on the toolbar, a fraud score and a spend
 * figure on the staff tables — so no zone is shaped for one of them.
 */
describe('the besigner toolbar zone', () => {
  beforeEach(() => {
    registerConsoleExtension({
      pluginId: 'acme-contrast',
      displayName: 'Contrast checker',
      widgets: [{ slot: CONSOLE_WIDGET_SLOTS.besignerToolbar, widgetId: 'check-contrast', Component: Control }],
    })
    registerConsoleExtension({
      pluginId: 'acme-copy',
      displayName: 'Copy assistant',
      widgets: [
        { slot: CONSOLE_WIDGET_SLOTS.besignerToolbar, widgetId: 'draft-section', Component: Control },
        { slot: CONSOLE_WIDGET_SLOTS.besignerInspector, widgetId: 'rewrite-copy', Component: Control },
      ],
    })
  })

  afterEach(() => {
    unregisterConsoleExtension('acme-contrast')
    unregisterConsoleExtension('acme-copy')
  })

  it('is a workspace zone listing only the plugins the workspace has enabled', () => {
    expect(CONSOLE_WIDGET_SLOTS.besignerToolbar).toBe('besignerToolbar')
    expect(isConsoleStaffWidgetSlot('besignerToolbar')).toBe(false)
    expect(
      listConsoleWidgets('besignerToolbar', ['acme-contrast', 'acme-copy']).map(
        (entry) => entry.widget.widgetId,
      ),
    ).toEqual(['check-contrast', 'draft-section'])
    expect(
      listConsoleWidgets('besignerToolbar', ['acme-copy']).map((entry) => entry.widget.widgetId),
    ).toEqual(['draft-section'])
  })

  it('keeps an element-level control on the inspector zone', () => {
    expect(
      listConsoleWidgets('besignerInspector', ['acme-contrast', 'acme-copy']).map(
        (entry) => entry.widget.widgetId,
      ),
    ).toEqual(['rewrite-copy'])
  })
})

describe('the staff table column zones', () => {
  beforeEach(() => {
    registerConsoleExtension({
      pluginId: 'acme-fraud',
      displayName: 'Fraud score',
      widgets: [
        {
          slot: CONSOLE_WIDGET_SLOTS.staffOrgsListColumn,
          widgetId: 'fraud-score',
          column: { header: 'Fraud score', align: 'right' },
          Component: Cell,
        },
      ],
    })
    registerConsoleExtension({
      pluginId: 'acme-spend',
      displayName: 'Spend',
      widgets: [
        {
          slot: CONSOLE_WIDGET_SLOTS.staffOrgsListColumn,
          widgetId: 'spend-month',
          column: { header: 'Spend (month)', align: 'right' },
          Component: Cell,
        },
        {
          slot: CONSOLE_WIDGET_SLOTS.staffOrgUsageColumn,
          widgetId: 'spend-rollup',
          column: { header: 'Spend', align: 'right' },
          Component: Cell,
        },
      ],
    })
  })

  afterEach(() => {
    unregisterConsoleExtension('acme-fraud')
    unregisterConsoleExtension('acme-spend')
  })

  it('are staff zones, read from the plugins the staff area loads', () => {
    for (const zone of ['staffOrgsListColumn', 'staffOrgUsageColumn']) {
      expect((CONSOLE_WIDGET_SLOTS as Record<string, string>)[zone]).toBe(zone)
      expect(isConsoleStaffWidgetSlot(zone)).toBe(true)
      expect(CONSOLE_STAFF_WIDGET_SLOTS).toContain(zone)
    }
  })

  it('carry each plugin’s column, with the header the column declares', () => {
    expect(
      listConsoleWidgets('staffOrgsListColumn', ['acme-fraud', 'acme-spend']).map((entry) => [
        entry.widget.widgetId,
        entry.widget.column?.header,
      ]),
    ).toEqual([
      ['fraud-score', 'Fraud score'],
      ['spend-month', 'Spend (month)'],
    ])
    expect(
      listConsoleWidgets('staffOrgUsageColumn', ['acme-fraud', 'acme-spend']).map(
        (entry) => entry.widget.widgetId,
      ),
    ).toEqual(['spend-rollup'])
  })
})
