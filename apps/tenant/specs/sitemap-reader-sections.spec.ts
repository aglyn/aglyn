/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `Request` is not a constructor.
 *
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *

/**
 * Child sitemaps a plugin's READER lists (AGL-3475): record pages, one child
 * per record template, named `records-{key}`.
 *
 * Pinned here: the index names one child per key the reader answers, sized by
 * the count it gives; a child page carries the reader's URLs made absolute and
 * dated; and a reader that throws degrades the answer rather than quietly
 * shrinking it.
 */

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const mockEmptyQuery = (): any => {
  const query: any = {
    where: () => query,
    orderBy: () => query,
    select: () => query,
    offset: () => query,
    limit: () => query,
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => ({ docs: [] }),
  }
  return query
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) =>
              name === 'settings'
                ? { doc: () => ({ get: async () => ({ get: () => undefined }) }) }
                : mockEmptyQuery(),
          }),
        }),
      }),
    }),
  },
}))

import { SITEMAP_URLS_PER_FILE } from '@aglyn/aglyn/app-utils/sitemap'
import {
  type PluginSitemapReader,
  registerPluginSitemapReader,
  resetPluginSitemapReadersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-sitemap-readers'
import { GET } from '../app/api/sitemap/route'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.MockedFunction<typeof getHost>

const BASE = 'https://edr.test'

const fetchXml = async (path: string) =>
  (
    await GET(
      new Request(`${BASE}${path || '/sitemap.xml'}?host=edr`, {
        headers: { host: 'edr.test' },
      }),
    )
  ).text()

const locsOf = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

const ROOFS = Array.from({ length: SITEMAP_URLS_PER_FILE + 2 }, (_, index) => ({
  path: `/services/residential/roof-${index}`,
  lastmod: Date.UTC(2026, 8, 30),
}))

const reader: PluginSitemapReader = {
  children: async () => [
    { key: 'services', urls: 2 },
    { key: 'services--residential', urls: ROOFS.length },
    { key: 'Not A Key', urls: 3 },
  ],
  urls: async ({ key, page, perPage }) => {
    if (key === 'services') {
      return [
        { path: '/services/roofing', lastmod: Date.UTC(2026, 9, 1) },
        { path: 'services/no-leading-slash' },
      ]
    }
    return ROOFS.slice((page - 1) * perPage, page * perPage)
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  resetPluginSitemapReadersForTests()
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', cname: 'edr.test', seo: {}, screens: { home: '' } },
    nextPageToken: '',
    error: null,
  } as never)
})

describe('child sitemaps a plugin’s reader lists (AGL-3475)', () => {
  it('names one child per key the reader answers, sized by its count', async () => {
    registerPluginSitemapReader('records', reader, { pluginId: 'data' })
    expect(locsOf(await fetchXml(''))).toEqual([
      `${BASE}/sitemaps/pages/1.xml`,
      `${BASE}/sitemaps/records-services/1.xml`,
      `${BASE}/sitemaps/records-services--residential/1.xml`,
      `${BASE}/sitemaps/records-services--residential/2.xml`,
    ])
  })

  it('makes a child’s URLs absolute and dated, and drops a path that is not site-absolute', async () => {
    registerPluginSitemapReader('records', reader, { pluginId: 'data' })
    const xml = await fetchXml('/sitemaps/records-services/1.xml')
    expect(locsOf(xml)).toEqual([`${BASE}/services/roofing`])
    expect(xml).toContain('<lastmod>2026-10-01</lastmod>')
  })

  it('pages a large child the way the index sized it', async () => {
    registerPluginSitemapReader('records', reader, { pluginId: 'data' })
    const second = locsOf(await fetchXml('/sitemaps/records-services--residential/2.xml'))
    expect(second).toEqual([
      `${BASE}/services/residential/roof-${SITEMAP_URLS_PER_FILE}`,
      `${BASE}/services/residential/roof-${SITEMAP_URLS_PER_FILE + 1}`,
    ])
  })

  it('keeps every other section when the reader fails', async () => {
    registerPluginSitemapReader(
      'records',
      {
        children: async () => {
          throw new Error('unavailable')
        },
        urls: async () => [],
      },
      { pluginId: 'data' },
    )
    expect(locsOf(await fetchXml(''))).toEqual([`${BASE}/sitemaps/pages/1.xml`])
  })

  it('refuses a reader from a plugin other than the one that declared the family', () => {
    expect(() =>
      registerPluginSitemapReader('records', reader, { pluginId: 'commerce' }),
    ).toThrow(/declared by "data"/)
  })
})
