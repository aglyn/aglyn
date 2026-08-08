/**
 * The brand blue is hard-coded 616 times and fails WCAG AA everywhere (AGL-1293).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/fix-brand-blue-token.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * Measured on the live host: 454 nodes carry `color: #0090d9` (3.51:1 on white,
 * 3.19:1 on the Pro tint) and 160 carry `color: #00B0FF` (2.43:1). Every one of
 * the 454 is 13–15px at weight 600/700 — normal text by WCAG, which owes 4.5:1,
 * so none of them qualify for the 3:1 large-text allowance. The 160 are 22px
 * check-mark ICONS, non-text content, which owes 3:1 — and 2.43 fails that too.
 *
 * The fix is a TOKEN, not a better hex. Sites resolve light/dark by SWAPPING a
 * single-mode MUI theme (see `scheme-sx.ts`) — there is no CSS-variables or
 * media-query dark mode — so `color: 'primary.dark'` resolves against whichever
 * scheme is active and is correct in both by itself. The palette then owns the
 * value, which is the point: regenerating a host's palette moves the site with
 * it, where 616 literal hexes never could.
 *
 * The per-scheme values live on the HOST THEME document, written by
 * `set-host-primary-dark.mjs`:
 *
 *   light  #0073ae   5.17 white · 4.95 #fafafa · 4.70 Pro tint   AA everywhere
 *   dark   #4fc3f7   8.58 on page · 7.34 on paper                AA everywhere
 *
 * `#4fc3f7` is exactly what the dark slices already paint, so dark mode does not
 * change appearance at all — it just stops being 454 copies of one decision.
 *
 * Which means those slices must GO. Each of the 454 base blues has a 1:1
 * `@scheme dark` sibling overriding `color` with that literal `#4fc3f7`; left in
 * place it would beat the token in dark mode and pin the colour right back down.
 * Deleting them is the second half of this fix, not a tidy-up.
 *
 * NOT touched, and each for a reason:
 *   - `bgcolor` blues (5 nodes). A background is a different contrast question —
 *     what matters is the text ON it — and darkening a badge is a design call.
 *     They are counted and listed so the decision is visible, not silent.
 *   - responsive `color` objects (`{ xs: …, md: … }`). None exist today; if one
 *     appears it is reported as UNHANDLED rather than half-rewritten.
 *   - any blue in a nested selector (`&:hover`). Also none today, also reported.
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

/** Content blue (text) and theme blue (icons). Both become the token. */
const CONTENT_BLUE = '#0090d9'
const THEME_BLUE = '#00b0ff'
/** What the dark slices already paint, and what the token now carries in dark. */
const DARK_BLUE = '#4fc3f7'
const TOKEN = 'primary.dark'
const SCHEME_DARK_KEY = '@scheme dark'

const isBlue = (value, hex) =>
  typeof value === 'string' && value.trim().toLowerCase() === hex

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

const writeNodes = (form, nodes) =>
  form === 'bytes' ? Buffer.from(encode(nodes)) : nodes

let docsScanned = 0
const perForm = { map: 0, bytes: 0 }
let docsDecoded = 0
let nodesSeen = 0
let candidates = 0
let textRewritten = 0
let iconRewritten = 0
let slicesCleared = 0
let slicesEmptied = 0
let bgcolorSkipped = 0
let unhandled = 0
let docsChanged = 0
const unhandledSamples = []
const bgcolorSamples = []

/** Find the dark-slice key actually used on this sx (spacing has varied). */
function findSchemeKey(sx) {
  return Object.keys(sx).find((key) => /@scheme\s+dark/.test(key))
}

/** Report, but never rewrite, a blue we did not plan for. */
function noteUnhandled(where, detail) {
  unhandled += 1
  if (unhandledSamples.length < 20) unhandledSamples.push(`${where} — ${detail}`)
}

/**
 * Rewrites one node's sx. Returns a NEW sx when anything changed, else null.
 * The base `color` moves to the token and the matching dark-slice override is
 * dropped, because that override would otherwise win in dark mode.
 */
