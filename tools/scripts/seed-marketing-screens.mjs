/**
 * Seed the remaining aglyn-marketing screens from the SEO map (AGL-1170).
 *
 *   node seed-marketing-screens.mjs [--apply]
 *
 * DRY RUN BY DEFAULT.
 *
 * Mirrors exactly what the console's create-screen form writes, verified
 * against the existing docs:
 *
 *   hosts/{h}/screens/{id}                 displayName, description, slug,
 *                                          nameLower, versionId, parentId?,
 *                                          order?, layoutId?, createdAt,
 *                                          updatedAt, publishedAt
 *   hosts/{h}/screens/{id}/versions/{vid}  screenId, createdAt, updatedAt,
 *                                          nodes: { '_@_': empty div root }
 *   hosts/{h}.screens[{id}]                the COMPOSED route path
 *
 * `slug` is the screen's OWN segment with no leading slash; the routing-map
 * path is the ancestor chain joined by '/' (composeScreenRoutePath). Home is
 * the only '/' entry and contributes no segment to its children.
 *
 * Every screen is created bound to the `Marketing base` layout, so new pages
 * render the shared nav/footer from the first load.
 *
 * Idempotent: a slug that already exists under the same parent is skipped.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

const apply = process.argv.includes('--apply')
const HOST = 'DXnRbPH4CQ'
const LAYOUT = 'IWHn36dA9w'
const ROOT_NODE = '_@_'

// Existing parents, from the live data.
const PRODUCT = 'V0B8e81t1-'
const SOLUTIONS = 'eASC4CX44X'
const USE_CASES = 'SUbVFdFMhq'

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/** Same alphabet/length as the console's createIdUrlSafe. */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function createId(length = 10) {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

// `legal` is created first so its children can reference it by key.
const SPECS = [
  // Product children — besigner already exists at order 0.
  { key: 'product-console', name: 'Console', slug: 'console', parent: PRODUCT, order: 1, description: 'Product detail — Console.' },
  { key: 'product-commerce', name: 'Commerce', slug: 'commerce', parent: PRODUCT, order: 2, description: 'Product detail — Commerce.' },
  { key: 'product-forms', name: 'Forms & Inbox', slug: 'forms', parent: PRODUCT, order: 3, description: 'Product detail — Forms & Inbox.' },
  { key: 'product-media', name: 'Media', slug: 'media', parent: PRODUCT, order: 4, description: 'Product detail — Media.' },
  { key: 'product-workflows', name: 'Workflows', slug: 'workflows', parent: PRODUCT, order: 5, description: 'Product detail — Workflows.' },
  { key: 'product-plugins', name: 'Plugins', slug: 'plugins', parent: PRODUCT, order: 6, description: 'Product detail — Plugins & Marketplace.' },
  { key: 'product-analytics', name: 'Analytics', slug: 'analytics', parent: PRODUCT, order: 7, description: 'Product detail — Analytics.' },
  { key: 'product-marketing', name: 'Marketing', slug: 'marketing', parent: PRODUCT, order: 8, description: 'Product detail — Marketing.' },

  // Commercial
  { key: 'demo', name: 'Demo', slug: 'demo', description: 'Book a demo.' },
  { key: 'contact-sales', name: 'Contact sales', slug: 'contact-sales', description: 'Contact sales.' },

  // Solutions children
  { key: 'sol-agencies', name: 'Agencies', slug: 'agencies', parent: SOLUTIONS, order: 0, description: 'Solutions — Agencies.' },
  { key: 'sol-startups', name: 'Startups', slug: 'startups', parent: SOLUTIONS, order: 1, description: 'Solutions — Startups.' },
  { key: 'sol-creators', name: 'Creators', slug: 'creators', parent: SOLUTIONS, order: 2, description: 'Solutions — Creators.' },
  { key: 'sol-developers', name: 'Developers', slug: 'developers', parent: SOLUTIONS, order: 3, description: 'Solutions — Developers.' },
  { key: 'sol-enterprise', name: 'Enterprise', slug: 'enterprise', parent: SOLUTIONS, order: 4, description: 'Solutions — Enterprise.' },
  { key: 'sol-small-business', name: 'Small business', slug: 'small-business', parent: SOLUTIONS, order: 5, description: 'Solutions — Small business.' },

  // Use cases children
  { key: 'uc-online-stores', name: 'Online stores', slug: 'online-stores', parent: USE_CASES, order: 0, description: 'Use case — Online stores.' },
  { key: 'uc-portfolios', name: 'Portfolios', slug: 'portfolios', parent: USE_CASES, order: 1, description: 'Use case — Portfolios.' },
  { key: 'uc-blogs', name: 'Blogs', slug: 'blogs', parent: USE_CASES, order: 2, description: 'Use case — Blogs.' },
  { key: 'uc-saas-websites', name: 'SaaS websites', slug: 'saas-websites', parent: USE_CASES, order: 3, description: 'Use case — SaaS websites.' },
  { key: 'uc-documentation', name: 'Documentation', slug: 'documentation', parent: USE_CASES, order: 4, description: 'Use case — Documentation.' },
  { key: 'uc-membership-sites', name: 'Membership sites', slug: 'membership-sites', parent: USE_CASES, order: 5, description: 'Use case — Membership sites.' },

  // Legal index, then its children (parent resolved by key below).
  { key: 'legal', name: 'Legal', slug: 'legal', description: 'Legal index.' },
  { key: 'legal-privacy', name: 'Privacy Policy', slug: 'privacy', parentKey: 'legal', order: 0, description: 'Legal — Privacy Policy.' },
  { key: 'legal-terms', name: 'Terms of Service', slug: 'terms', parentKey: 'legal', order: 1, description: 'Legal — Terms of Service.' },
  { key: 'legal-eula', name: 'EULA', slug: 'eula', parentKey: 'legal', order: 2, description: 'Legal — End User Licence Agreement.' },
  { key: 'legal-acceptable-use', name: 'Acceptable Use', slug: 'acceptable-use', parentKey: 'legal', order: 3, description: 'Legal — Acceptable Use Policy.' },
  { key: 'legal-cookies', name: 'Cookie Policy', slug: 'cookies', parentKey: 'legal', order: 4, description: 'Legal — Cookie Policy.' },
  { key: 'legal-dmca', name: 'DMCA', slug: 'dmca', parentKey: 'legal', order: 5, description: 'Legal — DMCA Policy.' },
  { key: 'legal-dpa', name: 'DPA', slug: 'dpa', parentKey: 'legal', order: 6, description: 'Legal — Data Processing Addendum.' },
  { key: 'legal-subprocessors', name: 'Subprocessors', slug: 'subprocessors', parentKey: 'legal', order: 7, description: 'Legal — Subprocessors.' },

  // Content / audience
  { key: 'newsroom', name: 'Newsroom', slug: 'newsroom', description: 'Newsroom listing.' },
  { key: 'developers-home', name: 'Home — Developers', slug: 'developers-home', description: 'Developer-audience homepage.' },

  // Error screens. Only three slots exist on the host (`errorScreens`:
  // notFound / unauthorized / unavailable) — there is no `forbidden`, so the
  // design's 403 has nowhere to bind and is deliberately NOT created.
  { key: 'err-404', name: 'Not found (404)', slug: '404', description: 'Error screen — 404 Not found.' },
  { key: 'err-401', name: 'Unauthorized (401)', slug: '401', description: 'Error screen — 401 Unauthorized.' },
  { key: 'err-503', name: 'Unavailable (503)', slug: '503', description: 'Error screen — 503 Unavailable.' },
]

const hostRef = firestore.collection('hosts').doc(HOST)
const screensRef = hostRef.collection('screens')

const existingSnap = await screensRef.get()
const existing = new Map()
for (const d of existingSnap.docs) {
  existing.set(`${d.get('parentId') ?? ''}::${d.get('slug')}`, d.id)
}
const hostSnap = await hostRef.get()
const routingMap = hostSnap.get('screens') ?? {}

const slugById = new Map(existingSnap.docs.map((d) => [d.id, d.get('slug')]))
const parentById = new Map(
  existingSnap.docs.map((d) => [d.id, d.get('parentId')]),
)

/** composeScreenRoutePath, for the ancestors that already exist. */
function composePath(slug, parentId) {
  const segments = [slug]
  let cursor = parentId
  let guard = 0
  while (cursor && guard < 32) {
    guard += 1
    const s = slugById.get(cursor)
    if (!s) return undefined
    if (s !== '/') segments.unshift(s)
    cursor = parentById.get(cursor)
  }
  return segments.join('/')
}

const keyToId = new Map()
const planned = []
let skipped = 0

for (const spec of SPECS) {
  const parentId = spec.parentKey ? keyToId.get(spec.parentKey) : spec.parent
  const dedupeKey = `${parentId ?? ''}::${spec.slug}`
  if (existing.has(dedupeKey)) {
    keyToId.set(spec.key, existing.get(dedupeKey))
    skipped += 1
    console.log(`skip   ${spec.slug.padEnd(18)} already exists`)
    continue
  }
  const id = createId()
  keyToId.set(spec.key, id)
  // Register locally so the next spec's composePath can walk through it.
  slugById.set(id, spec.slug)
  parentById.set(id, parentId)
  const path = composePath(spec.slug, parentId)
  planned.push({ ...spec, id, parentId, path, versionId: createId() })
  console.log(
    `create ${spec.slug.padEnd(18)} -> /${path}${parentId ? `   (child of ${parentId})` : ''}`,
  )
}

// Collision check against paths already claimed by a different screen.
const claimed = new Map(Object.entries(routingMap).map(([id, p]) => [p, id]))
const collisions = planned.filter((p) => claimed.has(p.path))
if (collisions.length) {
  console.error(
    `\nABORT — ${collisions.length} path(s) already claimed: ` +
      collisions.map((c) => `${c.path} (by ${claimed.get(c.path)})`).join(', '),
  )
  process.exit(1)
}

console.log(
  `\n${apply ? 'APPLYING' : 'DRY RUN'} — ${planned.length} to create, ${skipped} skipped.`,
)

if (apply) {
  const now = Timestamp.now()
  for (const p of planned) {
    const screenDoc = {
      displayName: p.name,
      description: p.description,
      slug: p.slug,
      nameLower: p.name.toLowerCase(),
      versionId: p.versionId,
      layoutId: LAYOUT,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      ...(p.parentId ? { parentId: p.parentId, order: p.order ?? 0 } : {}),
    }
    await screensRef.doc(p.id).set(screenDoc)
    await screensRef
      .doc(p.id)
      .collection('versions')
      .doc(p.versionId)
      .set({
        screenId: p.id,
        createdAt: now,
        updatedAt: now,
        nodes: {
          [ROOT_NODE]: { $id: ROOT_NODE, componentId: 'div', nodes: [] },
        },
      })
    await hostRef.update({ [`screens.${p.id}`]: p.path })
    console.log(`  created ${p.id}  /${p.path}`)
  }
  console.log(`\nDone — ${planned.length} screen(s) created and published.`)
} else {
  console.log('Re-run with --apply to write.')
}

// Emit the key -> id map so the link-binding pass can consume it.
console.log('\nID MAP')
console.log(JSON.stringify(Object.fromEntries(keyToId), null, 1))
