/**
 * Two sections lost the page's content-width cap (AGL-1296).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/fix-pricing-container-width.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT. Idempotent.
 *
 * `/pricing` renders THREE different content widths. Four of its six sections
 * cap at 1280 (matching every Figma content frame in `77:38`); `Compare
 * features` and `Usage pricing` do not, and spread to 1392; and the metered
 * table inside Usage is separately capped at 1100, which is 180 NARROWER than
 * the design and makes four of its eight rows wrap:
 *
 *   live   45, 48, 48, 70, 48, 70, 70, 70  = 469
 *   figma  44, 42, 42, 42, 42, 42, 42, 42  = 339
 *
 * ## Why not `maxWidth="xl"`
 *
 * All six sections already ARE `muiContainer`. The four correct ones use
 * `props.maxWidth: false` plus `sx.maxWidth: '1328px'` — a custom value, not a
 * named breakpoint. This theme defines no custom `breakpoints`, so MUI's stock
 * scale applies and `xl` is **1536px**: at a 1440 viewport it would not
 * constrain at all, which is exactly the `maxWidth: false` behaviour these two
 * sections already have. `lg` would be 1200 — 80 too narrow.
 *
 * 1328 is the right number because the Container carries 24px of padding either
 * side, so 1328 − 48 = the 1280 the design draws to. Redefining the theme's
 * `xl` to 1328 would reach every console and tenant surface, so this copies the
 * pattern the working sections already use instead.
 *
 * ## Scope
 *
 * Only containers that are already `maxWidth: false` with NO `sx.maxWidth` are
 * touched, and only when they hold several section blocks — a deliberately
 * full-bleed band (a gradient strip, a hero image) is legitimately uncapped, so
 * anything with fewer than 3 children is reported rather than changed. Every
 * uncapped container found anywhere on the host is listed either way.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : 'DXnRbPH4CQ'

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/** The content cap the working sections use: 1280 design width + 2×24 padding. */
const CONTENT_CAP = '1328px'
/** The metered table's own cap. The design's grid is 286 + 7×142 = 1280 exactly. */
const TABLE_CAP_FROM = '1100px'
const TABLE_CAP_TO = '1280px'
/** Fewer children than this and an uncapped container is probably a deliberate band. */
const MIN_BLOCKS = 3

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

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
  if (isPlainObject(raw)) return { form: 'map', nodes: raw }
  return null
}
const writeNodes = (form, nodes) => (form === 'bytes' ? Buffer.from(encode(nodes)) : nodes)

let docsScanned = 0
const perForm = { map: 0, bytes: 0 }
let docsDecoded = 0
let containersSeen = 0
let alreadyCapped = 0
let capped = 0
let tablesWidened = 0
let reportedOnly = 0
let docsChanged = 0
const changes = []
const reports = []

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  perForm[read.form] += 1
  const { form, nodes } = read
  if (!isPlainObject(nodes)) return
  docsDecoded += 1

  const next = {}
  let changed = 0
  for (const [id, node] of Object.entries(nodes)) {
    const sx = node?.sx
    const props = node?.props ?? {}
    let nextSx = null

    if (node?.componentId === 'muiContainer') {
      containersSeen += 1
      const hasCap = isPlainObject(sx) && sx.maxWidth !== undefined
      if (hasCap) {
        alreadyCapped += 1
      } else if (props.maxWidth === false || props.maxWidth === undefined) {
        const blocks = (node.nodes ?? []).length
        if (blocks >= MIN_BLOCKS) {
          nextSx = { ...(isPlainObject(sx) ? sx : {}), maxWidth: CONTENT_CAP }
          capped += 1
          changes.push(`${ref.path}#${id} container (${blocks} blocks) → maxWidth ${CONTENT_CAP}`)
        } else {
          reportedOnly += 1
          reports.push(`${ref.path}#${id} uncapped container with only ${blocks} block(s) — left alone`)
        }
      }
    }

    // The metered table's own cap, narrower than the design's grid.
    if (isPlainObject(sx) && sx.maxWidth === TABLE_CAP_FROM) {
      nextSx = { ...(nextSx ?? sx), maxWidth: TABLE_CAP_TO }
      tablesWidened += 1
      changes.push(`${ref.path}#${id} table ${TABLE_CAP_FROM} → ${TABLE_CAP_TO}`)
    }

    if (nextSx) {
      next[id] = { ...node, sx: nextSx }
      changed += 1
    } else {
      next[id] = node
    }
  }

  if (!changed) return
  docsChanged += 1
  console.log(`${apply ? 'write' : 'would write'}  ${ref.path}  ${changed} node(s)  [${form}]`)
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
}

const host = await firestore.collection('hosts').doc(onlyHost).get()
if (!host.exists) {
  console.error(`host ${onlyHost} not found`)
  process.exit(1)
}
for (const kind of ['screens', 'layouts', 'components', 'templates']) {
  for (const parent of (await host.ref.collection(kind).get()).docs) {
    await processDoc(parent.ref)
    for (const version of (await parent.ref.collection('versions').get()).docs) {
      await processDoc(version.ref)
    }
  }
}

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'}\n` +
    `  scanned      ${docsScanned} document(s) — map ${perForm.map}, msgpack ${perForm.bytes}\n` +
    `  decoded      ${docsDecoded} document(s)\n` +
    `  containers   ${containersSeen} seen, ${alreadyCapped} already capped\n` +
    `  capped       ${capped} container(s) → ${CONTENT_CAP}\n` +
    `  widened      ${tablesWidened} table(s) ${TABLE_CAP_FROM} → ${TABLE_CAP_TO}\n` +
    `  reported     ${reportedOnly} uncapped container(s) below the ${MIN_BLOCKS}-block bar\n` +
    `  changed      ${docsChanged} document(s)`,
)
for (const c of changes) console.log(`      ${c}`)
for (const r of reports.slice(0, 20)) console.log(`      ? ${r}`)
if (!apply) console.log('\nRe-run with --apply to write.')
