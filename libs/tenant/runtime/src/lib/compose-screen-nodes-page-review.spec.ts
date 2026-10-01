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
 * AGL-3362: a page the phishing review holds is never composed for a
 * visitor.
 *
 * Every publish path is a pointer write — most of them from the browser —
 * so the one place they all meet is here, where the page is composed as a
 * visitor receives it. These pin the wiring: what the review sees, that a
 * held version falls back to the page's last clean version (screened again),
 * that a first publish that holds serves nothing, and that only the
 * PUBLISHED version is ever noted as the last clean one. The review itself
 * is `hosted-page-review.spec.ts`'s.
 */

const mockGetScreenVersion = jest.fn()
const mockReview = jest.fn()
const mockServedVersion = jest.fn()
const mockRecordServed = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ version: { nodes: {} }, layout: {} })),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ definitions: {} })),
}))
jest.mock('@aglyn/aglyn/plugin-manager/repeat-rows', () => ({ __esModule: true, readRepeatRows: jest.fn(async () => []) }))
jest.mock('./get-plugin-installs', () => ({ __esModule: true, default: jest.fn(async () => []) }))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
  getFunctions: jest.fn(async () => []),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(async () => null),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreenVersion(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/hosted-page-review', () => ({
  __esModule: true,
  reviewHostedPage: (...args: unknown[]) => mockReview(...args),
  servedPageVersion: (...args: unknown[]) => mockServedVersion(...args),
  recordServedPageVersion: (...args: unknown[]) => mockRecordServed(...args),
}))

import composeScreenNodes from './compose-screen-nodes'

const ROOT = '_@_'
const versionNodes = (label: string) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['t'] },
  t: { $id: 't', componentId: 'muiTypography', parentId: ROOT, props: { children: label } },
})

/** A composed tree names the version it came from, for the fake review. */
const labelOf = (nodes: unknown) => JSON.stringify(nodes).match(/"children":"([^"]+)"/)?.[1]

const screen = { versionId: 'v2' } as never

beforeEach(() => {
  jest.clearAllMocks()
  mockGetScreenVersion.mockImplementation(async ({ versionId }: { versionId: string }) => ({
    version: { nodes: versionNodes(`content-${versionId}`) },
  }))
  mockServedVersion.mockResolvedValue(null)
  mockRecordServed.mockResolvedValue(undefined)
})

describe('composeScreenNodes × the page review (AGL-3362)', () => {
  it('reviews the page as composed, and notes a clean published version as the last clean one', async () => {
    mockReview.mockResolvedValue({ outcome: 'serve' })
    const nodes = await composeScreenNodes({ hostId: 'h1', screenId: 's1', screen })
    expect(labelOf(nodes)).toBe('content-v2')
    expect(mockReview).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'h1', screenId: 's1', versionId: 'v2', nodes }),
    )
    expect(mockRecordServed).toHaveBeenCalledWith('h1', 's1', 'v2')
  })

  it('does not note an experiment variant or a pinned version as the page’s own', async () => {
    mockReview.mockResolvedValue({ outcome: 'serve' })
    await composeScreenNodes({ hostId: 'h1', screenId: 's1', screen, versionId: 'variant-b' })
    expect(mockReview).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'variant-b' }))
    expect(mockRecordServed).not.toHaveBeenCalled()
  })

  it('serves the last clean version when the published one is held', async () => {
    mockServedVersion.mockResolvedValue('v1')
    mockReview.mockImplementation(async ({ nodes }: { nodes: unknown }) =>
      labelOf(nodes) === 'content-v2'
        ? { outcome: 'held', reviewId: 'r', reference: 'HS-R' }
        : { outcome: 'serve' },
    )
    const nodes = await composeScreenNodes({ hostId: 'h1', screenId: 's1', screen })
    expect(labelOf(nodes)).toBe('content-v1')
    // Screened again: a version document can be edited after it was served.
    expect(mockReview).toHaveBeenCalledTimes(2)
    expect(mockRecordServed).not.toHaveBeenCalled()
  })

  it('serves nothing when a first publish is held', async () => {
    mockReview.mockResolvedValue({ outcome: 'held', reviewId: 'r', reference: 'HS-R' })
    await expect(composeScreenNodes({ hostId: 'h1', screenId: 's1', screen })).resolves.toBeNull()
  })

  it('serves nothing, and falls back no further, when the last clean version holds too', async () => {
    mockServedVersion.mockResolvedValue('v1')
    mockReview.mockResolvedValue({ outcome: 'rejected', reviewId: 'r', reference: 'HS-R' })
    await expect(composeScreenNodes({ hostId: 'h1', screenId: 's1', screen })).resolves.toBeNull()
    expect(mockReview).toHaveBeenCalledTimes(2)
    expect(mockServedVersion).toHaveBeenCalledTimes(1)
  })

  it('hands the review what the page IS, and its layouts and components on demand (AGL-3374)', async () => {
    mockReview.mockResolvedValue({ outcome: 'serve' })
    const template = {
      role: 'entry' as const,
      route: '/videos/:slug',
      collectionName: 'Videos',
      entryPath: '/videos/intro',
      fallback: 'built-in-design' as const,
    }
    await composeScreenNodes({
      hostId: 'h1',
      screenId: 'tmpl',
      screen: { versionId: 'v2', displayName: 'Video detail', kind: 'template', layoutId: 'main' } as never,
      page: { template },
    })
    const { page } = mockReview.mock.calls[0][0] as {
      page: { screen: unknown; template: unknown; variant: unknown; parts: () => Promise<Array<{ type: string; id: string }>> }
    }
    expect(page.screen).toEqual({ displayName: 'Video detail', name: undefined, kind: 'template' })
    expect(page.template).toEqual(template)
    expect(page.variant).toBeNull()
    const parts = await page.parts()
    expect(parts.map((part) => [part.type, part.id])).toEqual([
      ['screen', 'tmpl'],
      ['layout', 'main'],
    ])
  })
})
