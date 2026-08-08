/**
 * Dark-scheme node back-fill (AGL-1295).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-scheme-dark.mjs \
 *     [--apply] [--host=<hostId>] [--open-gate]
 *
 * DRY RUN BY DEFAULT.
 *
 * Sites are authored on a light canvas. Text mostly uses theme tokens, which
 * flip with the scheme on their own, but backgrounds and accents carry literal
 * hex — and hex cannot flip. `prefers-color-scheme: dark` therefore turned the
 * text white and left the backgrounds light: 903 of 1,910 elements below AA on
 * /pricing, 44 at exactly 1.00:1 (AGL-1292). The fix there was to gate dark off
 * entirely unless the host authored `colorSchemes.dark`.
 *
 * This fills in the missing half so the gate can open: every node whose sx
 * carries a literal hex colour gets an `@scheme dark` slice (AGL-588) holding
 * its dark counterpart. Light stays the base; the slice is dropped in light and
 * merged over the base in dark, resolved in JS by `resolveSchemeSx` in
 * `leaf.tsx`.
 *
 * Rules:
 *
 * - Only literal hex is ever rewritten. A theme token (`text.primary`,
 *   `divider`, `common.white`) or an `rgba()` string is LEFT ALONE — it already
 *   flips, and feeding it to the colour maths produced `#NaNNaNNaN`, which is
 *   invisible in light and catastrophic in dark. This is asserted, not assumed.
 * - The mapping is PROPERTY-AWARE. `#161C21` is a near-black: as a background
 *   it is a dark card that must LIFT above the now-dark page, as a foreground it
 *   is text that must go near-WHITE. One map for both roles put dark text on a
 *   dark surface.
 * - A saturated mid-tone is a brand colour (`#00b0ff`). It reads on both
 *   canvases and is left untouched in either role.
 * - Nested selector objects (`'& .MuiTabs-root'`) are re-emitted WHOLE.
 *   `mergeSchemeValue` replaces a non-responsive object wholesale, so a partial
 *   override silently drops its siblings.
 * - Slices are recomputed from the LIGHT BASE every run, so this is idempotent
 *   and self-correcting: a re-run repairs a slice an earlier version got wrong.
 * - Documents are only written when a slice actually changed.
 *
 * Covers, for every host: `screens`, `layouts`, `components` and `templates` —
 * both the parent doc (the published snapshot the tenant renders) and every doc
 * in its `versions` subcollection (what the besigner edits). The shared layout
 * carries the nav and footer, so skipping layouts would leave those light.
 *
 * `--open-gate` is deliberately a SEPARATE flag. Writing `colorSchemes.dark`
 * onto the host is what makes the site dark-capable, and it is host-wide: it
 * must be the LAST step, after every screen is migrated and reviewed. Running
 * it early republishes AGL-1292 across every page at once.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const openGate = process.argv.includes('--open-gate')
const closeGate = process.argv.includes('--close-gate')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/** Reserved node-sx key holding dark overrides — mirrors `SX_SCHEME_DARK_KEY`. */
const SCHEME_DARK = '@scheme dark'

/** sx keys whose value is a colour. Anything else is never touched. */
const COLOR_PROP =
  /^(bgcolor|backgroundColor|color|borderColor|outlineColor|fill|stroke)$/
const BG_PROP = /^(bgcolor|backgroundColor)$/

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Curated background ladder. Role, not lightness, decides these: `#ffffff` is
 * an elevated card and `#fbfbfb` is the page behind it, so they inverte to
 * DIFFERENT depths. Derived from `console.theme.ts`'s dark scheme.
 */
