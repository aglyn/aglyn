/**
 * Harness for `apply-page-copy.js`. Run from the repo root:
 *
 *   node tools/marketing/verify-applier.mjs
 *
 * The earlier stub counted `updateNodeProps` calls, which proves the PLAN —
 * slot counts, ordering, the refusal on a mismatch — and is blind to what a
 * write actually does. That gap shipped AGL-1227: the applier passed
 * `{ children }` alone, `updateNodeProps` REPLACES the prop bag rather than
 * merging into it, and every heading silently lost `component: 'h1'` while
 * still painting at 72px from its own `sx`. A no-op stub cannot see that.
 *
 * So this stub models the real replace semantics and asserts the EFFECT.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const SLOTS = [5, 1, 14, 9, 11, 17, 13, 4]
const PAGES = ['console','commerce','forms','media','workflows','plugins','analytics','marketing']
/** Decks whose Explore grid carries the whole roster, so section 5 is wider. */
const TEN_CARD_PAGES = ['datasets', 'ai']

/** Early-access is section 6; its 4 stat pairs start after eyebrow+heading+intro+2 actions. */
const SLOT_INDEX = { earlyaccess: { section: 6, first: 5 } }
const EXPECTED_STATS = [
  '1', 'platform, not a stack',
  '9', 'products built in',
  '0', 'plugins to wire up',
  '1-click', 'to publish',
]
const src = readFileSync('tools/marketing/apply-page-copy.js', 'utf8')

/**
 * Text nodes shaped like the real skeleton: seven headings carry `component`,
 * the hero body carries `variant`. Those are the props AGL-1227 destroyed.
 */
const AUTHORED = {
  '0:1': { component: 'h1' }, '0:2': { variant: 'body1' },
  '2:1': { component: 'h2' }, '3:1': { component: 'h2' }, '4:1': { component: 'h2' },
  '5:1': { component: 'h2' }, '6:1': { component: 'h2' }, '7:0': { component: 'h2' },
}

