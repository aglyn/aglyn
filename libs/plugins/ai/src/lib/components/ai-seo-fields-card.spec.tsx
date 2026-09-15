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
 * "Write SEO" in a search listing editor (AGL-2910), mounted through the
 * `seoFields` zone's props: it stays absent while the route says the feature
 * does not exist, it asks for exactly the fields its editor edits, and
 * "Put in the fields" hands the proposal to `proposeValues` — the card never
 * writes a listing, and it reaches no route but the jobs route.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-from-host' : null),
}))

import type { ConsoleSeoFieldsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiSeoFieldsCard, { aiSeoValuesForEditor } from './ai-seo-fields-card.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const summary = (patch: Record<string, unknown>) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'seo',
  status: 'done',
  brief: 'Write the search listing',
  steps: [],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 3,
  createdBy: 'u1',
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-09-15T12:00:05.000Z',
  error: null,
  running: false,
  ...patch,
})

const listingJob = summary({
  id: 'job-2',
  outputs: [
    {
      resource: 'seo',
      id: 'fields:screen:lamps',
      hostId: 'host-1',
      label: 'SEO proposal · Lamps',
      proposal: {
        kind: 'fields',
        subject: { kind: 'screen', id: 'lamps', name: 'Lamps', path: '/lamps' },
        values: {
          title: 'Dimmable brass desk lamps',
          description: 'Brass desk lamps, dimmable and finished by hand.',
          breadcrumb: 'Lamps',
          imageAlt: 'A lamp',
        },
        keywords: [{ keyword: 'dimmable', inTitle: true, inDescription: true, inH1: false, inBody: true }],
        notes: [],
      },
    },
  ],
})

let mockFetch: jest.Mock
const proposeValues = jest.fn()

const screenProps = (patch: Partial<ConsoleSeoFieldsZoneProps> = {}): ConsoleSeoFieldsZoneProps => ({
  hostId: 'host-1',
  orgId: 'org-1',
  orgSlug: 'acme',
  subject: { kind: 'screen', id: 'lamps', versionId: 'v1', name: 'Lamps' },
  fields: ['title', 'description', 'breadcrumb', 'imageAlt'],
  values: { title: '', description: '' },
  hasImage: false,
  proposeValues,
  ...patch,
})

beforeEach(() => {
  proposeValues.mockReset()
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  // A proposal is staged in the editor; nothing but the jobs route is reached.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('whether the card is here', () => {
  it('stays absent while the route says the feature does not exist', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = render(<AiSeoFieldsCard {...screenProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('a page’s listing', () => {
  it('asks for exactly the fields the SEO card edits, and stages the proposal in them', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiSeoFieldsCard {...screenProps()} />)
    const write = await screen.findByRole('button', { name: 'Write SEO' })
    fireEvent.change(screen.getByLabelText('Target keywords (optional)'), { target: { value: 'dimmable' } })
    mockFetch.mockResolvedValueOnce(json({ job: listingJob }))
    fireEvent.click(write)

    await screen.findByText('Dimmable brass desk lamps')
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('/api/ai/jobs')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'seo',
      brief: 'Write the search listing for Lamps',
      inputs: {
        target: 'screen',
        screenId: 'lamps',
        versionId: 'v1',
        fields: 'title,description,breadcrumb,imageAlt',
        keywords: 'dimmable',
      },
    })
    expect(screen.getByText('25/60')).toBeTruthy()
    expect(screen.getByText('Used 3 credits.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Put in the fields' }))
    // No social image, so no image description is staged.
    expect(proposeValues).toHaveBeenCalledWith(
      {
        title: 'Dimmable brass desk lamps',
        description: 'Brass desk lamps, dimmable and finished by hand.',
        breadcrumb: 'Lamps',
      },
      'job-2',
    )
    expect(screen.getByText('In the fields as unsaved changes. Review them, then press Save SEO.')).toBeTruthy()
  })

  it('offers what an applied site audit proposed for the page', async () => {
    const audit = summary({
      id: 'job-9',
      inputs: { target: 'site' },
      applied: { at: null, by: 'u1', versions: {}, staged: ['lamps'] },
      outputs: [
        {
          resource: 'seo',
          id: 'audit:report',
          hostId: 'host-1',
          label: 'SEO audit',
          proposal: { kind: 'audit', pages: [], skipped: 0, site: [], siteProposal: false, queue: ['lamps'], batchSize: 8, score: 50, notes: [] },
        },
        {
          resource: 'seo',
          id: 'audit:fixes:1',
          hostId: 'host-1',
          label: 'SEO fixes',
          proposal: {
            kind: 'fixes',
            batch: 1,
            fixes: [{ screenId: 'lamps', values: { title: 'Brass desk lamps' }, content: [], guidance: [] }],
            notes: [],
          },
        },
      ],
    })
    mockFetch.mockResolvedValueOnce(json({ jobs: [audit] }))
    render(<AiSeoFieldsCard {...screenProps()} />)
    await screen.findByText('Proposed by the site audit')
    fireEvent.click(screen.getByRole('button', { name: 'Put in the fields' }))
    expect(proposeValues).toHaveBeenCalledWith({ title: 'Brass desk lamps' }, 'audit:job-9')
  })
})

describe('a product’s listing', () => {
  const productProps = (name: string) =>
    screenProps({
      orgId: undefined,
      subject: { kind: 'product', id: 'p1', name, description: 'An adjustable brass desk lamp.' },
      fields: ['title', 'description'],
      values: { title: 'Old title', description: '' },
    })

  it('reads the org from the site when the editor does not know it, and sends the product’s own words', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiSeoFieldsCard {...productProps('Desk lamp')} />)
    const write = await screen.findByRole('button', { name: 'Write SEO' })
    expect(mockFetch.mock.calls[0][0]).toContain('orgId=org-from-host')
    mockFetch.mockResolvedValueOnce(json({ job: summary({ id: 'job-3', status: 'failed', error: 'Try again.' }) }))
    fireEvent.click(write)
    await screen.findByText('Try again.')
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).inputs).toEqual({
      target: 'product',
      productId: 'p1',
      name: 'Desk lamp',
      text: 'An adjustable brass desk lamp.',
      currentTitle: 'Old title',
      currentDescription: '',
      fields: 'title,description',
      keywords: '',
    })
  })

  it('asks for a name before it can write', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiSeoFieldsCard {...productProps('  ')} />)
    expect(((await screen.findByRole('button', { name: 'Write SEO' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Name the product first.')).toBeTruthy()
  })
})

describe('aiSeoValuesForEditor', () => {
  it('keeps the editor’s own fields, and an image description only beside an image', () => {
    const values = { title: 'T', description: ' ', breadcrumb: 'B', imageAlt: 'A' }
    expect(aiSeoValuesForEditor(values, ['title', 'description', 'imageAlt'], false)).toEqual({ title: 'T' })
    expect(aiSeoValuesForEditor(values, ['title', 'imageAlt'], true)).toEqual({ title: 'T', imageAlt: 'A' })
  })
})
