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

import * as Aglyn from '@aglyn/aglyn'
import { CrmGlanceCard } from './components/crm-glance-card'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCrmConsole } from './plugin'

const registered = () =>
  Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)

/**
 * The CRM's dashboard widgets (AGL-2604).
 *
 * A widget that is not registered is a card the dashboard never asks for,
 * and nothing else fails: the shell renders whatever the slot holds, so a
 * dropped entry is invisible until somebody notices the dashboard has no
 * CRM card. Its `widgetId` is a PERSISTED identifier — the console stores
 * the cards a reader switched off by this string — so this spec pins the id
 * and the slot rather than the count, which the tasks-due widget on the same
 * array is free to change.
 */
describe('crm dashboard widgets', () => {
  it('registers CRM at a glance on the host dashboard slot, by its stable id', () => {
    registerCrmConsole()
    const glance = registered()?.widgets?.find(
      (widget) => widget.widgetId === 'crm-glance',
    )
    expect(glance).toBeDefined()
    expect(glance?.slot).toBe(Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard)
    // The listed name matches the card's own heading: the customize dialog's
    // switch and the card it controls sit a click apart.
    expect(glance?.title).toBe('CRM at a glance')
    expect(glance?.Component).toBe(CrmGlanceCard)
  })
})
