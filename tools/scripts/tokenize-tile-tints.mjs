/**
 * Point the tinted tiles at the `tint` palette entry (AGL-1244).
 *
 *   node tools/scripts/tokenize-tile-tints.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT. Snapshot first:
 *
 *   node tools/scripts/backup-host-nodes.mjs --host=DXnRbPH4CQ --out=pre-tint.json
 *
 * The three tile tints were the last raw colour literals on the marketing nav,
 * and they had spread: 137 nodes across 18 documents, not the 15 the AGL-1244
 * memo counted from the nav component alone. Every one of them carries an
 * `@scheme dark` slice holding a hand-curated dark counterpart, and those
 * slices exist ONLY because the value is a literal — a token flips on its own.
 *
 * So the unit of work is "replace the literal AND drop the slice", and it has
 * to be one edit. Leaving the slice would make it override the new token, which
 * `backfill-scheme-dark.mjs`'s own `checkSlice` assertion counts as a
 * violation; dropping the slice without the token would freeze the tiles light.
 *
 * ## Why this is safe to do mechanically
 *
 * Measured across the whole host before this was written, not assumed:
 *
 * - All 137 nodes carry EXACTLY ONE of `bgcolor` / `backgroundColor` — none
 *   carries both, so the colour-picker shadowing trap (four nodes host-wide)
 *   does not touch this population.
 * - Every `@scheme dark` slice on those nodes has EXACTLY ONE key, the same
 *   background key as the base. Nothing else is riding along, so the whole
 *   slice can be deleted rather than surgically edited.
 * - The dark values are uniform: #143043 / #3d1443 / #262b31, which are the
 *   values now shipped as `consoleOptionsDark.palette.tint`. Dark mode renders
 *   the same colour after the change as before it.
 *
 * Anything that does not match that shape is REFUSED, per node, and reported —
 * a partial match means the population drifted since it was measured, and the
 * right response is to re-measure rather than to guess.
 *
 * ## After applying
 *
 * A node write is not a publish and does not revalidate. Screens render from
 * `screens/{id}.versionId`, and a live-screen save never revalidates on its
 * own, so the affected paths need an explicit revalidation pass afterwards.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : 'DXnRbPH4CQ'

const SX_SCHEME_DARK_KEY = '@scheme dark'
const BG_KEYS = ['bgcolor', 'backgroundColor']

/** literal -> [token, the dark counterpart its slice is allowed to hold] */
const TINTS = {
  '#e6f5ff': ['tint.primary', '#143043'],
  '#fbe6fe': ['tint.secondary', '#3d1443'],
  '#eef0f2': ['tint.tertiary', '#262b31'],
}

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/**
 * `nodes` is stored in TWO forms and both are live: a plain Firestore map and
 * msgpack bytes. Read by form and write back in the SAME form so this never
 * rewrites a document's storage representation as a side effect.
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
  if (typeof raw === 'object' && !Array.isArray(raw)) return { form: 'map', nodes: raw }
  return null
}
const writeNodes = (form, nodes) => (form === 'bytes' ? Buffer.from(encode(nodes)) : nodes)

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : null)

const refusals = []
let docsScanned = 0
let docsChanged = 0
let nodesChanged = 0
const perToken = {}

const hostRef = firestore.collection('hosts').doc(onlyHost)
async function* nodeDocs() {
  for (const kind of ['screens', 'layouts', 'components', 'templates']) {
    for (const parent of (await hostRef.collection(kind).get()).docs) {
      yield parent.ref
      for (const v of (await parent.ref.collection('versions').get()).docs) yield v.ref
    }
  }
}

for await (const ref of nodeDocs()) {
  const read = readNodes((await ref.get()).get('nodes'))
  if (!read) continue
  docsScanned += 1
  const { form, nodes } = read
  let changed = 0

  for (const [nodeId, node] of Object.entries(nodes)) {
    const sx = node?.sx
    if (!sx || typeof sx !== 'object') continue

    const present = BG_KEYS.filter((k) => TINTS[norm(sx[k])])
    if (!present.length) continue
    const where = `${ref.path}#${nodeId}`

    // Both keys set means the picker appended over a shadowed value. Which one
    // renders is decided by key order, so a blind rewrite could resurrect the
    // dead one. Refuse and let a human clear the stale key first.
    if (BG_KEYS.every((k) => sx[k] !== undefined)) {
      refusals.push(`${where}: carries BOTH bgcolor and backgroundColor`)
      continue
    }

    const key = present[0]
    const [token, expectedDark] = TINTS[norm(sx[key])]
    const slice = sx[SX_SCHEME_DARK_KEY]

    if (slice !== undefined) {
      if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) {
        refusals.push(`${where}: '${SX_SCHEME_DARK_KEY}' is not an object`)
        continue
      }
      const sliceKeys = Object.keys(slice)
      // Deleting the slice is only safe when the background IS the slice.
      if (sliceKeys.length !== 1 || sliceKeys[0] !== key) {
        refusals.push(
          `${where}: dark slice carries ${JSON.stringify(sliceKeys)}, expected exactly ["${key}"]`,
        )
        continue
      }
      if (norm(slice[key]) !== expectedDark) {
        refusals.push(
          `${where}: dark slice is ${slice[key]}, expected ${expectedDark} — dark mode would SHIFT`,
        )
        continue
      }
    }

    sx[key] = token
    delete sx[SX_SCHEME_DARK_KEY]
    changed += 1
    perToken[token] = (perToken[token] ?? 0) + 1
  }

  if (!changed) continue
  docsChanged += 1
  nodesChanged += changed
  console.log(
    `${apply ? 'write' : 'would write'} ${String(changed).padStart(3)} node(s)  [${form}]  ${ref.path}`,
  )
  if (apply) await ref.update({ nodes: writeNodes(form, nodes) })
}

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${docsScanned} document(s), ` +
    `${nodesChanged} node(s) in ${docsChanged} document(s).`,
)
console.log(perToken)

if (refusals.length) {
  console.error(`\n${refusals.length} NODE(S) REFUSED — shape did not match:`)
  for (const r of refusals) console.error(`  - ${r}`)
}
if (!apply) console.log('\nRe-run with --apply to write. Snapshot first.')
