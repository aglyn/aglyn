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
 * Sets the Free plan's cell in the `/pricing` compare table's "Reusable
 * components" row from "—" to "1" (AGL-3615): a Free site saves one reusable
 * component, `PLAN_ENTITLEMENTS.free.componentsPerHost`.
 *
 *   node tools/scripts/publish-pricing-free-component-cell.mjs           dry run
 *   node tools/scripts/publish-pricing-free-component-cell.mjs --write   publish
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from `.env` and
 * `apps/console/.env.production.local`.
 *
 * The row already exists — a "—" under Free and a "✓" under every paid plan,
 * whose allowance is unlimited and stays so — so nothing is inserted and no
 * stripe moves. Two text nodes change, in the two places the table is drawn:
 *
 *  - the desktop grid: the Free column's cell (the first after the label);
 *  - the narrow layout: the value of the row in the Free tab panel.
 *
 * A "—" cell is already styled as a number cell is (regular weight, the
 * secondary text color on the grid; medium, primary on the panel — the
 * "Saved forms per site" row's "1" carries the same), so only the text
 * changes. The paid cells are read and must all be "✓"; they are not
 * touched.
 *
 * Safety:
 *  - dry run by default; `--write` is required to write anything;
 *  - refuses when Free's cell already reads "1", or when the table does not
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

const LABEL = 'Reusable components'
const FROM = '—'
const TO = '1'
const PAID = '✓'
const PLAN_ORDER = ['Free', 'Starter', 'Pro', 'Business', 'Scale', 'Advanced', 'Agency', 'Enterprise']

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
const textOf = (id) => nodes[id]?.props?.children

const labels = Object.values(nodes).filter(
  (node) => node?.props?.children === LABEL && nodes[node.parentId],
)

// ---- the desktop grid: a label and eight plan cells ------------------------
const gridRows = labels.map((label) => nodes[label.parentId]).filter((row) => childIds(row).length === 9)
if (gridRows.length !== 1) {
  problems.push(`expected one desktop grid row labelled "${LABEL}", found ${gridRows.length}`)
}

// ---- the narrow layout: one row per plan tab panel -------------------------
const panelRows = labels
  .map((label) => nodes[label.parentId])
  .filter((row) => childIds(row).length === 2 && nodes[row.parentId]?.componentId === 'muiTabPanel')
const panelOf = Object.fromEntries(panelRows.map((row) => [nodes[row.parentId].props?.label, row]))
if (panelRows.length !== PLAN_ORDER.length || PLAN_ORDER.some((plan) => !panelOf[plan])) {
  problems.push(
    `expected one tab-panel row per plan (${PLAN_ORDER.join(', ')}), ` +
      `found ${Object.keys(panelOf).join(', ') || 'none'}`,
  )
}

/** The cell ids to change, after every cell has been read and checked. */
const targets = []
if (!problems.length) {
  const [gridRow] = gridRows
  const cells = childIds(gridRow).slice(1)
  const freeCell = cells[0]
  const panelValues = Object.fromEntries(PLAN_ORDER.map((plan) => [plan, childIds(panelOf[plan])[1]]))
  if (textOf(freeCell) === TO && textOf(panelValues.Free) === TO) {
    problems.push(`Free's "${LABEL}" cell already reads "${TO}" — nothing to change`)
  } else {
    if (textOf(freeCell) !== FROM) {
      problems.push(`the grid's Free cell ${freeCell} reads "${textOf(freeCell)}", expected "${FROM}"`)
    }
    if (textOf(panelValues.Free) !== FROM) {
      problems.push(`the Free panel's value ${panelValues.Free} reads "${textOf(panelValues.Free)}", expected "${FROM}"`)
    }
  }
  // The paid cells are what this leaves alone; anything but a tick means the
  // row is not the one this script was written against.
  cells.slice(1).forEach((id, index) => {
    if (textOf(id) !== PAID) {
      problems.push(`the grid's ${PLAN_ORDER[index + 1]} cell ${id} reads "${textOf(id)}", expected "${PAID}"`)
    }
  })
  for (const plan of PLAN_ORDER.slice(1)) {
    if (textOf(panelValues[plan]) !== PAID) {
      problems.push(`the ${plan} panel's value ${panelValues[plan]} reads "${textOf(panelValues[plan])}", expected "${PAID}"`)
    }
  }
  targets.push(
    { id: freeCell, where: `desktop grid ${gridRow.parentId}, row ${gridRow.$id}, Free cell` },
    { id: panelValues.Free, where: `Free tab ${panelOf.Free.parentId}, row ${panelOf.Free.$id}, value` },
  )
}

if (problems.length) {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}

for (const { id, where } of targets) {
  nodes[id] = { ...nodes[id], props: { ...nodes[id].props, children: TO } }
  changes.push(`${where} ${id}: "${FROM}" → "${TO}"`)
}

console.log(`/pricing → hosts/${HOST}/screens/${SCREEN}`)
console.log(`  source version: ${sourceVersionId}`)
console.log(`  row "${LABEL}": ${PLAN_ORDER.map((plan, index) => `${plan} ${index === 0 ? TO : PAID}`).join(' | ')}`)
for (const line of changes) console.log(`  ~ ${line}`)

if (!WRITE) {
  console.log(`\nDry run. ${changes.length} cell(s) to change. Pass --write to publish.`)
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
