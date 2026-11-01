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

/*
 * THE CRM'S VOCABULARIES, FLAT, FOR THE NATIVE APPS (AGL-3669).
 *
 * The console reads these off `as const` tuples and typed definitions,
 * shapes the native contracts generator does not translate. Each value here
 * is the same data re-read as plain arrays and maps; nothing in the web
 * apps imports this file, so it adds nothing to their bundles.
 */

import {
  CONTACT_LIFECYCLE_STAGES,
  CRM_ACTIVITY_DIRECTIONS,
  CRM_ACTIVITY_KINDS,
  CRM_FIELD_OBJECTS,
  CRM_LEAD_OPEN_STATUSES,
  CRM_LEAD_STATUSES,
  CRM_PICKLIST_DEFINITIONS,
  CRM_TASK_KINDS,
} from '@aglyn/aglyn/app-utils/crm'
import {
  CONTACT_FIELD_DEFAULT_CURRENCY,
  CONTACT_FIELD_TYPE_LABELS,
  CONTACT_FIELD_TYPES,
  currencyFractionDigits,
} from '@aglyn/aglyn/app-utils/contact-custom-fields'
import { CRM_REPORT_PERIODS } from './crm-reports'
import { DEAL_CURRENCIES } from './deal-board-model'

/** Every lead status, in the console's order. */
export const NATIVE_CRM_LEAD_STATUSES: string[] = [...CRM_LEAD_STATUSES]

/** The statuses a lead still needs working in. */
export const NATIVE_CRM_LEAD_OPEN_STATUSES: string[] = [...CRM_LEAD_OPEN_STATUSES]

/** Every contact lifecycle stage, in order. */
export const NATIVE_CONTACT_LIFECYCLE_STAGES: string[] = [...CONTACT_LIFECYCLE_STAGES]

/** Every task kind, in order. */
export const NATIVE_CRM_TASK_KINDS: string[] = [...CRM_TASK_KINDS]

/** Every activity kind, in order. */
export const NATIVE_CRM_ACTIVITY_KINDS: string[] = [...CRM_ACTIVITY_KINDS]

/**
 * The Material Design glyphs the console's activity timeline draws for the
 * channels that are brands (`KIND_ICONS` in `activity-list`). Neither SF
 * Symbols nor Material Icons carry a brand's mark, so the apps draw these
 * paths through their SVG path icon, and the timeline shows the same marks on
 * every platform. Copied rather than imported, because this module stays pure;
 * `native-vocabulary.spec.ts` holds them to `@aglyn/shared-data-mdi`.
 */
