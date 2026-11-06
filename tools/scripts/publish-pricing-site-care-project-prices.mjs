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
 * Puts the Site Care project price list on `/pricing`: a full-width "Site
 * Care project prices" panel under the add-on cards, the Site Care card's
 * project sentence shortened to point at it, and the "Managed" sentence
 * under the panel pointing at it too (Pricing Decision Log, 2026-11-05).
 *
 *   node tools/scripts/publish-pricing-site-care-project-prices.mjs
 *       dry run: prints every change, writes nothing
 *   node tools/scripts/publish-pricing-site-care-project-prices.mjs --write
 *       writes a NEW version cut from the live one; the page does not change
 *   node tools/scripts/publish-pricing-site-care-project-prices.mjs --publish <versionId>
 *       re-checks that version against live, then moves the screen's
 *       `versionId` to it — the publish
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from `.env` and
 * `apps/console/.env.production.local`.
 *
 * The add-ons section is besigner content on the marketing host, so the
 * change is made to the screen's stored node map, built from the section's
 * own nodes rather than from hard-coded styles:
 *
 *  - the panel is a clone of the Site Care card (border, radius, paper
 *    background, padding), placed after the cards' grid with the grid's own
 *    gap above it. Its title clones the card title, its subhead and row
 *    names clone the card's sentences, its column labels clone the
 *    section's eyebrow ("OPTIONAL ADD-ONS"), and each row clones the card's
 *    title-and-price row with a divider under every row but the last. The
 *    three columns sit side by side from `md` and stack below it;
 *  - the card's project sentence keeps its node and style, takes the new
 *    text, and holds one element after it: a text-style button, styled from
 *    the card's "Learn more →" link, whose click scrolls to the panel (an
 *    element interaction — a bare `#fragment` goes nowhere, AGL-2867);
 *  - the "Managed" sentence keeps its node and takes the new text.
 *
 * The prices are the Pricing Decision Log entry of 2026-11-05
 * (`docs/DECISION_LOG.md`, the Drive entry of the same date). No constant in
 * `plan-entitlements.ts` carries them: a project bills as a one-off invoice
 * (2026-10-19 entry), so the page is the only place they are published.
 *
 * Safety:
 *  - dry run by default;
 *  - refuses, writing nothing, when the page already carries the panel or
 *    when any value it replaces is not exactly what is asserted below;
 *  - `--write` creates a new version and leaves the pointer alone;
 *  - `--publish` refuses unless the screen still points at the version the
 *    new one was cut from, and unless the two differ by exactly this change
 *    (three nodes changed, every added node inside the panel or the link);
 *    the pointer moves in a transaction that refuses if live moved. It
 *    prints the previous version id: pointing `versionId` back at it is the
 *    revert.
 */

import { config as loadEnv } from 'dotenv'
import { decode, encode } from '@msgpack/msgpack'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createResourceUid } from './lib/resource-uid.mjs'

const HOST = 'DXnRbPH4CQ' // aglyn-marketing
const SCREEN = 'v0clP6xQl-' // /pricing

const VERSION_NAME = 'Site Care project prices panel (Pricing Decision Log, 2026-11-05)'

// ---- the prices (Pricing Decision Log, 2026-11-05) ---------------------------
const SITE_CARE_MONTHLY_USD = 49
const STARTER_MONTHLY_USD = 25
const STARTER_YEARLY_PER_MONTH_USD = 16
const SITE_CARE_EXTRA_HOUR_USD = 79

