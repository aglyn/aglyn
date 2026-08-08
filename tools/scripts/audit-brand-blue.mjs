/**
 * Survey, not a fix (AGL-1293). Where do the brand blues live, and in what role?
 *
 *   node tools/scripts/audit-brand-blue.mjs --host=DXnRbPH4CQ
 *
 * Reports every literal brand-blue hex keyed by the sx PROPERTY carrying it and
 * by its SELECTOR PATH, because both decide the fix:
 *
 *   - the property says what contrast rule applies — a `color` is text and owes
 *     4.5:1, a `borderColor` or icon `fill` is non-text and owes 3:1;
 *   - the path says which scheme it belongs to — a value inside `@scheme dark`
 *     is a separate decision from the same value in the base, and a base value
 *     that already HAS a dark sibling cannot simply be swapped for a token,
 *     because the hard-coded sibling would win in dark mode.
 *
 * Also counts, per node, whether a base blue has a dark-slice counterpart, which
 * is the number that says how many `@scheme dark` overrides the token rewrite
 * has to delete.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode } from '@msgpack/msgpack'

const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/** The blues under review, lowercased. */
const TARGETS = new Set(['#0090d9', '#00b0ff', '#4fc3f7'])
const SCHEME_KEY = /@scheme\s+dark/

function readNodes(raw) {
  if (raw === undefined || raw === null) return null
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      return { form: 'bytes', nodes: decode(bytes) }
    } catch (error) {
      console.warn(`  ! msgpack decode failed: ${error.message}`)
      return null
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return { form: 'map', nodes: raw }
  return null
}

let docsScanned = 0
const perForm = { map: 0, bytes: 0 }
let docsDecoded = 0
let nodesSeen = 0

/** `${hex}|${property}|${scope}` -> { n, contexts: Map } */
const hits = new Map()
/** How many base `color: #0090d9` nodes also carry a dark slice for `color`. */
let blueWithDarkSibling = 0
let blueWithoutDarkSibling = 0
const orphanSamples = []

function note(hex, property, scope, context) {
  const key = `${hex}|${property}|${scope}`
  if (!hits.has(key)) hits.set(key, { n: 0, contexts: new Map() })
  const entry = hits.get(key)
  entry.n += 1
  entry.contexts.set(context, (entry.contexts.get(context) ?? 0) + 1)
}

/** What size does this node's text render at? Decides 4.5:1 vs 3:1. */
function typeContext(node) {
  const sx = node?.sx ?? {}
  const size = sx.fontSize ?? node?.props?.fontSize
  const weight = sx.fontWeight ?? node?.props?.fontWeight
  const variant = node?.props?.variant ?? node?.variant
  const bits = []
  if (variant) bits.push(`variant=${variant}`)
  if (size !== undefined) bits.push(`fontSize=${JSON.stringify(size)}`)
  if (weight !== undefined) bits.push(`fontWeight=${weight}`)
  return bits.length ? bits.join(' ') : 'no type hints'
}

function walkSx(sx, scope, node, onHit) {
  if (!sx || typeof sx !== 'object' || Array.isArray(sx)) return
  for (const [key, value] of Object.entries(sx)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nextScope = SCHEME_KEY.test(key)
        ? 'dark-slice'
        : scope === 'base'
          ? `nested:${key}`
          : scope
      walkSx(value, nextScope, node, onHit)
      continue
    }
    if (typeof value !== 'string') continue
    const hex = value.trim().toLowerCase()
    if (!TARGETS.has(hex)) continue
    onHit(hex, key, scope, typeContext(node))
  }
}

/** Does this node override `prop` inside a dark slice? */
function darkSliceHas(sx, prop) {
  if (!sx || typeof sx !== 'object') return false
  for (const [key, value] of Object.entries(sx)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    if (SCHEME_KEY.test(key) && value[prop] !== undefined) return true
    if (darkSliceHas(value, prop)) return true
  }
  return false
}

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  perForm[read.form] += 1
  const { nodes } = read
  if (!nodes || typeof nodes !== 'object') return
  docsDecoded += 1
  for (const [id, node] of Object.entries(nodes)) {
    nodesSeen += 1
    walkSx(node?.sx, 'base', node, (hex, prop, scope, ctx) => {
      note(hex, prop, scope, ctx)
      if (hex === '#0090d9' && scope === 'base' && prop === 'color') {
        if (darkSliceHas(node.sx, 'color')) blueWithDarkSibling += 1
        else {
          blueWithoutDarkSibling += 1
          if (orphanSamples.length < 10) orphanSamples.push(`${ref.path}#${id}`)
        }
      }
    })
  }
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
  `\nscanned ${docsScanned} doc(s) — map ${perForm.map}, msgpack ${perForm.bytes}, ` +
    `decoded ${docsDecoded}, ${nodesSeen} node(s) walked\n`,
)

console.log('=== brand blues by hex / property / scope ===')
for (const [key, entry] of [...hits.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const [hex, prop, scope] = key.split('|')
  console.log(`  ${String(entry.n).padStart(4)}  ${hex}  ${prop}  [${scope}]`)
  for (const [ctx, n] of [...entry.contexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`        ${String(n).padStart(4)}  ${ctx}`)
  }
}

console.log(
  `\n=== dark-slice pairing for base \`color: #0090d9\` ===\n` +
    `  ${blueWithDarkSibling} node(s) already override \`color\` in a dark slice (the rewrite must DELETE these)\n` +
    `  ${blueWithoutDarkSibling} node(s) have no dark override`,
)
for (const s of orphanSamples) console.log(`      orphan: ${s}`)
