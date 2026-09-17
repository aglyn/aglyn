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
 * The import dialog's AI option (AGL-2916), through the `productImport`
 * zone: absent while the route says the feature does not exist, and
 * otherwise a box that sets the import's option — nothing starts from here,
 * and no job is followed.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
}))

import type { ConsoleProductImportZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiProductImportOption from './ai-product-import-option.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

let mockFetch: jest.Mock
const setOption = jest.fn()

const props = (patch: Partial<ConsoleProductImportZoneProps> = {}): ConsoleProductImportZoneProps => ({
  hostId: 'host-1',
  orgId: undefined,
  count: 12,
  options: {},
  setOption,
  ...patch,
})

beforeEach(() => {
  setOption.mockReset()
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

it('stays absent while the route says the feature does not exist', async () => {
  mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
  const { container } = render(<AiProductImportOption {...props()} />)
  await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})

it('sets the import’s option, reads the list once, and follows no job', async () => {
  const moving = { id: 'job-1', kind: 'products', hostId: 'host-1', status: 'running', brief: 'Write storefront copy for 3 products', createdAt: '2026-09-16T12:00:00.000Z', outputs: [] }
  mockFetch.mockResolvedValue(json({ jobs: [moving] }))
  const { rerender } = render(<AiProductImportOption {...props()} />)
  const box = (await screen.findByLabelText(
    'Write descriptions, search listings and tags with AI as they land',
  )) as HTMLInputElement
  expect(box.checked).toBe(false)
  fireEvent.click(box)
  expect(setOption).toHaveBeenCalledWith('ai.writeCopy', true)
  rerender(<AiProductImportOption {...props({ options: { 'ai.writeCopy': true } })} />)
  expect(box.checked).toBe(true)
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/first 50/)).toBeNull()
})

it('says which products get copy when the import is larger than a job writes', async () => {
  mockFetch.mockResolvedValue(json({ jobs: [] }))
  render(<AiProductImportOption {...props({ count: 80 })} />)
  expect(await screen.findByText(/Copy is written for the first 50 of the 80 products\./)).toBeTruthy()
})
