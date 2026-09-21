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

// Pour a `product-copy/copy-<page>.json` into a screen version through
// FIRESTORE, because the besigner route is closed (AGL-2920).
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/marketing/pour-page.mjs \
//       --host <hostId> --screen <screenId> \
//       --copy tools/marketing/product-copy/copy-ai.json [--apply]
//
// ## Why this exists
//
// `apply-page-copy.js` opens with `window.AglynModule.canvas` and its header
// says to paste it into the besigner's own page context. On app.aglyn.com the
// canvas lives in a CROSS-ORIGIN iframe: `AglynModule` is absent from the top
// frame, both real frames throw SecurityError on any property read, and
// neither `window.Aglyn` nor `window.__AGLYN_PLUGIN_HOST__` carries a canvas.
// No reachable script context can call `updateNodeProps`, so the documented
// path cannot run against production for this page or any future one.
//
// ## It does NOT re-implement the contract
//
// The 8-section / 74-slot contract, the flattens, the slot assertions and the
// prop-spread all stay in `apply-page-copy.js`, which is read and evaluated
// here verbatim. This file only supplies a `canvas` backed by a Firestore
// document instead of by the editor — exactly what `verify-applier.mjs`
// already does with its in-memory `stubCanvas()`.
//
// Keeping one copy of the rule is deliberate. The contract has three guards
// that each exist because the thing they check already went wrong once
// (AGL-1227's prop-bag replace, AGL-1233's `meta` flatten, the positional
// shift). A second implementation would be a second place for them to drift
// out of, which is the defect shape this whole file is downstream of.
//
// ## Safety
//
// * Dry run by DEFAULT. `--apply` is required to write anything.
// * Writes a NEW version document and moves the screen's `versionId` to it.
//   The source version is never modified, so the previous state stays intact
//   and reachable in version history.
// * Never touches `publishedAt` and never adds a route to the host's `screens`
//   map, which is what makes a screen reachable at all.
//
// ⛔ BUT: ON A ROUTED SCREEN, MOVING `versionId` IS THE PUBLISH.
//
//   An earlier version of this block said the script "never moves a publish
//   pointer". That is wrong for a screen and it is the one clause a reader
//   would rely on. The tenant renders whatever `screens/<id>.versionId` names
//   — `get-screen.ts` says so in as many words: "a screen publish flips
//   `versionId` on this doc" — so for any screen that already has a route,
//   `--apply` IS a publish, live within the 600s pointer TTL.
//
//   It is safe on an UNROUTED screen (no entry in the host's `screens` map,
//   `publishedAt` absent) because there is no URL for the tenant to serve it
//   from. That is the only reason pouring `/product/ai` does not expose it,
//   and it stops being true the moment the page is routed. Check before you
//   apply; do not infer it from this script's name.
// * Refuses on any problem the applier reports, writing nothing — a partial
//   pour reads as a plausible page with one slot shifted, which is the
//   failure that matters here.

import { readFileSync } from 'node:fs'
import { decode, encode } from '@msgpack/msgpack'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { CANVAS_ROOT_ELEMENT_ID, firestoreCanvas } from './firestore-canvas.mjs'
import { createResourceUid } from '../scripts/lib/resource-uid.mjs'

/**
 * `nodes` is stored in TWO live forms and both reach this script (AGL-1223).
 * A plain Firestore map, and msgpack BYTES: the client converter compresses on
 * write (AGL-1151), so anything saved through the editor arrives here as a Node
 * `Buffer`, while documents written before that path learned to — or by
 * `updateDoc` around the converter — are still maps. `/product/ai`'s own
 * version is bytes; `/pricing`'s is 628 KB of them.
 *
 * Reading the raw field and walking it as a map is a SILENT failure, not a
 * loud one: `Object.values` over a Buffer yields the individual byte NUMBERS,
 * none of which has `props` or `componentId`, so the applier's walk finds zero
 * text nodes and reports a slot-count mismatch — a shape problem wearing a
 * copy problem's clothes. `libs/aglyn/src/lib/app-utils/stored-nodes.ts` owns
 * this rule for app code and its docblock is the long version.
 *
 * ⚠️ `byteOffset`/`byteLength`, ALWAYS. firebase-admin hands back POOLED
 * Buffers — a small field is typically a view into a shared 8 KB ArrayBuffer —
 * so `new Uint8Array(buf.buffer)` decodes the whole pool and throws on the
 * trailing garbage instead of returning the document.
 */
const decodeNodes = (raw) =>
  Buffer.isBuffer(raw)
    ? decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
    : raw

