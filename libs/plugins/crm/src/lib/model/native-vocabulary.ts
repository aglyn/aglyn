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
