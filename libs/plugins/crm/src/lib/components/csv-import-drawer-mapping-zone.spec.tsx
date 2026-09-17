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

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ImportChunkResult, ImportSkippedRow } from '@aglyn/aglyn'

/**
 * The `importMapping` zone in a CRM import drawer (AGL-2917): once a file is
 * read, a widget is handed each column's header and shape — never a cell —
 * with the drawer's matching, and a matching it proposes replaces the
 * drawer's, keeping only the fields this import offers, one column each.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HelpTip: () => null,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('./crm-site-picker', () => ({ CrmSitePicker: () => null }))

import { CsvImportDrawer, type CsvImportVocabulary } from './csv-import-drawer'

type Field = 'email' | 'name' | 'phone'

const VOCABULARY: CsvImportVocabulary<Field, Record<string, unknown>, ImportSkippedRow<string>> = {
  title: 'Import people',
  collection: 'contacts',
  help: { title: 'Import' } as never,
  intro: 'A CSV with a header row.',
  fields: ['email', 'name', 'phone'],
  fieldLabels: { email: 'Email', name: 'Name', phone: 'Phone' },
  customFields: [{ key: 'renewal', label: 'Renewal' }],
  requiredField: 'email',
  requiredWarning: 'Choose the email column.',
  unusableNotice: () => '',
  guessMapping: () => ({}),
  mapRow: () => ({}),
  route: '/api/crm/contacts-import',
  maxRows: 100,
  chunkSize: 50,
  previewRows: 5,
  emptyResult: () => ({ processed: 0, skipped: [] }) as unknown as ImportChunkResult<ImportSkippedRow<string>>,
  mergeResults: (total) => total,
  skipLabels: {},
  skippedCsv: () => '',
  skippedFileName: 'skipped.csv',
  templateCsv: () => '',
  templateFileName: 'template.csv',
}

let zone: Record<string, unknown> | null = null
function ZoneRenderer(props: Record<string, unknown>) {
  zone = props
  return null
}

const CSV = 'E-mail,Full name,Mobile,Renews\ndana@example.com,Dana Whitfield,(512) 555-0100,2026-10-01\nkim@example.org,Kim Lee,(512) 555-0199,2026-11-01\n'

async function openWithFile(vocabulary = VOCABULARY) {
  const view = render(
    <ConsoleWidgetSlotContext.Provider value={ZoneRenderer}>
      <CsvImportDrawer open onClose={jest.fn()} hostId="site-1" vocabulary={vocabulary} />
    </ConsoleWidgetSlotContext.Provider>,
  )
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
  const file = { name: 'people.csv', text: async () => CSV }
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
  return view
}

beforeEach(() => {
  zone = null
})

describe('the import mapping zone', () => {
  it('waits for a file, then hands the columns’ headers and shapes and never a cell', async () => {
    render(
      <ConsoleWidgetSlotContext.Provider value={ZoneRenderer}>
        <CsvImportDrawer open onClose={jest.fn()} hostId="site-1" vocabulary={VOCABULARY} />
      </ConsoleWidgetSlotContext.Provider>,
    )
    expect(zone).toBeNull()
    await openWithFile()
    await waitFor(() => expect(zone).not.toBeNull())
    expect(zone).toMatchObject({
      slot: 'importMapping',
      hostId: 'site-1',
      orgId: 'org-1',
      collection: 'contacts',
      columns: [
        { header: 'E-mail', shape: 'email' },
        { header: 'Full name', shape: 'text' },
        { header: 'Mobile', shape: 'phone' },
        { header: 'Renews', shape: 'date' },
      ],
      mapping: {},
    })
    expect(JSON.stringify(zone?.['columns'])).not.toContain('dana@example.com')
  })

  it('takes a proposed matching, dropping a field it does not offer, a column it lacks and a field twice', async () => {
    await openWithFile()
    await waitFor(() => expect(zone).not.toBeNull())
    await act(async () => {
      ;(zone?.['proposeMapping'] as (mapping: Record<number, string>, key: string) => void)(
        { 0: 'email', 1: 'name', 2: 'fax', 3: 'custom:renewal', 7: 'phone' },
        'job-1',
      )
    })
    expect(zone?.['mapping']).toEqual({ 0: 'email', 1: 'name', 3: 'custom:renewal' })
    await act(async () => {
      ;(zone?.['proposeMapping'] as (mapping: Record<number, string>, key: string) => void)({ 0: 'email', 2: 'email' }, 'job-2')
    })
    expect(zone?.['mapping']).toEqual({ 0: 'email' })
  })

  it('hosts no zone for an import that names no collection', async () => {
    await openWithFile({ ...VOCABULARY, collection: undefined })
    expect(zone).toBeNull()
  })
})
