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
 * The intrinsic-size backfill, run against a real Firestore (AGL-2486).
 *
 * This backfill was written and then deliberately not written for weeks,
 * because the things that make it dangerous cannot be established by reading
 * it. All four are decided here by running it:
 *
 *  1. **The three storage forms round-trip.** `nodes` is a msgpack `Bytes`
 *     field, a plain map, or a `{type:'Buffer'}` envelope, and all three are
 *     live. A document silently rewritten into a different form is a worse
 *     outcome than a missing width — the readers all decode by form, and the
 *     plain form is materially larger, which walks a near-limit document into
 *     Firestore's ceiling. Each form is seeded, backfilled, and asserted to
 *     come back out as the same form holding the same tree apart from the two
 *     numbers that were added.
 *  2. **The size ceiling holds.** Two documents are seeded a hundred bytes
 *     apart on either side of the point where adding a pair crosses the
 *     900,000-byte refuse threshold. One is written and one is refused, and
 *     the refused one is asserted byte-for-byte unchanged. A backfill that
 *     bricks a large page is worse than one that skips it.
 *  3. **Every leave-it-alone branch really leaves it alone.** A node that
 *     already has a pair keeps ITS pair rather than the asset's; a media
 *     document with no dimensions produces no keys rather than zeros; a
 *     reference to a document that does not exist is reported, not thrown.
 *  4. **It is idempotent.** The second apply is asserted to write nothing and
 *     to leave every stored blob byte-identical.
 *
 * ## The control
 *
 * Most of the assertions above are "nothing happened", and a no-op passes all
 * of them. `the control` is the test that makes the rest mean something: an
 * ordinary image node with a resolvable reference gains exactly the asset's
 * dimensions. If it ever goes green while the backfill does nothing, the
 * whole file is decorative.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns backfill-intrinsic-media-size.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'
import { NODE_MAP_MAX_BYTES, nodeMapBytes } from '@aglyn/aglyn/app-utils/measure-node-map'
import {
  backfillIntrinsicMediaSize,
  planIntrinsicMediaSize,
  readStoredNodes,
  type BackfillReport,
} from './backfill-intrinsic-media-size'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

const HOST = 'e2e-intrinsic-host'
const ORG = 'e2e-intrinsic-org'

/** Media assets the fixture points at. Only `sized`/`hostSized` are usable. */
const SIZED = `media:org:${ORG}/sized`
/** The same asset, addressed through the host-qualified org scope. */
const SIZED_QUALIFIED = `media:org:${ORG}:${HOST}/sized`
/** An asset in the HOST's own library rather than the org's. */
const HOST_SIZED = `media:${HOST}/hostSized`
/** A media document that exists and carries no dimensions at all. */
const UNSIZED = `media:org:${ORG}/unsized`
/** A media document whose capture came back as zeros. */
const ZEROED = `media:org:${ORG}/zeroed`
/** A reference to a media document that does not exist. */
const GHOST = `media:org:${ORG}/ghost`

const imageNode = (id: string, props: Record<string, unknown>) => ({
  $id: id,
  componentId: 'image',
  parentId: 'root',
  props,
  nodes: [],
})

/**
 * The tree that exercises every branch at once, so a change in one cannot be
 * hidden by re-seeding the fixture for it.
 */