const BG_MAP = {
  '#fbfbfb': '#161c21', // page            → dark background.default
  '#fafafa': '#1b2229', // zebra row
  '#f7f8f9': '#1b2229',
  '#ffffff': '#202934', // card / surface  → dark surface.main
  '#ececed': '#28323d',
  '#eff1f3': '#28323d', // group band
  '#161c21': '#2a3440', // dark card LIFTS above the dark page
  '#eaf6fd': '#12303f', // brand tint
  '#eef7fd': '#12303f',
  '#e3f2fb': '#16394b', // brand tint, zebra

  // ── Promoted from the algorithmic fallback (AGL-1295 leftovers) ──────────
  //
  // These 12 reached dark mode by formula, not by choice. The values below are
  // EXACTLY what the fallback produces today, so promoting them changes no
  // pixel — the point is that they are now reviewable, and that the fallback
  // report drops to zero and becomes an alarm instead of background noise.
  //
  // ⚠️ One inherited inconsistency, deliberately frozen rather than silently
  // fixed: `#f1f3f5` (160×) and `#eff1f3` (66×) are the same grey band role
  // one step apart, yet land on DIFFERENT depths — #242b33 vs #28323d. Same
  // for the two near-identical purples below. Worth a designer's call; see the
  // note on AGL-1295.
  '#f1f3f5': '#242b33', // grey band, one step lighter than #eff1f3
  '#eef0f2': '#262b31', // grey band, cooler
  '#e6e9ed': '#242a32',
  '#dde2e7': '#242b33', // grey divider band
  '#c9d0d8': '#242b32',
  '#f6f8fa': '#1f2b38',
  '#e6f5ff': '#143043', // brand tint, between #eaf6fd and #e3f2fb
  '#fbe6fe': '#3d1443', // secondary (magenta) tint
  '#fcebff': '#3c1443', // secondary tint, 1 step off #fbe6fe
  '#f3e8ff': '#2a1443', // violet tint
  '#e7f8ef': '#14432a', // success tint
  '#fff1e0': '#432e14', // warning tint
}

/** Curated foreground map. Near-black text goes near-white, never to a surface. */
const FG_MAP = {
  '#161c21': '#e6e9ec',
  // DORMANT since AGL-1293: no node carries either of these as a foreground
  // any more — all 614 moved to the `primary.dark` token, which flips by
  // itself and needs no slice. Kept only as a safety net if the literal is
  // ever re-authored; the right answer then is the token, not this mapping.
  '#0090d9': '#4fc3f7',
  '#0079b8': '#29b6f6',

  // Promoted from the fallback, same reasoning and same values as above.
  // The slate ramp reads as secondary text; the green is a success figure.
  '#3a4453': '#b1bac8',
  '#475569': '#b0baca',
  '#5a6675': '#b4bcc5',
  '#059669': '#84f5d2', // success green
}

function toHsl(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  let hh = 0
  let s = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    hh =
      mx === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4
    hh /= 6
  }
  return [hh, s, l]
}

function toHex(hh, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r
  let g
  let b
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = f(p, q, hh + 1 / 3)
    g = f(p, q, hh)
    b = f(p, q, hh - 1 / 3)
  }
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

/** WCAG relative luminance, for the invariant checks. */
function luminance(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

const unmapped = new Map()

/**
 * The dark counterpart of one colour value, or null to leave it alone.
 *
 * The hex guard is the FIRST thing here on purpose. Every colour-valued sx
 * string reaches this function, and most of them are theme tokens.
 */
function derive(prop, value) {
  if (typeof value !== 'string' || !HEX.test(value)) return null
  const k = value.toLowerCase()
  const isBg = BG_PROP.test(prop)
  if (isBg && BG_MAP[k]) return BG_MAP[k]
  if (!isBg && FG_MAP[k]) return FG_MAP[k]

  const [h, s, l] = toHsl(k)
  // A saturated mid-tone is a brand colour — a button fill, an accent, a
  // checkmark. It carries the brand and reads on both canvases, so inverting it
  // would be actively wrong in either role.
  if (s > 0.5 && l >= 0.38 && l <= 0.68) return null

  if (isBg) {
    if (l < 0.5) return null // already dark
    unmapped.set(`${prop} ${k}`, (unmapped.get(`${prop} ${k}`) ?? 0) + 1)
    if (s < 0.12)
      return toHex(h, 0.1, l > 0.97 ? 0.145 : l > 0.9 ? 0.175 : 0.215)
    return toHex(h, Math.min(s, 0.55), 0.17) // tint keeps its hue
  }
  if (l > 0.6) return null // already light enough to read on dark
  unmapped.set(`${prop} ${k}`, (unmapped.get(`${prop} ${k}`) ?? 0) + 1)
  return toHex(h, s < 0.12 ? 0.06 : Math.min(s, 0.85), s < 0.12 ? 0.9 : 0.74)
}

/**
 * The dark counterpart of an sx value, or null when nothing beneath it changes.
 * Nested objects are returned WHOLE — siblings included — because the merge
 * replaces a non-responsive object rather than deep-merging it.
 */
function darkFor(key, value) {
  if (typeof value === 'string')
    return COLOR_PROP.test(key) ? derive(key, value) : null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  let changed = false
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const d = darkFor(k, v)
    out[k] = d !== null ? d : v
    if (d !== null) changed = true
  }
  return changed ? out : null
}

