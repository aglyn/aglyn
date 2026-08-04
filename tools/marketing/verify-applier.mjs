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
import { readFileSync } from 'node:fs'

const SLOTS = [5, 1, 14, 9, 11, 17, 13, 4]
const PAGES = ['console','commerce','forms','media','workflows','plugins','analytics','marketing']

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

function stubCanvas() {
  const nodes = new Map()
  const root = { nodes: [] }
  nodes.set('_@_', root)
  SLOTS.forEach((n, i) => {
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

console.log(failures ? `\nFAILED — ${failures} check(s)` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
