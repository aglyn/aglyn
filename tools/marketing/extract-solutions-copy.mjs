/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Extracts one `solutions-copy/copy-<page>.json` per solutions/use-case detail
 * frame from a Figma `get_metadata` dump of the 🎯 Solutions canvas (AGL-1277).
 *
 * Why a dump and not the MCP directly: `get_metadata` on the canvas is ~376 KB
 * and overflows the tool's output limit, so it lands in a file. That file is
 * the input here. Regenerate it with `get_metadata` on canvas `163:89`.
 *
 * The text of a Figma text node is carried in its `name` attribute in this
 * dump, so the copy is extracted verbatim rather than transcribed from a
 * screenshot — the same property the product-copy files rely on.
 *
 *   node tools/marketing/extract-solutions-copy.mjs <dump.txt> [outDir]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const dumpPath = process.argv[2]
const outDir = process.argv[3] || join(HERE, 'solutions-copy')

if (!dumpPath) {
  console.error('usage: extract-solutions-copy.mjs <dump.txt> [outDir]')
  process.exit(1)
}

/** Frames we care about, and the route each one is the design for. */
const PAGES = [
  ['Solutions — Listing', '/solutions', 'solutions-listing'],
  ['Solutions — Agencies', '/solutions/agencies', 'agencies'],
  ['Solutions — Startups', '/solutions/startups', 'startups'],
  ['Solutions — Creators', '/solutions/creators', 'creators'],
  ['Solutions — Developers', '/solutions/developers', 'developers'],
  ['Solutions — Enterprise', '/solutions/enterprise', 'enterprise'],
  ['Solutions — Small business', '/solutions/small-business', 'small-business'],
  ['Use case — Online stores', '/use-cases/online-stores', 'online-stores'],
  ['Use case — Portfolios', '/use-cases/portfolios', 'portfolios'],
  ['Use case — Blogs', '/use-cases/blogs', 'blogs'],
  ['Use case — SaaS websites', '/use-cases/saas-websites', 'saas-websites'],
  ['Use case — Documentation', '/use-cases/documentation', 'documentation'],
  ['Use case — Membership sites', '/use-cases/membership-sites', 'membership-sites'],
]

// ---------------------------------------------------------------- parse

const raw = JSON.parse(readFileSync(dumpPath, 'utf8'))
const xml = raw.map((r) => r?.text ?? '').join('')
const canvas = xml.slice(xml.indexOf('<canvas'), xml.lastIndexOf('</canvas>') + 9)

/** Minimal indentation-driven parse — the dump is machine-generated and flat. */
const NODE = /^(\s*)<(\w+)\s+([^>]*?)(\/?)>\s*$/
const ATTR = /(\w+)="([^"]*)"/g

function parse(text) {
  const stack = []
  let root = null
  for (const line of text.split('\n')) {
    const m = line.match(NODE)
    if (!m) continue
    const [, indent, tag, attrText, selfClose] = m
    const attrs = {}
    for (const a of attrText.matchAll(ATTR)) attrs[a[1]] = a[2]
    const { id, name = '', width, height } = attrs
    if (!id) continue
    const depth = indent.length / 2
    const node = {
      tag,
      id,
      name: decode(name),
      width: width ? Number(width) : null,
      height: height ? Number(height) : null,
      children: [],
    }
    while (stack.length > depth) stack.pop()
    if (stack.length === 0) root = node
    else stack[stack.length - 1].children.push(node)
    if (!selfClose) stack.push(node)
  }
  return root
}

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

// ---------------------------------------------------------------- shape

const isChrome = (n) =>
  n.tag === 'instance' && /^(NavBar|Footer)$/i.test(n.name)

/** Text nodes in document order, with their ids. */
function textsOf(node) {
  const out = []
  const walk = (n) => {
    if (n.tag === 'text' && n.name.trim()) out.push({ id: n.id, text: n.name.trim() })
    n.children.forEach(walk)
  }
  walk(node)
  return out
}

