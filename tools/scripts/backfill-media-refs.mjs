/**
 * Media reference back-fill (AGL-1215).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-media-refs.mjs \
 *     [--apply] [--host=<hostId>] [--fields-only]
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
 *   found AND the org is entitled to `mediaCdn`. The CDN handler checks the
 *   entitlement nowhere (AGL-1409 — the gate is at write time), so minting a
 *   reference for an unentitled org would hand it paid delivery this script
 *   has no business granting.
 * - A URL that matches no media doc is REPORTED AND SKIPPED. It is an
 *   external hotlink, or an asset deleted out from under the page; guessing
 *   would replace a working image with a 404.
 *
 * ## `cdnPath` is EVIDENCE of the entitlement, not the entitlement (AGL-1407)
 *
 * The first version of that rule read `cdnPath` on the media doc and treated
 * its absence as "not entitled". That is wrong for the oldest assets, and the
 * way it is wrong is the shape worth remembering: a conversion that gates on
 * a field its targets LACK declines exactly the documents it was written for,
 * changes nothing, and reports success.
 *
 * It is what happened here. `seo.favicon` on two hosts — one of them a
 * customer site leaking its own bucket path — names assets uploaded before
 * `mediaCdnPathUpdate` existed, so neither carries a `cdnPath`. Both orgs are
 * entitled (`starter` and `enterprise` both include `mediaCdn`; only `free`
 * does not), and both objects are served by `/api/media/cdn/…` today, because
 * `serveMediaCdn` reads `storagePath` and never looks at `cdnPath` at all.
 *
 * So the entitlement is established from the org rather than from the one
 * asset: a live media doc anywhere in the scope this host can see — its own
 * library or its org's — that carries a `cdnPath` is `mediaCdnPathUpdate`'s
 * own output, and proves the gate ran and said yes for that ORG, which is the
 * unit `checkEntitlement` decides on. With the entitlement proven, the path
 * for an asset lacking one is DERIVED (`/api/media/cdn/{scope}/{mediaId}` —
 * the same string `mediaCdnPathUpdate` would have minted).
 *
 * This never grants delivery the real gate withheld: an org with no `cdnPath`
 * anywhere is declined, and so is a `private` asset, whose missing path is the
 * mechanism keeping it out of pickers and pages rather than a plan decision.
 *
 * ## Every decline is NAMED
 *
 * A value this script leaves alone is reported with the DOCUMENT and FIELD it
 * sits in and the reason, not merely rolled up by URL. Silence is what let the
 * favicon leg look done; a run that declines something must be unable to be
 * read as a run that had nothing to do.
 * - A prop already holding a `media:` reference is skipped, so re-runs are
 *   no-ops and documents are only written when a node actually changed.
 * - `emailImage` nodes are STILL SKIPPED, but no longer because they must be.
 *   The original reason — an email client cannot resolve a relative path, so
 *   an absolute storage URL was the only form that worked in an inbox — was
 *   fixed at the render end by AGL-1224: `renderEmailHtml` now resolves a
 *   reference and absolutizes it against the sending site's own origin, and
 *   both send paths supply one. Converting these would additionally fix the
 *   AGL-1215 folder-move 404 for email images, which is the whole point of
 *   this script.
 *
 *   Lifting the skip is a DATA decision rather than a code one, so it is left
 *   to a deliberate run: the one case it would regress is a host with neither
 *   a custom domain nor a subdomain, whose images render today from an
 *   absolute storage URL and would be dropped instead. Check that no host in
 *   scope is originless before removing `emailImage` from SKIP_COMPONENT_IDS.
 *
 * Covers, for every host: `screens`, `layouts`, `components` and `templates`
 * — both the parent doc (the published snapshot the tenant renders) and every
 * doc in its `versions` subcollection (what the besigner edits). Missing
 * either half would leave the site and the editor disagreeing.
 *
 * ## Document FIELDS (AGL-1407)
 *
 * A media value is not always a node prop. `coverImage` on a collection entry
 * and `logoUrl` on the host document hold one too, and they were left out of
 * the first pass for a reason that has since been removed: their render paths
 * did not call `resolveMediaSrc`, so a reference would have reached an
 * `<img src>` as the literal string `media:…` — or, in the collection
 * fallback, failed a `^https?://` gate and dropped the cover block off the
 * page silently. Both now resolve, so the data can follow.
 *
 * `--fields-only` runs ONLY these passes and never opens a node document.
 * That is not a convenience: the besigner writes screen versions live, and a
 * field conversion has no business rewriting a `nodes` blob somebody is
 * editing. Converting fields is a different job from converting nodes, so it
 * gets a switch rather than a comment asking the operator to be careful.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const fieldsOnly = process.argv.includes('--fields-only')
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

/**
 * `hosts/{host}/collections/{collection}/entries/{entry}` (AGL-1407).
 *
 * Entries have NO `versions` subcollection — the besigner's version model is
 * for node documents, and an entry is edited in place — so unlike the node
 * walk this one is a single level deep.
 */
