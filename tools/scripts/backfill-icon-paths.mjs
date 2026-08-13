/**
 * Icon SVG path back-fill (AGL-1212).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-icon-paths.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * The mdi catalog is ~2.9 MB and is lazily loaded by picker surfaces only,
 * so a render surface that had to look an icon id up got `DEFAULT_ICON` back
 * — which carries a real `path`, so every published `icon` element and every
 * button start/end icon painted a "help" glyph with full confidence instead
 * of degrading. The renderer now reads a `*Path` prop denormalized next to
 * the id at author time; this fills that prop in for everything authored
 * before the change.
 *
 * Rules:
 *
 * - `iconId` → `iconPath`, `startIconId` → `startIconPath`, `endIconId` →
 *   `endIconPath`. The id stays the source of truth; the path is a copy.
 * - A node that already has a non-empty path prop is left alone, so this is
 *   safe to re-run.
 * - An id that resolves to nothing in `@mdi/js` is REPORTED AND SKIPPED, not
 *   written as empty. A stale id is a content problem, and writing an empty
 *   path would make it indistinguishable from a node that predates this.
 * - Documents are only written when at least one node actually changed, so a
 *   re-run touches nothing and `updatedAt` stays put.
 *
 * Covers, for every host: `screens`, `layouts`, `components` and `templates`
 * — both the parent doc (the published snapshot the tenant renders) and every
 * doc in its `versions` subcollection (what the besigner edits). Missing
 * either half would leave the site and the editor disagreeing.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { camelCase } from 'change-case'
import { decode, encode } from '@msgpack/msgpack'
import * as mdi from '@mdi/js'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

/** Mirrors `convertIdToModuleName`: `view-grid-outline` → `mdiViewGridOutline`. */
function pathForIconId(iconId) {
  if (!iconId || typeof iconId !== 'string') return undefined
  const moduleName = camelCase(`mdi-${iconId}`, {
    mergeAmbiguousCharacters: true,
  })
  const value = mdi[moduleName]
  return typeof value === 'string' && value ? value : undefined
}

/** Mirrors `iconPathPropName`. */
const ICON_ID_PROPS = ['iconId', 'startIconId', 'endIconId']
const pathProp = (idProp) => idProp.replace(/Id$/, 'Path')

const unresolved = new Map()

/**
 * Fills icon paths in a denormalized node map. Returns the number of props
 * written; mutates a shallow-cloned copy the caller supplies.
 */
function fillNodes(nodes, docPath) {
  if (!nodes || typeof nodes !== 'object') return 0
  let written = 0
  for (const [nodeId, node] of Object.entries(nodes)) {
    const props = node?.props
    if (!props || typeof props !== 'object') continue
    for (const idProp of ICON_ID_PROPS) {
      const iconId = props[idProp]
      if (typeof iconId !== 'string' || !iconId) continue
      const target = pathProp(idProp)
      if (typeof props[target] === 'string' && props[target]) continue
      const path = pathForIconId(iconId)
      if (!path) {
        const key = iconId
        unresolved.set(key, (unresolved.get(key) ?? 0) + 1)
        console.warn(`  ! unresolved icon id "${iconId}" at ${docPath}#${nodeId}`)
        continue
      }
      props[target] = path
      written += 1
    }
  }
  return written
}

let docsScanned = 0
let docsWithNodes = 0
let docsChanged = 0
let propsWritten = 0
let iconNodesSeen = 0

/**
 * `nodes` is stored in TWO forms in production and both are live: a plain
 * Firestore map, and msgpack bytes (AGL-1151 compression at rest). Reading
 * the bytes form as a map silently yields a 40k-key byte object with no
 * `props` anywhere — which reports "0 documents needed changes" and looks
 * exactly like success. Decode by form, and write back in the SAME form so
 * this never rewrites a document's storage representation as a side effect.
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

async function processDoc(ref) {
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
  const written = fillNodes(next, ref.path)
  iconNodesSeen += countIconNodes(nodes)
  if (!written) return
  docsChanged += 1
  propsWritten += written
  console.log(
    `${apply ? 'write' : 'would write'} ${String(written).padStart(3)} path(s)  [${form}]  ${ref.path}`,
  )
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
}

/** Counted so a "0 changes" run can be told apart from a "0 found" run. */
function countIconNodes(nodes) {
  let n = 0
  for (const node of Object.values(nodes)) {
    const props = node?.props
    if (!props || typeof props !== 'object') continue
    if (ICON_ID_PROPS.some((p) => typeof props[p] === 'string' && props[p])) n += 1
  }
  return n
}

const KINDS = ['screens', 'layouts', 'components', 'templates']

const hosts = onlyHost
  ? [await firestore.collection('hosts').doc(onlyHost).get()]
  : (await firestore.collection('hosts').get()).docs

for (const host of hosts) {
  if (!host.exists) {
    console.error(`host ${onlyHost} not found`)
    process.exit(1)
  }
  for (const kind of KINDS) {
    const parents = await host.ref.collection(kind).get()
    for (const parent of parents.docs) {
      await processDoc(parent.ref)
      const versions = await parent.ref.collection('versions').get()
      for (const version of versions.docs) await processDoc(version.ref)
    }
  }
}

// Report the intermediate counts, not just the final one. "0 changes" is
// ambiguous on its own — it reads identically whether every icon already had
// a path or the script decoded no nodes at all (which is exactly what the
// first run of this script did against the msgpack-encoded documents).
console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${docsScanned} document(s), ` +
    `${docsWithNodes} carried nodes, ${iconNodesSeen} icon-bearing node(s) found, ` +
    `${docsChanged} document(s) needed changes, ` +
    `${propsWritten} path(s) ${apply ? 'written' : 'pending'}.`,
)
if (unresolved.size) {
  console.log(`\n${unresolved.size} icon id(s) did not resolve in @mdi/js:`)
  for (const [id, count] of [...unresolved].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}×  ${id}`)
  }
  console.log('These were SKIPPED — re-pick them in the besigner.')
}
if (!apply) console.log('\nRe-run with --apply to write.')
