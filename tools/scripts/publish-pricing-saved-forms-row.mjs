#!/usr/bin/env node
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
 * Adds a "Saved forms per site" row to the `/pricing` compare table, directly
 * above "Form submissions / mo, per site" (AGL-3597).
 *
 *   node tools/scripts/publish-pricing-saved-forms-row.mjs           dry run
 *   node tools/scripts/publish-pricing-saved-forms-row.mjs --write   publish
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from `.env` and
 * `apps/console/.env.production.local`.
 *
 * The compare table is besigner content on the marketing host, not generated
 * output, so the row is inserted in the screen's stored node map in the two
 * places the table is drawn:
 *
 *  - the desktop grid: one row of a label and eight plan cells. Its rows are
 *    zebra-striped within each group, so every row below the insert, up to the
 *    next group band, swaps its stripe — the new row takes the stripe the
 *    form-submissions row had, which then takes the next one;
 *  - the narrow layout: one tab panel per plan, each holding a label-and-value
 *    row per feature. Each panel gets its own row with that plan's value.
 *
 * Every new node is a clone of its form-submissions neighbor, so the row
 * carries the table's own type, spacing and dark-scheme colors.
 *
 * The values are the saved-form ladder in `PLAN_ENTITLEMENTS.formsPerHost`
 * (`libs/aglyn/src/lib/app-utils/plan-entitlements.ts`), restated below
 * because a plain script cannot import the TypeScript module. Enterprise
 * prints "Talk to us", as every numeric row on the page does: its allowance
 * is set by the agreement.
 *
 * Safety:
 *  - dry run by default; `--write` is required to write anything;
 *  - refuses when the page already has the row, or when the table does not
 *    have the shape described above, writing nothing;
 *  - writes a NEW version and moves the screen's `versionId` to it. The page
 *    is routed, so that move IS the publish — live within the tenant's
 *    pointer TTL. The previous version stays in history as the revert path:
 *    point `versionId` back at the one this prints.
 */

import { config as loadEnv } from 'dotenv'
import { decode, encode } from '@msgpack/msgpack'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createResourceUid } from './lib/resource-uid.mjs'

const HOST = 'DXnRbPH4CQ' // aglyn-marketing
const SCREEN = 'v0clP6xQl-' // /pricing

const ANCHOR_LABEL = 'Form submissions / mo, per site'
const NEW_LABEL = 'Saved forms per site'

/** The cell each plan column prints, in the table's column order. */
const VALUES = {
  Free: '1',
  Starter: '5',
  Pro: '25',
  Business: '100',
  Scale: '500',
  Advanced: '500',
  Agency: '500',
  Enterprise: 'Talk to us',
}
const PLAN_ORDER = Object.keys(VALUES)

const WRITE = process.argv.includes('--write')

loadEnv({ path: '.env', quiet: true })
loadEnv({ path: 'apps/console/.env.production.local', quiet: true })

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY')
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

/**
 * `nodes` is stored as a plain map or as msgpack bytes; `/pricing`'s is bytes.
 * `byteOffset`/`byteLength` always, because firebase-admin hands back pooled
 * Buffers (see `tools/marketing/pour-page.mjs`).
 */
const decodeNodes = (raw) =>
  Buffer.isBuffer(raw) ? decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) : raw
const encodeNodes = (nodes, wasBytes) => (wasBytes ? Buffer.from(encode(nodes)) : nodes)

const screenRef = firestore.collection('hosts').doc(HOST).collection('screens').doc(SCREEN)
const screenSnap = await screenRef.get()
if (!screenSnap.exists) {
  console.error(`hosts/${HOST}/screens/${SCREEN} does not exist`)
  process.exit(1)
}
const sourceVersionId = screenSnap.get('versionId')
if (!sourceVersionId) {
  console.error(`screen ${SCREEN} has no versionId`)
  process.exit(1)
}
const versionsRef = screenRef.collection('versions')
const sourceSnap = await versionsRef.doc(sourceVersionId).get()
if (!sourceSnap.exists) {
  console.error(`version ${sourceVersionId} does not exist under screen ${SCREEN}`)
  process.exit(1)
}
const source = sourceSnap.data()
const storedAsBytes = Buffer.isBuffer(source.nodes)
const nodes = structuredClone(decodeNodes(source.nodes))

const problems = []
const changes = []

const childIds = (node) => (node.nodes ?? []).map((kid) => (typeof kid === 'string' ? kid : kid.$id))

/** Clone a node under a new parent with a new id and, for a text node, new text. */
function cloneLeaf(id, parentId, text) {
  const copy = structuredClone(nodes[id])
  copy.$id = createResourceUid()
  copy.parentId = parentId
  copy.props = { ...copy.props, children: text }
  nodes[copy.$id] = copy
  return copy.$id
}

/** Clone a label-and-cells row and splice it into its parent just above `row`. */
function insertAbove(row, cells) {
  const parent = nodes[row.parentId]
  const ids = childIds(parent)
  if (ids.some((id) => typeof id !== 'string')) {
    problems.push(`${parent.$id} holds its rows inline, which this script does not edit`)
    return null
  }
  const copy = structuredClone(row)
  copy.$id = createResourceUid()
  const kids = childIds(row)
  copy.nodes = kids.map((kidId, index) =>
    cloneLeaf(kidId, copy.$id, index === 0 ? NEW_LABEL : cells[index - 1]),
  )
  nodes[copy.$id] = copy
  const at = ids.indexOf(row.$id)
  parent.nodes = [...ids.slice(0, at), copy.$id, ...ids.slice(at)]
  return copy
}

