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
'use client'

/**
 * IMPORTING A LEADS FILE — the lead vocabulary over the shared drawer
 * (AGL-2701).
 *
 * The server half is `server/leads-import.ts`. What is particular to
 * leads: the address is the one cell every row needs AND the document's
 * id, so a row is merged onto the person the site already holds rather
 * than filed twice; the file may set only the team's working state, since
 * the capture history is the capture door's; and there is no consent
 * column, because a spreadsheet is not a checkbox somebody ticked.
 *
 * ## The site is the whole scope, so the picker is the whole question
 *
 * A lead lives under `hosts/{hostId}/leads` and is private to that site by
 * path. At the organization level there is therefore no site to fall back
 * on and no scope token that could stand in for one, so the shared
 * drawer's site picker is not a convenience here — it is the only thing
 * that says where the file lands, and the import stays held until it is
 * answered.
 */

import {
  LEAD_IMPORT_CHUNK_SIZE,
  LEAD_IMPORT_FIELD_LABELS,
  LEAD_IMPORT_FIELDS,
  LEAD_IMPORT_MAX_ROWS,
  LEAD_IMPORT_PREVIEW_ROWS,
  LEAD_IMPORT_SKIP_LABELS,
  type LeadImportField,
  type LeadImportRawRow,
  type LeadImportSkippedRow,
  emptyLeadImportResult,
  guessLeadImportMapping,
  leadImportSkippedCsv,
  mapLeadImportRow,
  mergeLeadImportResults,
  normalizeContactEmail,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { leadsCsv } from '../model/leads-csv'
import {
  CsvImportButton,
  CsvImportDrawer,
  type CsvImportVocabulary,
} from './csv-import-drawer'

/** The browser-side address of the route one chunk is posted to. */
export const LEADS_IMPORT_URL = '/api/crm/leads-import'

/** Built once: nothing in it depends on a render. */
export const LEAD_IMPORT_VOCABULARY: CsvImportVocabulary<
  LeadImportField,
  LeadImportRawRow & Record<string, unknown>,
  LeadImportSkippedRow
> = {
  title: 'Import leads from CSV',
  help: pluginDocsHelp('crmLeads', { anchor: '#import-from-csv' }),
  sitePickerHelperText:
    'The site these leads are filed under — a lead is private to one site, ' +
    'and this is the site that will hold them.',
  intro:
    'A CSV with a header row. Match its columns to lead fields below, check ' +
    'the preview, then import. A person this site has already met is ' +
    'updated rather than added twice. Nobody is emailed, and no marketing ' +
    'consent is recorded — a file is not a checkbox somebody ticked, so an ' +
    'imported lead can be mailed only if this site already holds a consent ' +
    `for them. Up to ${LEAD_IMPORT_MAX_ROWS.toLocaleString()} rows per file ` +
    '— split a larger one.',
  fields: LEAD_IMPORT_FIELDS,
  fieldLabels: LEAD_IMPORT_FIELD_LABELS,
  requiredField: 'email',
  requiredWarning:
    'Choose which column holds the email address. It is the one field every ' +
    'row needs, and it is what tells one lead from another.',
  unusable: (cell) => !normalizeContactEmail(cell),
  unusableNotice: (count, total) =>
    `${count.toLocaleString()} of ${total.toLocaleString()} rows have no ` +
    'usable email address and will be skipped. You can download them after ' +
    'the import.',
  guessMapping: guessLeadImportMapping,
  mapRow: (cells, mapping) =>
    mapLeadImportRow(cells, mapping) as LeadImportRawRow & Record<string, unknown>,
  route: LEADS_IMPORT_URL,
  maxRows: LEAD_IMPORT_MAX_ROWS,
  chunkSize: LEAD_IMPORT_CHUNK_SIZE,
  previewRows: LEAD_IMPORT_PREVIEW_ROWS,
  emptyResult: emptyLeadImportResult,
  mergeResults: mergeLeadImportResults,
  skipLabels: LEAD_IMPORT_SKIP_LABELS,
  skippedCsv: leadImportSkippedCsv,
  skippedFileName: 'skipped-leads.csv',
  // The export's own header over no rows, so an export re-imports as is —
  // the columns a file cannot set land on "Do not import".
  templateCsv: () => leadsCsv([]),
  templateFileName: 'leads-template.csv',
}

export interface LeadImportDrawerProps {
  open: boolean
  onClose: () => void
  /** The site the file is filed under, or `null` at the organization level. */
  hostId: string | null
}

export function LeadImportDrawer(props: LeadImportDrawerProps) {
  const { open, onClose, hostId } = props
  return (
    <CsvImportDrawer
      open={open}
      onClose={onClose}
      hostId={hostId}
      vocabulary={LEAD_IMPORT_VOCABULARY}
    />
  )
}
LeadImportDrawer.displayName = 'LeadImportDrawer'

/** The "Import CSV" action on the leads list, with the drawer it opens. */
export function LeadImportButton(props: { hostId: string | null }) {
  const { hostId } = props
  return (
    <CsvImportButton>
      {(open, onClose) => <LeadImportDrawer open={open} onClose={onClose} hostId={hostId} />}
    </CsvImportButton>
  )
}
LeadImportButton.displayName = 'LeadImportButton'

export default LeadImportDrawer
