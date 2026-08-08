/**
 * Pick the brand-blue token from the SURFACE under it (AGL-1293).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/fix-brand-blue-surface-aware.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT. Idempotent. Run AFTER `fix-brand-blue-token.mjs`.
 *
 * That script moved 614 literal hexes onto `primary.dark` assuming the blue
 * always sits on a light surface. Measured on the live page, it does not: the
 * Pro plan card is `#161C21` — a DARK panel inside the LIGHT scheme — and its
 * ten check icons went from 7.08:1 to **3.32:1**. Above the 3:1 non-text floor,
 * still plainly a regression and plainly the wrong colour for that card.
 *
 * It also misses a second, larger population entirely. 210 nodes never held a
 * literal hex at all — they already referenced `primary.main`, which resolves to
 * the same failing `#00b0ff`: 55 text nodes on the `#e6f5ff` tint at 2.18:1, 39
 * on `background.paper` at 2.43, 27 on the page, 12 icons on the tint. A hex
 * sweep cannot see those, so this pass keys off the TOKEN instead and treats
 * both spellings of the bug as one.
 *
 * `bgStaysLight` in `backfill-scheme-dark.mjs` cannot answer the surface
 * question, because it only inspects a node's OWN sx. An icon inherits its
 * surface from an ancestor, so this walks the tree (`node.nodes` holds child
 * ids) to the nearest declared background and resolves it in BOTH schemes.
 *
 * Four cases, and only one of them is the ordinary one:
 *
 *   light bg / dark bg   →  `primary.dark`  — the normal case
 *   DARK bg / dark bg    →  `primary.main`  — #00b0ff, 7.08 on #161c21 and
 *                                             5.20 on the dark scheme's lifted
 *                                             #2a3440 panels
 *   light bg / LIGHT bg  →  `primary.dark` + a `@scheme dark` pin back to the
 *                           light-scheme blue. This is the inverse trap: a
 *                           `common.white` button does NOT flip, so in dark
 *                           mode `primary.dark` resolves to #4fc3f7 and paints
 *                           light blue on white — 2.0:1, the same shape as the
 *                           white-on-white bug AGL-1295 fixed.
 *   DARK bg / light bg   →  reported, never guessed at.
 *
 * No large-text exemption is applied, and none would help: `#00b0ff` is 2.43 on
 * white and 2.18 on the tint, so it misses even the 3:1 bar that large text and
 * icons are held to. Every light surface is a failure at any size.
 *
 * A literal hex background does not flip by itself; it flips only if the node
 * carries an `@scheme dark` slice for it. That is why the dark-scheme surface
 * is read from the slice rather than assumed. An unknown token — the site uses
 * `quaternary.main`, which this theme does not define — resolves to nothing, so
 * the walk continues past it to the real surface above.
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

const TOKEN_DARK = 'primary.dark'
const TOKEN_MAIN = 'primary.main'
/** Both spellings of the brand blue in node data; either may be wrong. */
const BLUE_TOKENS = new Set([TOKEN_DARK, TOKEN_MAIN])
/** What `primary.dark` resolves to in the light scheme — the dark-mode pin. */
const LIGHT_SCHEME_BLUE = '#0073ae'
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Tokens that keep a LIGHT value even in the dark scheme (AGL-1295). */
const NON_FLIPPING = {
  'common.white': '#ffffff',
  'grey.50': '#fafafa',
  'grey.100': '#f5f5f5',
  'grey.200': '#eeeeee',
  'grey.300': '#e0e0e0',
  'grey.400': '#bdbdbd',
}
/** Tokens that DO flip, per scheme. */
const FLIPPING = {
  'background.paper': ['#ffffff', '#202934'],
  'background.default': ['#f5f5f5', '#161c21'],
  'surface.main': ['#f8f9fa', '#202934'],
  'common.black': ['#000000', '#000000'],
}

function luminance(hex) {
  const v = hex.replace('#', '')
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}
const isDark = (hex) => luminance(hex) < 0.5

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const findSchemeKey = (sx) =>
  isPlainObject(sx) ? Object.keys(sx).find((k) => /@scheme\s+dark/.test(k)) : undefined

function readNodes(raw) {
  if (raw === undefined || raw === null) return null
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      return { form: 'bytes', nodes: decode(bytes) }
    } catch {
      return null
    }
  }
  if (isPlainObject(raw)) return { form: 'map', nodes: raw }
  return null
}
const writeNodes = (form, nodes) => (form === 'bytes' ? Buffer.from(encode(nodes)) : nodes)

/**
 * This node's own background in [light, dark], or null when it declares none.
 * A responsive background is refused rather than half-read.
 */
function ownBackground(sx) {
  if (!isPlainObject(sx)) return null
  const base = sx.bgcolor ?? sx.backgroundColor
  if (typeof base !== 'string') return null
  const schemeKey = findSchemeKey(sx)
  const override = schemeKey ? (sx[schemeKey]?.bgcolor ?? sx[schemeKey]?.backgroundColor) : undefined

  const resolve = (value, scheme) => {
    if (typeof value !== 'string') return null
    if (HEX.test(value)) return value.toLowerCase()
    if (NON_FLIPPING[value]) return NON_FLIPPING[value]
    if (FLIPPING[value]) return FLIPPING[value][scheme]
    return null // unknown token — treat as unresolved
  }
  const light = resolve(base, 0)
  // A hex only flips if a slice says so; a token flips by itself.
  const dark = typeof override === 'string' ? resolve(override, 1) : resolve(base, 1)
  if (!light || !dark) return null
  return [light, dark]
}

