/**
 * @jest-environment node
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
 * Moving a file to the other library, against a REAL Firestore (AGL-4254).
 *
 * The stored documents are the only witness: a page version whose node tree
 * is compressed bytes, a draft stored as a plain map, a product variant, a
 * site setting. Each must come back rewritten to the new address, in the form
 * it was stored in, and a use on another site or in the CRM must stop the
 * file from going to one site's library.
 *
 * Skipped unless the Firestore emulator host is set:
 *
 *   npx firebase emulators:start --config cloud/firebase.json --only firestore
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c apps/console/jest.config.ts --testPathPatterns media-library-move.emulator
 */

import {
  mediaUseRewriter,
  orgToSiteRefusal,
} from '@aglyn/aglyn/app-utils/media-library-move'
import {
  decodeStoredNodes,
  encodeStoredNodes,
} from '@aglyn/aglyn/app-utils/stored-nodes'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { rewriteMovedUses, usesOf, walkMoveCorpus } from './media-library-move'

// The tenant data barrel pulls in Next's cache, which a node test cannot
// load. The walk needs only the Admin SDK's FieldPath and FieldValue.
jest.mock('@aglyn/tenant-data-admin', () => {
  const firestore = jest.requireActual('firebase-admin/firestore')
  return {
    firebaseAdmin: {
      firestore: { FieldPath: firestore.FieldPath, FieldValue: firestore.FieldValue },
    },
    mediaDerivedObjectPaths: () => [],
  }
})
jest.mock('./media-scope', () => ({
  folderStoragePath: jest.fn(),
  mediaCdnPathUpdate: jest.fn(),
  mediaObjectPath: jest.fn(),
}))

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })
const describeEmulated = EMULATED ? describe : describe.skip

const ORG = 'lib-move-org'
const SITE = 'lib-move-site'
const OTHER = 'lib-move-other'

describeEmulated('moving files between libraries (emulator)', () => {
  let db: Firestore

  beforeAll(async () => {
    db = getFirestore()
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    for (const id of [SITE, OTHER]) await db.recursiveDelete(db.collection('hosts').doc(id))
    await db.collection('orgs').doc(ORG).set({ name: 'Org', logoUrl: 'media:org:lib-move-org/LOGO' })
    await db.collection('hosts').doc(SITE).set({ orgId: ORG, seo: { image: '/api/media/cdn/org:lib-move-org/CARD' } })
    await db.collection('hosts').doc(OTHER).set({ orgId: ORG })
    const home = db.collection('hosts').doc(SITE).collection('screens').doc('home')
    await home.set({ displayName: 'Home', versionId: 'v2' })
    // The published version, compressed.
    await home.collection('versions').doc('v2').set({
      nodes: Buffer.from(
        encodeStoredNodes({ hero: { props: { src: 'media:org:lib-move-org/PHOTO' } } }) as Uint8Array,
      ),
    })
    // A draft, stored as a plain map, using the site-qualified spelling.
    await home.collection('versions').doc('draft').set({
      nodes: { hero: { props: { src: 'media:org:lib-move-org:lib-move-site/PHOTO' } } },
    })
    await db.collection('hosts').doc(SITE).collection('products').doc('jersey').set({
      title: 'Jersey',
      imageUrl: 'media:org:lib-move-org/PHOTO',
      variants: [{ id: 'm', imageUrl: 'media:org:lib-move-org/PHOTO' }],
    })
    await db.collection('hosts').doc(OTHER).collection('screens').doc('about').set({
      displayName: 'About',
      nodes: { a: { props: { src: 'media:org:lib-move-org/SHARED' } } },
    })
    await db.collection('orgs').doc(ORG).collection('contacts').doc('billy').set({
      name: 'Billy',
      mediaIds: ['CRMFILE'],
    })
  })

  const moves = ['PHOTO', 'CARD', 'SHARED', 'CRMFILE', 'LOGO'].map((mediaId) => ({
    mediaId,
    fromScope: `org:${ORG}`,
    toScope: SITE,
  }))

  it('finds every use and refuses the files something outside the site uses', async () => {
    const walk = await walkMoveCorpus({
      firestore: db,
      orgId: ORG,
      hostIds: [SITE, OTHER],
      mediaIds: moves.map((move) => move.mediaId),
      rewriter: mediaUseRewriter(moves),
    })
    expect(walk.complete).toBe(true)
    const refusal = (id: string) => orgToSiteRefusal(usesOf(walk.hits, id), SITE)
    expect(refusal('PHOTO')).toBeNull()
    expect(refusal('CARD')).toBeNull()
    expect(refusal('SHARED')).toMatch(/another site uses it/)
    expect(refusal('CRMFILE')).toMatch(/CRM contact "Billy" holds it/)
    expect(refusal('LOGO')).toMatch(/the workspace uses it/)
  })

  it('rewrites the published version, the draft, the product and its variant, and the site setting', async () => {
    const moved = moves.filter((move) => move.mediaId === 'PHOTO' || move.mediaId === 'CARD')
    const walk = await walkMoveCorpus({
      firestore: db,
      orgId: ORG,
      hostIds: [SITE],
      mediaIds: moved.map((move) => move.mediaId),
      rewriter: mediaUseRewriter(moved),
    })
    const rewriter = mediaUseRewriter(moved)
    const result = await rewriteMovedUses({
      hits: walk.hits,
      movedIds: new Set(['PHOTO', 'CARD']),
      rewriter,
      hostIds: new Set([SITE]),
    })
    expect(result.failed).toBe(0)
    expect(result.documents).toBe(4)
    expect([...rewriter.counts.values()].reduce((a, b) => a + b, 0)).toBe(5)

    const home = db.collection('hosts').doc(SITE).collection('screens').doc('home')
    const published = (await home.collection('versions').doc('v2').get()).get('nodes')
    expect(Buffer.isBuffer(published) || published instanceof Uint8Array).toBe(true)
    expect(decodeStoredNodes<any>(published)?.hero.props.src).toBe(`media:${SITE}/PHOTO`)
    const draft = (await home.collection('versions').doc('draft').get()).get('nodes')
    expect(draft.hero.props.src).toBe(`media:${SITE}/PHOTO`)
    const product = (await db.collection('hosts').doc(SITE).collection('products').doc('jersey').get()).data()
    expect(product?.['imageUrl']).toBe(`media:${SITE}/PHOTO`)
    expect(product?.['variants'][0].imageUrl).toBe(`media:${SITE}/PHOTO`)
    const site = (await db.collection('hosts').doc(SITE).get()).data()
    expect(site?.['seo'].image).toBe(`/api/media/cdn/${SITE}/CARD`)
    // Another site's page is not this move's to touch.
    const other = (await db.collection('hosts').doc(OTHER).collection('screens').doc('about').get()).data()
    expect(other?.['nodes'].a.props.src).toBe(`media:org:${ORG}/SHARED`)
  })
})
