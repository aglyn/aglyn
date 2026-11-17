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

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'

// The arrangement's rules are pure and live in `libs/aglyn`, where the native
// apps replay them; only the console's slot list is the console's own.
export * from '@aglyn/aglyn/app-utils/dashboard-widget-prefs'

/**
 * The dashboard slots whose widgets a person may hide and reorder, in the
 * order the dashboard page renders them.
 *
 * Ordering is applied WITHIN a slot. Widgets from two different slots sit in
 * different containers on the page — the capability grid, the full-width
 * activity feed, the footer zone — so a rank spanning them would describe a
 * layout the dashboard cannot draw.
 */
export const DASHBOARD_WIDGET_SLOTS: readonly string[] = [
  CONSOLE_WIDGET_SLOTS.commerceGlance,
  CONSOLE_WIDGET_SLOTS.hostDashboard,
  CONSOLE_WIDGET_SLOTS.hostActivity,
  CONSOLE_WIDGET_SLOTS.dashboardFooter,
]
