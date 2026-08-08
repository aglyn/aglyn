/**
 * The CTA band is a gradient the design does not have (AGL-1295).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/fix-cta-gradient.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * Figma's CTA (`90:51`) is `bg/paper` with a 1px top border — no gradient. The
 * build instead paints a saturated blue→purple band behind the same text, and
 * that band cannot carry accessible text in either direction:
 *
 *   white on the #00b0ff stop      2.6:1   (AA needs 4.5)
 *   #0090d9 eyebrow on that stop   ~1.2:1  (effectively invisible)
 *
 * Only near-black clears AA across all three stops, which is why the light
 * design puts the copy on paper. Dark mode made it obvious — the tokens flipped
 * the copy to near-white over a bright band — but the eyebrow and the text
 * button have been unreadable in LIGHT the whole time.
 *
 * So this restores the design: drop `backgroundImage`, put the panel on the
 * `background.paper` TOKEN, and add the top border. Using the token rather than
 * a hex is the point — it flips with the scheme by itself, so the panel needs no
 * `@scheme dark` slice at all and is correct in both.
 *
 * Padding is left exactly as authored. The bands already use `pt: 12` / `pb: 14`
 * — 96px / 112px, which is precisely what the Figma frame specifies — so the
 * background was the only drift, and one band deliberately uses `py: 8`.
 *
 * ONLY the CTA band is touched. The host has four other gradients — a 160×150
 * corner decoration, a 56×3 divider rule, and a 120px card banner — which carry
 * no text, have no contrast problem, and are decoration the design does want.
 * They are matched out by requiring the CTA's own gradient AND a child.
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

/** The CTA band's gradient, verbatim. Decorative gradients use other angles. */
const CTA_GRADIENT = 'linear-gradient(190.72deg, #00b0ff 36.6%, #7a5cf0 76.87%, #e040fb 109.81%)'

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

const writeNodes = (form, nodes) =>
  form === 'bytes' ? Buffer.from(encode(nodes)) : nodes

let docsScanned = 0
let gradientsSeen = 0
let decorativeSkipped = 0
let docsChanged = 0
let bandsFixed = 0

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return

  const next = {}
  let changed = 0
  for (const [id, node] of Object.entries(nodes)) {
    const sx = node?.sx
    const image = sx?.backgroundImage
    if (typeof image !== 'string' || !image.includes('gradient')) {
      next[id] = node
      continue
    }
    gradientsSeen += 1

    // Decoration, not a panel: a different gradient, or nothing sitting on it.
    if (image !== CTA_GRADIENT || !(node.nodes?.length > 0)) {
      decorativeSkipped += 1
      console.log(
        `  - ${ref.path}#${id} SKIPPED — decorative (${(node.nodes ?? []).length} children)`,
      )
      next[id] = node
      continue
    }

    const nextSx = JSON.parse(JSON.stringify(sx))
    delete nextSx.backgroundImage
    // A token, not a hex: it flips with the scheme, so no dark slice is needed
    // and the panel is right in both. Any slice we previously wrote for this
    // subtree is recomputed by re-running backfill-scheme-dark.mjs.
    delete nextSx[' @scheme dark']
    delete nextSx['@scheme dark']
    nextSx.bgcolor = 'background.paper'
    nextSx.borderTop = '1px solid'
    nextSx.borderColor = 'divider'

    next[id] = { ...node, sx: nextSx }
    changed += 1
    bandsFixed += 1
    console.log(
      `${apply ? 'write' : 'would write'}  ${ref.path}#${id}  gradient → background.paper + top border`,
    )
  }

  if (!changed) return
  docsChanged += 1
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
}

const hosts = onlyHost
  ? [await firestore.collection('hosts').doc(onlyHost).get()]
  : (await firestore.collection('hosts').get()).docs

for (const host of hosts) {
  if (!host.exists) {
    console.error(`host ${onlyHost} not found`)
    process.exit(1)
  }
  for (const kind of ['screens', 'layouts', 'components', 'templates']) {
    const parents = await host.ref.collection(kind).get()
    for (const parent of parents.docs) {
      await processDoc(parent.ref)
      const versions = await parent.ref.collection('versions').get()
      for (const version of versions.docs) await processDoc(version.ref)
    }
  }
}

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${docsScanned} document(s), ` +
    `${gradientsSeen} gradient node(s) found, ${decorativeSkipped} decorative skipped, ` +
    `${docsChanged} document(s) needed changes, ${bandsFixed} CTA band(s) ${apply ? 'fixed' : 'pending'}.`,
)
if (apply) {
  console.log(
    '\nNow re-run backfill-scheme-dark.mjs --apply: those subtrees are no longer\n' +
      'on a gradient, so their pinned dark slices must be recomputed (or dropped).',
  )
}
if (!apply) console.log('\nRe-run with --apply to write.')