export const NATIVE_CRM_ACTIVITY_ICON_PATHS: Record<string, string> = {
  whatsapp:
    'M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 15 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M8.53 7.33C8.37 7.33 8.1 7.39 7.87 7.64C7.65 7.89 7 8.5 7 9.71C7 10.93 7.89 12.1 8 12.27C8.14 12.44 9.76 14.94 12.25 16C12.84 16.27 13.3 16.42 13.66 16.53C14.25 16.72 14.79 16.69 15.22 16.63C15.7 16.56 16.68 16.03 16.89 15.45C17.1 14.87 17.1 14.38 17.04 14.27C16.97 14.17 16.81 14.11 16.56 14C16.31 13.86 15.09 13.26 14.87 13.18C14.64 13.1 14.5 13.06 14.31 13.3C14.15 13.55 13.67 14.11 13.53 14.27C13.38 14.44 13.24 14.46 13 14.34C12.74 14.21 11.94 13.95 11 13.11C10.26 12.45 9.77 11.64 9.62 11.39C9.5 11.15 9.61 11 9.73 10.89C9.84 10.78 10 10.6 10.1 10.45C10.23 10.31 10.27 10.2 10.35 10.04C10.43 9.87 10.39 9.73 10.33 9.61C10.27 9.5 9.77 8.26 9.56 7.77C9.36 7.29 9.16 7.35 9 7.34C8.86 7.34 8.7 7.33 8.53 7.33Z',
  messenger:
    'M12,2C6.36,2 2,6.13 2,11.7C2,14.61 3.19,17.14 5.14,18.87C5.3,19 5.4,19.22 5.41,19.44L5.46,21.22C5.5,21.79 6.07,22.16 6.59,21.93L8.57,21.06C8.74,21 8.93,20.97 9.1,21C10,21.27 11,21.4 12,21.4C17.64,21.4 22,17.27 22,11.7C22,6.13 17.64,2 12,2M18,9.46L15.07,14.13C14.6,14.86 13.6,15.05 12.9,14.5L10.56,12.77C10.35,12.61 10.05,12.61 9.84,12.77L6.68,15.17C6.26,15.5 5.71,15 6,14.54L8.93,9.87C9.4,9.14 10.4,8.95 11.1,9.47L13.44,11.23C13.66,11.39 13.95,11.39 14.16,11.23L17.32,8.83C17.74,8.5 18.29,9 18,9.46Z',
  instagram:
    'M7.8,2H16.2C19.4,2 22,4.6 22,7.8V16.2A5.8,5.8 0 0,1 16.2,22H7.8C4.6,22 2,19.4 2,16.2V7.8A5.8,5.8 0 0,1 7.8,2M7.6,4A3.6,3.6 0 0,0 4,7.6V16.4C4,18.39 5.61,20 7.6,20H16.4A3.6,3.6 0 0,0 20,16.4V7.6C20,5.61 18.39,4 16.4,4H7.6M17.25,5.5A1.25,1.25 0 0,1 18.5,6.75A1.25,1.25 0 0,1 17.25,8A1.25,1.25 0 0,1 16,6.75A1.25,1.25 0 0,1 17.25,5.5M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9Z',
  linkedin:
    'M19 3A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H19M18.5 18.5V13.2A3.26 3.26 0 0 0 15.24 9.94C14.39 9.94 13.4 10.46 12.92 11.24V10.13H10.13V18.5H12.92V13.57C12.92 12.8 13.54 12.17 14.31 12.17A1.4 1.4 0 0 1 15.71 13.57V18.5H18.5M6.88 8.56A1.68 1.68 0 0 0 8.56 6.88C8.56 5.95 7.81 5.19 6.88 5.19A1.69 1.69 0 0 0 5.19 6.88C5.19 7.81 5.95 8.56 6.88 8.56M8.27 18.5V10.13H5.5V18.5H8.27Z',
}

/** The objects custom fields are kept for. */
export const NATIVE_CRM_FIELD_OBJECTS: string[] = [...CRM_FIELD_OBJECTS]

/** The report periods, in the console's order. */
export const NATIVE_CRM_REPORT_PERIODS: string[] = [...CRM_REPORT_PERIODS]

/** The directions an activity of each kind can take. */
export const NATIVE_CRM_ACTIVITY_DIRECTIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CRM_ACTIVITY_DIRECTIONS).map(([kind, directions]) => [kind, [...(directions ?? [])]]),
)

/** One picklist as the native pickers start it: its id, label, object and standard labels. */
export interface NativeCrmPicklist {
  id: string
  label: string
  object: string
  standardLabels: string[]
}

/** Every picklist the CRM keeps, with the labels a workspace starts with. */
export const NATIVE_CRM_PICKLISTS: NativeCrmPicklist[] = CRM_PICKLIST_DEFINITIONS.map((definition) => ({
  id: definition.id,
  label: definition.label,
  object: definition.object,
  standardLabels: definition.standardValues.map((value) => value.label),
}))

/** Every custom field type, in the order the console's field drawer lists them (AGL-3971). */
export const NATIVE_CRM_FIELD_TYPES: string[] = [...CONTACT_FIELD_TYPES]

/** How each custom field type reads, the console's own words. */
export const NATIVE_CRM_FIELD_TYPE_LABELS: Record<string, string> = { ...CONTACT_FIELD_TYPE_LABELS }

/** The currencies a currency field's picker offers: the deal amount picker's list, lowercase ISO 4217. */
export const NATIVE_CRM_FIELD_CURRENCIES: string[] = [...DEAL_CURRENCIES]

/** The currency a currency field is in when it names none. */
export const NATIVE_CRM_FIELD_DEFAULT_CURRENCY: string = CONTACT_FIELD_DEFAULT_CURRENCY

/**
 * How many decimals each currency's minor unit has where it is not two, as
 * the console's `Intl` reads them (`currencyFractionDigits`): JPY, KRW and
 * VND 0; BHD, KWD and OMR 3. A code not listed has two, as the console's
 * fallback does.
 */
export const NATIVE_CURRENCY_FRACTION_DIGITS: Record<string, number> = Object.fromEntries(
  Intl.supportedValuesOf('currency')
    .map((code) => [code.toLowerCase(), currencyFractionDigits(code)] as const)
    .filter(([, digits]) => digits !== 2),
)
