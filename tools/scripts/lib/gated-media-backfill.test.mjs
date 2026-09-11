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

// The members-video backfill's decisions (AGL-2814), against an in-memory
// project.
//
//   node --test tools/scripts/lib/gated-media-backfill.test.mjs
//
// The dry run is what the owner reads before anything is written, so the
// first thing proved is that it finds a public members video, names every
// write it would make, and makes none of them.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encode } from '@msgpack/msgpack'
import {
  collectGatedMedia,
  haystackOf,
  mentionsMediaId,
  paidMediaAssetOfObject,
  parsePaidMediaSource,
  planAsset,
  runGatedMediaBackfill,
  summarize,
  tokensOfMetadata,
} from './gated-media-backfill.mjs'

const BUCKET = 'aglyn-main.appspot.com'

const downloadUrl = (objectPath, token, bucket = BUCKET) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(objectPath)}?alt=media&token=${token}`

const FILM_OBJECT = 'orgs/acme/media/Films/med-film'
const FILM_URL = downloadUrl(FILM_OBJECT, 'token-handed-out')

/** A site in org `acme` selling one course, in every shape the list can hold. */
function makeProject() {
  const state = {
    sites: [{ hostId: 'host-1', orgId: 'acme' }],
    orgSites: { acme: ['host-1', 'host-2'] },
    products: {
      'host-1': [
        {
          id: 'prod-course',
          name: 'Training program',
          deleted: false,
          gatedVideos: [
            { url: FILM_URL, title: 'Week 1' },
            { url: 'media:host-1/med-bonus', title: 'Bonus' },
            { url: 'https://videos.example.com/w1.m3u8', title: 'Hosted elsewhere' },
            { url: 'media:org:rival/med-stolen', title: 'Another org' },
            { url: 'media:org:acme/med-trailer', title: 'Trailer' },
            {
              url: downloadUrl('hosts/host-1/media/Legacy/week-2.mp4', 'legacy-token'),
              title: 'Week 2',
            },
          ],
        },
        { id: 'prod-mug', name: 'Mug', deleted: false },
      ],
    },
    media: {
      'orgs/acme/media/med-film': {
        visibleTo: ['org'],
        storagePath: FILM_OBJECT,
        cdnPath: '/api/media/cdn/org:acme/med-film',
        url: FILM_URL,
      },
      'hosts/host-1/media/med-bonus': {
        private: true,
        storagePath: 'hosts/host-1/media/med-bonus',
      },
      'orgs/acme/media/med-trailer': {
        visibleTo: ['org'],
        storagePath: 'orgs/acme/media/med-trailer',
        cdnPath: '/api/media/cdn/org:acme/med-trailer',
      },
    },
    tokens: {
      [FILM_OBJECT]: 'token-handed-out',
      'hosts/host-1/media/med-bonus': 'rotated-when-made-private',
      'orgs/acme/media/med-trailer': 'trailer-token',
      'hosts/host-1/media/Legacy/week-2.mp4': 'legacy-token',
    },
    otherUses: { 'med-trailer': ['hosts/host-2/screens/home'] },
    writes: [],
  }
  const io = {
    listSites: async () => state.sites,
    listOrgSites: async (orgId) => state.orgSites[orgId] ?? [],
    listProducts: async (hostId) => state.products[hostId] ?? [],
    readMedia: async (collection, scopeId, mediaId) =>
      state.media[`${collection}/${scopeId}/media/${mediaId}`] ?? null,
    readObjectToken: async (objectPath) => state.tokens[objectPath] ?? null,
    findOtherUses: async ({ asset }) => state.otherUses[asset.mediaId] ?? [],
    rotateToken: async (objectPath) => {
      state.writes.push(['rotate', objectPath])
      if (!state.tokens[objectPath]) return false
      state.tokens[objectPath] = `rotated-${state.writes.length}`
      return true
    },
    updateMedia: async (asset, change) => {
      state.writes.push(['private', asset.key, change])
      const doc = state.media[asset.key]
      doc.private = true
      if (change.deleteUrl) delete doc.url
      if (change.deleteCdnPath) delete doc.cdnPath
    },
    rewriteProductEntries: async (hostId, productId, rewrites) => {
      state.writes.push(['rewrite', `${hostId}/${productId}`, rewrites.length])
      const product = state.products[hostId].find((item) => item.id === productId)
      let changed = 0
      product.gatedVideos = product.gatedVideos.map((entry) => {
        const hit = rewrites.find((rewrite) => rewrite.from === entry.url)
        if (!hit) return entry
        changed += 1
        return { ...entry, url: hit.to }
      })
      return changed
    },
  }
  return { state, io }
}

const planFor = (report, key) => report.assets.find((plan) => plan.key === key)

describe('the dry run (AGL-2814)', () => {
  it('finds a public members video, names every write that fixes it, and writes nothing', async () => {
    const { state, io } = makeProject()
    const report = await runGatedMediaBackfill({ io, bucket: BUCKET })
    const film = planFor(report, 'orgs/acme/media/med-film')
    assert.equal(film.status, 'fix')
    assert.equal(film.markPrivate, true)
    assert.equal(film.deleteUrl, true)
    assert.equal(film.deleteCdnPath, true)
    assert.deepEqual(film.rotate, [FILM_OBJECT])
    assert.deepEqual(film.rewrites, [
      {
        hostId: 'host-1',
        productId: 'prod-course',
        index: 0,
        from: FILM_URL,
        to: 'media:org:acme/med-film',
      },
    ])
    assert.deepEqual(state.writes, [])
    assert.equal(state.media['orgs/acme/media/med-film'].private, undefined)
  })

  it('counts what it found, so a clean run and a blind one read differently', async () => {
    const { io } = makeProject()
    const totals = summarize(await runGatedMediaBackfill({ io, bucket: BUCKET }))
    assert.deepEqual(totals, {
      sites: 1,
      products: 2,
      productsWithGatedVideos: 1,
      deletedProductsWithGatedVideos: 0,
      entries: 6,
      skipped: { external: 1, 'out-of-scope': 1 },
      assets: 3,
      assetsToFix: 1,
      assetsAlreadyProtected: 1,
      assetsSharedLeftAlone: 1,
      assetsMissing: 0,
      wouldMarkPrivate: 1,
      wouldRotateTokens: 2,
      wouldRewriteEntries: 1,
      orphanObjects: 1,
    })
  })

  it('leaves a file that is already private and whose old links are dead alone', async () => {
    const { io } = makeProject()
    const bonus = planFor(
      await runGatedMediaBackfill({ io, bucket: BUCKET }),
      'hosts/host-1/media/med-bonus',
    )
    assert.equal(bonus.status, 'protected')
    assert.deepEqual(bonus.rotate, [])
  })

  it('lists a public file that is used elsewhere, and plans nothing for it without --include-shared', async () => {
    const { io } = makeProject()
    const trailer = planFor(
      await runGatedMediaBackfill({ io, bucket: BUCKET }),
      'orgs/acme/media/med-trailer',
    )
    assert.equal(trailer.status, 'shared')
    assert.deepEqual(trailer.otherUses, ['hosts/host-2/screens/home'])
    assert.equal(trailer.markPrivate, false)
    assert.deepEqual(trailer.rotate, [])

    const included = planFor(
      await runGatedMediaBackfill({ io, bucket: BUCKET, includeShared: true }),
      'orgs/acme/media/med-trailer',
    )
    assert.equal(included.status, 'fix')
    assert.equal(included.markPrivate, true)
    assert.deepEqual(included.rotate, ['orgs/acme/media/med-trailer'])
  })

  it('kills a handed-out link to an object no library asset owns', async () => {
    const { io } = makeProject()
    const report = await runGatedMediaBackfill({ io, bucket: BUCKET })
    assert.deepEqual(report.orphans, [
      {
        objectPath: 'hosts/host-1/media/Legacy/week-2.mp4',
        entries: 1,
        status: 'fix',
        rotate: ['hosts/host-1/media/Legacy/week-2.mp4'],
      },
    ])
  })

  it('⛔ skips a hotlink and another org’s library, reading neither', async () => {
    const { io } = makeProject()
    const report = await runGatedMediaBackfill({ io, bucket: BUCKET })
    assert.deepEqual(
      report.skipped.map((entry) => [entry.index, entry.reason]),
      [
        [2, 'external'],
        [3, 'out-of-scope'],
      ],
    )
    assert.equal(planFor(report, 'orgs/rival/media/med-stolen'), undefined)
  })
})

describe('--apply', () => {
  it('rotates first, makes private, rewrites the stored link — and a second run has nothing left', async () => {
    const { state, io } = makeProject()
    const report = await runGatedMediaBackfill({ io, bucket: BUCKET, apply: true })
    assert.deepEqual(state.writes, [
      ['rotate', FILM_OBJECT],
      ['private', 'orgs/acme/media/med-film', { deleteUrl: true, deleteCdnPath: true }],
      ['rewrite', 'host-1/prod-course', 1],
      ['rotate', 'hosts/host-1/media/Legacy/week-2.mp4'],
    ])
    assert.deepEqual(report.applied, {
      tokensRotated: 2,
      madePrivate: 1,
      entriesRewritten: 1,
      failures: [],
    })
    assert.notEqual(state.tokens[FILM_OBJECT], 'token-handed-out')
    assert.equal(state.media['orgs/acme/media/med-film'].private, true)
    assert.equal(state.media['orgs/acme/media/med-film'].url, undefined)
    assert.equal(state.products['host-1'][0].gatedVideos[0].url, 'media:org:acme/med-film')
    // The shared trailer was not touched.
    assert.equal(state.media['orgs/acme/media/med-trailer'].private, undefined)
    assert.equal(state.tokens['orgs/acme/media/med-trailer'], 'trailer-token')

    state.writes = []
    const again = summarize(await runGatedMediaBackfill({ io, bucket: BUCKET, apply: true }))
    assert.deepEqual(state.writes, [])
    assert.equal(again.assetsToFix, 0)
    assert.equal(again.wouldRotateTokens, 0)
  })

  it('reports a failed write and carries on with the rest', async () => {
    const { state, io } = makeProject()
    io.rotateToken = async (objectPath) => {
      state.writes.push(['rotate', objectPath])
      throw new Error('storage said no')
    }
    const report = await runGatedMediaBackfill({ io, bucket: BUCKET, apply: true })
    assert.equal(report.applied.failures.length, 2)
    assert.match(report.applied.failures[0].label, /^rotate /)
    assert.equal(report.applied.madePrivate, 1)
  })
})

describe('planAsset', () => {
  const asset = {
    key: 'hosts/host-1/media/m1',
    collection: 'hosts',
    scopeId: 'host-1',
    mediaId: 'm1',
    base: 'hosts/host-1',
    reference: 'media:host-1/m1',
    entries: [{ hostId: 'host-1', productId: 'p1', index: 0, url: 'media:host-1/m1', objectPath: null }],
  }

  it('⛔ mints no token where the object has none', () => {
    const plan = planAsset({ asset, media: { storagePath: 'hosts/host-1/media/m1' }, objectTokens: new Map() })
    assert.equal(plan.status, 'fix')
    assert.equal(plan.markPrivate, true)
    assert.deepEqual(plan.rotate, [])
  })

  it('rotates a deleted asset’s object only when a handed-out link names its token', () => {
    const handedOut = {
      ...asset,
      entries: [
        {
          ...asset.entries[0],
          url: downloadUrl('hosts/host-1/media/m1', 'live'),
          objectPath: 'hosts/host-1/media/m1',
        },
      ],
    }
    const live = planAsset({
      asset: handedOut,
      media: { deletedAt: 1 },
      objectTokens: new Map([['hosts/host-1/media/m1', 'live']]),
    })
    assert.equal(live.status, 'missing')
    assert.deepEqual(live.rotate, ['hosts/host-1/media/m1'])
    const dead = planAsset({
      asset: handedOut,
      media: null,
      objectTokens: new Map([['hosts/host-1/media/m1', 'already-rotated']]),
    })
    assert.deepEqual(dead.rotate, [])
    assert.equal(dead.markPrivate, false)
  })

  it('reads a stored key outside the library as the flat layout, never as the key', () => {
    const plan = planAsset({
      asset,
      media: { storagePath: 'adminAudit-archive/2026/export.json' },
      objectTokens: new Map([['hosts/host-1/media/m1', 't']]),
    })
    assert.equal(plan.objectPath, 'hosts/host-1/media/m1')
    assert.deepEqual(plan.rotate, ['hosts/host-1/media/m1'])
  })
})

describe('the copied grammar agrees with paid-media-source.ts', () => {
  it('reads the library forms, a download URL and a hotlink the same way', () => {
    assert.deepEqual(parsePaidMediaSource('media:org:acme/m1@abc123'), {
      kind: 'asset',
      scope: 'org:acme',
      mediaId: 'm1',
    })
    assert.deepEqual(parsePaidMediaSource('/api/media/cdn/org:acme:host-1/m1/abc?r=auto'), {
      kind: 'asset',
      scope: 'org:acme:host-1',
      mediaId: 'm1',
    })
    assert.deepEqual(parsePaidMediaSource('https://demo.aglyn.app/api/media/cdn/host-1/m1'), {
      kind: 'asset',
      scope: 'host-1',
      mediaId: 'm1',
    })
    assert.deepEqual(parsePaidMediaSource(FILM_URL), {
      kind: 'storage-object',
      bucket: BUCKET,
      objectPath: FILM_OBJECT,
    })
    assert.deepEqual(parsePaidMediaSource('https://evil.example/api/media/cdn/host-1/m1'), {
      kind: 'external',
      url: 'https://evil.example/api/media/cdn/host-1/m1',
    })
    for (const junk of [undefined, '', 'media:not a reference', '/uploads/x.mp4', 'https://firebasestorage.googleapis.com/v1/x?token=t']) {
      assert.deepEqual(parsePaidMediaSource(junk), { kind: 'malformed' })
    }
  })

  it('names an object’s asset only for an id-shaped key inside a library', () => {
    assert.deepEqual(paidMediaAssetOfObject('orgs/acme/media/Films/2026/m1'), {
      scope: 'org:acme',
      mediaId: 'm1',
    })
    for (const objectPath of [
      'orgs/acme/media/Films/m1__r720p.mp4',
      'hosts/host-1/media/week-2.mp4',
      'hosts/host-1/media/../m1',
      'adminAudit-archive/m1',
    ]) {
      assert.equal(paidMediaAssetOfObject(objectPath), null)
    }
  })

  it('⛔ skips a download URL from another bucket as foreign storage', () => {
    const collected = collectGatedMedia(
      [
        {
          hostId: 'host-1',
          orgId: 'acme',
          products: [
            {
              id: 'p1',
              name: 'P1',
              gatedVideos: [{ url: downloadUrl(FILM_OBJECT, 't', 'someone-else.appspot.com') }],
            },
          ],
        },
      ],
      { bucket: BUCKET },
    )
    assert.deepEqual(collected.skipped.map((entry) => entry.reason), ['foreign-storage'])
    assert.deepEqual(collected.assets, [])
  })
})

describe('the other-uses search', () => {
  it('finds a media id inside msgpack-compressed nodes, which a plain stringify cannot', () => {
    const nodes = { root: { props: { src: 'media:org:acme/med-trailer' } } }
    const compressed = { nodes: Buffer.from(encode(nodes)) }
    assert.equal(mentionsMediaId(JSON.stringify(compressed), 'med-trailer'), false)
    assert.equal(mentionsMediaId(haystackOf(compressed), 'med-trailer'), true)
    assert.equal(mentionsMediaId(haystackOf({ nodes: encode(nodes) }), 'med-trailer'), true)
  })

  it('matches the whole id only', () => {
    assert.equal(mentionsMediaId('"media:host-1/med12"', 'med1'), false)
    assert.equal(mentionsMediaId('"media:host-1/med1@abc"', 'med1'), true)
    assert.equal(mentionsMediaId('anything', 'not an id'), false)
  })

  it('reads every token of a multi-token metadata value', () => {
    assert.deepEqual(tokensOfMetadata('a, b,,c'), ['a', 'b', 'c'])
    assert.deepEqual(tokensOfMetadata(null), [])
  })
})