function stubCanvas(slots = SLOTS) {
  const nodes = new Map()
  const root = { nodes: [] }
  nodes.set('_@_', root)
  slots.forEach((n, i) => {
    const kids = []
    for (let k = 0; k < n; k++) {
      const id = `${i}:${k}`
      nodes.set(id, {
        id,
        componentId: 'muiTypography',
        props: { children: `skeleton ${id}`, ...(AUTHORED[id] ?? {}) },
        sx: { fontSize: '72px' },
        nodes: [],
      })
      kids.push(id)
    }
    nodes.set(`s${i}`, { props: {}, nodes: kids })
    root.nodes.push(`s${i}`)
  })
  return {
    getNode: (id) => nodes.get(id),
    saveHistory() {},
    // The real CanvasManager REPLACES props. Modelling that is the point.
    updateNodeProps(node, props) { node.props = { ...props } },
    _nodes: nodes,
  }
}

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  ✗ ${msg}`) } else console.log(`  ✓ ${msg}`) }

for (const page of PAGES) {
  const COPY = JSON.parse(readFileSync(`tools/marketing/product-copy/copy-${page}.json`, 'utf8'))
  const canvas = stubCanvas()
  globalThis.window = { AglynModule: { canvas, CANVAS_ROOT_ELEMENT_ID: '_@_' } }
  const applyPageCopy = eval(`${src}; applyPageCopy`)

  const dry = applyPageCopy(COPY, { dryRun: true })
  if (dry.problems?.length) { failures++; console.log(`${page}\n  ✗ ${dry.problems.join('\n  ✗ ')}`); continue }
  const res = applyPageCopy(COPY, { dryRun: false })

  console.log(`${page} — ${res.wrote} writes`)
  check(res.wrote >= 73 && res.wrote <= 74, `73-74 writes (got ${res.wrote})`)
  // The regression AGL-1227 was: authored props gone after a write.
  const lost = Object.entries(AUTHORED).filter(([id, want]) => {
    const p = canvas._nodes.get(id).props
    return Object.entries(want).some(([k, v]) => p[k] !== v)
  }).map(([id]) => id)
  check(lost.length === 0, `authored props survive the write (lost: ${lost.join(', ') || 'none'})`)
  const blank = [...canvas._nodes.values()].filter((n) => n.componentId === 'muiTypography' && !String(n.props.children ?? '').trim())
  check(blank.length === 0, `no node left blank (${blank.length} blank)`)

  // AGL-1233: the early-access band is figure-then-label, four times over. The
  // applier used to flatten `[meta, title]`, and `meta` on a stat item is the
  // extractor's type tag "stat" — so the band published "stat" as the figure on
  // every poured page. A slot COUNT of 13 is satisfied by either flatten, which
  // is precisely why nothing caught it; assert the values, not the arity.
  const stats = SLOT_INDEX.earlyaccess
  const got = Array.from({ length: 8 }, (_, k) => canvas._nodes.get(`${stats.section}:${stats.first + k}`).props.children)
  check(
    got.every((v, k) => v === EXPECTED_STATS[k]),
    `stat band is figure-then-label (got ${JSON.stringify(got.slice(0, 4))}…)`,
  )
}

// The guard itself must still refuse a positional shift.
{
  const COPY = JSON.parse(readFileSync('tools/marketing/product-copy/copy-console.json', 'utf8'))
  const shifted = structuredClone(COPY)
  shifted.sections.find((s) => s.kind === 'capabilities').items.pop()
  globalThis.window = { AglynModule: { canvas: stubCanvas(), CANVAS_ROOT_ELEMENT_ID: '_@_' } }
  const applyPageCopy = eval(`${src}; applyPageCopy`)
  console.log('guard')
  check(applyPageCopy(shifted, { dryRun: true }).problems?.length > 0, 'refuses a section one card short')
  const ov = JSON.parse(readFileSync('tools/marketing/product-copy/copy-product-overview.json', 'utf8'))
  check(applyPageCopy(ov, { dryRun: true }).problems?.length > 0, 'refuses copy-product-overview (11 sections)')
}

// Explore carries one card per product other than the page's own, so its slot
// count comes from the copy rather than from a fixed contract. A ten-card deck
// must pour into a ten-card grid and be refused by a seven-card one.
for (const page of TEN_CARD_PAGES) {
  const COPY = JSON.parse(readFileSync(`tools/marketing/product-copy/copy-${page}.json`, 'utf8'))
  const explore = COPY.sections.find((s) => s.kind === 'explore')
  const slots = SLOTS.map((n, i) => (i === 5 ? 3 + 2 * explore.items.length : n))
  console.log(`${page} — ${explore.items.length} explore cards`)

  globalThis.window = { AglynModule: { canvas: stubCanvas(), CANVAS_ROOT_ELEMENT_ID: '_@_' } }
  let applyPageCopy = eval(`${src}; applyPageCopy`)
  check(applyPageCopy(COPY, { dryRun: true }).problems?.length > 0, 'refuses the deck on a seven-card Explore grid')

  const canvas = stubCanvas(slots)
  globalThis.window = { AglynModule: { canvas, CANVAS_ROOT_ELEMENT_ID: '_@_' } }
  applyPageCopy = eval(`${src}; applyPageCopy`)
  const res = applyPageCopy(COPY, { dryRun: false })
  // Every slot is written except the ones the copy leaves null, which on these
  // decks is the early-access chip — kept from the skeleton on the pages that
  // do not name it, poured on the ones that do (Aglyn AI changes it).
  const earlyAccess = COPY.sections.find((s) => s.kind === 'early-access')
  const kept = earlyAccess.eyebrow == null ? 1 : 0
  const expectedWrites = slots.reduce((sum, n) => sum + n, 0) - kept
  check(res.wrote === expectedWrites, `${expectedWrites} writes (got ${res.wrote}${res.problems ? `; ${res.problems.join('; ')}` : ''})`)
  const labels = explore.items.map((_, k) => canvas._nodes.get(`5:${3 + 2 * k}`).props.children)
  check(
    labels.every((label, k) => label === explore.items[k].title),
    `explore labels land in card order (last two: ${JSON.stringify(labels.slice(-2))})`,
  )
  const stats = earlyAccess.items.flatMap((item) => [item.title, item.body])
  const got = Array.from({ length: 8 }, (_, k) => canvas._nodes.get(`6:${5 + k}`).props.children)
  check(got.every((v, k) => v === stats[k]), `stat band is figure-then-label (got ${JSON.stringify(got.slice(0, 4))}…)`)
}

/**
 * The shared AI band (AGL-2921) is ONE block placed on many pages, and the
 * copy format has no section kind for it: `apply-page-copy.js` pours one
 * page's `sections` into one canvas and asserts the canvas holds exactly as
 * many root sections as the contract. So a page that already carries the band
 * is a page the applier refuses — pour first, place the band second, and
 * remove it before any re-pour. That ordering is the whole risk, so it is
 * asserted here rather than left in a README.
 */
{
  const BAND = JSON.parse(readFileSync('tools/marketing/shared-copy/band-ai.json', 'utf8'))
  console.log(`shared band — ${BAND.targets.length} targets`)

  // One band, not twenty-five copies: the wording lives here and nowhere else.
  const pageFiles = [...PAGES, ...TEN_CARD_PAGES].map(
    (page) => `tools/marketing/product-copy/copy-${page}.json`,
  )
  const forked = pageFiles.filter((file) => readFileSync(file, 'utf8').includes(BAND.heading))
  check(forked.length === 0, `the band's heading is in one file (forked into: ${forked.join(', ') || 'none'})`)

  // Its flatten arity is the contract a band-aware applier would assert.
  const flattened = [
    BAND.eyebrow,
    BAND.heading,
    BAND.body[0],
    BAND.actions[0]?.label,
    BAND.disclosure.body,
  ]
  check(flattened.length === BAND.slotContract.slots, `flattens to ${BAND.slotContract.slots} slots`)
  check(
    flattened.every((v) => typeof v === 'string' && v.trim()),
    'no slot is empty — the applier refuses to blank a node',
  )
  // The rolling-out line is the LAST slot so the flip deletes a trailing node.
  check(
    flattened.at(-1) === BAND.disclosure.body &&
      BAND.slotContract.slotsAfterFlip === BAND.slotContract.slots - 1,
    'the disclosure is the last slot and drops one at the flip',
  )
  const missing = BAND.targets
    .filter((t) => t.copyFile && !existsSync(`tools/marketing/${t.copyFile}`))
    .map((t) => t.copyFile)
  check(missing.length === 0, `every named copy file exists (missing: ${missing.join(', ') || 'none'})`)
  check(
    !BAND.targets.some((t) => t.route === '/product/ai'),
    'the band does not link the hub page to itself',
  )

  // The negative control: a canvas carrying the band has nine root sections,
  // and the applier must refuse it rather than pour eight sections' copy into
  // the wrong nine slots.
  const COPY = JSON.parse(readFileSync('tools/marketing/product-copy/copy-console.json', 'utf8'))
  const withBand = [...SLOTS.slice(0, 5), BAND.slotContract.slots, ...SLOTS.slice(5)]
  globalThis.window = {
    AglynModule: { canvas: stubCanvas(withBand), CANVAS_ROOT_ELEMENT_ID: '_@_' },
  }
  const applyPageCopy = eval(`${src}; applyPageCopy`)
  check(
    applyPageCopy(COPY, { dryRun: true }).problems?.length > 0,
    'refuses a canvas that already carries the band — pour first, place second',
  )
}

