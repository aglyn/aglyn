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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'

/**
 * What a workspace without the Event Calendar reads where Events would be.
 *
 * `eventCalendar` is false on every plan: it is sold as a per-org add-on and
 * nothing else, so the shell's generic "not included in your current plan"
 * would send a reader to compare tiers that all say no. The price is the
 * constant the invoice is built from (`EVENT_CALENDAR_ADDON_MONTHLY_USD`),
 * passed in so this sentence cannot drift away from what a purchase charges.
 * The console's Events extension and the native apps (through
 * `generate-native-derived-values.mjs`) both read it from here.
 */
export function eventCalendarUpgradeMessage(monthlyUsd: number): string {
  return (
    'The Event Calendar is a paid add-on ' +
    `($${monthlyUsd}/mo for your whole ` +
    `workspace, supported directly by ${PLATFORM_BRAND_NAME}). ` +
    'Enable it from Billing → Add-ons.'
  )
}
