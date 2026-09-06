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
 * The contacts CSV — every CRM column, the same file from the table's
 * Export button and the bulk bar's (AGL-2603, widened by AGL-2621).
 *
 * The selection's export and the table's export are the same file over a
 * different set of rows: the same columns in the same order, the same `|`
 * between multi-valued cells, the same quoting. A second column list would
 * be a second file format for one feature, and the person opening both in
 * a spreadsheet would be the one to find the difference.
 *
 * ## The header row is the import's own vocabulary
 *
 * Each column is headed by a name `guessContactImportMapping` recognizes —
 * "Job title", "Address line 1", "Lifecycle stage", a custom field's label
 * — so an export re-imports without a hand mapping, and the template the
 * Import drawer offers IS this header over no rows. The owner column
 * carries the member's ADDRESS rather than a uid for the same reason: the
 * import resolves an owner by email, and a uid is nothing a spreadsheet
 * can read anyway. The three columns the import has no field for — sources,
 * the last interaction and the last campaign engagement — are still
 * written, because they are what a merchant reads the file for; they map to
 * "Do not import" on the way back.
 */

import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  type AglynPostalAddress,
  type ContactCustomValue,
  type ContactFieldDefinition,
  type ContactLifecycleStage,
  csvDocument,
} from '@aglyn/aglyn'

/** As much of a projected table row as the file reads. */
export interface ContactCsvRow {
  email?: string
  name?: string
  phone?: string
  jobTitle?: string
  companyName?: string
  ownerUid?: string
  lifecycleStage?: ContactLifecycleStage | ''
  address?: AglynPostalAddress | null
  tags?: string[]
  sources?: Record<string, unknown>
  interactions?: Array<{ atMs: number }>
  /** The last open or click on one of the site's campaigns (AGL-2616). */
  lastEmailEngagementAtMs?: number
  notes?: string
  /** This holder's custom values, keyed by definition key. */
  custom?: Record<string, ContactCustomValue>
}

export interface ContactCsvOptions {
  /**
   * The owner's address for a stored uid — what the import resolves an
   * owner by. Absent, the uid is written as it is.
   */
  ownerEmail?: (uid: string) => string
  /** The org's custom fields, one column each, headed by the field's label. */
  customFields?: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[]
}

/**
 * The standard columns, in order, headed as the import reads them. A
 * custom field's column follows these, headed by its label.
 */
export const CONTACT_CSV_COLUMNS = [
  'Email',
  'Name',
  'Phone',
  'Job title',
  'Company',
  'Owner',
  'Lifecycle stage',
  'Address line 1',
  'Address line 2',
  'City',
  'State',
  'Postal code',
  'Country',
  'Tags',
  'Sources',
  'Last interaction',
  'Last engaged',
  'Notes',
] as const

/** The header row, with one column per custom field after the standard ones. */
export function contactCsvHeader(
  customFields: ContactCsvOptions['customFields'] = [],
): string[] {
  return [...CONTACT_CSV_COLUMNS, ...customFields.map((field) => field.label)]
}

/** A custom value as a cell: a date field's epoch as an ISO date, the rest as text. */
const customCell = (value: ContactCustomValue | undefined): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/** The whole file, header first. */
export function contactsCsv(
  rows: readonly ContactCsvRow[],
  options: ContactCsvOptions = {},
): string {
  const { ownerEmail, customFields = [] } = options
  return csvDocument(
    contactCsvHeader(customFields),
    rows.map((contact) => [
      contact.email ?? '',
      contact.name ?? '',
      contact.phone ?? '',
      contact.jobTitle ?? '',
      contact.companyName ?? '',
      contact.ownerUid ? (ownerEmail?.(contact.ownerUid) ?? contact.ownerUid) : '',
      contact.lifecycleStage
        ? CONTACT_LIFECYCLE_STAGE_LABELS[contact.lifecycleStage]
        : '',
      contact.address?.line1 ?? '',
      contact.address?.line2 ?? '',
      contact.address?.city ?? '',
      contact.address?.state ?? '',
      contact.address?.postalCode ?? '',
      contact.address?.country ?? '',
      (contact.tags ?? []).join('|'),
      Object.keys(contact.sources ?? {}).join('|'),
      contact.interactions?.[0]
        ? new Date(contact.interactions[0].atMs).toISOString()
        : '',
      contact.lastEmailEngagementAtMs
        ? new Date(contact.lastEmailEngagementAtMs).toISOString()
        : '',
      contact.notes ?? '',
      ...customFields.map((field) => customCell(contact.custom?.[field.key])),
    ]),
  )
}

/**
 * The file the Import drawer hands out to start from: the export's header
 * and nothing under it, so a sheet filled in against it maps itself.
 */
export function contactImportTemplateCsv(
  customFields: ContactCsvOptions['customFields'] = [],
): string {
  return contactsCsv([], { customFields })
}

/** Hand the browser a file to save. */
export function downloadTextFile(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
