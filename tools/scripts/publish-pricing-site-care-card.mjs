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
 * Adds a "Site Care" card to the `/pricing` page's optional add-ons, and the
 * one-line "Managed" offer beneath them (AGL-3954).
 *
 *   node tools/scripts/publish-pricing-site-care-card.mjs           dry run
 *   node tools/scripts/publish-pricing-site-care-card.mjs --write   publish
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from `.env` and
 * `apps/console/.env.production.local`.
 *
 * The add-ons section is besigner content on the marketing host, not
 * generated output, so the card is added to the screen's stored node map:
 *
 *  - the card is a clone of the Event Calendar card — the other flat,
 *    org-wide add-on — so it carries the section's own border, spacing, type
 *    and dark-scheme colors. Its title, price and first sentence replace the
 *    clone's, and three more sentences are cloned from that first one: what
 *    is quoted instead, "Any paid plan", and nothing else;
 *  - the grid holding the cards goes from three columns to two at `md`, so
 *    four cards sit two by two rather than three and an orphan;
 *  - the section heading's count moves from three to four;
 *  - the "Managed" sentence is a clone of the section's centered subhead,
 *    placed after the grid.
 *
 * The figures restate `SITE_CARE_ADDON_MONTHLY_USD` and Starter's two
 * `PLAN_PRICING` prices (`libs/aglyn/src/lib/app-utils/plan-entitlements.ts`)
 * because a plain script cannot import the TypeScript module. Managed Starter
 * is that plan plus the add-on: $25 + $49 a month, and $16 + $49 a month
 * billed yearly.
 *
 * Safety:
 *  - dry run by default; `--write` is required to write anything;
 *  - refuses when the page already carries "Site Care", or when the add-ons
 *    section does not have the shape described above (each replaced value is
 *    asserted before it is changed), writing nothing;
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

const SITE_CARE_MONTHLY_USD = 49
const STARTER_MONTHLY_USD = 25
const STARTER_YEARLY_PER_MONTH_USD = 16

/** The card the new one is cloned from, found by its title and price. */
const TEMPLATE_TITLE = 'Event Calendar'
const TEMPLATE_PRICE = '$9 / mo'

const HEADING_FROM = 'Three things you buy only if you need them.'
const HEADING_TO = 'Four things you buy only if you need them.'

const GRID_COLUMNS_FROM = { xs: '1fr', md: 'repeat(3, 1fr)' }
const GRID_COLUMNS_TO = { xs: '1fr', md: 'repeat(2, 1fr)' }

const SUBHEAD_PREFIX = 'Flat monthly prices per workspace'

const CARD = {
  title: 'Site Care',
  price: `$${SITE_CARE_MONTHLY_USD} / mo`,
  sentences: [
    'We make your site changes for you: hours, prices, photos, a staff ' +
      'member, a seasonal banner, a section on an existing page. Up to about ' +
      'an hour of work a month, done within 2 business days.',
    'Bigger jobs are quoted first at a flat price: a new page or form, a ' +
      'redesign, brand work, photography, ads. Plan limits still apply.',
    'Any paid plan.',
  ],
}

const MANAGED_SENTENCE =
  'Managed: your plan plus Site Care, one price. Managed Starter is ' +
  `$${STARTER_MONTHLY_USD + SITE_CARE_MONTHLY_USD} a month, or ` +
  `$${STARTER_YEARLY_PER_MONTH_USD + SITE_CARE_MONTHLY_USD} a month billed yearly.`

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

const childIds = (node) => (node?.nodes ?? []).map((kid) => (typeof kid === 'string' ? kid : kid.$id))
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : null)
const byText = (text) => Object.values(nodes).filter((node) => textOf(node) === text)
const refuse = () => {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}

if (Object.values(nodes).some((node) => textOf(node) === CARD.title)) {
  problems.push(`the page already carries "${CARD.title}" — nothing to add`)
}

// ---- the template card: title and price side by side, then a sentence ----
const templateCards = byText(TEMPLATE_TITLE)
  .map((title) => nodes[title.parentId])
  .filter((row) => row && childIds(row).some((id) => textOf(nodes[id]) === TEMPLATE_PRICE))
  .map((row) => nodes[row.parentId])
  .filter(Boolean)