/** One flat price per job; `from` marks the one job still priced from a floor. */
const PROJECT_PRICES = [
  {
    label: 'Pages',
    rows: [
      { name: 'Simple page (contact, reviews, an account page)', usd: 149 },
      { name: 'Standard page (gallery, about, services list)', usd: 199 },
      { name: 'Landing or service page', usd: 249 },
      { name: 'Detailed page (comparisons, options)', usd: 349 },
      { name: 'Home page', usd: 499 },
      { name: 'Error and legal pages', usd: 199 },
      { name: 'Redesign', usd: 749, from: true },
    ],
  },
  {
    label: 'Store and content',
    rows: [
      { name: 'Online store setup', usd: 499 },
      { name: 'Product list setup', usd: 349 },
      { name: 'Blog setup', usd: 249 },
      { name: 'Moving an article, images included', usd: 29, each: true },
      { name: 'Point of sale setup', usd: 149 },
      { name: 'Quotes and proofs setup', usd: 199 },
    ],
  },
  {
    label: 'Brand and setup',
    rows: [
      { name: 'Logo or brand kit', usd: 349 },
      { name: 'Header, footer and menus', usd: 249 },
      { name: 'Photo prep', usd: 199 },
      { name: 'Local search setup', usd: 499 },
      { name: 'Redirects for old links', usd: 149 },
      { name: 'CRM and email setup', usd: 249 },
    ],
  },
]
const priceText = ({ usd, from, each }) => `${from ? 'from ' : ''}$${usd}${each ? ' each' : ''}`

// ---- what the page says now ------------------------------------------------
const SITE_CARE_TITLE = 'Site Care'
const SITE_CARE_PRICE = `$${SITE_CARE_MONTHLY_USD} / mo`
const LEARN_MORE = 'Learn more →'
const EYEBROW = 'OPTIONAL ADD-ONS'
const MANAGED_PREFIX =
  'Managed: your plan plus Site Care, one price. Managed Starter is ' +
  `$${STARTER_MONTHLY_USD + SITE_CARE_MONTHLY_USD} a month, or ` +
  `$${STARTER_YEARLY_PER_MONTH_USD + SITE_CARE_MONTHLY_USD} a month billed yearly. ` +
  `Extra work past the hour is $${SITE_CARE_EXTRA_HOUR_USD} per started hour, once you've said yes. `
const PROJECTS_SENTENCE_FROM =
  'Bigger jobs are quoted flat up front: landing pages from $249, redesigns from $749, ' +
  'logo or brand kit from $349. Plan limits still apply.'
const MANAGED_FROM =
  MANAGED_PREFIX +
  'Bigger jobs are quoted flat up front: landing pages from $249, redesigns from $749, ' +
  'logo or brand kit from $349.'

// ---- what it will say ------------------------------------------------------
const PROJECTS_SENTENCE_TO = 'Bigger jobs have one flat price, agreed up front: '
const PROJECTS_LINK = 'see project prices ↓'
const MANAGED_TO = `${MANAGED_PREFIX}Bigger jobs are priced flat up front, from the project prices above.`
const PANEL_TITLE = 'Site Care project prices'
const PANEL_SUBHEAD = 'One flat price per job, agreed before we start. Plan limits still apply.'
/** Room left above the panel when the link scrolls to it, for the sticky header. */
const SCROLL_OFFSET_PX = 72

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const publishAt = args.indexOf('--publish')
const PUBLISH = publishAt >= 0 ? args[publishAt + 1] : null
if (publishAt >= 0 && !PUBLISH) {
  console.error('--publish takes the version id that --write printed')
  process.exit(1)
}

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

const childIds = (node) => (node?.nodes ?? []).map((kid) => (typeof kid === 'string' ? kid : kid.$id))
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : null)

const screenRef = firestore.collection('hosts').doc(HOST).collection('screens').doc(SCREEN)
const versionsRef = screenRef.collection('versions')

async function readVersion(versionId) {
  const snap = await versionsRef.doc(versionId).get()
  if (!snap.exists) {
    console.error(`version ${versionId} does not exist under screen ${SCREEN}`)
    process.exit(1)
  }
  const data = snap.data()
  return { data, nodes: decodeNodes(data.nodes), storedAsBytes: Buffer.isBuffer(data.nodes) }
}

const liveVersionId = (await screenRef.get()).get('versionId')
if (!liveVersionId) {
  console.error(`hosts/${HOST}/screens/${SCREEN} has no versionId`)
  process.exit(1)
}

/**
 * Finds every node this change touches in a version's node map, asserting
 * each value it will replace. Returns the problems found and the pieces.
 */