/**
 * Tokens that do NOT flip with the scheme. `common.white` is white in both, and
 * the grey ramp is identical in light and dark in `console.theme.ts` — so a node
 * sitting on one of these keeps a LIGHT background in dark mode.
 */
const NON_FLIPPING_BG = /^(common\.white|common\.black|grey\.(50|100|200|300|400))$/

/**
 * Whether this node's own background stays light once the scheme flips.
 *
 * This decides whether its foreground may be lifted. The Pro card's CTA is the
 * case that matters: a white button (`bgcolor: common.white`) with near-black
 * label. The button does not darken, so lifting its label to near-white — which
 * is right for text on the page — puts white on white. A foreground is only
 * safe to lift when the surface under it actually went dark.
 */
function bgStaysLight(sx) {
  const bg = sx.bgcolor ?? sx.backgroundColor
  if (typeof bg !== 'string') return false
  if (NON_FLIPPING_BG.test(bg)) return true
  if (!HEX.test(bg)) return false // background.paper/default/surface flip
  // A hex we remap goes dark; one we leave alone stays exactly as it is.
  return derive('bgcolor', bg) === null && luminance(bg) > 0.5
}

/**
 * Light values for the tokens that DO flip. Used to pin text inside a gradient
 * panel, where following the scheme is exactly the wrong behaviour.
 */
const TOKEN_LIGHT = {
  'text.primary': 'rgba(0,0,0,0.87)',
  'text.secondary': 'rgba(0,0,0,0.6)',
  'text.disabled': 'rgba(0,0,0,0.38)',
  'divider': 'rgba(0,0,0,0.12)',
  'background.paper': '#ffffff',
  'background.default': '#f5f5f5',
  'surface.main': '#f8f9fa',
}

const hasGradient = (v) => {
  if (typeof v === 'string') return v.includes('gradient')
  if (!v || typeof v !== 'object') return false
  return Object.values(v).some(hasGradient)
}

/**
 * Every node sitting on a gradient panel, itself included.
 *
 * A gradient background is a string in `backgroundImage`, so nothing above
 * rewrites it — the panel is BRIGHT in both schemes. Its text, however, is
 * token-driven, so the scheme flip turned near-black copy into near-white copy
 * on a bright blue/purple band. That is the `/pricing` CTA defect.
 *
 * The panel cannot carry AA text either way (white is 2.6:1 on the `#00b0ff`
 * stop), so this does NOT try to improve it — it pins the light appearance,
 * which is what the site has always shipped. The panel is undesigned drift in
 * the first place: Figma's CTA (`90:51`) is `bg/paper` with a top border and no
 * gradient at all. Fixing that is a design decision, filed separately.
 */
function gradientPanelIds(nodes) {
  const inPanel = new Set()
  const walk = (id) => {
    if (!id || inPanel.has(id)) return
    inPanel.add(id)
    for (const child of nodes[id]?.nodes ?? []) walk(child)
  }
  for (const [id, node] of Object.entries(nodes))
    if (hasGradient(node?.sx)) walk(id)
  return inPanel
}

/** The slice a node's LIGHT base implies, or null when it needs none. */
function sliceFor(sx, onGradient = false) {
  if (onGradient) {
    // Pin, don't flip. Only token-driven colours need saying — a literal hex
    // already stays put once we emit no override for it.
    const pinned = {}
    for (const [k, v] of Object.entries(sx)) {
      if (k === SCHEME_DARK || !COLOR_PROP.test(k)) continue
      if (typeof v === 'string' && TOKEN_LIGHT[v]) pinned[k] = TOKEN_LIGHT[v]
    }
    return Object.keys(pinned).length ? pinned : null
  }
  const keepForeground = !bgStaysLight(sx)
  const slice = {}
  for (const [k, v] of Object.entries(sx)) {
    if (k === SCHEME_DARK) continue
    if (!keepForeground && !BG_PROP.test(k) && COLOR_PROP.test(k)) continue
    const d = darkFor(k, v)
    if (d !== null) slice[k] = d
  }
  return Object.keys(slice).length ? slice : null
}

