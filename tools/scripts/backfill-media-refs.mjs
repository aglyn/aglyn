/**
 * Media reference back-fill (AGL-1215).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-media-refs.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * Node props used to persist a URL for a media asset. First a
 * firebasestorage download URL — which names the object's CURRENT location,
 * so a folder move (a physical copy, a rewrite of `url`, and a DELETE of the
 * original) 404s it forever — and then, after this issue's first pass
 * (`b27d96791`), the mediaId-keyed path `/api/media/cdn/{scope}/{mediaId}`.
 * That fixed move-safety and left
 * the document coupled to a ROUTE SHAPE, which is an app concern: changing
 * the route should be a deploy, not a migration over every host.
 *
 * So a prop now stores `media:{scope}/{mediaId}` and the renderer builds the
 * URL. Both legacy forms still render — `resolveMediaSrc` passes any
 * non-reference string through untouched — so this back-fill is a cleanup,
 * not a rescue. What it buys is that the NEXT delivery change needs no
 * migration at all, and that assets referenced by their old raw URL stop
 * being one folder move away from a dead image.
 *
 * Rules:
 *
 * - `/api/media/cdn/{scope}/{mediaId}[/{hash}]` → `media:{scope}/{mediaId}`.
 *   Purely local: the path already carries everything a reference needs. The
 *   content hash is DROPPED on purpose — a reference names the asset, so a
 *   replace propagates instead of 404ing that exact URL by design.
 * - A raw storage URL → a reference only when the media doc it names can be
 *   found AND that doc has a `cdnPath`. No `cdnPath` means the org is not
 *   entitled to `mediaCdn` (or the asset is private), and since the CDN
 *   handler checks the entitlement nowhere, minting a reference would hand
 *   the org paid delivery this script has no business granting. Those are
 *   REPORTED AND LEFT ALONE — they keep rendering exactly as they do today.
 * - A URL that matches no media doc is REPORTED AND SKIPPED. It is an
 *   external hotlink, or an asset deleted out from under the page; guessing
 *   would replace a working image with a 404.
 * - A prop already holding a `media:` reference is skipped, so re-runs are
 *   no-ops and documents are only written when a node actually changed.
 * - `emailImage` nodes are SKIPPED ENTIRELY. Email clients cannot resolve a
 *   relative path, so an absolute storage URL in an email is the only form
 *   that WORKS there; converting it would trade a working image for a broken
 *   one. (The `/api/media/cdn/…` paths the first pass put in emails are
 *   already broken; that is a separate bug and not this script's to paper
 *   over.)
 *
 * Covers, for every host: `screens`, `layouts`, `components` and `templates`
 * — both the parent doc (the published snapshot the tenant renders) and every
 * doc in its `versions` subcollection (what the besigner edits). Missing
 * either half would leave the site and the editor disagreeing.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/**
 * Props the media picker can write and every render surface now resolves.
 * Keep in step with the components that call `resolveMediaSrc` — converting
 * a prop nothing resolves would replace a working URL with a literal
 * `media:…` in an `<img src>`.
 */
const MEDIA_PROPS = ['src', 'poster', 'imageUrl']

/** Components whose `src` must stay an absolute URL — see the header. */
const SKIP_COMPONENT_IDS = new Set(['emailImage'])

const MEDIA_CDN_ROUTE = '/api/media/cdn'
const MEDIA_REF_PREFIX = 'media:'
/** Mirrors `SEGMENT` in libs/aglyn/src/lib/app-utils/media-ref.ts. */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/

/** Mirrors `isMediaCdnScope`. */
function isCdnScope(scope) {
  if (!scope) return false
  if (!scope.startsWith('org:')) return SEGMENT.test(scope)
  const parts = scope.slice('org:'.length).split(':')
  return parts.length >= 1 && parts.length <= 2 && parts.every((p) => SEGMENT.test(p))
}

/** Mirrors `formatMediaRef`. */
function formatMediaRef(scope, mediaId) {
  if (!scope || !mediaId) return undefined
  if (!isCdnScope(scope) || !SEGMENT.test(mediaId)) return undefined
  return `${MEDIA_REF_PREFIX}${scope}/${mediaId}`
}

/** Mirrors `mediaRefFromCdnPath`. */
function refFromCdnPath(value) {
  const marker = `${MEDIA_CDN_ROUTE}/`
  const at = value.indexOf(marker)
  if (at === -1) return undefined
  const [scope, mediaId] = value.slice(at + marker.length).split('/')
  return formatMediaRef(scope, mediaId)
}

/** Mirrors `hostQualifiedCdnPath`'s rule, at the scope level. */
function qualifyScope(scope, visibleTo, hostId) {
  if (!hostId || !scope.startsWith('org:')) return scope
  const orgWide = !Array.isArray(visibleTo) || visibleTo.includes('org')
  if (orgWide) return scope
  return `org:${scope.slice('org:'.length).split(':')[0]}:${hostId}`
}

