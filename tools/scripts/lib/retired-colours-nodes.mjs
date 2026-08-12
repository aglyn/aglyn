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
 * Find retired colours in besigner NODE DATA, and name the node (AGL-1431).
 *
 * The sibling of `retired-colours.mjs`. That file reads a rendered page and
 * answers "did visitors receive a retired colour"; this one reads the stored
 * node documents and answers "WHICH node do I have to open to fix it".
 *
 * ## Why both, and why this one is separate
 *
 * The AGL-1431 regression is DATA. `/pricing` was re-authored in the besigner
 * between 2026-08-08 and 08-11 and the retired colours came back with the node
 * props — no commit, nothing for CI to be affected by. The rendered census
 * proves the defect reached visitors, which is the part that matters for a
 * schedule, but it cannot say more than "this route". Repairing it means
 * opening a specific node, so something has to name one.
 *
 * The rendered census is also a LOWER BOUND, for the reason AGL-1285 gave:
 * `lazyPanels` keeps deferred panel nodes out of the delivered payload, so a
 * retired colour that only lives inside a collapsed panel is invisible to an
 * HTTP read and perfectly visible here. Drafts are the same shape of gap — a
 * version document that has not been published yet serves nobody today and is
 * one Publish click from serving everybody.
 *
 * Kept in its own module rather than added to `retired-colours.mjs` because
 * decoding node data needs `@msgpack/msgpack`, and the census workflow runs
 * with NO install step on purpose: a monitor that can be broken by a lockfile
 * or a registry outage gets muted. Nothing here is imported by the census.
 *
 * ## The two storage forms, and the way this under-reports to zero
 *
 * `nodes` is stored either as a plain Firestore map or as msgpack bytes, and
 * the form is a property of the DOCUMENT, not of the host. Every marketing
 * screen measured on 2026-08-12 was msgpack. A scan that reads the field and
 * finds something that is not a plain object — and treats that as "no nodes" —
 * therefore reports a clean zero across the entire corpus.
 *
 * `decodeNodesField` refuses to do that. Bytes it cannot decode throw, so the
 * caller reports an ERROR for that document rather than a zero for it.
 *
 * The other zero-shaped trap is one level up: on the marketing host the parent
 * `screens/{id}` document carries NO `nodes` field at all — it holds a
 * `versionId`, and the nodes live in `versions/{versionId}`. A scan of parent
 * documents alone reads 62 screens and finds nothing. That belongs to the
 * caller, and `audit-retired-colours-data.mjs` says so where it walks.
 */

import { decode } from '@msgpack/msgpack'

import { PALETTE_SLOTS, RETIRED_COLOURS } from './retired-colours.mjs'

/** An sx key that scopes everything beneath it to the dark scheme (AGL-588). */
const DARK_SLICE_KEY = /@scheme\s+dark/

/**
 * Decode one `nodes` field into a plain node map.
 *
 * Throws on bytes that will not decode. That is the point: the alternative is
 * a silent `null` that the caller counts as a clean document.
 *
 * @param {unknown} raw the raw Firestore field value
 * @returns {{ form: 'map' | 'msgpack' | 'absent', nodes: Record<string, unknown> }}
 */
export function decodeNodesField(raw) {
  if (raw === undefined || raw === null) return { form: 'absent', nodes: {} }

  if (raw instanceof Uint8Array || Buffer.isBuffer?.(raw)) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    // Let a decode failure escape. A `catch` that returns `{}` here is the
    // exact bug this module exists to not have.
    const decoded = decode(bytes)
    return { form: 'msgpack', nodes: normalise(decoded) }
  }

  if (typeof raw === 'object') return { form: 'map', nodes: normalise(raw) }

  throw new TypeError(`unrecognised \`nodes\` field: ${typeof raw}`)
}

/**
 * Both an array of nodes and an id-keyed map arrive here; key the array by its
 * `$id` so a finding names the node the besigner shows, not an array index.
 */
function normalise(nodes) {
  if (Array.isArray(nodes)) {
    const out = {}
    nodes.forEach((node, index) => {
      out[node?.$id ?? `[${index}]`] = node
    })
    return out
  }
  if (nodes && typeof nodes === 'object') return nodes
  throw new TypeError(`decoded \`nodes\` is not a node collection`)
}

/**
 * Whether `value` mentions `hex`, and how many times.
 *
 * A CONTAINS check, not an equality check, because the value is often not the
 * bare colour: `linear-gradient(90deg,#0090d9,#00b0ff)` and
 * `1px solid #0090d9` are both authored shapes, and both are the retired
 * colour reaching a visitor. The trailing-digit guard keeps `#0090d9ff` — a
 * different colour — from matching.
 */
function countHex(value, hex) {
  const haystack = value.toLowerCase()
  const needle = hex.toLowerCase()
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    const next = haystack[at + needle.length]
    if (!next || !/[0-9a-f]/.test(next)) count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/**
 * Every retired colour in one decoded node map, each one located.
 *
 * Walks the WHOLE node rather than `sx` alone. `sx` is where the AGL-1293
 * population lived, but a colour can be authored into `props` too, and a
 * detector that only looks where the last regression happened to sit is the
 * standing check equivalent of a hand-listed set of files.
 *
 * @param {Record<string, unknown>} nodes
 * @param {typeof RETIRED_COLOURS} [colours]
 * @returns {{ findings: Array<{ nodeId: string, path: string, property: string, hex: string, value: string, scope: 'base' | 'dark-slice', occurrences: number, retiredBy: string, replacement: string }>, nodesWalked: number, exempt: number }}
 */
export function findRetiredColoursInNodes(nodes, colours = RETIRED_COLOURS) {
  const byHex = new Map(
    colours.map((colour) => [colour.hex.toLowerCase(), colour]),
  )
  const findings = []
  let nodesWalked = 0
  let exempt = 0

  const walk = (value, nodeId, trail) => {
    if (typeof value === 'string') {
      const property = trail[trail.length - 1] ?? ''
      for (const [hex, colour] of byHex) {
        const occurrences = countHex(value, hex)
        if (!occurrences) continue
        // A hex sitting in a palette SLOT is a theme describing itself, not an
        // author pinning a colour onto a node. Same exemption, same reason as
        // the rendered census — kept in one place so the two halves cannot
        // drift into disagreeing about what counts.
        if (PALETTE_SLOTS.has(property) && value.trim().toLowerCase() === hex) {
          exempt += occurrences
          continue
        }
        findings.push({
          nodeId,
          path: trail.join('.'),
          property,
          hex,
          value,
          scope: trail.some((key) => DARK_SLICE_KEY.test(key))
            ? 'dark-slice'
            : 'base',
          occurrences,
          retiredBy: colour.retiredBy,
          replacement: colour.replacement,
        })
      }
      return
    }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        walk(item, nodeId, [...trail, `[${index}]`]),
      )
      return
    }
    for (const [key, child] of Object.entries(value))
      walk(child, nodeId, [...trail, key])
  }

  for (const [nodeId, node] of Object.entries(nodes ?? {})) {
    nodesWalked += 1
    walk(node, nodeId, [])
  }

  return { findings, nodesWalked, exempt }
}

/** One line per finding, for the CLI report. */
export function describeNodeFinding(finding) {
  const times = finding.occurrences > 1 ? ` ×${finding.occurrences}` : ''
  return (
    `${finding.hex}${times} at ${finding.nodeId}.${finding.path} ` +
    `[${finding.scope}] = ${JSON.stringify(finding.value)}`
  )
}