const violations = []

/**
 * Assertions that must hold for every slice we are about to write. These encode
 * the three ways earlier attempts went wrong, so a regression fails the run
 * instead of shipping quietly.
 */
function checkSlice(base, slice, where) {
  const json = JSON.stringify(slice)
  if (json.includes('NaN'))
    violations.push(`${where}: NaN in slice ${json.slice(0, 120)}`)
  for (const [k, v] of Object.entries(slice)) {
    // Never override a key whose light value is a theme token: it already flips.
    if (typeof base[k] === 'string' && !HEX.test(base[k]))
      violations.push(`${where}: slice overrides non-hex light value ${k}=${base[k]}`)
    if (typeof v !== 'string' || !HEX.test(v)) continue
    // A foreground that stays dark would be invisible on the dark canvas.
    if (!BG_PROP.test(k) && luminance(v) < 0.12)
      violations.push(`${where}: dark foreground ${k}=${v} (lum ${luminance(v).toFixed(3)})`)
    if (BG_PROP.test(k) && luminance(v) > 0.5)
      violations.push(`${where}: light background ${k}=${v} in dark slice`)
  }
}

/**
 * `nodes` is stored in TWO forms and both are live: a plain Firestore map, and
 * msgpack bytes (compression at rest). Reading the bytes form as a map yields a
 * huge byte-keyed object with no `sx` anywhere — which reports "0 documents
 * needed changes" and is indistinguishable from success. Decode by form, and
 * write back in the SAME form so this never rewrites a document's storage
 * representation as a side effect.
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

const writeNodes = (form, nodes) =>
  form === 'bytes' ? Buffer.from(encode(nodes)) : nodes

let docsScanned = 0
let docsWithNodes = 0
let docsChanged = 0
let nodesWithSx = 0
let nodesWithHex = 0
let slicesWritten = 0
let slicesRemoved = 0
let gradientNodes = 0
const formCounts = { map: 0, bytes: 0 }
const palette = new Map()

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return
  docsWithNodes += 1
  formCounts[form] += 1

  const onGradient = gradientPanelIds(nodes)
  if (onGradient.size) gradientNodes += onGradient.size

  const next = {}
  let changed = 0
  for (const [id, node] of Object.entries(nodes)) {
    const sx = node?.sx
    if (!sx || typeof sx !== 'object') {
      next[id] = node
      continue
    }
    nodesWithSx += 1
    // Deep clone: nested selector objects are rewritten whole.
    const base = JSON.parse(JSON.stringify(sx))
    delete base[SCHEME_DARK]

    const slice = sliceFor(base, onGradient.has(id))
    if (slice) {
      nodesWithHex += 1
      checkSlice(base, slice, `${ref.path}#${id}`)
      for (const [k, v] of Object.entries(slice)) {
        if (typeof v !== 'string') continue
        const key = `${k}: ${String(base[k]).toLowerCase()} → ${v}`
        palette.set(key, (palette.get(key) ?? 0) + 1)
      }
    }

    const had = sx[SCHEME_DARK] ? JSON.stringify(sx[SCHEME_DARK]) : null
    const want = slice ? JSON.stringify(slice) : null
    if (had !== want) {
      changed += 1
      if (want && !had) slicesWritten += 1
      else if (!want && had) slicesRemoved += 1
      else slicesWritten += 1
    }

    const nextSx = base
    if (slice) nextSx[SCHEME_DARK] = slice
    next[id] = { ...node, sx: nextSx }
  }

  if (!changed) return
  docsChanged += 1
  console.log(
    `${apply ? 'write' : 'would write'} ${String(changed).padStart(4)} slice(s)  [${form}]  ${ref.path}`,
  )
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
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

// Report the intermediate counts, not just the final one. "0 changes" reads
// identically whether every slice was already correct or the script decoded no
// nodes at all — which is exactly what a msgpack-blind first version does.
console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${docsScanned} document(s), ` +
    `${docsWithNodes} carried nodes (map ${formCounts.map}, msgpack ${formCounts.bytes}), ` +
    `${nodesWithSx} node(s) with sx, ${nodesWithHex} carrying literal hex, ` +
    `${gradientNodes} node(s) on gradient panels (text PINNED, not flipped), ` +
    `${docsChanged} document(s) needed changes, ` +
    `${slicesWritten} slice(s) ${apply ? 'written' : 'pending'}, ${slicesRemoved} removed.`,
)

if (palette.size) {
  console.log(`\nPalette — every light → dark mapping this run produces:`)
  for (const [key, count] of [...palette].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(count).padStart(5)}×  ${key}`)
}

if (unmapped.size) {
  console.log(
    `\n${unmapped.size} colour(s) fell through to the ALGORITHMIC fallback ` +
      `(hue kept, lightness inverted). Review these — a curated value in ` +
      `BG_MAP/FG_MAP is better wherever the colour has a known role:`,
  )
  for (const [key, count] of [...unmapped].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(count).padStart(5)}×  ${key}`)
}

if (violations.length) {
  console.error(`\n${violations.length} INVARIANT VIOLATION(S) — nothing safe to apply:`)
  for (const v of violations.slice(0, 40)) console.error(`  ${v}`)
  if (violations.length > 40)
    console.error(`  … and ${violations.length - 40} more`)
  process.exit(1)
}

/**
 * The gate (AGL-1292). `hasDarkScheme` requires a NON-EMPTY
 * `theme.colorSchemes.dark`, and it is host-wide — the moment this lands every
 * page of the site becomes dark-capable, migrated or not. Hence a separate
 * flag, and hence last.
 *
 * `background.paper` is `#202934` rather than `console.theme.ts`'s `#2a3440`
 * so that token-driven surfaces land on the same step of the ladder as the
 * hex-driven cards above; `#2a3440` stays reserved for the deliberately lifted
 * Pro/Enterprise card.
 */
