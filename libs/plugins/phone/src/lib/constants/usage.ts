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

/**
 * Calls are UNLIMITED within the US and Canada, voicemail and its transcripts
 * included: there is no minutes pool and no minutes overage. Minutes are still
 * counted on `PHONE_MINUTES_COUNTER` for the cost model. Fair use is held by
 * the per-workspace hourly ceiling every call placed from Phone spends
 * (`PHONE_SENDS_PER_HOUR_PER_ORG`) and by {@link isUsOrCanadaNumber}: Phone
 * dials and forwards to US and Canadian numbers only.
 */
/** Text segments (sent or received) one Phone add-on includes a month. */
export const PHONE_INCLUDED_TEXTS_PER_UNIT = 300

/** Per-site monthly counters the usage is kept on (`hosts/{hostId}/counters/{name}`, field `YYYY-MM`). */
export const PHONE_MINUTES_COUNTER = 'phoneMinutes'
export const PHONE_TEXTS_COUNTER = 'phoneTexts'

/** The entitlement keys: the texts pool, and the minutes (unlimited, counted for cost). */
export const PHONE_TEXTS_QUOTA = 'phoneTextsPerMonth'
export const PHONE_MINUTES_QUOTA = 'phoneMinutesPerMonth'

/** Longest text the composer sends: ten segments. */
export const PHONE_MAX_BODY_CHARS = 1600

/** Texts and calls placed from a workspace's number per rolling hour. */
export const PHONE_SENDS_PER_HOUR_PER_ORG = 200