const ENTRY_MEDIA_FIELDS = ['coverImage']

/**
 * `hosts/{host}` (AGL-1407). Three surfaces read `logoUrl` and all three
 * resolve a reference: the tenant layout's navigation loader, the client
 * brand block, and the PWA manifest icon.
 *
 * `seo.favicon` joined them once its two readers learned to resolve —
 * `favicon-card.component.tsx` and `host-icon.component.tsx`, which handed the
 * stored string straight to an `<img src>` / `<Avatar src>` and would have
 * shown a broken tile in the site switcher and the sites list the moment the
 * data changed underneath them. It is written as a DOTTED path because that is
 * what `snapshot.get` reads and what `update` treats as a nested field; a
 * `set(…, {merge:true})` with the same key would create a literal field called
 * `seo.favicon` beside the real one.
 *
 * No tenant surface renders the favicon — the app emits no `<link rel="icon">`
 * — but the host document is serialized into the page payload, so the raw URL
 * is on every rendered HTML route regardless, which is the bucket-path
 * exposure this converts away.
 */
const HOST_MEDIA_FIELDS = ['logoUrl', 'seo.favicon']

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
 * The index key that survives a FOLDER MOVE — `orgs/{org}/media` (or
 * `hosts/{host}/media`) plus the media id, with the folders between them
 * discarded.
 *
 * This is the AGL-1215 failure itself, found in the wild on the marketing
 * site: `hosts/DXnRbPH4CQ.logoUrl` names `orgs/jWmGooWE3L/media/hWwBgGtkiM`,
 * the asset was later filed under `brand/`, and the move copied the object,
 * rewrote `url` and DELETED the original. The stored URL now 401s. Matching
 * on the exact path or the exact `url` — the only two things this script knew
 * — reports it as "matched no media doc" and leaves a dead URL on a live site
 * forever, which is the one outcome the whole reference scheme exists to
 * prevent.
 *
 * The last path segment of a media object IS the media doc id; that is the
 * upload convention, not a guess, and everything before it is folders. So the
 * id is recoverable from a stale path even when nothing else about it is
 * still true.
 *
 * Deliberately anchored to the LIBRARY ROOT rather than matching an id
 * anywhere: a URL naming another org's bucket path must not resolve against
 * this host's library just because the trailing segment collides. And it is
 * the last lookup tried, so an asset whose exact path still matches is never
 * decided by this weaker rule.
 *
 * It does NOT loosen the `cdnPath` gate. The doc still has to exist, still
 * has to be in a library this host can see, and still has to carry a
 * `cdnPath` — this only changes WHICH doc a stale URL is recognised as.
 */
const movedKey = (libraryRoot, mediaId) => `moved:${libraryRoot}/media/${mediaId}`

