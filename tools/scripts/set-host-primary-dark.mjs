/**
 * Give the host palette an accessible `primary.dark`, per scheme (AGL-1293).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/set-host-primary-dark.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * The companion to `fix-brand-blue-token.mjs`, and it must run FIRST: that
 * script points 616 nodes at `primary.dark`, and this one decides what
 * `primary.dark` is.
 *
 * Left to MUI the shade is derived — `darken(primary.main, 0.3)`, which from
 * `#00b0ff` gives `#007bb2`. That measures 4.69 on white but only 4.49 on
 * `#fafafa` and 4.27 on the Pro tint `#eaf6fd`, so it misses AA on two of the
 * three surfaces the marketing site actually uses. Deriving is not enough; the
 * value has to be chosen. This writes it explicitly for both schemes:
 *
 *   light  #0073ae   the first blue clearing 4.5:1 on ALL THREE surfaces
 *   dark   #4fc3f7   what the dark slices already paint — appearance unchanged
 *
 * Every ratio above is recomputed at run time and printed, and the script
 * REFUSES to apply if any of them regress below AA. The numbers in this comment
 * are therefore checkable rather than remembered.
 *
 * A note on semantics, because it is a real caveat: in the dark scheme this
 * makes `primary.dark` LIGHTER than `primary.main`. That reads oddly, but it is
 * correct for the one thing MUI derives from it here — a contained button's
 * hover — which conventionally lightens in dark mode. It also means a future
 * palette GENERATOR that recomputes shades by darkening will overwrite this and
 * silently break dark mode. Making the generator scheme-aware is the follow-up;
 * this script only fixes the host in front of us.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const hostId = hostArg ? hostArg.slice('--host='.length) : 'DXnRbPH4CQ'

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

const LIGHT_PRIMARY_DARK = '#0073ae'
const DARK_PRIMARY_DARK = '#4fc3f7'

/** WCAG 2.x relative luminance. */
function luminance(hex) {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value.split('').map((c) => c + c).join('')
      : value.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** The surfaces this blue actually lands on, measured from the live node data. */
const LIGHT_SURFACES = {
  'white': '#ffffff',
  'grey 50 #fafafa': '#fafafa',
  'Pro tint #eaf6fd': '#eaf6fd',
  'panel #f1f3f5': '#f1f3f5',
  'blue tint #e6f5ff': '#e6f5ff',
}
const DARK_SURFACES = {
  'page #161c21': '#161c21',
  'paper #202934': '#202934',
  'raised #242b33': '#242b33',
  'tint #143043': '#143043',
}

const AA_NORMAL = 4.5
let failures = 0

console.log('=== light scheme — primary.dark ' + LIGHT_PRIMARY_DARK + ' ===')
for (const [name, bg] of Object.entries(LIGHT_SURFACES)) {
  const ratio = contrast(LIGHT_PRIMARY_DARK, bg)
  const ok = ratio >= AA_NORMAL
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2)}  on ${name}`)
}
console.log('\n=== dark scheme — primary.dark ' + DARK_PRIMARY_DARK + ' ===')
for (const [name, bg] of Object.entries(DARK_SURFACES)) {
  const ratio = contrast(DARK_PRIMARY_DARK, bg)
  const ok = ratio >= AA_NORMAL
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2)}  on ${name}`)
}

console.log('\n=== what we are replacing, for the record ===')
for (const [name, bg] of Object.entries(LIGHT_SURFACES)) {
  console.log(
    `  #0090d9 ${contrast('#0090d9', bg).toFixed(2)} · ` +
      `#00b0ff ${contrast('#00b0ff', bg).toFixed(2)} · ` +
      `derived #007bb2 ${contrast('#007bb2', bg).toFixed(2)}   on ${name}`,
  )
}

if (failures) {
  console.error(`\nREFUSING — ${failures} surface(s) below AA ${AA_NORMAL}:1.`)
  process.exit(1)
}

const ref = firestore.collection('hosts').doc(hostId)
const snapshot = await ref.get()
if (!snapshot.exists) {
  console.error(`\nhost ${hostId} not found`)
  process.exit(1)
}

const theme = snapshot.get('theme') ?? {}
const schemes = theme.colorSchemes ?? {}
const lightPrimary = schemes.light?.primary ?? {}
const darkPrimary = schemes.dark?.primary ?? {}

console.log('\n=== current host palette ===')
console.log(`  light.primary  ${JSON.stringify(lightPrimary)}`)
console.log(`  dark.primary   ${JSON.stringify(darkPrimary)}`)

/**
 * `mergeThemeOptions` replaces a colour record WHOLE rather than deep-merging,
 * so the write has to carry `main` and `contrastText` forward or they fall back
 * to the console base — which happens to match today, but would not survive a
 * host that had customized them.
 */
const nextLight = {
  main: lightPrimary.main ?? '#00b0ff',
  ...(lightPrimary.light && { light: lightPrimary.light }),
  dark: LIGHT_PRIMARY_DARK,
  contrastText: lightPrimary.contrastText ?? '#FFFFFF',
}
const nextDark = {
  main: darkPrimary.main ?? '#00b0ff',
  ...(darkPrimary.light && { light: darkPrimary.light }),
  dark: DARK_PRIMARY_DARK,
  contrastText: darkPrimary.contrastText ?? '#FFFFFF',
}

console.log('\n=== next host palette ===')
console.log(`  light.primary  ${JSON.stringify(nextLight)}`)
console.log(`  dark.primary   ${JSON.stringify(nextDark)}`)

const alreadyDone =
  lightPrimary.dark === LIGHT_PRIMARY_DARK && darkPrimary.dark === DARK_PRIMARY_DARK
if (alreadyDone) {
  console.log('\nAlready set — nothing to do (idempotent).')
  process.exit(0)
}

if (apply) {
  await ref.update({
    'theme.colorSchemes.light.primary': nextLight,
    'theme.colorSchemes.dark.primary': nextDark,
    updatedAt: FieldValue.serverTimestamp(),
  })
  console.log('\nAPPLIED.')
} else {
  console.log('\nDRY RUN — re-run with --apply to write.')
}
