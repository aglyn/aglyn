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
 * "Match columns" in a CRM import (AGL-2917), mounted through the
 * `importMapping` zone's props: it sends each column's header and shape and
 * nothing else of the file, and the matching goes into the drawer through
 * `proposeMapping`, whose Import stays the write.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: () => null,
}))

import type { ConsoleImportMappingZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiCrmImportMapping, { aiCrmMappingOf } from './ai-crm-import-mapping.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const JOB = {
  id: 'job-9',
  orgId: 'org-1',
  hostId: null,
  kind: 'crm',
  status: 'done',
  brief: 'Match the columns of a contacts import',
  batch: null,
  steps: [],
  outputs: [{ resource: 'crm', id: 'mapping:contacts', hostId: null, label: 'Import column matches', proposal: { kind: 'mapping', collection: 'contacts' } }],
  creditsReserved: 0,
  creditsSpent: 0,
  createdBy: 'u1',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:05.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
}

const COLUMNS = [
  { header: 'E-mail', shape: 'email' as const },
  { header: 'Full name', shape: 'text' as const },
  { header: 'Favorite color', shape: 'text' as const },
]

let mockFetch: jest.Mock
let routes: Record<string, () => unknown>
const proposeMapping = jest.fn()

const props = (patch: Partial<ConsoleImportMappingZoneProps> = {}): ConsoleImportMappingZoneProps => ({
  hostId: null,
  orgId: 'org-1',
  collection: 'contacts',
  columns: COLUMNS,
  mapping: {},
  proposeMapping,
  ...patch,
})

beforeEach(() => {
  proposeMapping.mockReset()
  routes = {}
  mockFetch = jest.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).split('?')[0]}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected ${key}`)
    return route()
  })
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/(jobs|crm\/)/)
})

describe('an import’s columns', () => {
  it('sends headers and shapes, and puts the matching in the drawer', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [] })
    routes['POST /api/ai/jobs'] = () => json({ job: JOB })
    routes['GET /api/ai/crm/job-9'] = () =>
      json({
        answer: {
          jobId: 'job-9',
          hostId: null,
          createdBy: 'u1',
          proposal: {
            kind: 'mapping',
            collection: 'contacts',
            columns: 3,
            matches: [
              { column: 0, header: 'E-mail', field: 'email', label: 'Email' },
              { column: 1, header: 'Full name', field: 'name', label: 'Name' },
            ],
          },
        },
      })
    render(<AiCrmImportMapping {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Match columns' }))
    await screen.findByText('Matched 2 of 3 columns. Check the matches below before you import.')
    expect(proposeMapping).toHaveBeenCalledWith({ 0: 'email', 1: 'name' }, 'job-9')
    const [, init] = mockFetch.mock.calls.find(([, request]) => request?.method === 'POST') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      orgId: 'org-1',
      hostId: null,
      kind: 'crm',
      brief: 'Match the columns of a contacts import',
      inputs: { task: 'mapping', collection: 'contacts', columns: JSON.stringify(COLUMNS) },
    })
  })

  it('offers no matching for a file wider than a request carries', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [] })
    const wide = Array.from({ length: 61 }, (_, index) => ({ header: `Column ${index}`, shape: 'text' as const }))
    render(<AiCrmImportMapping {...props({ columns: wide })} />)
    expect(((await screen.findByRole('button', { name: 'Match columns' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('AI matches files of up to 60 columns.')).toBeTruthy()
  })

  it('draws nothing for an import it does not know, and asks nothing', async () => {
    const { container } = render(<AiCrmImportMapping {...props({ collection: 'invoices' })} />)
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reads matches as the drawer’s column-to-field record', () => {
    expect(aiCrmMappingOf([{ column: 2, header: 'Renews', field: 'custom:renewal', label: 'Renewal' }])).toEqual({ 2: 'custom:renewal' })
  })
})
