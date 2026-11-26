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
 * What the Phone add-on includes, and what one unit of use costs Aglyn
 * (AGL-4251).
 *
 * The PRICE of the add-on ($15/mo) is core's (`PHONE_ADDON_MONTHLY_USD` in
 * `plan-entitlements.ts`), and so is every rate a customer is billed at
 * (`METERED_UNIT_RATES_USD`, cost + 30% kept after card fees). This file holds
 * the plugin's own definitions: the pool one add-on adds and where the usage
 * is counted. The plugin records COUNTS only; core prices them.
 */

/** Minutes of calls (in or out, voicemail included) one Phone add-on includes a month. */
export const PHONE_INCLUDED_MINUTES_PER_UNIT = 300

/** Text segments (sent or received) one Phone add-on includes a month. */
export const PHONE_INCLUDED_TEXTS_PER_UNIT = 300

/** Per-site monthly counters the usage is kept on (`hosts/{hostId}/counters/{name}`, field `YYYY-MM`). */
export const PHONE_MINUTES_COUNTER = 'phoneMinutes'
export const PHONE_TEXTS_COUNTER = 'phoneTexts'

/** The entitlement keys the pool is held in. */
export const PHONE_MINUTES_QUOTA = 'phoneMinutesPerMonth'
export const PHONE_TEXTS_QUOTA = 'phoneTextsPerMonth'

/** Longest text the composer sends: ten segments. */
export const PHONE_MAX_BODY_CHARS = 1600

/** Texts a workspace's number may send per rolling hour. */
export const PHONE_SENDS_PER_HOUR_PER_ORG = 200
