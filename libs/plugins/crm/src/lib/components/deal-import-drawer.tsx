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
 * IMPORTING A DEALS FILE — the deal vocabulary over the shared drawer
 * (AGL-2662).
 *
 * The server half is `server/deals-import.ts`. What is particular to
 * deals: the title is the one cell every row needs, the pipeline and the
 * stage travel as NAMES the server resolves (and refuses, by name, when
 * the org has no such pipeline or stage), and nothing is merged — a deal
 * has no key, so every row is a new deal.
 */

import {
  DEAL_IMPORT_CHUNK_SIZE,
  DEAL_IMPORT_FIELD_LABELS,
  DEAL_IMPORT_FIELDS,
  DEAL_IMPORT_MAX_ROWS,
  DEAL_IMPORT_PREVIEW_ROWS,
  DEAL_IMPORT_SKIP_LABELS,
  type DealImportField,
  type DealImportRawRow,
  type DealImportSkippedRow,
  dealImportSkippedCsv,
  emptyDealImportResult,
  guessDealImportMapping,
  mapDealImportRow,
  mergeDealImportResults,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { dealsCsv } from '../model/deals-csv'
import {
  CsvImportButton,
  CsvImportDrawer,
  type CsvImportVocabulary,
} from './csv-import-drawer'

/** The browser-side address of the route one chunk is posted to. */
export const DEALS_IMPORT_URL = '/api/crm/deals-import'

/** Built once: nothing in it depends on a render. */
export const DEAL_IMPORT_VOCABULARY: CsvImportVocabulary<
  DealImportField,
  DealImportRawRow & Record<string, unknown>,
  DealImportSkippedRow
> = {
  title: 'Import deals from CSV',
  help: pluginDocsHelp('deals', { anchor: '#import-from-csv' }),
  sitePickerHelperText:
    'The site these deals are filed under — it decides which of your sites ' +
    'may see them.',
  intro:
    'A CSV with a header row. Match its columns to deal fields below, check ' +
    'the preview, then import. Name the pipeline and the stage as they ' +
    'appear in your settings; a row naming neither lands in the default ' +
    'pipeline’s first stage. Every row becomes a new deal — importing a ' +
    `file twice files it twice. Up to ${DEAL_IMPORT_MAX_ROWS.toLocaleString()} ` +
    'rows per file — split a larger one.',
  fields: DEAL_IMPORT_FIELDS,
  fieldLabels: DEAL_IMPORT_FIELD_LABELS,
  requiredField: 'title',
  requiredWarning:
    'Choose which column holds the deal title. It is the one field every ' +
    'row needs.',
  unusableNotice: (count, total) =>
    `${count.toLocaleString()} of ${total.toLocaleString()} rows have no ` +
    'title and will be skipped. You can download them after the import.',
  guessMapping: guessDealImportMapping,
  mapRow: (cells, mapping) =>
    mapDealImportRow(cells, mapping) as DealImportRawRow & Record<string, unknown>,
  route: DEALS_IMPORT_URL,
  maxRows: DEAL_IMPORT_MAX_ROWS,
  chunkSize: DEAL_IMPORT_CHUNK_SIZE,
  previewRows: DEAL_IMPORT_PREVIEW_ROWS,
  emptyResult: emptyDealImportResult,
  mergeResults: mergeDealImportResults,
  skipLabels: DEAL_IMPORT_SKIP_LABELS,
  skippedCsv: dealImportSkippedCsv,
  skippedFileName: 'skipped-deals.csv',
  // The export's own header over no rows, so an export re-imports as is.
  templateCsv: () => dealsCsv([]),
  templateFileName: 'deals-template.csv',
}

export interface DealImportDrawerProps {
  open: boolean
  onClose: () => void
  /** The site the file is filed under, or `null` at the organization level. */
  hostId: string | null
}

export function DealImportDrawer(props: DealImportDrawerProps) {
  const { open, onClose, hostId } = props
  return (
    <CsvImportDrawer
      open={open}
      onClose={onClose}
      hostId={hostId}
      vocabulary={DEAL_IMPORT_VOCABULARY}
    />
  )
}
DealImportDrawer.displayName = 'DealImportDrawer'

/** The "Import CSV" action on the deals table, with the drawer it opens. */
export function DealImportButton(props: { hostId: string | null }) {
  const { hostId } = props
  return (
    <CsvImportButton>
      {(open, onClose) => <DealImportDrawer open={open} onClose={onClose} hostId={hostId} />}
    </CsvImportButton>
  )
}
DealImportButton.displayName = 'DealImportButton'

export default DealImportDrawer