function rewriteSx(sx, where) {
  if (!isPlainObject(sx)) return null
  let changed = false
  const next = JSON.parse(JSON.stringify(sx))

  // Blues we are deliberately leaving alone, surfaced rather than ignored.
  for (const key of ['bgcolor', 'backgroundColor']) {
    if (isBlue(next[key], CONTENT_BLUE) || isBlue(next[key], THEME_BLUE)) {
      bgcolorSkipped += 1
      if (bgcolorSamples.length < 10) {
        bgcolorSamples.push(`${where} ${key}=${next[key]}`)
      }
    }
  }

  // A blue hiding in a nested selector is out of scope — flag it.
  for (const [key, value] of Object.entries(next)) {
    if (key === SCHEME_DARK_KEY || !isPlainObject(value)) continue
    if (/@scheme\s+dark/.test(key)) continue
    for (const inner of Object.values(value)) {
      if (isBlue(inner, CONTENT_BLUE) || isBlue(inner, THEME_BLUE)) {
        noteUnhandled(where, `blue inside nested selector \`${key}\``)
      }
    }
  }

  const color = next.color
  const isText = isBlue(color, CONTENT_BLUE)
  const isIcon = isBlue(color, THEME_BLUE)

  // A responsive colour would need per-breakpoint reasoning; refuse it loudly.
  if (!isText && !isIcon && isPlainObject(color)) {
    for (const inner of Object.values(color)) {
      if (isBlue(inner, CONTENT_BLUE) || isBlue(inner, THEME_BLUE)) {
        noteUnhandled(where, 'blue inside a responsive `color` object')
      }
    }
  }

  if (isText || isIcon) {
    candidates += 1
    next.color = TOKEN
    changed = true
    if (isText) textRewritten += 1
    else iconRewritten += 1
  }

  // Drop the now-redundant dark override. Only when it is the literal we are
  // replacing — a different dark colour is a real authored decision.
  const schemeKey = findSchemeKey(next)
  if (schemeKey && isPlainObject(next[schemeKey])) {
    const slice = next[schemeKey]
    if (changed && isBlue(slice.color, DARK_BLUE)) {
      delete slice.color
      slicesCleared += 1
      if (Object.keys(slice).length === 0) {
        delete next[schemeKey]
        slicesEmptied += 1
      }
    } else if (changed && slice.color !== undefined) {
      noteUnhandled(where, `dark slice keeps a non-${DARK_BLUE} color=${JSON.stringify(slice.color)}`)
    }
  }

  return changed ? next : null
}

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
    nodesSeen += 1
    const rewritten = rewriteSx(node?.sx, `${ref.path}#${id}`)
    if (rewritten) {
      next[id] = { ...node, sx: rewritten }
      changed += 1
    } else {
      next[id] = node
    }
  }

  if (!changed) return
  docsChanged += 1
  console.log(
    `${apply ? 'write' : 'would write'}  ${ref.path}  ${changed} node(s)  [${form}]`,
  )
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
    `  decoded      ${docsDecoded} document(s), ${nodesSeen} node(s) walked\n` +
    `  candidates   ${candidates} node(s) carrying a blue \`color\`\n` +
    `  rewritten    ${textRewritten} text + ${iconRewritten} icon → \`${TOKEN}\`\n` +
    `  dark slices  ${slicesCleared} redundant \`color\` override(s) dropped, ` +
    `${slicesEmptied} slice(s) removed entirely\n` +
    `  skipped      ${bgcolorSkipped} background blue(s) — design call, listed below\n` +
    `  unhandled    ${unhandled} — must be 0 before applying\n` +
    `  changed      ${docsChanged} document(s)`,
)
for (const s of bgcolorSamples) console.log(`      bg: ${s}`)
for (const s of unhandledSamples) console.log(`      !! ${s}`)
if (!apply) {
  console.log(
    '\nRe-run with --apply to write. Run set-host-primary-dark.mjs --apply FIRST:\n' +
      'until the palette carries the token, these nodes resolve to the derived\n' +
      '#007bb2, which is 4.49 on #fafafa and still short of AA.',
  )
}
