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
 * IMPORTING A COMPANIES FILE — the company vocabulary over the shared
 * drawer (AGL-2621).
 *
 * The server half is `server/companies-import.ts`. What is particular to
 * companies: the name is the one cell every row needs (a domain is a key,
 * a name is the caption the list cannot do without), there are no custom
 * fields, and a row is matched to a company already filed by its domain
 * first and its name second.
 */

import {
  COMPANY_IMPORT_CHUNK_SIZE,
  COMPANY_IMPORT_FIELD_LABELS,
  COMPANY_IMPORT_FIELDS,
  COMPANY_IMPORT_MAX_ROWS,
  COMPANY_IMPORT_PREVIEW_ROWS,
  COMPANY_IMPORT_SKIP_LABELS,
  type CompanyImportField,
  type CompanyImportRawRow,
  type CompanyImportSkippedRow,
  companyImportSkippedCsv,
  emptyCompanyImportResult,
  guessCompanyImportMapping,
  mapCompanyImportRow,
  mergeCompanyImportResults,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { companyImportTemplateCsv } from '../model/companies-csv'
import {
  CsvImportButton,
  CsvImportDrawer,
  type CsvImportVocabulary,
} from './csv-import-drawer'

/** The browser-side address of the route one chunk is posted to. */
export const COMPANIES_IMPORT_URL = '/api/crm/companies-import'

/** Built once: nothing in it depends on a render. */
export const COMPANY_IMPORT_VOCABULARY: CsvImportVocabulary<
  CompanyImportField,
  CompanyImportRawRow & Record<string, unknown>,
  CompanyImportSkippedRow
> = {
  title: 'Import companies from CSV',
  help: pluginDocsHelp('companies', { anchor: '#import-from-csv' }),
  intro:
    'A CSV with a header row. Match its columns to company fields below, ' +
    'check the preview, then import. A company already in your list — by ' +
    'domain, or failing that by name — is updated rather than added twice. ' +
    `Up to ${COMPANY_IMPORT_MAX_ROWS.toLocaleString()} rows per file — split ` +
    'a larger one.',
  fields: COMPANY_IMPORT_FIELDS,
  fieldLabels: COMPANY_IMPORT_FIELD_LABELS,
  requiredField: 'name',
  requiredWarning:
    'Choose which column holds the company name. It is the one field every ' +
    'row needs.',
  unusableNotice: (count, total) =>
    `${count.toLocaleString()} of ${total.toLocaleString()} rows have no ` +
    'company name and will be skipped. You can download them after the ' +
    'import.',
  guessMapping: guessCompanyImportMapping,
  mapRow: (cells, mapping) =>
    mapCompanyImportRow(cells, mapping) as CompanyImportRawRow & Record<string, unknown>,
  route: COMPANIES_IMPORT_URL,
  maxRows: COMPANY_IMPORT_MAX_ROWS,
  chunkSize: COMPANY_IMPORT_CHUNK_SIZE,
  previewRows: COMPANY_IMPORT_PREVIEW_ROWS,
  emptyResult: emptyCompanyImportResult,
  mergeResults: mergeCompanyImportResults,
  skipLabels: COMPANY_IMPORT_SKIP_LABELS,
  skippedCsv: companyImportSkippedCsv,
  skippedFileName: 'skipped-companies.csv',
  templateCsv: companyImportTemplateCsv,
  templateFileName: 'companies-template.csv',
}

export interface CompanyImportDrawerProps {
  open: boolean
  onClose: () => void
  hostId: string
}

export function CompanyImportDrawer(props: CompanyImportDrawerProps) {
  const { open, onClose, hostId } = props
  return (
    <CsvImportDrawer
      open={open}
      onClose={onClose}
      hostId={hostId}
      vocabulary={COMPANY_IMPORT_VOCABULARY}
    />
  )
}
CompanyImportDrawer.displayName = 'CompanyImportDrawer'

/** The "Import CSV" action on the companies list, with the drawer it opens. */
export function CompanyImportButton(props: { hostId: string }) {
  const { hostId } = props
  return (
    <CsvImportButton>
      {(open, onClose) => (
        <CompanyImportDrawer open={open} onClose={onClose} hostId={hostId} />
      )}
    </CsvImportButton>
  )
}
CompanyImportButton.displayName = 'CompanyImportButton'

export default CompanyImportDrawer