const mixedTree = () => ({
  root: { $id: 'root', componentId: 'div', props: {}, nodes: ['gains'] },
  // THE CONTROL — an ordinary published image with a resolvable reference.
  gains: imageNode('gains', { src: SIZED, alt: 'hero' }),
  // Already carries a pair. Its own numbers must survive; the asset's
  // 1600x900 must not overwrite them.
  authored: imageNode('authored', {
    src: SIZED,
    intrinsicWidth: 111,
    intrinsicHeight: 222,
  }),
  // The media document exists and has no dimensions. No keys may appear.
  unsized: imageNode('unsized', { src: UNSIZED }),
  // Capture came back zero. `width="0"` collapses the element.
  zeroed: imageNode('zeroed', { src: ZEROED }),
  // The media document does not exist. Reported, never thrown.
  ghost: imageNode('ghost', { src: GHOST }),
  // The host's own library rather than the org's.
  hostLibrary: imageNode('hostLibrary', { src: HOST_SIZED }),
  // `org:{orgId}:{hostId}` narrows DELIVERY, not which library holds it.
  qualified: imageNode('qualified', { src: SIZED_QUALIFIED }),
  // An author-typed hotlink. Nothing here has seen the file.
  hotlink: imageNode('hotlink', { src: 'https://example.com/a.png' }),
  // A component whose renderer does not read the pair. Writing one would
  // spread `intrinsicwidth` onto the DOM as an invalid attribute.
  poster: {
    $id: 'poster',
    componentId: 'video',
    parentId: 'root',
    props: { src: SIZED },
    nodes: [],
  },
  // A node with no props at all.
  spacer: { $id: 'spacer', componentId: 'div', parentId: 'root', nodes: [] },
})

/** One image and a text node padded so the tree measures exactly `target`. */
function paddedTree(target: number) {
  const build = (padLength: number) => ({
    root: { $id: 'root', componentId: 'div', props: {}, nodes: ['hero', 'pad'] },
    hero: imageNode('hero', { src: SIZED, alt: 'hero' }),
    pad: {
      $id: 'pad',
      componentId: 'text',
      parentId: 'root',
      props: { text: 'x'.repeat(padLength) },
      nodes: [],
    },
  })
  // msgpack string headers step at 32/256/65536 bytes, so one adjustment can
  // overshoot. Converge instead of assuming.
  let padLength = Math.max(0, target - nodeMapBytes(build(0)))
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const size = nodeMapBytes(build(padLength))
    if (size === target) break
    padLength += target - size
  }
  return build(padLength)
}

/**
 * The bytes a pair costs in the encoding the ceiling is measured in — two
 * keys and two small integers. Derived rather than asserted as a literal, so
 * the two padded documents stay on the intended sides of the line if the
 * prop names ever change.
 */
const PAIR_BYTES =
  nodeMapBytes({
    n: { props: { src: SIZED, intrinsicWidth: 1600, intrinsicHeight: 900 } },
  }) - nodeMapBytes({ n: { props: { src: SIZED } } })