/** The `movedKey` a stored object path implies, if it looks like one. */
function movedKeyFromPath(path) {
  const at = path.indexOf('/media/')
  if (at <= 0) return null
  const mediaId = path.slice(path.lastIndexOf('/') + 1)
  if (!mediaId || !SEGMENT.test(mediaId)) return null
  return movedKey(path.slice(0, at), mediaId)
}

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
      // A `cdnPath` is `mediaCdnPathUpdate`'s output, so one anywhere in this
      // host's reachable scope PROVES the org holds `mediaCdn` — see the
      // header. Its absence on a single asset proves nothing on its own:
      // assets predating AGL-1051 never had one minted.
      const hasCdnPath = typeof data['cdnPath'] === 'string' && data['cdnPath']
      if (hasCdnPath) withCdnPath += 1
      else withoutCdnPath += 1
      const entry = {
        mediaId: doc.id,
        cdnScope,
        visibleTo: data['visibleTo'],
        hasCdnPath: Boolean(hasCdnPath),
        // A private asset's missing `cdnPath` IS the mechanism keeping it out
        // of pickers and pages, not a plan decision — never derive one.
        private: data['private'] === true,
      }
      const storagePath =
        typeof data['storagePath'] === 'string' && data['storagePath']
          ? data['storagePath']
          : `${ref.path}/media/${doc.id}`
      index.set(`path:${storagePath}`, entry)
      // The MOVED key: this library's root plus the media id, with whatever
      // folders sit between them thrown away. See `movedKey`.
      index.set(movedKey(ref.path, doc.id), entry)
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
  // The entitlement, established from the org rather than from one asset.
  // Deliberately counted across BOTH libraries: `mediaCdnPathUpdate` gates on
  // the ORG billing doc, so evidence in the org library settles the question
  // for a host whose own library happens to hold only legacy uploads — which
  // is exactly the customer site this reopened on.
  return { index, withCdnPath, withoutCdnPath, cdnEntitled: withCdnPath > 0 }
}

let docsScanned = 0
let docsWithNodes = 0
let docsChanged = 0
let entriesScanned = 0
let entryDocsChanged = 0
let hostDocsChanged = 0
let skippedEmail = 0

/**
 * Every value this script refuses to convert, each with the DOCUMENT and
 * FIELD it sits in and the reason (AGL-1407).
 *
 * Previously a URL→count rollup, which cannot answer the only question that
 * matters after a run that changed nothing: *which document did you decline,
 * and why*. The favicon leg survived a run reported as successful because a
 * decline was a number in a list of URLs rather than a named document.
 */
const declined = []
const decline = (where, value, reason) => {
  declined.push({ where, value, reason })
  return undefined
}

/**
 * Counted separately per surface so "0 changes" stays readable. A node pass
 * that has already converged and a field pass that never ran produce the same
 * total, and only the split says which happened.
 */
const newStats = () => ({
  seen: 0,
  alreadyRefs: 0,
  fromCdnPath: 0,
  fromStorageUrl: 0,
  external: 0,
  /** Of `fromStorageUrl`, the ones matched by `movedKey` — a dead URL made live. */
  movedAssets: 0,
  /**
   * Of `fromStorageUrl`, the ones whose media doc carries NO `cdnPath` and
   * whose path was DERIVED from the org's proven entitlement. Counted apart
   * because it is the one branch that mints a path nothing wrote down, and a
   * supervised run has to see how many of those it is about to create.
   */
  derivedCdnPath: 0,
})
const nodeStats = newStats()
const fieldStats = newStats()
const written = (stats) => stats.fromCdnPath + stats.fromStorageUrl

/**
 * The ONE conversion rule, for a single stored value.
 *
 * Node props and document fields reach it by different walks and must not
 * reach it by different rules. The entitlement gate below is the whole reason
 * this script is safe to point at production — a raw URL means free-tier, or
 * private, or pre-AGL-1215 legacy, and only the media doc and its org separate
 * them — so a second copy of that decision is a second place for it to be
 * wrong.
 *
 * Returns the reference to store, or undefined to leave the value alone.
 * EVERY "leave it alone" branch calls `decline` with the document, the field
 * and the reason. A branch that returns undefined without one is the bug this
 * function was reopened for.
 */
