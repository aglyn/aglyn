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
 * "Write with AI" in the product editor (AGL-2916), mounted through the
 * `productEditor` zone's props: it stays absent while the route says the
 * feature does not exist, it sends the product as the editor holds it with
 * its FIRST photo and nothing else of its media, and "Put in the fields"
 * hands the proposal to `proposeValues` — the card never writes a product,
 * and it reaches no route but the jobs route.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-from-host' : null),
}))

import type { ConsoleProductEditorZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiProductCopyCard, { aiProductCopyValues } from './ai-product-copy-card.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const summary = (patch: Record<string, unknown>) => ({
  orgId: 'org-from-host',
  hostId: 'host-1',
  kind: 'products',
  status: 'done',
  brief: 'Write the storefront copy for Desk lamp',
  batch: null,
  steps: [],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 2,
  createdBy: 'u1',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:05.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
  ...patch,
})

const PROPOSAL = {
  kind: 'copy',
  product: { id: 'lamp', name: 'Desk lamp' },
  values: {
    description: 'An adjustable brass desk lamp with a dimmable bulb.\n\nShade: [material].',
    seoTitle: 'Brass desk lamp',
    seoDescription: 'An adjustable brass desk lamp for the home office.',
    tags: ['desk lamp', 'brass'],
    categoryIds: ['cat-lighting'],
    optionNames: ['Finish'],
  },
  categories: [{ id: 'cat-lighting', name: 'Lighting' }],
  optionNamesBefore: ['finish'],
  gaps: ['material'],
  photo: 'read',
  skipped: null,
  notes: [],
}

const copyJob = summary({
  id: 'job-7',
  outputs: [{ resource: 'product', id: 'copy:lamp', hostId: 'host-1', label: 'Product copy · Desk lamp', proposal: PROPOSAL }],
})

let mockFetch: jest.Mock
const proposeValues = jest.fn()

const props = (patch: Partial<ConsoleProductEditorZoneProps['product']> = {}): ConsoleProductEditorZoneProps => ({
  hostId: 'host-1',
  orgId: undefined,
  product: {
    id: 'lamp',
    name: 'Desk lamp',
    type: 'physical',
    description: 'A lamp.',
    tags: ['lamp'],
    categoryIds: [],
    options: [{ name: 'finish', values: ['Brass', 'Black'] }],
    mediaUrls: ['media:host-1/lamp-front', 'media:host-1/lamp-side'],
    seoTitle: '',
    seoDescription: '',
    ...patch,
  },
  categories: [{ id: 'cat-lighting', name: 'Lighting' }],
  proposeValues,
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
    const { container } = render(<AiProductCopyCard {...props()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('writing a product’s copy', () => {
  it('sends the product as the editor holds it with its first photo only, and stages the proposal', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiProductCopyCard {...props()} />)
    const write = await screen.findByRole('button', { name: 'Write copy' })
    expect(mockFetch.mock.calls[0][0]).toContain('orgId=org-from-host')
    mockFetch.mockResolvedValueOnce(json({ job: copyJob }))
    fireEvent.click(write)

    await screen.findByText('Brass desk lamp')
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('/api/ai/jobs')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ orgId: 'org-from-host', hostId: 'host-1', kind: 'products', brief: 'Write the storefront copy for Desk lamp' })
    expect(body.inputs).toEqual({
      target: 'product',
      productId: 'lamp',
      name: 'Desk lamp',
      type: 'physical',
      text: 'A lamp.',
      tags: '["lamp"]',
      categoryIds: '',
      options: '[{"name":"finish","values":["Brass","Black"]}]',
      imageUrl: 'media:host-1/lamp-front',
      seoTitle: '',
      seoDescription: '',
    })
    expect(JSON.stringify(body)).not.toContain('lamp-side')
    expect(screen.getByText('finish → Finish')).toBeTruthy()
    expect(screen.getByText('Fill in what the copy could not know before you save: [material].')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Put in the fields' }))
    expect(proposeValues).toHaveBeenCalledWith(aiProductCopyValues(PROPOSAL as never), 'job-7')
    expect(proposeValues.mock.calls[0][0]).toEqual({
      description: 'An adjustable brass desk lamp with a dimmable bulb.\n\nShade: [material].',
      tags: ['desk lamp', 'brass'],
      categoryIds: ['cat-lighting'],
      seoTitle: 'Brass desk lamp',
      seoDescription: 'An adjustable brass desk lamp for the home office.',
      optionNames: ['Finish'],
    })
    expect(screen.getByText('In the fields as unsaved changes. Review them, then press Save product.')).toBeTruthy()
  })

  it('shows the latest copy a saved product already has waiting', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [summary({ id: 'job-other', kind: 'seo' }), copyJob] }))
    render(<AiProductCopyCard {...props()} />)
    await screen.findByText('Proposed copy')
    expect(screen.getByRole('button', { name: 'Write again' })).toBeTruthy()
  })

  it('shows no other product’s copy, and asks for a name before it can write', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [copyJob] }))
    render(<AiProductCopyCard {...props({ id: null, name: ' ' })} />)
    expect(((await screen.findByRole('button', { name: 'Write copy' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Name the product first.')).toBeTruthy()
    expect(screen.queryByText('Proposed copy')).toBeNull()
  })

  it('says why a job could not write, in the job’s own words', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiProductCopyCard {...props()} />)
    const write = await screen.findByRole('button', { name: 'Write copy' })
    mockFetch.mockResolvedValueOnce(json({ job: summary({ id: 'job-8', status: 'failed', error: 'Turn on Commerce for this site before starting the job.' }) }))
    fireEvent.click(write)
    expect(await screen.findByText('Turn on Commerce for this site before starting the job.')).toBeTruthy()
  })
})