describeEmulated('the intrinsic-size backfill, run for real (AGL-2486)', () => {
  let db: Firestore
  let dryRun: BackfillReport
  let firstApply: BackfillReport
  let secondApply: BackfillReport
  /** Raw `nodes` fields as stored immediately after the first apply. */
  let afterFirstApply: Record<string, unknown>

  const versionRef = (screenId: string) =>
    db
      .collection('hosts')
      .doc(HOST)
      .collection('screens')
      .doc(screenId)
      .collection('versions')
      .doc('v1')

  const rawNodes = async (screenId: string) =>
    (await versionRef(screenId).get()).get('nodes')

  const decodedNodes = async (screenId: string) =>
    readStoredNodes(await rawNodes(screenId))

  const run = (apply: boolean) =>
    backfillIntrinsicMediaSize({
      firestore: db,
      apply,
      hostId: HOST,
    })

  beforeAll(async () => {
    db = getFirestore()
    const host = db.collection('hosts').doc(HOST)
    const org = db.collection('orgs').doc(ORG)

    await host.set({ subdomain: HOST })
    await org.collection('media').doc('sized').set({
      fileName: 'hero.png',
      width: 1600,
      height: 900,
      // Present so the read is proved to be masked to width/height rather
      // than pulling the whole media document.
      tags: ['brand'],
    })
    await host.collection('media').doc('hostSized').set({
      fileName: 'badge.png',
      width: 800,
      height: 600,
    })
    // Exists, carries no dimensions — must be told apart from `ghost`.
    await org.collection('media').doc('unsized').set({ fileName: 'old.png' })
    await org.collection('media').doc('zeroed').set({
      fileName: 'partial.png',
      width: 0,
      height: 0,
    })
    // `ghost` is deliberately never written.

    const seedVersion = async (screenId: string, nodes: unknown) => {
      await host.collection('screens').doc(screenId).set({ versionId: 'v1' })
      await host
        .collection('screens')
        .doc(screenId)
        .collection('versions')
        .doc('v1')
        .set({ nodes })
    }

    // The three live storage forms, each holding the same tree.
    await seedVersion('plain', mixedTree())
    await seedVersion('bytes', Buffer.from(encode(mixedTree())))
    await seedVersion('envelope', {
      type: 'Buffer',
      data: Array.from(encode(mixedTree())),
    })
    // Either side of the point where the addition crosses the threshold.
    await seedVersion(
      'nearlimit',
      Buffer.from(encode(paddedTree(NODE_MAP_MAX_BYTES - PAIR_BYTES - 1))),
    )
    await seedVersion(
      'overlimit',
      Buffer.from(encode(paddedTree(NODE_MAP_MAX_BYTES - PAIR_BYTES + 1))),
    )

    dryRun = await run(false)
    firstApply = await run(true)
    afterFirstApply = {
      plain: await rawNodes('plain'),
      bytes: await rawNodes('bytes'),
      envelope: await rawNodes('envelope'),
      nearlimit: await rawNodes('nearlimit'),
      overlimit: await rawNodes('overlimit'),
    }
    secondApply = await run(true)
  }, 120_000)

  it('the control: an ordinary published image gains the asset dimensions', async () => {
    const stored = await decodedNodes('plain')
    expect(stored?.nodes['gains'].props).toEqual({
      src: SIZED,
      alt: 'hero',
      intrinsicWidth: 1600,
      intrinsicHeight: 900,
    })
    // And it did so through the real walk, not because the fixture said so.
    expect(firstApply.nodesStamped).toBeGreaterThan(0)
    expect(firstApply.docsChanged).toBeGreaterThan(0)
  })

  it('resolves a host library and a host-qualified org scope', async () => {
    const props = (await decodedNodes('plain'))?.nodes
    expect(props['hostLibrary'].props).toEqual({
      src: HOST_SIZED,
      intrinsicWidth: 800,
      intrinsicHeight: 600,
    })
    // `org:{orgId}:{hostId}` addresses the SAME org library document.
    expect(props['qualified'].props).toEqual({
      src: SIZED_QUALIFIED,
      intrinsicWidth: 1600,
      intrinsicHeight: 900,
    })
  })

  it('leaves a node that already carries a pair exactly as it was', async () => {
    const stored = await decodedNodes('plain')
    expect(stored?.nodes['authored'].props).toEqual({
      src: SIZED,
      intrinsicWidth: 111,
      intrinsicHeight: 222,
    })
  })

  it('adds no keys when the media document has no usable dimensions', async () => {
    const nodes = (await decodedNodes('plain'))?.nodes
    // Not `{intrinsicWidth: 0}`, and not `{intrinsicWidth: undefined}` — the
    // props object must come back with exactly the keys it went in with.
    expect(nodes['unsized'].props).toEqual({ src: UNSIZED })
    expect(nodes['zeroed'].props).toEqual({ src: ZEROED })
    expect(firstApply.unsizedMedia.map((entry) => entry.ref)).toEqual(
      expect.arrayContaining([UNSIZED, ZEROED]),
    )
  })

  it('skips a reference to a media document that does not exist, and says so', async () => {
    const nodes = (await decodedNodes('plain'))?.nodes
    expect(nodes['ghost'].props).toEqual({ src: GHOST })
    expect(firstApply.missingMedia).toEqual(
      expect.arrayContaining([
        {
          path: `hosts/${HOST}/screens/plain/versions/v1`,
          ref: GHOST,
        },
      ]),
    )
    // A missing document is not the same answer as one carrying no
    // dimensions, and the two buckets must not have collapsed into one.
    expect(firstApply.unsizedMedia.map((entry) => entry.ref)).not.toContain(GHOST)
  })

  it('leaves a hotlink and a component that does not read the pair alone', async () => {
    const nodes = (await decodedNodes('plain'))?.nodes
    expect(nodes['hotlink'].props).toEqual({ src: 'https://example.com/a.png' })
    // `video` is not in the allowlist; a pair here would reach the DOM as an
    // invalid `intrinsicwidth` attribute in the published HTML.
    expect(nodes['poster'].props).toEqual({ src: SIZED })
    expect(nodes['spacer']).toEqual({
      $id: 'spacer',
      componentId: 'div',
      parentId: 'root',
      nodes: [],
    })
  })

  it('a dry run reports the same work and writes nothing', () => {
    expect(dryRun.apply).toBe(false)
    expect(dryRun.nodesStamped).toBe(firstApply.nodesStamped)
    expect(dryRun.docsChanged).toBe(firstApply.docsChanged)
    expect(dryRun.refusedForSize.map((item) => item.path)).toEqual(
      firstApply.refusedForSize.map((item) => item.path),
    )
    // The apply that followed it found work to do, which it could not have
    // done had the dry run written anything.
    expect(firstApply.nodesStamped).toBe(dryRun.nodesStamped)
  })

  describe('the three storage forms', () => {
    /** The tree each form must decode to once the backfill has run. */
    const expected = () => {
      const tree = mixedTree() as Record<string, any>
      tree['gains'].props.intrinsicWidth = 1600
      tree['gains'].props.intrinsicHeight = 900
      tree['hostLibrary'].props.intrinsicWidth = 800
      tree['hostLibrary'].props.intrinsicHeight = 600
      tree['qualified'].props.intrinsicWidth = 1600
      tree['qualified'].props.intrinsicHeight = 900
      return tree
    }

    it('a plain map stays a plain map', async () => {
      const raw = await rawNodes('plain')
      expect(Buffer.isBuffer(raw)).toBe(false)
      expect(raw).not.toHaveProperty('type', 'Buffer')
      expect(raw).toEqual(expected())
    })

    it('a msgpack Bytes field stays a msgpack Bytes field', async () => {
      const raw = await rawNodes('bytes')
      expect(Buffer.isBuffer(raw)).toBe(true)
      expect(decode(raw as Buffer)).toEqual(expected())
    })

    it('a {type:"Buffer"} envelope stays an envelope', async () => {
      const raw = await rawNodes('envelope')
      expect(Buffer.isBuffer(raw)).toBe(false)
      const envelope = raw as { type: string; data: number[] }
      expect(envelope.type).toBe('Buffer')
      expect(Array.isArray(envelope.data)).toBe(true)
      expect(decode(Uint8Array.from(envelope.data))).toEqual(expected())
    })

    it('all three were seen, so no form was walked blind', () => {
      expect(firstApply.forms).toEqual({ map: 1, bytes: 3, envelope: 1 })
    })
  })

  describe('the size ceiling', () => {
    it('writes the document the addition still fits in', async () => {
      const stored = await decodedNodes('nearlimit')
      expect(stored?.nodes['hero'].props.intrinsicWidth).toBe(1600)
      expect(nodeMapBytes(stored?.nodes)).toBeLessThanOrEqual(NODE_MAP_MAX_BYTES)
      expect(firstApply.refusedForSize.map((item) => item.path)).not.toContain(
        `hosts/${HOST}/screens/nearlimit/versions/v1`,
      )
    })

    it('refuses the one the addition would push over, and reports it', async () => {
      const refusal = firstApply.refusedForSize.find(
        (item) => item.path === `hosts/${HOST}/screens/overlimit/versions/v1`,
      )
      expect(refusal).toBeDefined()
      expect(refusal?.images).toBe(1)
      // Under the line before, over it after — the addition is what crosses,
      // not the document already being too big.
      expect(refusal?.bytesBefore).toBeLessThanOrEqual(NODE_MAP_MAX_BYTES)
      expect(refusal?.bytesAfter).toBeGreaterThan(NODE_MAP_MAX_BYTES)
    })

    it('leaves the refused document byte-for-byte unchanged', async () => {
      const stored = await decodedNodes('overlimit')
      expect(stored?.nodes['hero'].props).toEqual({ src: SIZED, alt: 'hero' })
      // The whole run kept going: a document too large to touch is reported,
      // never a failure that abandons the corpus behind it.
      expect(firstApply.docsChanged).toBeGreaterThan(0)
    })

    it('the two padded documents differ only by which side of the line they land', () => {
      const under = paddedTree(NODE_MAP_MAX_BYTES - PAIR_BYTES - 1)
      const over = paddedTree(NODE_MAP_MAX_BYTES - PAIR_BYTES + 1)
      const sizes = new Map([
        [`orgs/${ORG}/media/sized`, { width: 1600, height: 900 }],
      ])
      expect(nodeMapBytes(over) - nodeMapBytes(under)).toBe(2)
      expect(planIntrinsicMediaSize(under, sizes).tooLarge).toBe(false)
      expect(planIntrinsicMediaSize(over, sizes).tooLarge).toBe(true)
      // And the refusal is the ONLY difference: the same node qualifies in
      // both, so the skip is about size and nothing else.
      expect(planIntrinsicMediaSize(over, sizes).stamped).toBe(1)
      expect(planIntrinsicMediaSize(over, sizes).nodes).toBeNull()
    })
  })

  describe('the media reads', () => {
    it('reads distinct assets in batches, not one read per image', () => {
      // The mixed tree holds seven media references on stampable nodes, and
      // it is seeded three times over. They name five distinct media
      // documents — `SIZED` and `SIZED_QUALIFIED` are one asset addressed two
      // ways — and one batched read fetches all five for the first document.
      // Everything after that is answered from the cache.
      expect(firstApply.mediaBatches).toBe(1)
      expect(firstApply.mediaReads).toBe(5)
    })

    it('the second run reads only the assets it still cannot stamp', () => {
      // Every node the first run stamped is skipped before its reference is
      // ever collected, so the reads that remain are exactly the four the
      // backfill will never resolve: the dimensionless asset, the zeroed one,
      // the document that does not exist, and the one image inside the
      // document refused for size. That the number FELL proves the read gate
      // follows the stamp gate rather than running ahead of it.
      expect(secondApply.mediaReads).toBe(4)
      expect(secondApply.mediaReads).toBeLessThan(firstApply.mediaReads)
    })
  })

  describe('idempotency', () => {
    it('a second apply writes nothing', () => {
      expect(secondApply.nodesStamped).toBe(0)
      expect(secondApply.docsChanged).toBe(0)
      expect(secondApply.bytesAdded).toBe(0)
      // It still SAW the same corpus — a zero that came from scanning
      // nothing would be the failure this counter exists to expose.
      expect(secondApply.docsWithNodes).toBe(firstApply.docsWithNodes)
      expect(secondApply.forms).toEqual(firstApply.forms)
    })

    it('every stored blob is identical to what the first apply left', async () => {
      for (const screenId of Object.keys(afterFirstApply)) {
        const before = afterFirstApply[screenId]
        const after = await rawNodes(screenId)
        if (Buffer.isBuffer(before)) {
          expect(Buffer.isBuffer(after)).toBe(true)
          expect(Buffer.compare(before, after as Buffer)).toBe(0)
        } else {
          expect(after).toEqual(before)
        }
      }
    })

    it('the images it skipped are still counted, not forgotten', () => {
      // The already-sized node is counted on both runs; on the second every
      // node it stamped the first time joins it.
      expect(secondApply.nodesAlreadySized).toBeGreaterThan(
        firstApply.nodesAlreadySized,
      )
      expect(secondApply.missingMedia.length).toBe(firstApply.missingMedia.length)
    })
  })
})