/**
 * The object path a firebasestorage download URL names, decoded:
 * `https://…/o/hosts%2Fsite-a%2Fmedia%2Fmed123?alt=media&token=…` →
 * `hosts/site-a/media/med123`. Matching on this rather than on the whole URL
 * is what makes a re-issued download token (which rewrites `url`) still line
 * up with the media doc.
 */
function storagePathFromUrl(url) {
  const match = /\/o\/([^?]+)/.exec(url)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

const isStorageUrl = (value) =>
  value.startsWith('https://firebasestorage.googleapis.com/') ||
  value.startsWith('https://storage.googleapis.com/')

/**
 * Everything a host's pages could legitimately point at: its own private
 * library plus its org's shared one. Keyed by exact `url` AND by decoded
 * object path, because either can be what a node happens to hold.
 */
async function buildMediaIndex(hostId) {
  const index = new Map()
  let withCdnPath = 0
  let withoutCdnPath = 0

  const addScope = async (ref, cdnScope) => {
    const media = await ref.collection('media').get()
    for (const doc of media.docs) {
      const data = doc.data()
      if (data['deletedAt']) continue
      // No `cdnPath` = no `mediaCdn` entitlement, or private (AGL-1051).
      // Either way there is no reference to be minted; recorded so the
      // report can say WHY a URL was left alone.
      const hasCdnPath = typeof data['cdnPath'] === 'string' && data['cdnPath']
      if (hasCdnPath) withCdnPath += 1
      else withoutCdnPath += 1
      const entry = {
        mediaId: doc.id,
        cdnScope,
        visibleTo: data['visibleTo'],
        hasCdnPath: Boolean(hasCdnPath),
      }
      const storagePath =
        typeof data['storagePath'] === 'string' && data['storagePath']
          ? data['storagePath']
          : `${ref.path}/media/${doc.id}`
      index.set(`path:${storagePath}`, entry)
      if (typeof data['url'] === 'string' && data['url']) {
        index.set(`url:${data['url']}`, entry)
        const fromUrl = storagePathFromUrl(data['url'])
        if (fromUrl) index.set(`path:${fromUrl}`, entry)
      }
    }
  }

  await addScope(firestore.collection('hosts').doc(hostId), hostId)
  const hostIndex = await firestore.collection('hostIndex').doc(hostId).get()
  const orgId = hostIndex.data()?.['orgId']
  if (typeof orgId === 'string' && orgId) {
    await addScope(firestore.collection('orgs').doc(orgId), `org:${orgId}`)
  }
  return { index, withCdnPath, withoutCdnPath }
}

let docsScanned = 0
let docsWithNodes = 0
let docsChanged = 0
let mediaPropsSeen = 0
let alreadyRefs = 0
let fromCdnPath = 0
let fromStorageUrl = 0
let skippedEmail = 0
let externalUrls = 0
const unresolvedUrls = new Map()
const noCdnPathUrls = new Map()

/** Converts media props in a node map in place. Returns props rewritten. */
function convertNodes(nodes, media, hostId, docPath) {
  let written = 0
  for (const [nodeId, node] of Object.entries(nodes)) {
    const props = node?.props
    if (!props || typeof props !== 'object') continue
    if (SKIP_COMPONENT_IDS.has(node?.componentId)) {
      for (const prop of MEDIA_PROPS) {
        if (typeof props[prop] === 'string' && props[prop]) skippedEmail += 1
      }
      continue
    }
    for (const prop of MEDIA_PROPS) {
      const value = props[prop]
      if (typeof value !== 'string' || !value) continue
      mediaPropsSeen += 1
      if (value.startsWith(MEDIA_REF_PREFIX)) {
        alreadyRefs += 1
        continue
      }
      if (value.includes(`${MEDIA_CDN_ROUTE}/`)) {
        const ref = refFromCdnPath(value)
        if (!ref) {
          unresolvedUrls.set(value, (unresolvedUrls.get(value) ?? 0) + 1)
          console.warn(`  ! unparseable cdn path at ${docPath}#${nodeId}.${prop}`)
          continue
        }
        props[prop] = ref
        fromCdnPath += 1
        written += 1
        continue
      }
      if (!isStorageUrl(value)) {
        // An author-typed hotlink. Supported, and none of our business.
        externalUrls += 1
        continue
      }
      const path = storagePathFromUrl(value)
      const entry =
        media.index.get(`url:${value}`) ??
        (path ? media.index.get(`path:${path}`) : undefined)
      if (!entry) {
        unresolvedUrls.set(value, (unresolvedUrls.get(value) ?? 0) + 1)
        continue
      }
      if (!entry.hasCdnPath) {
        noCdnPathUrls.set(value, (noCdnPathUrls.get(value) ?? 0) + 1)
        continue
      }
      const scope = qualifyScope(entry.cdnScope, entry.visibleTo, hostId)
      const ref = formatMediaRef(scope, entry.mediaId)
      if (!ref) {
        unresolvedUrls.set(value, (unresolvedUrls.get(value) ?? 0) + 1)
        continue
      }
      props[prop] = ref
      fromStorageUrl += 1
      written += 1
    }
  }
  return written
}

/**
 * `nodes` is stored in TWO forms in production and both are live: a plain
 * Firestore map, and msgpack bytes (AGL-1151 compression at rest). Reading
 * the bytes form as a map silently yields a byte object with no `props`
 * anywhere — which reports "0 documents needed changes" and looks exactly
 * like success. Decode by form, and write back in the SAME form so this
 * never rewrites a document's storage representation as a side effect.
 */
function readNodes(raw) {
  if (raw === undefined || raw === null) return null
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      return { form: 'bytes', nodes: decode(bytes) }
    } catch (error) {
      console.warn(`  ! could not decode msgpack nodes: ${error.message}`)
      return null
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { form: 'map', nodes: raw }
  }
  return null
}

