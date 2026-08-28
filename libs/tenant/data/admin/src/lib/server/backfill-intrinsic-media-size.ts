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
 * Stamps the intrinsic pixel size of an already-published image onto the node
 * that renders it (AGL-2486).
 *
 * `image.tsx` emits `width`/`height` attributes from `intrinsicWidth` /
 * `intrinsicHeight`, and the besigner's media picker copies them off the
 * media document at PICK time. That fixes every image picked from then on and
 * nothing already on a page: measured on aglyn.com/press, 45 images and not
 * one with a dimension pair. Without the pair an `<img>` laid out as
 * `width: 100%; height: auto` has no height until its bytes decode, so every
 * image shifts the content below it as it lands.
 *
 * ## Why the fix is a backfill rather than a render-time or publish-time read
 *
 * `resolveMediaSrc` is pure string manipulation — no tenant render path reads
 * a media document at all — so resolving dimensions at render adds one
 * Firestore read PER IMAGE to the hottest ISR-cached path. The publish path is
 * the other candidate and is worse: its save-refusal semantics were hardened
 * days before this, and a tree rewrite threaded through them is a much larger
 * change than two numbers per node.
 *
 * ## What it decides, and what it deliberately does not
 *
 * Every rule about WHICH nodes qualify and WHICH values are usable lives in
 * {@link intrinsicMediaSize} and is called, never restated: the both-or-
 * neither pair, the finite-and-positive test, and the component allowlist
 * (a prop written onto an element whose renderer does not read it reaches
 * `...rest` and is spread onto the DOM as an invalid `intrinsicwidth`
 * attribute). This module contributes only the walk, the reads and the write.
 *
 * A node is left exactly as it is when its media document is missing, when
 * that document carries no usable dimensions, when the node already has a
 * usable pair, or when stamping would push the document over the size
 * ceiling. Each of those is counted separately, because "0 changes" from a
 * node migration reads identically whether the corpus has converged or the
 * walk decoded nothing at all.
 *
 * A SOFT-DELETED media document is still resolved. A DAM delete is reversible
 * (AGL-1467) and the pixel dimensions of the file are true either way, so
 * skipping one would leave the node un-backfilled with nothing to say so the
 * day the asset is restored.
 */