const EYEBROW = /^[A-Z0-9][A-Z0-9 ’'&·,./—-]{2,}$/

/** The node whose children include `childId`, searched from `root`. */
function findParentOf(root, childId) {
  let found = null
  const walk = (n) => {
    if (n.children.some((c) => c.id === childId)) found = n
    else n.children.forEach(walk)
  }
  walk(root)
  return found
}

/**
 * Repeated cards: sibling frames under one parent that share a width AND a
 * text count. Requiring a uniform text count is what stops a section's own
 * eyebrow being absorbed as a card — `WHAT'S INCLUDED` sits in a sibling of
 * the grid, so a looser rule pairs it with a real card and eats the heading.
 */
function itemsOf(section) {
  let best = []
  const walk = (n) => {
    const sibs = n.children.filter((c) => c.tag === 'frame' && textsOf(c).length >= 1)
    if (sibs.length >= 2) {
      const groups = new Map()
      for (const s of sibs) {
        // ROUND. Figma emits a float tail from auto-layout division: the
        // three how-it-works cards are 405.3333435058594, 405.33331298828125
        // and 405.33331298828125. Keying on the exact float puts card 01 in a
        // group of one, which is then dropped — the page still extracts and
        // still validates, it just silently loses its first step.
        const key = String(Math.round(s.width ?? 0))
        groups.set(key, [...(groups.get(key) || []), s])
      }
      for (const group of groups.values()) {
        // Keep the modal text-count, not an exact match. Exact uniformity
        // drops a real card whose body wraps to one line fewer; grouping by
        // width alone lets a header block that happens to share the grid
        // width be read as a card, which is how `WHAT'S INCLUDED` was eaten.
        const counts = new Map()
        for (const s of group) {
          const c = textsOf(s).length
          counts.set(c, (counts.get(c) || 0) + 1)
        }
        const mode = [...counts.entries()].sort(
          (a, b) => b[1] - a[1] || b[0] - a[0],
        )[0]?.[0]
        const kept = group.filter((s) => textsOf(s).length === mode)
        if (kept.length >= 2 && kept.length > best.length) best = kept
      }
    }
    n.children.forEach(walk)
  }
  walk(section)

  return best.map((g) => {
    const t = textsOf(g).map((x) => x.text)
    // AGL-1233: a how-it-works card leads with a step numeral, which is
    // display copy, not a label. Flattening it as the title publishes
    // "01 / 02 / 03" as the card headings.
    const meta = /^\d{1,2}$/.test(t[0] ?? '') ? t.shift() : null
    return {
      figmaNodeId: g.id,
      meta,
      title: t[0] ?? null,
      body: t[1] ?? null,
      extra: t.slice(2),
    }
  })
}

function sectionOf(section, index) {
  const texts = textsOf(section)
  const items = itemsOf(section)
  // Order-based, not set-based: the lead is whatever precedes the first card
  // in document order. A set difference misfiles any lead line whose text
  // also happens to appear inside a card.
  const firstItemId = items[0]?.figmaNodeId
  const itemIds = new Set(items.map((i) => i.figmaNodeId))
  const inItems = new Set()
  const collect = (n) => {
    if (itemIds.has(n.id)) textsOf(n).forEach((t) => inItems.add(t.id))
    n.children.forEach(collect)
  }
  collect(section)
  const lead = texts.filter((t) => !inItems.has(t.id))

  let eyebrow = null
  let rest = lead
  if (lead.length && EYEBROW.test(lead[0].text) && lead[0].text.length < 48) {
    eyebrow = lead[0].text
    rest = lead.slice(1)
  }
  const heading = rest[0]?.text ?? null
  const body = rest.slice(1).map((t) => t.text)
  void firstItemId

  // A dropped card is the failure mode that matters here: the file still
  // parses, every field is populated, and nothing looks wrong — the page is
  // just missing a step. So assert that every sibling of a kept card was
  // itself kept, and fail loudly rather than emit a plausible short grid.
  if (items.length) {
    const parent = findParentOf(section, items[0].figmaNodeId)
    const siblings = (parent?.children ?? []).filter(
      (c) => c.tag === 'frame' && textsOf(c).length >= 1,
    )
    if (siblings.length && siblings.length !== items.length) {
      throw new Error(
        `${section.id}: grid has ${siblings.length} cards but ${items.length} ` +
          `were extracted — dropped ${siblings
            .filter((s) => !items.some((i) => i.figmaNodeId === s.id))
            .map((s) => s.id)
            .join(', ')}`,
      )
    }
  }

  return {
    kind: null, // filled in by hand during review — the frame does not name it
    figmaNodeId: section.id,
    order: index,
    heightPx: section.height,
    eyebrow,
    heading,
    subheading: null,
    body,
    actions: [],
    items,
    image: null,
    notes: null,
  }
}

// ---------------------------------------------------------------- emit

const page = parse(canvas)
if (!page) throw new Error('could not parse canvas from dump')

const byName = new Map(page.children.map((c) => [c.name, c]))
mkdirSync(outDir, { recursive: true })

const summary = []
for (const [frameName, route, slug] of PAGES) {
  const frame = byName.get(frameName)
  if (!frame) {
    summary.push([slug, 'MISSING FRAME', 0])
    continue
  }
  const body = frame.children.filter((c) => !isChrome(c))
  const sections = body.map(sectionOf)
  const doc = {
    page: frameName.replace(/^(Solutions|Use case) — /, ''),
    route,
    figmaNodeId: frame.id,
    frameName,
    frameSize: { width: frame.width, height: Math.round(frame.height) },
    notes:
      'Extracted verbatim from the Figma frame by ' +
      'tools/marketing/extract-solutions-copy.mjs (AGL-1277). `kind` and ' +
      '`notes` are left null for a human pass — the frame does not name its ' +
      'own section types.',
    sections,
    claimsToVerify: [],
  }
  writeFileSync(join(outDir, `copy-${slug}.json`), JSON.stringify(doc, null, 2) + '\n')
  summary.push([slug, frame.id, sections.length])
}

for (const [slug, id, n] of summary) {
  console.log(`  ${slug.padEnd(18)} ${String(id).padEnd(12)} ${n} sections`)
}