function convertValue(value, stats, media, hostId, where) {
  stats.seen += 1
  if (value.startsWith(MEDIA_REF_PREFIX)) {
    stats.alreadyRefs += 1
    return undefined
  }
  if (value.includes(`${MEDIA_CDN_ROUTE}/`)) {
    const ref = refFromCdnPath(value)
    if (!ref) {
      console.warn(`  ! unparseable cdn path at ${where}`)
      return decline(where, value, 'unparseable /api/media/cdn path')
    }
    stats.fromCdnPath += 1
    return ref
  }
  if (!isStorageUrl(value)) {
    // An author-typed hotlink. Supported, and none of our business.
    stats.external += 1
    return undefined
  }
  const path = storagePathFromUrl(value)
  const movedFrom = path ? movedKeyFromPath(path) : null
  let entry =
    media.index.get(`url:${value}`) ??
    (path ? media.index.get(`path:${path}`) : undefined)
  if (!entry && movedFrom) {
    entry = media.index.get(movedFrom)
    if (entry) {
      stats.movedAssets += 1
      console.warn(
        `  ~ ${where}: the object this URL names is GONE (the asset moved ` +
          `folders); matched \`${entry.mediaId}\` by id`,
      )
    }
  }
  if (!entry) {
    return decline(
      where,
      value,
      'matched no media doc (deleted asset, or a library this host cannot see)',
    )
  }
  if (!entry.hasCdnPath) {
    // The asset carries no `cdnPath`. That is a REFUSAL only when the org has
    // no `mediaCdn`, or the asset is private — see the header. Otherwise it is
    // an asset older than `mediaCdnPathUpdate`, and the path it would have
    // been given is derivable, which is what `serveMediaCdn` serves it from
    // today anyway (it reads `storagePath` and never consults `cdnPath`).
    if (entry.private) {
      return decline(
        where,
        value,
        `\`${entry.mediaId}\` is PRIVATE — a reference would publish it`,
      )
    }
    if (!media.cdnEntitled) {
      return decline(
        where,
        value,
        `no cdnPath on \`${entry.mediaId}\` and NONE anywhere in this org — ` +
          'no mediaCdn entitlement to derive one from',
      )
    }
    stats.derivedCdnPath += 1
    console.warn(
      `  ~ ${where}: \`${entry.mediaId}\` predates cdnPath minting; DERIVED ` +
        'one (the org is entitled — it has cdnPaths on other assets)',
    )
  }
  const scope = qualifyScope(entry.cdnScope, entry.visibleTo, hostId)
  const ref = formatMediaRef(scope, entry.mediaId)
  if (!ref) {
    return decline(
      where,
      value,
      `\`${entry.mediaId}\` in scope \`${scope}\` does not form a reference ` +
        'the CDN would accept',
    )
  }
  stats.fromStorageUrl += 1
  return ref
}

/** Converts media props in a node map in place. Returns props rewritten. */
function convertNodes(nodes, media, hostId, docPath) {
  let count = 0
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
      const ref = convertValue(
        value,
        nodeStats,
        media,
        hostId,
        `${docPath}#${nodeId}.${prop}`,
      )
      if (!ref) continue
      props[prop] = ref
      count += 1
    }
  }
  return count
}

/**
 * Media-bearing FIELDS on one document (AGL-1407).
 *
 * Writes only the fields that changed, through `update` with explicit keys —
 * never a whole-document `set`, which would take the rest of the document
 * from a snapshot read seconds ago and undo any concurrent edit to it.
 */