let docsScanned = 0
const perForm = { map: 0, bytes: 0 }
let tokenNodes = 0
let normal = 0
let toMain = 0
let toDark = 0
let pinned = 0
let unresolved = 0
let weird = 0
let docsChanged = 0
const samples = []
const unresolvedSamples = []

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  perForm[read.form] += 1
  const { form, nodes } = read
  if (!isPlainObject(nodes)) return

  // child id -> parent id, so an icon can find the card it sits in.
  const parentOf = new Map()
  for (const [id, node] of Object.entries(nodes)) {
    for (const child of node?.nodes ?? []) {
      if (typeof child === 'string') parentOf.set(child, id)
    }
  }

  /** Nearest declared background walking self → ancestors. */
  function effectiveBackground(id) {
    const seen = new Set()
    let current = id
    while (current && !seen.has(current)) {
      seen.add(current)
      const found = ownBackground(nodes[current]?.sx)
      if (found) return found
      current = parentOf.get(current)
    }
    return null // nothing declared — the page itself, which is light/dark
  }

  const next = {}
  let changed = 0
  for (const [id, node] of Object.entries(nodes)) {
    const sx = node?.sx
    if (!isPlainObject(sx) || !BLUE_TOKENS.has(sx.color)) {
      next[id] = node
      continue
    }
    tokenNodes += 1

    // No declared surface anywhere up the tree means the page background,
    // which flips light→dark. That is exactly what `primary.dark` is for.
    const surfaces = effectiveBackground(id) ?? ['#ffffff', '#161c21']
    const [lightBg, darkBg] = surfaces
    const lightIsDark = isDark(lightBg)
    const darkIsDark = isDark(darkBg)

    if (!lightIsDark && darkIsDark) {
      // The ordinary surface: light now, dark when the scheme flips. Already
      // right if it is on `primary.dark`; a `primary.main` here is the 2.43:1
      // failure this pass exists to catch.
      if (sx.color === TOKEN_DARK) {
        normal += 1
        next[id] = node
        continue
      }
      const nextSx = JSON.parse(JSON.stringify(sx))
      nextSx.color = TOKEN_DARK
      toDark += 1
      if (samples.length < 15) {
        samples.push(`${ref.path}#${id} on ${lightBg}/${darkBg} → ${TOKEN_DARK}`)
      }
      next[id] = { ...node, sx: nextSx }
      changed += 1
      continue
    }

    const nextSx = JSON.parse(JSON.stringify(sx))
    if (lightIsDark && darkIsDark) {
      if (sx.color === TOKEN_MAIN) {
        normal += 1
        next[id] = node
        continue
      }
      // Dark in both schemes: the bright brand blue is right in both.
      nextSx.color = TOKEN_MAIN
      const schemeKey = findSchemeKey(nextSx)
      if (schemeKey && isPlainObject(nextSx[schemeKey]) && nextSx[schemeKey].color !== undefined) {
        delete nextSx[schemeKey].color
        if (Object.keys(nextSx[schemeKey]).length === 0) delete nextSx[schemeKey]
      }
      toMain += 1
    } else if (!lightIsDark && !darkIsDark) {
      // Light in both: keep the accessible light-scheme blue in dark mode too.
      nextSx.color = TOKEN_DARK
      const schemeKey = findSchemeKey(nextSx) ?? '@scheme dark'
      nextSx[schemeKey] = { ...(nextSx[schemeKey] ?? {}), color: LIGHT_SCHEME_BLUE }
      pinned += 1
    } else {
      weird += 1
      if (samples.length < 15) {
        samples.push(`${ref.path}#${id} DARK→LIGHT surface ${lightBg} → ${darkBg} (left alone)`)
      }
      next[id] = node
      continue
    }

    if (samples.length < 15) {
      samples.push(
        `${ref.path}#${id} on ${lightBg}/${darkBg} → ${nextSx.color}${nextSx['@scheme dark']?.color ? ` + dark pin ${nextSx['@scheme dark'].color}` : ''}`,
      )
    }
    next[id] = { ...node, sx: nextSx }
    changed += 1
  }

  if (!changed) return
  docsChanged += 1
  console.log(`${apply ? 'write' : 'would write'}  ${ref.path}  ${changed} node(s)  [${form}]`)
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
  `\n${apply ? 'APPLIED' : 'DRY RUN'}\n` +
    `  scanned      ${docsScanned} document(s) — map ${perForm.map}, msgpack ${perForm.bytes}\n` +
    `  on token     ${tokenNodes} node(s) carrying a brand-blue token\n` +
    `  correct      ${normal} already right for their surface — left alone\n` +
    `  → dark       ${toDark} on a light surface that flips dark\n` +
    `  → main       ${toMain} on a surface dark in BOTH schemes\n` +
    `  → pinned     ${pinned} on a surface light in BOTH schemes\n` +
    `  reported     ${weird} dark→light surface(s), left alone\n` +
    `  unresolved   ${unresolved}\n` +
    `  changed      ${docsChanged} document(s)`,
)
for (const s of samples) console.log(`      ${s}`)
for (const s of unresolvedSamples) console.log(`      ? ${s}`)
if (!apply) console.log('\nRe-run with --apply to write.')