if (templateCards.length !== 1) {
  problems.push(
    `expected one "${TEMPLATE_TITLE}" card priced "${TEMPLATE_PRICE}", found ${templateCards.length}`,
  )
  refuse()
}
const [templateCard] = templateCards
const [templateHeaderId, templateBodyId, ...extra] = childIds(templateCard)
if (!templateHeaderId || !templateBodyId || extra.length) {
  problems.push(`card ${templateCard.$id} is not a header row and one sentence`)
}
const grid = nodes[templateCard.parentId]
const section = nodes[grid?.parentId]
if (!grid || !section) problems.push(`card ${templateCard.$id} has no grid and section above it`)
if (problems.length) refuse()

// The grid, asserted before it changes.
const columns = grid.sx?.gridTemplateColumns
if (JSON.stringify(columns) !== JSON.stringify(GRID_COLUMNS_FROM)) {
  problems.push(
    `grid ${grid.$id} columns are ${JSON.stringify(columns)}, expected ${JSON.stringify(GRID_COLUMNS_FROM)}`,
  )
}
// The heading and subhead live in the same section as the grid.
const sectionIds = childIds(section)
const heading = sectionIds.map((id) => nodes[id]).find((node) => textOf(node) === HEADING_FROM)
if (!heading) problems.push(`section ${section.$id} has no heading "${HEADING_FROM}"`)
const subhead = sectionIds
  .map((id) => nodes[id])
  .find((node) => textOf(node)?.startsWith(SUBHEAD_PREFIX))
if (!subhead) problems.push(`section ${section.$id} has no subhead starting "${SUBHEAD_PREFIX}"`)
if (childIds(grid).some((id) => typeof id !== 'string') || sectionIds.some((id) => typeof id !== 'string')) {
  problems.push('the add-ons section holds its children inline, which this script does not edit')
}
if (problems.length) refuse()

/** Clone a text node under a new parent with a new id, new text and extra sx. */
function cloneText(id, parentId, text, sx = {}) {
  const copy = structuredClone(nodes[id])
  copy.$id = createResourceUid()
  copy.parentId = parentId
  copy.props = { ...copy.props, children: text }
  copy.sx = { ...copy.sx, ...sx }
  nodes[copy.$id] = copy
  return copy.$id
}

// ---- the card --------------------------------------------------------------
const card = structuredClone(templateCard)
card.$id = createResourceUid()
const header = structuredClone(nodes[templateHeaderId])
header.$id = createResourceUid()
header.parentId = card.$id
const [titleId, priceId] = childIds(nodes[templateHeaderId])
header.nodes = [
  cloneText(titleId, header.$id, CARD.title),
  cloneText(priceId, header.$id, CARD.price),
]
nodes[header.$id] = header
const [firstSentence, quotedSentence, plansSentence] = CARD.sentences
card.nodes = [
  header.$id,
  cloneText(templateBodyId, card.$id, firstSentence),
  cloneText(templateBodyId, card.$id, quotedSentence),
  cloneText(templateBodyId, card.$id, plansSentence, {
    fontWeight: 'semiBold',
    color: 'text.primary',
  }),
]
nodes[card.$id] = card
grid.nodes = [...childIds(grid), card.$id]
changes.push(
  `grid ${grid.$id}: new card ${card.$id} (cloned from ${templateCard.$id}) after the last card — ` +
    `${CARD.title} | ${CARD.price} | ${CARD.sentences.join(' / ')}`,
)

grid.sx = { ...grid.sx, gridTemplateColumns: GRID_COLUMNS_TO }
changes.push(
  `grid ${grid.$id}: columns ${JSON.stringify(GRID_COLUMNS_FROM)} → ${JSON.stringify(GRID_COLUMNS_TO)}`,
)

heading.props = { ...heading.props, children: HEADING_TO }
changes.push(`heading ${heading.$id}: "${HEADING_FROM}" → "${HEADING_TO}"`)

// ---- the "Managed" sentence, after the grid --------------------------------
const managedId = cloneText(subhead.$id, section.$id, MANAGED_SENTENCE, { mt: 3, mb: 0 })
const gridAt = sectionIds.indexOf(grid.$id)
section.nodes = [...sectionIds.slice(0, gridAt + 1), managedId, ...sectionIds.slice(gridAt + 1)]
changes.push(`section ${section.$id}: new sentence ${managedId} after the grid — ${MANAGED_SENTENCE}`)

console.log(`/pricing → hosts/${HOST}/screens/${SCREEN}`)
console.log(`  source version: ${sourceVersionId}`)
for (const line of changes) console.log(`  + ${line}`)

if (!WRITE) {
  console.log(`\nDry run. ${changes.length} change(s) planned. Pass --write to publish.`)
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
