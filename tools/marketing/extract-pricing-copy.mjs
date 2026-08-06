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
 * Extracts `pricing-copy/copy-<variant>.json` from Figma `get_metadata` dumps
 * of the four Pricing frames (AGL-1278).
 *
 * Why a dump and not the MCP directly: `get_metadata` on any of these frames is
 * ~150 KB and overflows the tool's output limit, so it lands in a file. Those
 * files are the input here.
 *
 * The text of a Figma text node is carried in its `name` attribute in this
 * dump, so the copy is extracted verbatim rather than transcribed from a
 * screenshot — the same property solutions-copy relies on.
 *
 * WHY THIS IS NOT extract-solutions-copy.mjs: that extractor's unit is a card
 * in a grid, found by grouping same-width siblings. Pricing is tables — a
 * 15-row compare table, a fee ladder, plan feature lists — where every row is a
 * distinct two-cell record and the "cards" heuristic collapses them. So this
 * one preserves structure instead of classifying it, and leans on a much
 * stronger invariant to prove nothing was lost (see CONSERVATION below).
 *
 *   node tools/marketing/extract-pricing-copy.mjs <dump.txt>... [--out <dir>]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const outDir = outIdx === -1 ? join(HERE, 'pricing-copy') : argv[outIdx + 1]
const dumps = (outIdx === -1 ? argv : argv.slice(0, outIdx)).filter(Boolean)

if (!dumps.length) {
  console.error('usage: extract-pricing-copy.mjs <dump.txt>... [--out <dir>]')
  process.exit(1)
}

/**
 * Variant is keyed off the frame's own width, never off its name or the order
 * the dumps were passed in. Zach supplied four node ids without saying which
 * was which, and the ids do not sort by breakpoint — reading the width is the
 * only non-guessing way to tell a 768 tablet frame from a 1440 desktop one.
 */
const VARIANTS = [
  [375, 'mobile'],
  [768, 'tablet'],
  [1440, 'desktop'],
  [1920, 'widescreen'],
]

// ---------------------------------------------------------------- parse

/** Minimal indentation-driven parse — the dump is machine-generated and flat. */
const NODE = /^(\s*)<([\w-]+)\s+([^>]*?)(\/?)>\s*$/
const ATTR = /([\w-]+)="([^"]*)"/g

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

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

// ---------------------------------------------------------------- shape

const isChrome = (n) =>
  (n.tag === 'instance' || n.tag === 'frame') &&
  /^(NavBar|MobileNav|TabletNav|Footer|Footer\/Mobile)$/i.test(n.name)

const isText = (n) => n.tag === 'text' && n.name.trim() !== ''

/** Every text node under `node`, in document order. */
function textsOf(node) {
  const out = []
  const walk = (n) => {
    if (isText(n)) out.push(n)
    n.children.forEach(walk)
  }
  walk(node)
  return out
}

/**
 * A layout-only wrapper: a frame that carries no text of its own and has a
 * single child. Figma auto-layout emits chains of these ("Frame > Frame >
 * Frame") and keeping them buries the real content four levels deep for no
 * information gain. Collapsing is safe precisely because it is text-preserving.
 */
function collapse(node) {
  let n = node
  while (
    n.children.length === 1 &&
    !isText(n) &&
    !n.children[0].children.every(isText)
  ) {
    const only = n.children[0]
    if (isText(only)) break
    n = only
  }
  return n
}

/**
 * A "record" is the smallest frame that owns text directly or owns only text
 * leaves — a table row, a fee-ladder line, a plan feature bullet. This is the
 * unit the pricing page is actually made of.
 */
function recordsOf(node) {
  const out = []
  const walk = (n) => {
    const texts = textsOf(n)
    if (!texts.length) return
    const childFramesWithText = n.children.filter(
      (c) => !isText(c) && textsOf(c).length > 0,
    )
    // A leaf record: all of this node's text is either directly on it or in
    // wrappers that hold nothing but a single text (Figma wraps an icon+label
    // row that way). Anything with two or more text-bearing child frames is a
    // container and must be descended into, or a whole table becomes one row.
    if (childFramesWithText.length <= 1 && texts.length <= 4) {
      out.push({
        figmaNodeId: n.id,
        name: n.name === texts[0]?.name ? null : n.name,
        cells: texts.map((t) => t.name.trim()),
      })
      return
    }
    if (isText(n)) {
      out.push({ figmaNodeId: n.id, name: null, cells: [n.name.trim()] })
      return
    }
    n.children.forEach(walk)
  }
  walk(node)
  return out
}