function locate(nodes) {
  const problems = []
  if (Object.values(nodes).some((node) => textOf(node) === PANEL_TITLE)) {
    problems.push(`the page already carries "${PANEL_TITLE}"`)
  }
  const cards = Object.values(nodes)
    .filter((node) => textOf(node) === SITE_CARE_TITLE)
    .map((title) => nodes[title.parentId])
    .filter((row) => row && childIds(row).some((id) => textOf(nodes[id]) === SITE_CARE_PRICE))
    .map((row) => nodes[row.parentId])
    .filter(Boolean)
  if (cards.length !== 1) {
    problems.push(`expected one "${SITE_CARE_TITLE}" card priced "${SITE_CARE_PRICE}", found ${cards.length}`)
    return { problems }
  }
  const [card] = cards
  const cardKids = childIds(card).map((id) => nodes[id])
  const [header, firstSentence] = cardKids
  const projects = cardKids.filter((node) => textOf(node) === PROJECTS_SENTENCE_FROM)
  if (projects.length !== 1) {
    problems.push(`card ${card.$id} holds ${projects.length} sentences reading "${PROJECTS_SENTENCE_FROM}", expected 1`)
  }
  const link = cardKids.find((node) => textOf(node) === LEARN_MORE)
  if (!link) problems.push(`card ${card.$id} has no "${LEARN_MORE}" link`)
  const grid = nodes[card.parentId]
  const section = nodes[grid?.parentId]
  if (!grid || !section) {
    problems.push(`card ${card.$id} has no grid and section above it`)
    return { problems }
  }
  const sectionKids = childIds(section).map((id) => nodes[id])
  const eyebrow = sectionKids.find((node) => textOf(node) === EYEBROW)
  if (!eyebrow) problems.push(`section ${section.$id} has no eyebrow "${EYEBROW}"`)
  const managed = sectionKids.filter((node) => textOf(node) === MANAGED_FROM)
  if (managed.length !== 1) {
    problems.push(`section ${section.$id} holds ${managed.length} Managed sentences reading "${MANAGED_FROM}", expected 1`)
  }
  if (sectionKids.indexOf(managed[0]) !== sectionKids.indexOf(grid) + 1) {
    problems.push(`the Managed sentence does not directly follow grid ${grid.$id}`)
  }
  if ([card, grid, section].some((node) => (node.nodes ?? []).some((kid) => typeof kid !== 'string'))) {
    problems.push('the add-ons section holds its children inline, which this script does not edit')
  }
  if (projects[0] && childIds(projects[0]).length) {
    problems.push(`sentence ${projects[0].$id} already holds elements`)
  }
  const [titleId, priceId] = childIds(header)
  if (!nodes[titleId] || !nodes[priceId] || !firstSentence) {
    problems.push(`card ${card.$id} does not open with a title-and-price row and a sentence`)
  }
  return {
    problems,
    card,
    header,
    title: nodes[titleId],
    price: nodes[priceId],
    sentence: firstSentence,
    projects: projects[0],
    link,
    grid,
    section,
    eyebrow,
    managed: managed[0],
  }
}

