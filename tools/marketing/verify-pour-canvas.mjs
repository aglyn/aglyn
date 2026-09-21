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

// Harness for `firestore-canvas.mjs`. Run from the repo root:
//
//   node tools/marketing/verify-pour-canvas.mjs
//
// `verify-applier.mjs` proves the APPLIER against an in-memory stub of its
// own shape. This proves the other half that `pour-page.mjs` adds: that the
// real applier still behaves when its canvas is a STORED `nodes` map rather
// than the editor's.
//
// The case that matters is the node schema, not the copy.
// `AglynNodeSchema.nodes` is `NodeId[] | AglynNodeSchema[]`: a stored document
// may hold its children as ids or inline, and both are valid documents. The
// applier walks with `getNode(kid)`, so under a lookup that only understood
// ids a denormalized document would resolve every child to `undefined`, find
// zero text nodes, and fail as a slot-count mismatch — a shape fault wearing a
// copy fault's clothes, on a tool whose whole job is to refuse a shifted pour.
// So both forms are driven here, and they must agree exactly.

import { readFileSync } from 'node:fs'
import { CANVAS_ROOT_ELEMENT_ID, firestoreCanvas } from './firestore-canvas.mjs'

const SLOTS = [5, 1, 14, 9, 11, 17, 13, 4]
const src = readFileSync('tools/marketing/apply-page-copy.js', 'utf8')

/** The props AGL-1227 destroyed, on the nodes that carry them. */
const AUTHORED = {
  '0:1': { component: 'h1' }, '0:2': { variant: 'body1' },
  '2:1': { component: 'h2' }, '3:1': { component: 'h2' }, '4:1': { component: 'h2' },
  '5:1': { component: 'h2' }, '6:1': { component: 'h2' }, '7:0': { component: 'h2' },
}

/**
 * A stored `nodes` map shaped like `AglynScreenVersion.nodes`:
 * `Record<NodeId, AglynNodeSchema>` with a `_@_` root.
 *
 * `inline: true` writes the children as node OBJECTS instead of ids — the
 * denormalized form the schema also permits.
 */
function storedNodes(slots = SLOTS, { inline = false } = {}) {
  const nodes = {}
  const sectionIds = []
  slots.forEach((n, i) => {
    const kids = []
    for (let k = 0; k < n; k++) {
      const id = `${i}:${k}`
      const node = {
        $id: id,
        componentId: 'muiTypography',
        props: { children: `skeleton ${id}`, ...(AUTHORED[id] ?? {}) },
        sx: { fontSize: '72px' },
        nodes: [],
      }
      nodes[id] = node
      kids.push(inline ? node : id)
    }
    const sid = `s${i}`
    nodes[sid] = { $id: sid, componentId: 'muiBox', props: {}, nodes: kids }
    sectionIds.push(inline ? nodes[sid] : sid)
  })
  nodes[CANVAS_ROOT_ELEMENT_ID] = {
    $id: CANVAS_ROOT_ELEMENT_ID,
    componentId: 'muiBox',
    props: {},
    nodes: sectionIds,
  }
  return nodes
}

function pour(COPY, nodes) {
  const { canvas, state } = firestoreCanvas(nodes)
  globalThis.window = { AglynModule: { canvas, CANVAS_ROOT_ELEMENT_ID } }
  const applyPageCopy = eval(`${src}; applyPageCopy`)
  return { result: applyPageCopy(COPY, { dryRun: false }), state, nodes }
}

let failures = 0
const check = (ok, msg) => {
  if (!ok) { failures += 1; console.log(`  ✗ ${msg}`) } else console.log(`  ✓ ${msg}`)
}

const CONSOLE_COPY = JSON.parse(
  readFileSync('tools/marketing/product-copy/copy-console.json', 'utf8'),
)
const AI_COPY = JSON.parse(
  readFileSync('tools/marketing/product-copy/copy-ai.json', 'utf8'),
)
const aiExplore = AI_COPY.sections.find((s) => s.kind === 'explore')
const AI_SLOTS = SLOTS.map((n, i) => (i === 5 ? 3 + 2 * aiExplore.items.length : n))

for (const inline of [false, true]) {
  const form = inline ? 'denormalized (children inline)' : 'normalized (children as ids)'
  console.log(`\nstored nodes map — ${form}`)

  const { result, state, nodes } = pour(CONSOLE_COPY, storedNodes(SLOTS, { inline }))
  check(!result.problems?.length, `no problems (${(result.problems ?? []).join('; ') || 'none'})`)
  check(result.wrote === state.writes, `applier and canvas agree on the write count (${result.wrote})`)
  check(
    nodes['0:1'].props.component === 'h1' && nodes['0:2'].props.variant === 'body1',
    'authored props survive the write',
  )
  check(
    nodes['0:1'].props.children === CONSOLE_COPY.sections[0].heading,
    `hero heading landed (${JSON.stringify(String(nodes['0:1'].props.children).slice(0, 34))})`,
  )
  const blanks = Object.values(nodes).filter(
    (n) => typeof n.props?.children === 'string' && !n.props.children.trim(),
  )
  check(blanks.length === 0, `no node left blank (${blanks.length} blank)`)
}

// The two forms must not merely both succeed — they must produce the SAME page.
{
  console.log('\nthe two stored forms agree')
  const a = pour(CONSOLE_COPY, storedNodes(SLOTS, { inline: false }))
  const b = pour(CONSOLE_COPY, storedNodes(SLOTS, { inline: true }))
  const text = ({ nodes }) =>
    Object.keys(nodes)
      .filter((k) => typeof nodes[k].props?.children === 'string')
      .sort()
      .map((k) => `${k}=${nodes[k].props.children}`)
  check(
    JSON.stringify(text(a)) === JSON.stringify(text(b)),
    'identical text in every slot, whichever way children are stored',
  )
  check(a.result.wrote === b.result.wrote, `identical write count (${a.result.wrote})`)
}

// The refusal has to survive the swap too, or the tool would pour a shifted
// page into a real document.
{
  console.log('\nrefusals still refuse')
  const short = SLOTS.map((n, i) => (i === 2 ? n - 1 : n))
  const { result } = pour(CONSOLE_COPY, storedNodes(short))
  check(result.problems?.length > 0, 'refuses a section one slot short')
  check(result.wrote === 0, `writes nothing when it refuses (wrote ${result.wrote ?? 0})`)

  const { result: wrongGrid } = pour(AI_COPY, storedNodes(SLOTS))
  check(wrongGrid.problems?.length > 0, 'refuses the ten-card AI deck on a seven-card Explore grid')
}

// The page this tool was written for, against a document shaped like the one
// it will actually be pointed at.
{
  console.log(`\ncopy-ai.json — ${aiExplore.items.length} explore cards`)
  const { result, nodes } = pour(AI_COPY, storedNodes(AI_SLOTS))
  check(!result.problems?.length, `no problems (${(result.problems ?? []).join('; ') || 'none'})`)
  const earlyAccess = AI_COPY.sections.find((s) => s.kind === 'early-access')
  const kept = earlyAccess.eyebrow == null ? 1 : 0
  const expected = AI_SLOTS.reduce((sum, n) => sum + n, 0) - kept
  check(result.wrote === expected, `${expected} writes (got ${result.wrote})`)
  check(
    nodes['0:1'].props.children === AI_COPY.sections[0].heading &&
      nodes['0:1'].props.component === 'h1',
    `hero is the AI heading and still an h1 (${JSON.stringify(String(nodes['0:1'].props.children).slice(0, 40))})`,
  )
}

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