async function processFields(snapshot, fields, stats, media, hostId) {
  const update = {}
  for (const field of fields) {
    const value = snapshot.get(field)
    if (typeof value !== 'string' || !value) continue
    const ref = convertValue(
      value,
      stats,
      media,
      hostId,
      `${snapshot.ref.path}.${field}`,
    )
    if (ref) update[field] = ref
  }
  const changed = Object.keys(update)
  if (!changed.length) return false
  console.log(
    `${apply ? 'write' : 'would write'} ${String(changed.length).padStart(3)} ` +
      `ref(s)  [${changed.join(',')}]  ${snapshot.ref.path}`,
  )
  if (apply) await snapshot.ref.update(update)
  return true
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
  const count = convertNodes(next, media, hostId, ref.path)
  if (!count) return
  docsChanged += 1
  console.log(
    `${apply ? 'write' : 'would write'} ${String(count).padStart(3)} ref(s)  [${form}]  ${ref.path}`,
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
  if (!fieldsOnly) {
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
  // Collection entries (AGL-1407). Soft-deleted ones are converted too: the
  // conversion names the same asset either way, and skipping them would put a
  // raw URL back on the page the day someone restores a post.
  for (const collection of (await host.ref.collection('collections').get()).docs) {
    for (const entry of (await collection.ref.collection('entries').get()).docs) {
      entriesScanned += 1
      if (await processFields(entry, ENTRY_MEDIA_FIELDS, fieldStats, media, host.id)) {
        entryDocsChanged += 1
      }
    }
  }
  if (await processFields(host, HOST_MEDIA_FIELDS, fieldStats, media, host.id)) {
    hostDocsChanged += 1
  }
}

// Report the intermediate counts, not just the final one. "0 changes" is
// ambiguous on its own — it reads identically whether every prop was already
// a reference and whether the script decoded no nodes at all, which is
// exactly what a map-only reader does against the msgpack documents.
const breakdown = (stats) =>
  `  ${stats.alreadyRefs} already reference(s)\n` +
  `  ${stats.fromCdnPath} cdn path(s) → reference\n` +
  `  ${stats.fromStorageUrl} storage URL(s) → reference` +
  (stats.movedAssets
    ? ` (${stats.movedAssets} of them DEAD — the asset had moved folders)\n`
    : '\n') +
  (stats.derivedCdnPath
    ? `    of which ${stats.derivedCdnPath} had NO cdnPath — DERIVED from ` +
      'the org entitlement\n'
    : '') +
  `  ${stats.external} external URL(s) left alone\n`

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${hosts.length} host(s), ` +
    `${mediaDocsWithCdnPath} media doc(s) with a cdnPath / ` +
    `${mediaDocsWithoutCdnPath} without.\n` +
    (fieldsOnly
      ? 'node documents SKIPPED (--fields-only).\n'
      : `scanned ${docsScanned} node document(s), ${docsWithNodes} carried nodes, ` +
        `${nodeStats.seen} media prop(s) found:\n` +
        breakdown(nodeStats) +
        `  ${skippedEmail} email-block prop(s) skipped (need an absolute URL)\n`) +
    `scanned ${entriesScanned} entry document(s) + ${hosts.length} host document(s), ` +
    `${fieldStats.seen} media field(s) found:\n` +
    breakdown(fieldStats) +
    `${docsChanged} node document(s), ${entryDocsChanged} entry document(s) and ` +
    `${hostDocsChanged} host document(s) needed changes, ` +
    `${written(nodeStats) + written(fieldStats)} value(s) ` +
    `${apply ? 'written' : 'pending'}.`,
)
/**
 * Declines, grouped by reason and NAMING EVERY DOCUMENT (AGL-1407).
 *
 * The old report rolled these up by URL, which reads as a footnote about the
 * media library rather than a list of documents this run refused to fix. Say
 * so explicitly when there are none, too — the absence of a section is not a
 * statement, and this run's whole failure mode was being read as one.
 */
if (declined.length) {
  const byReason = new Map()
  for (const item of declined) {
    const list = byReason.get(item.reason) ?? []
    list.push(item)
    byReason.set(item.reason, list)
  }
  console.log(
    `\n${declined.length} value(s) DECLINED across ` +
      `${byReason.size} reason(s) — each left exactly as it is today:`,
  )
  for (const [reason, items] of [...byReason].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`\n  ${items.length}×  ${reason}`)
    for (const item of items.slice(0, 20)) {
      console.log(`      ${item.where}`)
      console.log(`        ${item.value.slice(0, 120)}`)
    }
    if (items.length > 20) console.log(`      … and ${items.length - 20} more`)
  }
} else {
  console.log('\n0 value(s) declined — nothing was left behind.')
}
if (!apply) console.log('\nRe-run with --apply to write.')
