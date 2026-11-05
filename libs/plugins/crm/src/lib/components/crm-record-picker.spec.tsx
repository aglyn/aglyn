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
 * What a record picker shows for the record it was opened on (AGL-4163):
 * its name, whether or not the hundred-record window holds it, and never
 * its id. Over a doubled listener and a doubled document read.
 */

import { render, screen } from '@testing-library/react'
import { resetCrmRecordNameCache } from '../hooks/use-crm-record-names'

type Row = Record<string, unknown> & { $id: string }

const mockWindow: Row[] = []
const mockDocs = new Map<string, Record<string, unknown>>()
const mockReads: string[] = []
let mockReadsHang = false

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The record-names hook re-reads when the session heals; nothing heals here.
  subscribeFirestoreSessionHeal: () => () => undefined,
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) =>
    build() ? { data: mockWindow, status: 'success' } : { data: undefined, status: 'idle' },
}))
jest.mock('firebase/firestore', () => ({
  collection: () => 'window',
  query: () => 'window',
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: (path: string) => {
    mockReads.push(path)
    if (mockReadsHang) return new Promise(() => undefined)
    const data = mockDocs.get(path)
    return Promise.resolve({ exists: () => Boolean(data), data: () => data })
  },
}))

import { CrmRecordPicker, type CrmRecordPickerProps } from './crm-record-picker'

const picker = (props: Partial<CrmRecordPickerProps>) =>
  render(
    <CrmRecordPicker
      kind="company"
      scope={['orgs', 'org-1']}
      readTokens={null}
      groupId={null}
      org={{}}
      value={null}
      onChange={() => undefined}
      {...props}
    />,
  )

const field = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement

beforeEach(() => {
  resetCrmRecordNameCache()
  mockWindow.length = 0
  mockDocs.clear()
  mockReads.length = 0
  mockReadsHang = false
})

it('names a record the window holds from the window, with no read of its own', () => {
  mockWindow.push({ $id: 'co-1', name: 'Acme Builders' })
  picker({ value: 'co-1' })
  expect(field('Company').value).toBe('Acme Builders')
  expect(mockReads).toEqual([])
})

it('names a record outside the window by reading it, never showing its id', async () => {
  mockWindow.push({ $id: 'co-2', name: 'Globex' })
  mockDocs.set('orgs/org-1/companies/co-old', { name: 'Branded Signs' })
  picker({ value: 'co-old' })
  expect(field('Company').value).not.toBe('co-old')
  expect(await screen.findByDisplayValue('Branded Signs')).toBeTruthy()
  expect(mockReads).toEqual(['orgs/org-1/companies/co-old'])
})

it('shows the kind’s name while that read is in flight', () => {
  mockReadsHang = true
  picker({ kind: 'contact', value: 'c-old' })
  expect(field('Contact').value).toBe('Contact')
})

it('takes the caller’s name when it has one, and reads nothing', () => {
  picker({ value: 'co-old', valueLabel: 'Named by the caller' })
  expect(field('Company').value).toBe('Named by the caller')
  expect(mockReads).toEqual([])
})