/** Write back in the form it was read in, so a pour never changes the shape. */
const encodeNodes = (nodes, wasBytes) => (wasBytes ? Buffer.from(encode(nodes)) : nodes)

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const hostId = flag('host')
const screenId = flag('screen')
const copyPath = flag('copy')
const apply = args.includes('--apply')

if (!hostId || !screenId || !copyPath) {
  console.error(
    'Usage: node tools/marketing/pour-page.mjs --host <hostId> --screen <screenId> --copy <copy-<page>.json> [--apply]',
  )
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const COPY = JSON.parse(readFileSync(copyPath, 'utf8'))

// --- read the screen and the version it currently points at ----------------
const screenRef = firestore
  .collection('hosts')
  .doc(hostId)
  .collection('screens')
  .doc(screenId)
const screenSnap = await screenRef.get()
if (!screenSnap.exists) {
  console.error(`hosts/${hostId}/screens/${screenId} does not exist`)
  process.exit(1)
}
const screen = screenSnap.data()
const sourceVersionId = screen.versionId
if (!sourceVersionId) {
  console.error(`screen ${screenId} has no versionId pointer — nothing to pour into`)
  process.exit(1)
}

const versionsRef = screenRef.collection('versions')
const sourceSnap = await versionsRef.doc(sourceVersionId).get()
if (!sourceSnap.exists) {
  console.error(`version ${sourceVersionId} does not exist under screen ${screenId}`)
  process.exit(1)
}
const source = sourceSnap.data()
const storedAsBytes = Buffer.isBuffer(source.nodes)
source.nodes = decodeNodes(source.nodes)
if (!source.nodes || !source.nodes[CANVAS_ROOT_ELEMENT_ID]) {
  console.error(
    `version ${sourceVersionId} has no '${CANVAS_ROOT_ELEMENT_ID}' root in its nodes map`,
  )
  process.exit(1)
}

// --- a canvas over a working copy of that document -------------------------
// Deep-cloned so a refusal leaves nothing half-mutated even in memory, and so
// the write is a whole-map replace rather than a set of field paths that could
// land partially.
const nodes = structuredClone(source.nodes)
const { canvas } = firestoreCanvas(nodes)

const src = readFileSync('tools/marketing/apply-page-copy.js', 'utf8')
globalThis.window = { AglynModule: { canvas, CANVAS_ROOT_ELEMENT_ID } }
const applyPageCopy = eval(`${src}; applyPageCopy`)

// --- verify, then report or write ------------------------------------------
const dry = applyPageCopy(COPY, { dryRun: true })
if (dry.problems?.length) {
  console.error(`REFUSED — ${dry.problems.length} problem(s), nothing written:\n`)
  for (const p of dry.problems) console.error(`  • ${p}`)
  process.exit(1)
}

console.log(`${COPY.page} → hosts/${hostId}/screens/${screenId}`)
console.log(`  source version: ${sourceVersionId}`)
for (const section of dry.preview) {
  console.log(`\n  ${section.section}`)
  for (const [before, after] of section.pairs) {
    console.log(`    ${after === '(keep)' ? '=' : '→'} ${JSON.stringify(before)}  ${after === '(keep)' ? '' : `=> ${JSON.stringify(after)}`}`)
  }
}

if (!apply) {
  console.log(`\nDry run. ${dry.preview.reduce((n, s) => n + s.pairs.length, 0)} slot(s) inspected. Pass --apply to write.`)
  process.exit(0)
}

const real = applyPageCopy(COPY, { dryRun: false })
if (real.problems?.length) {
  console.error(`REFUSED on the write pass — nothing written:\n`)
  for (const p of real.problems) console.error(`  • ${p}`)
  process.exit(1)
}

// A NEW version: the source is left exactly as it was.
// Named by the platform's own id, not a Firestore auto-id: a version is a
// console resource and its id is addressed in besigner routes (AGL-3079).
const newVersionRef = versionsRef.doc(createResourceUid())
const { $id: _ignoredId, createdAt: _ignoredCreated, ...carried } = source
await newVersionRef.set({
  ...carried,
  nodes: encodeNodes(nodes, storedAsBytes),
  hostId,
  screenId,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})
await screenRef.update({
  versionId: newVersionRef.id,
  updatedAt: FieldValue.serverTimestamp(),
})

console.log(
  `\nWrote ${real.wrote} slot(s) into NEW version ${newVersionRef.id} (was ${sourceVersionId}).`,
)
console.log('The screen is NOT published — review it in the besigner, then publish by hand.')