/**
 * The blog posts (AGL-2922). `blog-copy/post-<slug>.json` is prose, not slots,
 * so there is no arity to assert — the failure mode is different and worse: a
 * published post full of links to pages that do not exist. The keyword plan
 * these were written from is dated 2026-09-13 and names `/alternatives/framer`
 * and a docs path `ai/generate-a-page`, neither of which exists, so every link
 * is resolved here against the docs tree and against the routes the live
 * sitemap actually serves.
 *
 * The other thing asserted is the rolling-out disclosure. `release_ai_generative`
 * is off in production; each post carries the notice as a DISCRETE element
 * outside `body`, so the flip deletes one block per post rather than reopening
 * the prose. A disclosure whose words had leaked into a paragraph would look
 * identical in the JSON and be impossible to remove cleanly, so the check is
 * that `body` does not contain them.
 */
{
  /**
   * Routes `https://aglyn.com/sitemaps/pages/1.xml` served on 2026-09-20.
   * There is no repo record of what the marketing site publishes — it is a
   * besigner site — and `seed-marketing-screens.mjs` seeds only part of it
   * (no `/alternatives/*`, no `/pricing`). Re-read the sitemap before trusting
   * this list; a route that has since been built belongs in it, and a link to
   * a route that is NOT in it is a 404 on a published post.
   */
  const LIVE_ROUTES = new Set([
    '/pricing',
    '/product/besigner', '/product/console', '/product/crm', '/product/marketing',
    '/solutions/agencies',
    '/alternatives/duda', '/alternatives/webflow',
  ])
  const DOCS_ORIGIN = 'https://docs.aglyn.com/'
  const ROLLING_OUT = 'release-flagged feature, currently being rolled out'

  const posts = readdirSync('tools/marketing/blog-copy')
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, post: JSON.parse(readFileSync(`tools/marketing/blog-copy/${f}`, 'utf8')) }))
  console.log(`\nblog posts — ${posts.length} decks`)
  check(posts.length === 3, 'three posts (AI-Keyword-Plan.md §4 briefs 1-3)')

  const disclosures = new Set(posts.map(({ post }) => post.disclosure.body))
  check(disclosures.size === 1, `one rolling-out wording across every post (${disclosures.size} found)`)
  check([...disclosures][0]?.includes(ROLLING_OUT), 'it is the wording the docs use')

  for (const { f, post } of posts) {
    check(post.body.length === post.bodyContract.blocks, `${f}: ${post.bodyContract.blocks} blocks`)
    const body = post.body.join('\n\n')

    // The disclosure comes off as ONE block, so none of it may be in the prose.
    const leaked = post.disclosure.body
      .split(/(?<=\.)\s+/)
      .filter((sentence) => body.includes(sentence.trim()))
    check(leaked.length === 0 && post.disclosure.removeAtFlip === true,
      `${f}: the rolling-out notice is its own removable block`)

    // Every link the prose carries is declared with what it was checked
    // against, and every declared link is used — a link recorded and then cut
    // is a verification nobody needed.
    const used = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])
    const declared = new Set(post.internalLinks.map((l) => l.href))
    const undeclared = used.filter((href) => !declared.has(href))
    check(undeclared.length === 0, `${f}: every link is declared (${undeclared.join(', ') || 'none missing'})`)
    const unused = [...declared].filter((href) => !used.includes(href))
    check(unused.length === 0, `${f}: every declared link is used (${unused.join(', ') || 'none stray'})`)

    const dead = post.internalLinks.filter(({ href }) => {
      if (href.startsWith(DOCS_ORIGIN)) {
        const page = href.slice(DOCS_ORIGIN.length).split('#')[0]
        return !existsSync(`apps/docs/docs/${page}.md`)
      }
      return !LIVE_ROUTES.has(href.split('#')[0])
    })
    check(dead.length === 0, `${f}: every link resolves (${dead.map((l) => l.href).join(', ') || 'no 404s'})`)
    check(post.internalLinks.every((l) => l.verifiedAgainst),
      `${f}: every link records what it was checked against`)

    // `docs/PRICING_SURFACES.md` owns prices. A post may say "metered in
    // credits"; a figure of any currency on this surface is the bug.
    check(!/[$£€]\s?\d/.test(body), `${f}: no price figure`)
    check(post.claimsToVerify.length > 0 && post.claimsToVerify.every((c) => c.source && c.concern),
      `${f}: every flagged claim carries its source and its verdict`)
  }
}

console.log(failures ? `\nFAILED — ${failures} check(s)` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