const anchors = Object.values(nodes).filter(
  (node) => node?.props?.children === ANCHOR_LABEL && nodes[node.parentId],
)
if (Object.values(nodes).some((node) => node?.props?.children === NEW_LABEL)) {
  problems.push(`the page already carries "${NEW_LABEL}" — nothing to add`)
}

// ---- the desktop grid: the anchor row with a label and eight plan cells ----
const gridRows = anchors.map((a) => nodes[a.parentId]).filter((row) => childIds(row).length === 9)
if (gridRows.length !== 1) {
  problems.push(`expected one desktop grid row labelled "${ANCHOR_LABEL}", found ${gridRows.length}`)
}

// ---- the narrow layout: one row per plan tab panel -----------------------
const panelRows = anchors
  .map((a) => nodes[a.parentId])
  .filter((row) => childIds(row).length === 2 && nodes[row.parentId]?.componentId === 'muiTabPanel')
const panelPlans = panelRows.map((row) => nodes[row.parentId].props?.label)
if (
  panelRows.length !== PLAN_ORDER.length ||
  PLAN_ORDER.some((plan) => !panelPlans.includes(plan))
) {
  problems.push(`expected one tab-panel row per plan (${PLAN_ORDER.join(', ')}), found ${panelPlans.join(', ') || 'none'}`)
}

if (problems.length) {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}

/**
 * The stripe a row and its label cell carry: light background and the
 * dark-scheme override. Swapped as a pair, so a stripe is never half-moved.
 */
const stripeOf = (row) => ({
  row: { bgcolor: row.sx?.bgcolor, dark: row.sx?.['@scheme dark'] },
  label: {
    bgcolor: nodes[childIds(row)[0]]?.sx?.bgcolor,
    dark: nodes[childIds(row)[0]]?.sx?.['@scheme dark'],
  },
})
const withStripe = (sx, { bgcolor, dark }) => {
  const next = { ...sx }
  for (const [key, value] of [['bgcolor', bgcolor], ['@scheme dark', dark]]) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}
function paint(row, stripe) {
  row.sx = withStripe(row.sx, stripe.row)
  const label = nodes[childIds(row)[0]]
  label.sx = withStripe(label.sx, stripe.label)
}

const [gridRow] = gridRows
const grid = nodes[gridRow.parentId]
const gridIds = childIds(grid)
const anchorAt = gridIds.indexOf(gridRow.$id)
// The rows of this group from the anchor down, up to the next band (a row
// whose background is neither of the two stripes).
const stripes = new Set(
  [gridRow, nodes[gridIds[anchorAt + 1]]].filter(Boolean).map((row) => row.sx?.bgcolor),
)
const groupTail = []
for (const id of gridIds.slice(anchorAt)) {
  if (!stripes.has(nodes[id].sx?.bgcolor)) break
  groupTail.push(nodes[id])
}
const tailStripes = groupTail.map(stripeOf)

const inserted = insertAbove(
  gridRow,
  PLAN_ORDER.map((plan) => VALUES[plan]),
)
if (!inserted) {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}
// The new row takes the anchor's stripe; every row below it takes the stripe
// of the row that was below IT, and the last takes the other one.
const otherStripe =
  tailStripes.length > 1 ? tailStripes[tailStripes.length - 2] : stripeOf(nodes[gridIds[anchorAt - 1]])
groupTail.forEach((row, index) => paint(row, tailStripes[index + 1] ?? otherStripe))
changes.push(
  `desktop grid ${grid.$id}: new row ${inserted.$id} above ${gridRow.$id} — ` +
    `${NEW_LABEL} | ${PLAN_ORDER.map((plan) => VALUES[plan]).join(' | ')}; ` +
    `${groupTail.length} row(s) below re-striped`,
)

for (const row of panelRows) {
  const plan = nodes[row.parentId].props.label
  const copy = insertAbove(row, [VALUES[plan]])
  if (!copy) break
  changes.push(`${plan} tab ${row.parentId}: new row ${copy.$id} above ${row.$id} — ${NEW_LABEL} | ${VALUES[plan]}`)
}

if (problems.length) {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}

console.log(`/pricing → hosts/${HOST}/screens/${SCREEN}`)
console.log(`  source version: ${sourceVersionId}`)
for (const line of changes) console.log(`  + ${line}`)

if (!WRITE) {
  console.log(`\nDry run. ${changes.length} insert(s) planned. Pass --write to publish.`)
  process.exit(0)
}

const newVersionRef = versionsRef.doc(createResourceUid())
const { $id: _id, createdAt: _createdAt, ...carried } = source
await newVersionRef.set({
  ...carried,
  nodes: encodeNodes(nodes, storedAsBytes),
  hostId: HOST,
  screenId: SCREEN,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})
await screenRef.update({ versionId: newVersionRef.id, updatedAt: FieldValue.serverTimestamp() })

console.log(`\nPublished NEW version ${newVersionRef.id} (was ${sourceVersionId}).`)
console.log(`Revert: set hosts/${HOST}/screens/${SCREEN}.versionId back to ${sourceVersionId}.`)