// ---- --publish: re-check the new version against live, then move the pointer
if (PUBLISH) {
  const draft = await readVersion(PUBLISH)
  const base = draft.data.sourceVersionId
  if (!base) {
    console.error(`version ${PUBLISH} records no sourceVersionId; it was not written by this script`)
    process.exit(1)
  }
  if (base !== liveVersionId) {
    console.error(`live is ${liveVersionId}, but ${PUBLISH} was cut from ${base}: re-run --write from live`)
    process.exit(1)
  }
  const live = await readVersion(liveVersionId)
  const at = locate(live.nodes)
  const problems = [...at.problems]
  if (problems.length) {
    console.error(`REFUSED — nothing published:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
    process.exit(1)
  }
  const changed = Object.keys(live.nodes).filter(
    (id) => JSON.stringify(live.nodes[id]) !== JSON.stringify(draft.nodes[id]),
  )
  const expectedChanged = [at.projects?.$id, at.managed?.$id, at.section?.$id].sort()
  if (JSON.stringify(changed.sort()) !== JSON.stringify(expectedChanged)) {
    problems.push(`changed nodes are [${changed.join(', ')}], expected [${expectedChanged.join(', ')}]`)
  }
  const added = Object.keys(draft.nodes).filter((id) => !(id in live.nodes))
  const panelId = childIds(draft.nodes[at.section.$id]).find((id) => !(id in live.nodes))
  const inside = new Set()
  const walk = (id) => {
    inside.add(id)
    for (const kid of childIds(draft.nodes[id])) walk(kid)
  }
  if (panelId) walk(panelId)
  for (const id of childIds(draft.nodes[at.projects.$id])) walk(id)
  const stray = added.filter((id) => !inside.has(id))
  if (!panelId || stray.length) problems.push(`added nodes outside the panel and the link: [${stray.join(', ')}]`)
  if (textOf(draft.nodes[at.projects.$id]) !== PROJECTS_SENTENCE_TO) problems.push('the card sentence is not the new text')
  if (textOf(draft.nodes[at.managed.$id]) !== MANAGED_TO) problems.push('the Managed sentence is not the new text')
  if (problems.length) {
    console.error(`REFUSED — nothing published:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
    process.exit(1)
  }
  await firestore.runTransaction(async (tx) => {
    const current = (await tx.get(screenRef)).get('versionId')
    if (current !== base) throw new Error(`live moved to ${current} — nothing published`)
    tx.update(screenRef, { versionId: PUBLISH, updatedAt: FieldValue.serverTimestamp() })
  })
  console.log(`/pricing → hosts/${HOST}/screens/${SCREEN}`)
  console.log(`  ${changed.length} nodes changed, ${added.length} added, none removed`)
  console.log(`\nPublished ${PUBLISH} (was ${base}).`)
  console.log(`Revert: set hosts/${HOST}/screens/${SCREEN}.versionId back to ${base}.`)
  console.log('Then drop the tenant cache: POST /api/screens/revalidate {hostId, screenId}.')
  process.exit(0)
}

// ---- dry run and --write: build the change on a copy of live ----------------
const source = await readVersion(liveVersionId)
const nodes = structuredClone(source.nodes)
const at = locate(nodes)
if (at.problems.length) {
  console.error(`REFUSED — nothing written:\n${at.problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}
const changes = []

/** Clone a node's own fields (never its children) under a new parent. */
function clone(node, parentId, { text, sx = {}, props = {} } = {}) {
  const copy = structuredClone(node)
  copy.$id = createResourceUid()
  copy.parentId = parentId
  delete copy.nodes
  delete copy.interactions
  copy.props = { ...copy.props, ...props, ...(text === undefined ? {} : { children: text }) }
  copy.sx = { ...copy.sx, ...sx }
  nodes[copy.$id] = copy
  return copy
}
const adopt = (parent, kids) => {
  parent.nodes = kids.map((kid) => kid.$id)
}

// The panel: the card's box, full width, the grid's gap above it.
const panel = clone(at.card, at.section.$id, { sx: { mt: at.grid.sx?.gap ?? 2.5 } })
const panelTitle = clone(at.title, panel.$id, { text: PANEL_TITLE, props: { component: 'h4' } })
const panelSubhead = clone(at.sentence, panel.$id, { text: PANEL_SUBHEAD, sx: { mt: 0.5 } })
const columns = clone(at.grid, panel.$id, {
  sx: {
    gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
    columnGap: 5,
    rowGap: 3,
    mt: 2.5,
  },
})
delete columns.sx.gap
const columnNodes = PROJECT_PRICES.map(({ label, rows }) => {
  const column = clone(at.grid, columns.$id, { sx: { display: 'block', mt: 0 } })
  delete column.sx.gridTemplateColumns
  delete column.sx.gap
  const heading = clone(at.eyebrow, column.$id, {
    text: label,
    props: { component: 'h5' },
    sx: { textAlign: 'left', color: 'text.secondary', textTransform: 'uppercase', mb: 0.5 },
  })
  const rowNodes = rows.map((row, index) => {
    const line = clone(at.header, column.$id, {
      sx: {
        py: 0.75,
        ...(index < rows.length - 1 ? { borderBottom: '1px solid', borderColor: 'divider' } : {}),
      },
    })
    adopt(line, [
      clone(at.sentence, line.$id, { text: row.name, sx: { mt: 0, color: 'text.primary' } }),
      clone(at.sentence, line.$id, {
        text: priceText(row),
        sx: { mt: 0, color: 'text.primary', fontWeight: 'semiBold', whiteSpace: 'nowrap' },
      }),
    ])
    return line
  })
  adopt(column, [heading, ...rowNodes])
  return column
})
adopt(columns, columnNodes)
adopt(panel, [panelTitle, panelSubhead, columns])
const sectionKids = childIds(at.section)
const gridAt = sectionKids.indexOf(at.grid.$id)
at.section.nodes = [...sectionKids.slice(0, gridAt + 1), panel.$id, ...sectionKids.slice(gridAt + 1)]
const rowCount = PROJECT_PRICES.reduce((sum, { rows }) => sum + rows.length, 0)
changes.push(
  `section ${at.section.$id}: new panel ${panel.$id} after grid ${at.grid.$id} — "${PANEL_TITLE}", ` +
    `${PROJECT_PRICES.length} columns, ${rowCount} rows`,
)
for (const { label, rows } of PROJECT_PRICES) {
  changes.push(`  ${label}: ${rows.map((row) => `${row.name} ${priceText(row)}`).join(' · ')}`)
}

// The card's sentence, and the element that scrolls to the panel.
const button = clone(at.link, at.projects.$id, {
  text: PROJECTS_LINK,
  sx: {
    display: 'inline',
    mt: 0,
    p: 0,
    minWidth: 0,
    verticalAlign: 'baseline',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    textTransform: 'none',
    '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
  },
})
button.componentId = 'muiButton'
button.props = { children: PROJECTS_LINK, variant: 'text', color: 'inherit', disableRipple: true }
button.interactions = [
  {
    id: 'scroll-to-project-prices',
    name: 'Scroll to the project prices',
    enabled: true,
    trigger: { event: 'elementClick', everyTime: true },
    steps: [{ type: 'scrollTo', selector: `[data-aglyn="leaf:${panel.$id}"]`, offsetPx: SCROLL_OFFSET_PX }],
  },
]
at.projects.props = { ...at.projects.props, children: PROJECTS_SENTENCE_TO }
at.projects.nodes = [button.$id]
changes.push(`sentence ${at.projects.$id}: "${PROJECTS_SENTENCE_FROM}" → "${PROJECTS_SENTENCE_TO}"`)
changes.push(`  + button ${button.$id} "${PROJECTS_LINK}", on click scrolls to panel ${panel.$id}`)

// The Managed sentence.
at.managed.props = { ...at.managed.props, children: MANAGED_TO }
changes.push(`sentence ${at.managed.$id}: "${MANAGED_FROM}" → "${MANAGED_TO}"`)

console.log(`/pricing → hosts/${HOST}/screens/${SCREEN}`)
console.log(`  live version: ${liveVersionId}`)
for (const line of changes) console.log(`  ${line}`)
console.log(`  nodes: ${Object.keys(source.nodes).length} → ${Object.keys(nodes).length}`)

if (!WRITE) {
  console.log('\nDry run. Pass --write to write the new version (the page does not change).')
  process.exit(0)
}

const newVersionRef = versionsRef.doc(createResourceUid())
const { $id: _id, createdAt: _createdAt, ...carried } = source.data
await newVersionRef.create({
  ...carried,
  nodes: encodeNodes(nodes, source.storedAsBytes),
  hostId: HOST,
  screenId: SCREEN,
  displayName: VERSION_NAME,
  sourceVersionId: liveVersionId,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})
const readBack = decodeNodes((await newVersionRef.get()).get('nodes'))
if (JSON.stringify(readBack) !== JSON.stringify(nodes)) {
  console.error(`version ${newVersionRef.id} reads back different from what was written`)
  process.exit(1)
}
console.log(`\nWrote NEW version ${newVersionRef.id} from ${liveVersionId}; live is unchanged.`)
console.log(`Preview: https://app.aglyn.com/aglyn-org/hosts/aglyn-marketing/screens/${SCREEN}/versions/${newVersionRef.id}/preview`)
console.log(`Publish: node tools/scripts/publish-pricing-site-care-project-prices.mjs --publish ${newVersionRef.id}`)