import { intrinsicMediaSize } from '@aglyn/aglyn/app-utils/media-metadata'
import { parseMediaRef, type MediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import {
  NODE_MAP_MAX_BYTES,
  nodeMapBytes,
} from '@aglyn/aglyn/app-utils/measure-node-map'
import { compress } from '@aglyn/aglyn/app-utils/compress'
import { decompress } from '@aglyn/aglyn/app-utils/decompress'
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore'

/** Node collections whose documents carry a `nodes` tree. */
export const NODE_KINDS = [
  'screens',
  'layouts',
  'components',
  'templates',
] as const

/**
 * The three ways a `nodes` field is stored, all of them live.
 *
 * `bytes` is the msgpack blob `screenVersionConverter` writes (AGL-1151),
 * materialised by the Admin SDK as a Node `Buffer`. `map` is a plain
 * Firestore map, left behind by any `updateDoc` that bypassed the converter
 * and by the component documents the tenant runtime reads without decoding.
 * `envelope` is `{type:'Buffer', data:[…]}` — what `JSON.stringify` makes of
 * a Buffer, carried by pre-AGL-1391 export bundles and restorable from one.
 */
export type StoredNodesForm = 'map' | 'bytes' | 'envelope'

export interface StoredNodes {
  form: StoredNodesForm
  nodes: Record<string, any>
}

/**
 * A `nodes` field decoded, WITH the form it arrived in.
 *
 * The form is the whole reason this is not `decodeStoredNodes`. A document
 * silently rewritten from bytes to a map — or the reverse — is a far worse
 * outcome than a missing width: the readers that decode by form would each
 * have to be right about a representation nothing asked to change, and the
 * plain form is materially larger, which walks a near-limit document straight
 * into Firestore's ceiling.
 *
 * Returns null for absent and for undecodable alike. A blob this cannot
 * decode must never read as a tree with no images in it.
 */
export function readStoredNodes(raw: unknown): StoredNodes | null {
  if (raw === null || raw === undefined) return null
  if (ArrayBuffer.isView(raw)) {
    return decodeInto('bytes', raw as ArrayBufferView)
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  // The client SDK's `Bytes` wrapper. It cannot reach a server read through
  // the Admin SDK, which materialises a bytes field as a Buffer — carried
  // because a value that walks like a byte string must never fall through to
  // the map branch and come back "unchanged" (AGL-1397).
  const source = raw as { toUint8Array?: unknown; type?: unknown; data?: unknown }
  if (typeof source.toUint8Array === 'function') {
    return decodeInto('bytes', raw as { toUint8Array(): Uint8Array })
  }
  // Exactly two keys, `type === 'Buffer'` and an array `data`. The alternative
  // reading is a node map holding nodes called `type` and `data`, which cannot
  // exist: a node map's values are node objects, so `type` would have to hold
  // the literal string 'Buffer' and `data` an array, in the same document.
  if (
    source.type === 'Buffer' &&
    Array.isArray(source.data) &&
    Object.keys(source).length === 2
  ) {
    return decodeInto('envelope', Uint8Array.from(source.data as number[]))
  }
  return { form: 'map', nodes: raw as Record<string, any> }
}

function decodeInto(
  form: StoredNodesForm,
  bytes: ArrayBufferView | { toUint8Array(): Uint8Array },
): StoredNodes | null {
  try {
    const nodes = decompress<Record<string, any>>(bytes)
    return nodes && typeof nodes === 'object' ? { form, nodes } : null
  } catch (error) {
    console.error('could not decode stored nodes', error)
    return null
  }
}

/** The value to write back, in the form the document already used. */
export function writeStoredNodes(
  form: StoredNodesForm,
  nodes: Record<string, any>,
): unknown {
  if (form === 'map') return nodes
  const bytes = compress(nodes)
  return form === 'envelope'
    ? { type: 'Buffer', data: Array.from(bytes) }
    : Buffer.from(bytes)
}

/**
 * Whether this element's renderer reads an intrinsic pair at all.
 *
 * Asked of {@link intrinsicMediaSize} rather than of a second copy of its
 * allowlist: a sentinel pair that is finite and positive passes every other
 * gate the function has, so a non-empty answer means the component id and the
 * prop name were accepted. Keeping the question here would be a second place
 * for the list to be wrong, and the failure that causes is invisible until it
 * is in a customer's published HTML.
 */
function stampsIntrinsicSize(componentId: unknown): boolean {
  const probe = intrinsicMediaSize({
    componentId,
    propName: 'src',
    assetWidth: 1,
    assetHeight: 1,
  })
  return probe.intrinsicWidth !== undefined
}

/** Whether the node already carries a pair this backfill would accept. */
function alreadySized(componentId: unknown, props: Record<string, any>): boolean {
  const existing = intrinsicMediaSize({
    componentId,
    propName: 'src',
    assetWidth: props['intrinsicWidth'],
    assetHeight: props['intrinsicHeight'],
  })
  return existing.intrinsicWidth !== undefined
}

/**
 * The two fields read off a media document. Untyped because upload-time
 * capture is best-effort — absent, zero and a partial capture are all
 * ordinary, and {@link intrinsicMediaSize} is what decides between them.
 */
export interface MediaSize {
  width?: unknown
  height?: unknown
}

/**
 * The distinct media DOCUMENTS a tree would need read, keyed by their path.
 *
 * Keyed by the resolved path rather than by the stored string on purpose: the
 * same asset is addressed as `media:org:{orgId}/{id}` on one node and
 * `media:org:{orgId}:{hostId}/{id}` on another — the trailing host narrows
 * delivery, not which document holds the file — so keying on the stored value
 * would read one document twice for one asset. One asset placed eight times
 * across a page is one read either way.
 *
 * Only references on a node that would actually be stamped are collected.
 * Gating here rather than after the read is what keeps a page full of `video`
 * posters and `avatar` sources from costing a media read each.
 */
export function pendingMediaRefs(
  nodes: Record<string, any>,
): Map<string, MediaRef> {
  const refs = new Map<string, MediaRef>()
  for (const node of Object.values(nodes)) {
    const props = node?.props
    if (!props || typeof props !== 'object') continue
    if (!stampsIntrinsicSize(node?.componentId)) continue
    if (alreadySized(node?.componentId, props)) continue
    const parsed = parseMediaRef(props['src'])
    if (parsed) refs.set(mediaDocPath(parsed), parsed)
  }
  return refs
}

export interface DocumentPlan {
  /** The tree to write, or null when nothing about it changed. */
  nodes: Record<string, any> | null
  /** Nodes that gained a pair. */
  stamped: number
  /** Nodes skipped because they already carry a usable pair. */
  alreadySized: number
  /** References whose media document does not exist. */
  missingMedia: string[]
  /** References whose media document carries no usable dimension pair. */
  unsizedMedia: string[]
  /** Zero for a document nothing would change — it is never measured. */
  bytesBefore: number
  bytesAfter: number
  bytesAdded: number
  /**
   * The stamped tree would cross the refuse threshold, so the document is
   * reported and left alone.
   */
  tooLarge: boolean
}

/**
 * Plan one document from an already-resolved size lookup, keyed by the media
 * document PATH — see {@link pendingMediaRefs} for why that rather than the
 * stored reference string.
 *
 * Pure, so the size arithmetic and every leave-it-alone branch are assertable
 * without Firestore.
 *
 * ## The ceiling
 *
 * Version documents run close to Firestore's limit — the aglyn.com Press tree
 * measures 717,829 bytes against a 900,000-byte refuse threshold and a
 * 1,048,576-byte hard limit — and two numbers per image is growth, however
 * small. So the stamped tree is measured before anything is written and a
 * document the addition would push past {@link NODE_MAP_MAX_BYTES} is
 * REPORTED rather than written. Bricking a large page is a worse outcome than
 * leaving it without dimensions, and failing the whole run over one document
 * is worse than both.
 *
 * The threshold is the besigner's own refuse threshold, measured with the
 * same msgpack encoder its save path measures with, so the backfill and the
 * editor cannot disagree about which documents are too big. That threshold
 * sits ~148 KB under the hard limit deliberately, which is also the headroom
 * that covers a plain-map document occupying somewhat more in Firestore than
 * its msgpack measure.
 */
export function planIntrinsicMediaSize(
  nodes: Record<string, any>,
  sizes: ReadonlyMap<string, MediaSize | null>,
): DocumentPlan {
  const missingMedia = new Set<string>()
  const unsizedMedia = new Set<string>()
  let stamped = 0
  let alreadyCount = 0
  const next: Record<string, any> = { ...nodes }

  for (const [nodeId, node] of Object.entries(nodes)) {
    const props = node?.props
    if (!props || typeof props !== 'object') continue
    const componentId = node?.componentId
    if (!stampsIntrinsicSize(componentId)) continue
    if (alreadySized(componentId, props)) {
      alreadyCount += 1
      continue
    }
    const src = props['src']
    const parsed = parseMediaRef(src)
    if (!parsed) continue
    const size = sizes.get(mediaDocPath(parsed))
    if (size === undefined || size === null) {
      // Reported by the STORED reference rather than the resolved path: that
      // is the string sitting in the document a person would go and look at.
      missingMedia.add(src as string)
      continue
    }
    const pair = intrinsicMediaSize({
      componentId,
      propName: 'src',
      assetWidth: size.width,
      assetHeight: size.height,
    })
    if (pair.intrinsicWidth === undefined) {
      // The asset's own dimensions are absent, zero or a partial capture.
      // Upload-time capture is best-effort, so this is ordinary; writing a
      // zero would collapse the element, and writing one of the two would
      // give the browser a dimension rather than a ratio.
      unsizedMedia.add(src as string)
      continue
    }
    next[nodeId] = { ...node, props: { ...props, ...pair } }
    stamped += 1
  }

  // Measured only when there is something to write. Encoding every tree in
  // the corpus twice to report a zero would be the most expensive thing this
  // does, and nothing reads the number for a document it leaves alone.
  if (!stamped) {
    return {
      nodes: null,
      stamped: 0,
      alreadySized: alreadyCount,
      missingMedia: [...missingMedia],
      unsizedMedia: [...unsizedMedia],
      bytesBefore: 0,
      bytesAfter: 0,
      bytesAdded: 0,
      tooLarge: false,
    }
  }
  const bytesBefore = nodeMapBytes(nodes)
  const bytesAfter = nodeMapBytes(next)
  const tooLarge = bytesAfter > NODE_MAP_MAX_BYTES
  return {
    nodes: tooLarge ? null : next,
    stamped,
    alreadySized: alreadyCount,
    missingMedia: [...missingMedia],
    unsizedMedia: [...unsizedMedia],
    bytesBefore,
    bytesAfter,
    bytesAdded: bytesAfter - bytesBefore,
    tooLarge,
  }
}

/**
 * The media document a stored reference names.
 *
 * `org:{orgId}` and `org:{orgId}:{hostId}` both address the ORG library — the
 * trailing host in the qualified form narrows visibility at delivery, not
 * which document holds the asset — and a bare scope is a host's own library.
 */
export function mediaDocPath(ref: MediaRef): string {
  if (!ref.scope.startsWith('org:')) {
    return `hosts/${ref.scope}/media/${ref.mediaId}`
  }
  const orgId = ref.scope.slice('org:'.length).split(':')[0]
  return `orgs/${orgId}/media/${ref.mediaId}`
}

/** How many document references one `getAll` asks for. */
const MEDIA_READ_CHUNK = 200

/**
 * Resolve a document's distinct references in ONE batched read per chunk,
 * never one read per image, and remember the answers for the rest of the run.
 *
 * The cache is keyed by the stored reference string and holds negatives too:
 * a reference to a deleted asset appears on every page that used it, and
 * re-reading a document already known to be absent is the same cost as
 * reading one that exists.
 */
async function resolveMediaSizes(
  firestore: Firestore,
  refs: Map<string, MediaRef>,
  cache: Map<string, MediaSize | null>,
): Promise<{ reads: number; batches: number }> {
  const wanted = [...refs.keys()].filter((path) => !cache.has(path))
  let reads = 0
  let batches = 0
  for (let at = 0; at < wanted.length; at += MEDIA_READ_CHUNK) {
    const chunk = wanted.slice(at, at + MEDIA_READ_CHUNK)
    const docs = chunk.map((path) => firestore.doc(path)) as DocumentReference[]
    // Only the two fields this needs. A media document carries variants,
    // tags and custom metadata that no part of this decision reads.
    const snapshots = await firestore.getAll(...docs, {
      fieldMask: ['width', 'height'],
    })
    batches += 1
    reads += docs.length
    snapshots.forEach((snapshot: DocumentSnapshot, index: number) => {
      cache.set(
        chunk[index],
        snapshot.exists
          ? { width: snapshot.get('width'), height: snapshot.get('height') }
          : null,
      )
    })
  }
  return { reads, batches }
}

export interface SizeRefusal {
  path: string
  images: number
  bytesBefore: number
  bytesAfter: number
}

export interface BackfillReport {
  apply: boolean
  hostsScanned: number
  docsScanned: number
  docsWithNodes: number
  /** Documents seen per storage form — a zero here explains a zero below. */
  forms: Record<StoredNodesForm, number>
  /** Media documents read, and the batched reads that fetched them. */
  mediaReads: number
  mediaBatches: number
  nodesStamped: number
  nodesAlreadySized: number
  docsChanged: number
  bytesAdded: number
  /** Documents the addition would push past the refuse threshold. */
  refusedForSize: SizeRefusal[]
  /** References whose media document does not exist, with where they sit. */
  missingMedia: Array<{ path: string; ref: string }>
  /** References whose media document carries no usable dimension pair. */
  unsizedMedia: Array<{ path: string; ref: string }>
  /**
   * Documents that changed underneath the run between the read and the write.
   * The write is refused rather than applied — a node blob written from a
   * snapshot taken seconds ago would discard whatever the besigner saved in
   * between.
   */
  contended: string[]
  /** Documents whose `nodes` field could not be decoded. */
  undecodable: string[]
}

export interface BackfillOptions {
  firestore: Firestore
  /** Writes only with this set. Dry run otherwise. */
  apply?: boolean
  /** Limit the walk to one site. */
  hostId?: string
  log?: (line: string) => void
}

const emptyReport = (apply: boolean): BackfillReport => ({
  apply,
  hostsScanned: 0,
  docsScanned: 0,
  docsWithNodes: 0,
  forms: { map: 0, bytes: 0, envelope: 0 },
  mediaReads: 0,
  mediaBatches: 0,
  nodesStamped: 0,
  nodesAlreadySized: 0,
  docsChanged: 0,
  bytesAdded: 0,
  refusedForSize: [],
  missingMedia: [],
  unsizedMedia: [],
  contended: [],
  undecodable: [],
})

/**
 * Walk every node document and stamp what can be stamped.
 *
 * Dry run unless `apply` is set: the report a dry run produces is the report
 * the real run then produces, built by the same code rather than by a second
 * list.
 *
 * Writes are per document and never batched. A `nodes` blob is most of a
 * document, so four hundred of them in one `WriteBatch` is a commit far past
 * what Firestore accepts; the batching that matters here is the media READS,
 * which is where the per-image cost would otherwise be.
 *
 * Each write carries a `lastUpdateTime` precondition. The besigner saves into
 * these documents live, and an unconditional `update` built from a snapshot
 * taken seconds ago replaces the whole tree — so a document that moved is
 * refused and reported instead of silently reverted.
 */
export async function backfillIntrinsicMediaSize(
  options: BackfillOptions,
): Promise<BackfillReport> {
  const { firestore, hostId } = options
  const apply = options.apply === true
  const log = options.log ?? (() => undefined)
  const report = emptyReport(apply)
  const cache = new Map<string, MediaSize | null>()

  const hosts = hostId
    ? [await firestore.collection('hosts').doc(hostId).get()]
    : (await firestore.collection('hosts').get()).docs

  for (const host of hosts) {
    if (!host.exists) {
      throw new Error(`host ${hostId} not found`)
    }
    report.hostsScanned += 1
    for (const kind of NODE_KINDS) {
      const parents = await host.ref.collection(kind).select('nodes').get()
      for (const parent of parents.docs) {
        // The parent document is the PUBLISHED snapshot the tenant renders
        // and the versions are what the besigner edits. Doing one without the
        // other would leave the live page and the editor disagreeing about
        // the same image.
        await processDocument(firestore, parent, cache, apply, report, log)
        const versions = await parent.ref
          .collection('versions')
          .select('nodes')
          .get()
        for (const version of versions.docs) {
          await processDocument(firestore, version, cache, apply, report, log)
        }
      }
    }
  }
  return report
}

async function processDocument(
  firestore: Firestore,
  snapshot: DocumentSnapshot,
  cache: Map<string, MediaSize | null>,
  apply: boolean,
  report: BackfillReport,
  log: (line: string) => void,
): Promise<void> {
  report.docsScanned += 1
  const raw = snapshot.get('nodes')
  if (raw === null || raw === undefined) return
  const stored = readStoredNodes(raw)
  if (!stored) {
    report.undecodable.push(snapshot.ref.path)
    return
  }
  report.docsWithNodes += 1
  report.forms[stored.form] += 1

  const refs = pendingMediaRefs(stored.nodes)
  if (refs.size) {
    const { reads, batches } = await resolveMediaSizes(firestore, refs, cache)
    report.mediaReads += reads
    report.mediaBatches += batches
  }
  const plan = planIntrinsicMediaSize(stored.nodes, cache)
  report.nodesAlreadySized += plan.alreadySized
  for (const ref of plan.missingMedia) {
    report.missingMedia.push({ path: snapshot.ref.path, ref })
  }
  for (const ref of plan.unsizedMedia) {
    report.unsizedMedia.push({ path: snapshot.ref.path, ref })
  }
  if (plan.tooLarge) {
    report.refusedForSize.push({
      path: snapshot.ref.path,
      images: plan.stamped,
      bytesBefore: plan.bytesBefore,
      bytesAfter: plan.bytesAfter,
    })
    log(
      `  SKIP (size)  ${snapshot.ref.path} — ${plan.stamped} image(s) would ` +
        `take it from ${plan.bytesBefore} to ${plan.bytesAfter} bytes, past ` +
        `the ${NODE_MAP_MAX_BYTES}-byte refuse threshold`,
    )
    return
  }
  if (!plan.nodes) return

  report.nodesStamped += plan.stamped
  report.docsChanged += 1
  report.bytesAdded += plan.bytesAdded
  log(
    `  ${apply ? 'write' : 'would write'} ${String(plan.stamped).padStart(3)} ` +
      `image(s)  [${stored.form}]  +${plan.bytesAdded} bytes  ` +
      snapshot.ref.path,
  )
  if (!apply) return
  try {
    await snapshot.ref.update(
      { nodes: writeStoredNodes(stored.form, plan.nodes) },
      { lastUpdateTime: snapshot.updateTime },
    )
  } catch (error) {
    // A failed precondition means the document moved between the read and the
    // write. Anything else is a real write failure and must not be swallowed.
    if ((error as { code?: number }).code !== 9) throw error
    report.contended.push(snapshot.ref.path)
    report.docsChanged -= 1
    report.nodesStamped -= plan.stamped
    report.bytesAdded -= plan.bytesAdded
    log(`  SKIP (changed under us)  ${snapshot.ref.path}`)
  }
}

/** The run summary, as one block a person reads before deciding to apply. */
export function formatBackfillReport(report: BackfillReport): string {
  const lines = [
    `\n${report.apply ? 'APPLIED' : 'DRY RUN'} — ${report.hostsScanned} host(s), ` +
      `${report.docsScanned} document(s) scanned, ${report.docsWithNodes} ` +
      `carried nodes (${report.forms.map} map, ${report.forms.bytes} msgpack, ` +
      `${report.forms.envelope} envelope).`,
    `  ${report.mediaReads} media document(s) read in ${report.mediaBatches} ` +
      'batched read(s).',
    `  ${report.nodesStamped} image(s) ${report.apply ? 'stamped' : 'to stamp'} ` +
      `across ${report.docsChanged} document(s), +${report.bytesAdded} bytes.`,
    `  ${report.nodesAlreadySized} image(s) already carried a pair.`,
  ]
  if (report.refusedForSize.length) {
    lines.push(
      `\n${report.refusedForSize.length} document(s) REFUSED for size — left ` +
        'exactly as they are, so no page is bricked by this run:',
    )
    for (const item of report.refusedForSize) {
      lines.push(
        `  ${item.path} — ${item.images} image(s), ` +
          `${item.bytesBefore} → ${item.bytesAfter} bytes`,
      )
    }
  }
  if (report.missingMedia.length) {
    lines.push(
      `\n${report.missingMedia.length} reference(s) name a media document ` +
        'that does not exist. The image is already broken on the page; ' +
        'nothing here can size it:',
    )
    for (const item of report.missingMedia.slice(0, 20)) {
      lines.push(`  ${item.path} → ${item.ref}`)
    }
    if (report.missingMedia.length > 20) {
      lines.push(`  … and ${report.missingMedia.length - 20} more`)
    }
  }
  if (report.unsizedMedia.length) {
    lines.push(
      `\n${report.unsizedMedia.length} reference(s) resolve to a media ` +
        'document with no usable width/height. Upload-time capture is ' +
        'best-effort; these need the dimensions on the ASSET first:',
    )
    for (const item of report.unsizedMedia.slice(0, 20)) {
      lines.push(`  ${item.path} → ${item.ref}`)
    }
    if (report.unsizedMedia.length > 20) {
      lines.push(`  … and ${report.unsizedMedia.length - 20} more`)
    }
  }
  if (report.contended.length) {
    lines.push(
      `\n${report.contended.length} document(s) changed between the read and ` +
        'the write and were LEFT ALONE. Re-run to pick them up:',
    )
    for (const path of report.contended) lines.push(`  ${path}`)
  }
  if (report.undecodable.length) {
    lines.push(
      `\n${report.undecodable.length} document(s) carry a \`nodes\` field ` +
        'this could not decode. NOT counted as having no images:',
    )
    for (const path of report.undecodable) lines.push(`  ${path}`)
  }
  return lines.join('\n')
}