function sectionOf(section, index) {
  const body = collapse(section)
  const groups = []
  for (const child of body.children) {
    if (!textsOf(child).length) continue
    const c = collapse(child)
    groups.push({
      figmaNodeId: c.id,
      name: c.name,
      widthPx: c.width == null ? null : Math.round(c.width),
      records: recordsOf(c),
    })
  }
  return {
    kind: null, // filled in by hand during review — the frame does not name it
    figmaNodeId: section.id,
    name: section.name,
    order: index,
    widthPx: section.width == null ? null : Math.round(section.width),
    heightPx: section.height == null ? null : Math.round(section.height),
    groups,
    notes: null,
  }
}

// ---------------------------------------------------------------- emit

mkdirSync(outDir, { recursive: true })

const summary = []
for (const dumpPath of dumps) {
  const raw = JSON.parse(readFileSync(dumpPath, 'utf8'))
  const xml = raw.map((r) => r?.text ?? '').join('')
  const start = xml.indexOf('<frame')
  if (start === -1) throw new Error(`${dumpPath}: no frame in dump`)
  const frame = parse(xml.slice(start))
  if (!frame) throw new Error(`${dumpPath}: could not parse frame`)

  const width = Math.round(frame.width ?? 0)
  const variant = VARIANTS.find(([w]) => w === width)?.[1]
  if (!variant) {
    throw new Error(
      `${dumpPath}: frame ${frame.id} is ${width}px wide, which is not one of ` +
        `${VARIANTS.map(([w, v]) => `${w} (${v})`).join(', ')} — refusing to ` +
        `guess the variant from the file name`,
    )
  }

  const bodyFrames = frame.children.filter((c) => !isChrome(c))
  const sections = bodyFrames.map(sectionOf)

  // ------------------------------------------------------- CONSERVATION
  //
  // The failure that matters here is a SILENT one: a table row, a plan bullet
  // or a fee-ladder line that never makes it into the JSON. The file still
  // parses, every section is present, every field is populated, and a reader
  // comparing shapes sees nothing wrong — the page has just quietly lost a
  // row, which on a PRICING page is a published falsehood.
  //
  // extract-solutions-copy.mjs learned this the expensive way with Figma's
  // auto-layout float tails (405.3333435058594 vs 405.33331298828125) silently
  // dropping a card. Rather than re-derive that specific fix, assert the
  // general property it was protecting: every text node in the frame appears
  // in the output EXACTLY once. Under-count means a dropped row; over-count
  // means a row double-emitted into two groups. Either way, throw.
  const expected = bodyFrames.reduce((a, f) => a + textsOf(f).length, 0)
  const emitted = sections.reduce(
    (a, s) =>
      a +
      s.groups.reduce(
        (b, g) => b + g.records.reduce((c, r) => c + r.cells.length, 0),
        0,
      ),
    0,
  )
  if (emitted !== expected) {
    const verb = emitted < expected ? 'lost' : 'double-emitted'
    throw new Error(
      `${variant} (${frame.id}): frame has ${expected} text nodes but ` +
        `${emitted} were emitted — ${Math.abs(expected - emitted)} ${verb}. ` +
        `Refusing to write a plausible-looking but incomplete pricing record.`,
    )
  }

  const doc = {
    variant,
    route: '/pricing',
    figmaNodeId: frame.id,
    frameName: frame.name,
    frameSize: { width, height: Math.round(frame.height ?? 0) },
    notes:
      'Extracted verbatim from the Figma frame by ' +
      'tools/marketing/extract-pricing-copy.mjs (AGL-1278). `kind` and `notes` ' +
      'are left null for a human pass — the frame does not name its own ' +
      'section types. THE CODE WINS OVER THE FRAME: this file is a record of ' +
      'the design, not of the truth. Prices here have been caught drifting ' +
      'from libs/aglyn/src/lib/app-utils/plan-entitlements.ts twice; that file ' +
      'is the source of truth for every number.',
    sections,
    claimsToVerify: [],
  }
  writeFileSync(
    join(outDir, `copy-${variant}.json`),
    JSON.stringify(doc, null, 2) + '\n',
  )
  summary.push([variant, frame.id, width, sections.length, expected])
}

for (const [variant, id, width, n, texts] of summary) {
  console.log(
    `  ${variant.padEnd(11)} ${id.padEnd(11)} ${String(width).padStart(4)}px  ` +
      `${n} sections  ${texts} text nodes`,
  )
}
