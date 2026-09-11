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
 * The scan that keeps a sold members video from being published (AGL-2814).
 *
 * Every way it can be wrong points one direction: toward "no product sells
 * this", which is the answer that publishes the film. So the misses are what
 * this file drives — each stored form of the reference, a second site in the
 * org, and a catalog too large to read, which must say so rather than report
 * an empty list.
 */

import {
  findPaidMediaUses,
  PAID_MEDIA_USE_HOST_CEILING,
  PAID_MEDIA_USE_PRODUCT_CEILING,
  type PaidMediaUsesFirestore,
  paidMediaPublishRefusal,
} from './paid-media-uses'

const BUCKET = 'aglyn-media'

type Product = { id: string; data: Record<string, unknown> }

function makeFirestore(seed: {
  hosts?: string[]
  products?: Record<string, Product[]>
}) {
  const queried: string[] = []
  const query = (
    path: string,
    docs: () => { id: string; get(field: string): unknown }[],
  ): any => {
    let limit = Number.POSITIVE_INFINITY
    const self: any = {
      where: () => self,
      select: () => self,
      limit: (count: number) => {
        limit = count
        return self
      },
      get: async () => {
        queried.push(path)
        const all = docs()
        return { size: Math.min(all.length, limit), docs: all.slice(0, limit) }
      },
    }
    return self
  }
  const firestore: PaidMediaUsesFirestore = {
    collection: (name: string) =>
      Object.assign(
        query(name, () =>
          name === 'hosts'
            ? (seed.hosts ?? []).map((id) => ({ id, get: () => undefined }))
            : [],
        ),
        {
          doc: (hostId: string) => ({
            collection: (child: string) =>
              query(`${name}/${hostId}/${child}`, () =>
                (seed.products?.[hostId] ?? []).map(({ id, data }) => ({
                  id,
                  get: (field: string) => data[field],
                })),
              ),
          }),
        },
      ),
  }
  return { firestore, queried }
}

const downloadUrl = (objectPath: string, bucket = BUCKET) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(objectPath)}?alt=media&token=t`

const course = (url: string, extra: Record<string, unknown> = {}): Product => ({
  id: 'prod-course',
  data: { name: 'Training program', gatedVideos: [{ url }], ...extra },
})

describe('findPaidMediaUses', () => {
  it('finds an org film in every stored form, across the org’s sites', async () => {
    const { firestore } = makeFirestore({
      hosts: ['host-1', 'host-2', 'host-3'],
      products: {
        'host-1': [course('media:org:acme/m1')],
        'host-2': [
          {
            id: 'prod-film',
            data: {
              name: 'Feature film',
              gatedVideos: [
                { url: 'https://videos.example.com/trailer.m3u8' },
                { url: '/api/media/cdn/org:acme:host-2/m1/abc123' },
              ],
            },
          },
        ],
        'host-3': [
          {
            id: 'prod-legacy',
            data: {
              name: 'Legacy course',
              gatedVideos: [{ url: downloadUrl('orgs/acme/media/Films/m1') }],
            },
          },
        ],
      },
    })
    const result = await findPaidMediaUses({
      firestore,
      base: 'orgs/acme',
      mediaId: 'm1',
      bucket: BUCKET,
    })
    expect(result.complete).toBe(true)
    expect(result.uses).toEqual([
      { hostId: 'host-1', productId: 'prod-course', productName: 'Training program' },
      { hostId: 'host-2', productId: 'prod-film', productName: 'Feature film' },
      { hostId: 'host-3', productId: 'prod-legacy', productName: 'Legacy course' },
    ])
  })

  it('reads only the site itself for a site-library film', async () => {
    const { firestore, queried } = makeFirestore({
      products: { 'host-1': [course('media:host-1/m1')] },
    })
    const result = await findPaidMediaUses({
      firestore,
      base: 'hosts/host-1',
      mediaId: 'm1',
    })
    expect(result.uses).toHaveLength(1)
    expect(queried).toEqual(['hosts/host-1/products'])
  })

  it('does not count another asset, another library, a foreign bucket, or a deleted product', async () => {
    const { firestore } = makeFirestore({
      hosts: ['host-1'],
      products: {
        'host-1': [
          course('media:org:acme/m2'),
          { ...course('media:org:rival/m1'), id: 'prod-rival' },
          {
            ...course(downloadUrl('orgs/acme/media/m1', 'someone-else.appspot.com')),
            id: 'prod-foreign',
          },
          { ...course('media:org:acme/m1', { deletedAt: 1 }), id: 'prod-deleted' },
          { id: 'prod-none', data: { name: 'No videos' } },
        ],
      },
    })
    const result = await findPaidMediaUses({
      firestore,
      base: 'orgs/acme',
      mediaId: 'm1',
      bucket: BUCKET,
    })
    expect(result).toEqual({ uses: [], complete: true })
  })

  it('⛔ says it is incomplete when an org has more sites than it reads', async () => {
    const hosts = Array.from(
      { length: PAID_MEDIA_USE_HOST_CEILING + 1 },
      (_value, index) => `host-${index}`,
    )
    const { firestore } = makeFirestore({ hosts })
    const result = await findPaidMediaUses({
      firestore,
      base: 'orgs/acme',
      mediaId: 'm1',
    })
    expect(result).toEqual({ uses: [], complete: false })
  })

  it('⛔ says it is incomplete when a catalog is larger than it reads', async () => {
    const products = Array.from(
      { length: PAID_MEDIA_USE_PRODUCT_CEILING + 1 },
      (_value, index) => ({ id: `prod-${index}`, data: { name: `P${index}` } }),
    )
    const { firestore } = makeFirestore({ products: { 'host-1': products } })
    const result = await findPaidMediaUses({
      firestore,
      base: 'hosts/host-1',
      mediaId: 'm1',
    })
    expect(result.complete).toBe(false)
  })

  it('⛔ refuses to answer for a library it cannot name', async () => {
    const { firestore } = makeFirestore({})
    for (const base of ['', 'users/u1', 'orgs/', 'hosts']) {
      expect(
        await findPaidMediaUses({ firestore, base, mediaId: 'm1' }),
      ).toEqual({ uses: [], complete: false })
    }
  })
})

describe('paidMediaPublishRefusal', () => {
  const use = (productName: string) => ({
    hostId: 'host-1',
    productId: productName.toLowerCase(),
    productName,
  })

  it('names the product, and says why', () => {
    expect(
      paidMediaPublishRefusal({ uses: [use('Training program')], complete: true }),
    ).toBe(
      'This file is a members video on “Training program”. Remove it from ' +
        'that product before publishing it: a public copy would let anyone ' +
        'watch it without buying.',
    )
  })

  it('names the first three of many', () => {
    expect(
      paidMediaPublishRefusal({
        uses: ['A', 'B', 'C', 'D', 'E'].map(use),
        complete: true,
      }),
    ).toContain('“A”, “B”, “C” and 2 more. Remove it from those products')
  })

  it('does not pretend an incomplete scan found nothing', () => {
    expect(paidMediaPublishRefusal({ uses: [], complete: false })).toContain(
      'could not check every product',
    )
  })
})