const DARK_SCHEME = {
  primary: { main: '#00b0ff', contrastText: '#FFFFFF' },
  secondary: { main: '#e040fb', contrastText: '#FFFFFF' },
  tertiary: { main: '#7C8CA3', contrastText: '#000000DE' },
  surface: { main: '#202934', contrastText: '#FFFFFF' },
  background: { default: '#161c21', paper: '#202934' },
  text: { primary: '#e6e9ec', secondary: '#9aa5b1', disabled: '#6b7683' },
  divider: 'rgba(255,255,255,0.12)',
}

if (openGate) {
  if (!onlyHost) {
    console.error('\n--open-gate requires --host=<hostId>. Refusing to open every host.')
    process.exit(1)
  }
  if (docsChanged && !apply) {
    console.error(
      '\n--open-gate refused: this run still has pending slice changes. ' +
        'Migrate and review first, then open the gate on a clean run.',
    )
    process.exit(1)
  }
  console.log(
    `\n${apply ? 'OPENING' : 'would open'} the dark gate on host ${onlyHost} ` +
      `(theme.colorSchemes.dark)`,
  )
  console.log(JSON.stringify(DARK_SCHEME, null, 2))
  if (apply) {
    await firestore
      .collection('hosts')
      .doc(onlyHost)
      .set(
        { theme: { colorSchemes: { dark: DARK_SCHEME } }, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    console.log('Gate OPEN. Revalidate the host, then sweep contrast in dark.')
  }
}

/**
 * The undo. `hasDarkScheme` requires a NON-EMPTY `colorSchemes.dark`, so
 * deleting the key puts the site back to light everywhere — the AGL-1292
 * behaviour — without touching a single node slice. Opening the gate is the
 * only step here with a public blast radius, so it gets a one-command revert.
 */
if (closeGate) {
  if (!onlyHost) {
    console.error('\n--close-gate requires --host=<hostId>.')
    process.exit(1)
  }
  console.log(
    `\n${apply ? 'CLOSING' : 'would close'} the dark gate on host ${onlyHost} ` +
      `— the site renders light again; node slices are left in place.`,
  )
  if (apply) {
    await firestore
      .collection('hosts')
      .doc(onlyHost)
      .update({
        'theme.colorSchemes.dark': FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    console.log('Gate CLOSED. Pages pick it up on their next ISR regeneration.')
  }
}

if (!apply) console.log('\nRe-run with --apply to write.')
