/**
 * @jest-environment node
 *
 * The pragma stays in the FIRST block comment: behind the license header it
 * is silently ignored.
 */
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
 * Record pages on the published site (AGL-3475): which requests the resolver
 * answers, what it hands the template's composition, and what the page says
 * about itself. The reads and the composition are doubles; the record reads
 * have their own spec.
 */

const mockCompose = jest.fn()
const mockGetScreen = jest.fn()
const mockBindings = jest.fn()
const mockRecord = jest.fn()

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCompose(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreen(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('./record-page-read.server', () => ({
  readSiteRecordPageBindings: (...args: unknown[]) => mockBindings(...args),
  readRecordPageRecord: (...args: unknown[]) => mockRecord(...args),
}))

import type { DatasetModel } from '../model/dataset-models'
import { recordPageResolver } from './record-page-resolver.server'

const MODEL: DatasetModel = {
  order: ['name', 'slug', 'summary', 'photo', 'lead'],
  fields: {
    name: { name: 'Name', type: 'text' },
    slug: { name: 'Page address', type: 'text', customType: 'pageAddress' },
    summary: { name: 'Summary', type: 'text' },
    photo: { name: 'Photo', type: 'text' },
    lead: { name: 'Crew lead', type: 'reference', reference: { datasetId: 'people' } },
  },
}

const SERVICES = {
  screenId: 'svc-tmpl',
  datasetId: 'services',
  base: 'services',
  slugField: 'slug',
  seoDescriptionField: 'summary',
  seoImageField: 'photo',
}
const RESIDENTIAL = { ...SERVICES, screenId: 'res-tmpl', base: 'services/residential' }

const HOST = { $id: 'host-1', subdomain: 'edr', seo: { image: 'media:host-1/card' } }
const ORG = { $id: 'org-1' }

const resolve = (path: string, overrides: Record<string, unknown> = {}) =>
  recordPageResolver({
    hostId: 'host-1',
    host: HOST,
    org: ORG,
    path,
    slugSegments: path.split('/').filter(Boolean),
    ...overrides,
  }) as Promise<any>

const ROOFING = {
  dataset: { id: 'services', name: 'Services', model: MODEL },
  record: {
    $id: 'r1',
    name: 'Roofing',
    slug: 'roofing',
    summary: 'Shingle and metal roofs.',
    photo: 'media:org-1/roof',
    lead: 'p1',
  },
  datasetsByKey: { people: { records: [{ $id: 'p1', name: 'Marisol' }] } },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBindings.mockResolvedValue([SERVICES, RESIDENTIAL])
  mockRecord.mockImplementation(async (_host: string, binding: { base: string }, address: string) =>
    binding.base === 'services' && address === 'roofing' ? ROOFING : null,
  )
  mockGetScreen.mockImplementation(async ({ screenId }: { screenId: string }) => ({
    screen: {
      $id: screenId,
      kind: 'template',
      displayName: 'Service page',
      versionId: 'v1',
      seo: { title: 'Service page', description: 'One of our services' },
    },
  }))
  mockCompose.mockResolvedValue({ root: { $id: 'root' } })
})

describe('which requests it answers', () => {
  it('answers a record’s address under its template’s base', async () => {
    const page = await resolve('/services/roofing')
    expect(page?.props?.nodes).toEqual({ root: { $id: 'root' } })
    expect(mockGetScreen).toHaveBeenCalledWith({
      hostId: 'host-1',
      screenId: 'svc-tmpl',
      allowTemplate: true,
    })
  })

  it('asks a nested base for the segment after it', async () => {
    await resolve('/services/residential/gutters')
    expect(mockRecord).toHaveBeenCalledWith('host-1', RESIDENTIAL, 'gutters')
  })

  it('passes over a path no template’s base matches without reading a record', async () => {
    expect(await resolve('/about/team')).toBeUndefined()
    expect(await resolve('/services')).toBeUndefined()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('passes over an address no record holds, so the site’s 404 answers', async () => {
    expect(await resolve('/services/nothing-here')).toBeUndefined()
    expect(mockCompose).not.toHaveBeenCalled()
  })

  it('serves nothing from a template that has been made a page again', async () => {
    mockGetScreen.mockResolvedValue({ screen: { $id: 'svc-tmpl', kind: 'page' } })
    expect(await resolve('/services/roofing')).toBeUndefined()
    expect(mockCompose).not.toHaveBeenCalled()
  })

  it('serves nothing from a template that has never been published', async () => {
    mockCompose.mockResolvedValue(null)
    expect(await resolve('/services/roofing')).toBeUndefined()
  })

  it('serves nothing on a site that switched Data off, and reads nothing', async () => {
    const off = await resolve('/services/roofing', {
      host: { ...HOST, disabledPlugins: ['data'] },
    })
    expect(off).toBeUndefined()
    expect(mockBindings).not.toHaveBeenCalled()
  })

  it('reads nothing more on a site with no record templates', async () => {
    mockBindings.mockResolvedValue([])
    expect(await resolve('/services/roofing')).toBeUndefined()
    expect(mockGetScreen).not.toHaveBeenCalled()
  })
})

describe('what the template is composed with', () => {
  it('hands it the record, its references and its one hop', async () => {
    await resolve('/services/roofing')
    const options = mockCompose.mock.calls[0][0]
    expect(options.screenId).toBe('svc-tmpl')
    expect(options.record).toEqual({
      record: ROOFING.record,
      model: { references: { lead: 'people' } },
      datasetsByKey: ROOFING.datasetsByKey,
    })
  })

  it('names the page for the page review as the record template it is', async () => {
    await resolve('/services/roofing')
    expect(mockCompose.mock.calls[0][0].page.template).toEqual({
      role: 'entry',
      route: '/services/:slug',
      collectionName: 'Services',
      entryPath: '/services/roofing',
      fallback: 'not-found',
    })
  })

  it('reads the record’s image first for the card, then the template’s and the site’s', async () => {
    await resolve('/services/roofing')
    expect(mockCompose.mock.calls[0][0].socialImages.images).toEqual([
      'media:org-1/roof',
      undefined,
      'media:host-1/card',
    ])
  })
})

describe('what the page says about itself', () => {
  it('is named by the record and described by its picked fields', async () => {
    const page = await resolve('/services/roofing')
    const screen = page.props.data.screen.data
    expect(screen.displayName).toBe('Roofing')
    expect(screen.seo.title).toBeUndefined()
    expect(screen.seo.description).toBe('Shingle and metal roofs.')
    expect(screen.seo.image).toBe('media:org-1/roof')
  })

  it('falls back to the template’s description when the record has none', async () => {
    mockRecord.mockResolvedValue({ ...ROOFING, record: { name: 'Roofing', slug: 'roofing' } })
    const page = await resolve('/services/roofing')
    expect(page.props.data.screen.data.seo.description).toBe('One of our services')
  })

  it('answers at its own address, not the template’s', async () => {
    const page = await resolve('/services/roofing')
    expect(page.props.routePath).toBe('services/roofing')
  })
})