function writeNodes(form, nodes) {
  return form === 'bytes' ? Buffer.from(encode(nodes)) : nodes
}

async function processDoc(ref, media, hostId) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return
  docsWithNodes += 1
  // Deep-enough clone: we only ever mutate `node.props`.
  const next = {}
  for (const [id, node] of Object.entries(nodes)) {
    next[id] = { ...node, ...(node?.props ? { props: { ...node.props } } : {}) }
  }
  const written = convertNodes(next, media, hostId, ref.path)
  if (!written) return
  docsChanged += 1
  console.log(
    `${apply ? 'write' : 'would write'} ${String(written).padStart(3)} ref(s)  [${form}]  ${ref.path}`,
  )
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
}

const KINDS = ['screens', 'layouts', 'components', 'templates']

const hosts = onlyHost
  ? [await firestore.collection('hosts').doc(onlyHost).get()]
  : (await firestore.collection('hosts').get()).docs

let mediaDocsWithCdnPath = 0
let mediaDocsWithoutCdnPath = 0

for (const host of hosts) {
  if (!host.exists) {
    console.error(`host ${onlyHost} not found`)
    process.exit(1)
  }
  const media = await buildMediaIndex(host.id)
  mediaDocsWithCdnPath += media.withCdnPath
  mediaDocsWithoutCdnPath += media.withoutCdnPath
  for (const kind of KINDS) {
    const parents = await host.ref.collection(kind).get()
    for (const parent of parents.docs) {
      await processDoc(parent.ref, media, host.id)
      const versions = await parent.ref.collection('versions').get()
      for (const version of versions.docs) {
        await processDoc(version.ref, media, host.id)
      }
    }
  }
}

// Report the intermediate counts, not just the final one. "0 changes" is
// ambiguous on its own — it reads identically whether every prop was already
// a reference and whether the script decoded no nodes at all, which is
// exactly what a map-only reader does against the msgpack documents.
console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${hosts.length} host(s), ` +
    `${mediaDocsWithCdnPath} media doc(s) with a cdnPath / ` +
    `${mediaDocsWithoutCdnPath} without.\n` +
    `scanned ${docsScanned} document(s), ${docsWithNodes} carried nodes, ` +
    `${mediaPropsSeen} media prop(s) found:\n` +
    `  ${alreadyRefs} already reference(s)\n` +
    `  ${fromCdnPath} cdn path(s) → reference\n` +
    `  ${fromStorageUrl} storage URL(s) → reference\n` +
    `  ${externalUrls} external URL(s) left alone\n` +
    `  ${skippedEmail} email-block prop(s) skipped (need an absolute URL)\n` +
    `${docsChanged} document(s) needed changes, ` +
    `${fromCdnPath + fromStorageUrl} prop(s) ${apply ? 'written' : 'pending'}.`,
)
if (noCdnPathUrls.size) {
  console.log(
    `\n${noCdnPathUrls.size} URL(s) name a media doc with NO cdnPath ` +
      '(free-tier org, or a private asset) — left as raw URLs by design:',
  )
  for (const [url, count] of [...noCdnPathUrls].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(count).padStart(4)}×  ${url.slice(0, 120)}`)
  }
}
if (unresolvedUrls.size) {
  console.log(
    `\n${unresolvedUrls.size} storage URL(s) matched no media doc — SKIPPED ` +
      '(deleted asset, or a library this host cannot see):',
  )
  for (const [url, count] of [...unresolvedUrls].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(count).padStart(4)}×  ${url.slice(0, 120)}`)
  }
}
if (!apply) console.log('\nRe-run with --apply to write.')
