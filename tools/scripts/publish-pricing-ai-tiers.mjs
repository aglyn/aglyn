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
 * Publishes the Aglyn AI tiers to the `/pricing` page (AGL-3965), and the
 * "Learn more" link from the Site Care card to `/managed`.
 *
 *   node tools/scripts/publish-pricing-ai-tiers.mjs [--dry-run]
 *       dry run, the default: prints every changed node before and after
 *   node tools/scripts/publish-pricing-ai-tiers.mjs --write --expect-live=<versionId>
 *       publishes, only if the live version is still the one the dry run read
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from the repo's `.env`
 * and `apps/console/.env.production.local`.
 *
 * The page is Besigner content on the marketing host, so the changes are
 * made to the screen's stored node map. Exactly four, and nothing else:
 *
 *  1. the compare row "AI credits / mo" is relabeled "AI credits included /
 *     mo", on the desktop table and in each of the eight per-plan panels:
 *     the figure is the plan's own credits, and a tier adds on top of it;
 *  2. the generation row ticks on every paid plan, where it printed
 *     "add-on": one pool, so a paid plan's included credits pay for
 *     generation too. Each new tick takes the style the other ticks have
 *     (`semiBold`, `primary.dark`; a desktop cell keeps its column's own
 *     background), and the run refuses if that is not the style the panel's
 *     own ticks carry;
 *  3. the Aglyn AI card's sentence names the six tiers once, in place of a
 *     price per plan;
 *  4. the Site Care card gets a "Learn more" text link to `/managed`, after
 *     its last sentence. It is a Page Link (`muiScreenLink`) that targets the
 *     `/managed` screen by id, shown as a text link, opening in the same tab,
 *     in the style of the card links on the home page ("See agencies →":
 *     `body2`, `semiBold`, `primary.dark`). `inline-block` lets its top
 *     margin space it like the sentences above it.
 *
 * The new text for 1–3 comes from `tools/marketing/pricing-copy/tables.json`,
 * which `build-pricing-tables.mts` generates from `plan-entitlements.ts`.
 * Each cell is checked against its current value before it is changed. A
 * cell that already reads the new value is left alone, so a re-run is a
 * no-op.
 *
 * None of the nodes this touches sits in a reusable component, and the
 * script refuses if one does, so the screen's version is the whole of it. A
 * screen's `versionId` move IS the publish. A component would also need its
 * own document's nodes written, which does not apply here.
 *
 * Safety:
 *  - dry run by default. `--write` also needs `--expect-live=<versionId>`,
 *    the live version the dry run printed. The pointer is re-read inside the
 *    write's transaction, and the run refuses if a peer has published since;
 *  - before writing, the live screen and version documents are backed up to
 *    `.scratch/pricing-backup-<ISO>.json` (untracked);
 *  - the new version is diffed against the live one key by key, and the run
 *    refuses unless the only nodes that differ are the ones listed above;
 *  - one transaction writes a NEW version, moves the screen's `versionId` to
 *    it, and adds a `publishOutbox` entry for `/pricing`. That is the same
 *    announce the Besigner's publish leaves, and the console's drain turns it
 *    into the tenant revalidate. The previous version stays in history as the
 *    revert path: point `versionId` back at the one this prints, and add an
 *    outbox entry for `/pricing` the same way.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { decode, encode } from '@msgpack/msgpack'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createResourceUid } from './lib/resource-uid.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const HOST = 'DXnRbPH4CQ' // aglyn-marketing
const SCREEN = 'v0clP6xQl-' // /pricing
const ROUTE = '/pricing'
const MANAGED_SCREEN = 'qnuMY13VsS' // /managed
const MANAGED_SLUG = 'managed'

const VERSION_NAME =
  'Aglyn AI tiers: credits included, generation on every paid plan, the tier card, ' +
  'Site Care links to /managed (AGL-3965)'

// ---- what the page says now ------------------------------------------------
const CREDITS_LABEL_FROM = 'AI credits / mo'
const GENERATION_FROM = 'add-on'
const AI_SENTENCE_FROM =
  'Starter $9 · Pro $19 · Business $39 · Scale $69 · Advanced $99 · Agency $299 a month, ' +
  'per workspace. Adds AI credits to your plan’s included band — 4,000 on Starter, 9,000 on ' +
  'Pro, 19,000 on Business, 34,000 on Scale, 49,000 on Advanced, 149,000 on Agency. ' +
  'Enterprise by agreement.'
const SITE_CARE_LAST_SENTENCE = 'Any paid plan.'

// ---- what it will say, from the generated tables ---------------------------
const TABLES = JSON.parse(
  readFileSync(join(ROOT, 'tools', 'marketing', 'pricing-copy', 'tables.json'), 'utf8'),
)
const COLUMNS = TABLES.compare.columns // [{ plan, label }], left to right
const compareRows = TABLES.compare.groups.flatMap((group) => group.rows)
const CREDITS_LABEL_TO = 'AI credits included / mo'
const creditsRow = compareRows.find((row) => row.label === CREDITS_LABEL_TO)
const generationRow = compareRows.find((row) =>
  row.label.endsWith(': generate pages, emails, campaigns, products and more'),
)
const aiCard = TABLES.addons.rows.find((row) => Array.isArray(row.tiers))
const siteCareCard = TABLES.addons.rows.find((row) => row.label === 'Site Care')
if (!creditsRow || !generationRow || !aiCard?.blurb || !siteCareCard?.priceUsd) {
  console.error('tables.json lacks the credits row, the generation row, the AI card or Site Care')
  process.exit(1)
}
const AI_SENTENCE_TO = aiCard.blurb
const SITE_CARE_PRICE = `$${siteCareCard.priceUsd} / mo`

/** A tick, as the other ticks on the page are styled. */
const TICK_SX = { fontWeight: 'semiBold', color: 'primary.dark' }

const LINK_TEXT = 'Learn more'
const LINK_PROPS = {
  children: LINK_TEXT,
  renderAs: 'link',
  color: 'inherit',
  variant: 'text',
  screenId: MANAGED_SCREEN,
}
const LINK_SX = {
  display: 'inline-block',
  mt: 1,
  fontSize: 'body2.fontSize',
  fontWeight: 'semiBold',
  lineHeight: 1.4,
  color: 'primary.dark',
  textDecoration: 'none',
}

// ---- arguments ---------------------------------------------------------------
const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const expectLive = args.find((arg) => arg.startsWith('--expect-live='))?.slice('--expect-live='.length)
if (WRITE && args.includes('--dry-run')) {
  console.error('Pass --write or --dry-run, not both.')
  process.exit(1)
}
if (WRITE && !expectLive) {
  console.error('--write needs --expect-live=<versionId>: the live version the dry run printed.')
  process.exit(1)
}

loadEnv({ path: join(ROOT, '.env'), quiet: true })
loadEnv({ path: join(ROOT, 'apps', 'console', '.env.production.local'), quiet: true })

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

// ---- read what is live ---------------------------------------------------------
const hostRef = firestore.collection('hosts').doc(HOST)
const screenRef = hostRef.collection('screens').doc(SCREEN)
const versionsRef = screenRef.collection('versions')
const [hostSnap, screenSnap, managedSnap] = await Promise.all([
  hostRef.get(),
  screenRef.get(),
  hostRef.collection('screens').doc(MANAGED_SCREEN).get(),
])
if (!screenSnap.exists) {
  console.error(`hosts/${HOST}/screens/${SCREEN} does not exist`)
  process.exit(1)
}
const sourceVersionId = screenSnap.get('versionId')
if (!sourceVersionId) {
  console.error(`screen ${SCREEN} has no versionId`)
  process.exit(1)
}
if (WRITE && sourceVersionId !== expectLive) {
  console.error(
    `REFUSED — nothing written: the live version is ${sourceVersionId}, not ${expectLive}. ` +
      'Someone published since the dry run; run the dry run again and read its diff.',
  )
  process.exit(1)
}
const sourceSnap = await versionsRef.doc(sourceVersionId).get()
if (!sourceSnap.exists) {
  console.error(`version ${sourceVersionId} does not exist under screen ${SCREEN}`)
  process.exit(1)
}
const source = sourceSnap.data()
const storedAsBytes = Buffer.isBuffer(source.nodes)
const before = decodeNodes(source.nodes)
const nodes = structuredClone(before)

const problems = []
/** Planned changes, for the dry run: `{ id, where, field, from, to }`. */
const changes = []
/** Cells already carrying the new value. */
const already = []
/** Every node id this run is allowed to change. */
const intended = new Set()

const childIds = (node) => (node?.nodes ?? []).map((kid) => (typeof kid === 'string' ? kid : kid.$id))
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : null)
const withText = (...texts) => Object.values(nodes).filter((node) => texts.includes(textOf(node)))
const refuse = () => {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}
const ancestorsOf = (node) => {
  const out = []
  let at = nodes[node.parentId]
  while (at && at.$id !== at.parentId && out.length < 64) {
    out.push(at)
    at = nodes[at.parentId]
  }
  return out
}

/** Set a text node's `children`, guarded on its current value. */
function setText(node, from, to, where) {
  const now = textOf(node)
  if (now === to) {
    already.push(`${node.$id} (${where}) already reads "${to}"`)
    return false
  }
  if (now !== from) {
    problems.push(`${node.$id} (${where}) reads "${now}", expected "${from}"`)
    return false
  }
  node.props = { ...node.props, children: to }
  intended.add(node.$id)
  changes.push({ id: node.$id, where, field: 'props.children', from, to })
  return true
}

/** The plan a mobile panel shows, from its tab label. */
const planOfPanel = (panel) => COLUMNS.find((column) => column.label === panel?.props?.label)?.plan

// ---- (1) the credits row label ---------------------------------------------------
const creditsLabels = withText(CREDITS_LABEL_FROM, CREDITS_LABEL_TO)
const creditsDesktop = creditsLabels.filter((n) => childIds(nodes[n.parentId]).length === COLUMNS.length + 1)
const creditsPanels = creditsLabels.filter((n) => nodes[nodes[n.parentId]?.parentId]?.componentId === 'muiTabPanel')
if (creditsDesktop.length !== 1 || creditsPanels.length !== COLUMNS.length || creditsLabels.length !== COLUMNS.length + 1) {
  problems.push(
    `expected the credits row once on the desktop table and once in each of ${COLUMNS.length} ` +
      `panels, found ${creditsDesktop.length} + ${creditsPanels.length} of ${creditsLabels.length}`,
  )
  refuse()
}
const desktopTable = nodes[nodes[creditsDesktop[0].parentId].parentId]
// The desktop table's header row names the plans left to right.
const header = childIds(desktopTable)
  .map((id) => nodes[id])
  .find((row) => childIds(row).slice(1).map((id) => textOf(nodes[id])).join('|') === COLUMNS.map((c) => c.label).join('|'))
if (!header) {
  problems.push(`desktop table ${desktopTable.$id} has no header row ${COLUMNS.map((c) => c.label).join(' | ')}`)
  refuse()
}
{
  // The figures already match the code; only the label moves.
  const row = nodes[creditsDesktop[0].parentId]
  const cells = childIds(row).slice(1).map((id) => textOf(nodes[id]))
  const expected = COLUMNS.map((c) => creditsRow.values[c.plan])
  if (cells.join('|') !== expected.join('|')) {
    problems.push(`desktop credits row ${row.$id} reads ${cells.join(' · ')}, the code says ${expected.join(' · ')}`)
  }
  setText(creditsDesktop[0], CREDITS_LABEL_FROM, CREDITS_LABEL_TO, 'desktop compare table, credits row label')
}
for (const label of creditsPanels) {
  const panel = nodes[nodes[label.parentId].parentId]
  const plan = planOfPanel(panel)
  const value = textOf(nodes[childIds(nodes[label.parentId])[1]])
  if (value !== creditsRow.values[plan]) {
    problems.push(`${panel.props.label} panel credits row reads "${value}", the code says "${creditsRow.values[plan]}"`)
  }
  setText(label, CREDITS_LABEL_FROM, CREDITS_LABEL_TO, `${panel.props.label} panel, credits row label`)
}

// ---- (2) the generation row --------------------------------------------------------
const generationLabels = withText(generationRow.label)
const generationDesktop = generationLabels.filter((n) => nodes[n.parentId]?.parentId === desktopTable.$id)
const generationPanels = generationLabels.filter((n) => nodes[nodes[n.parentId]?.parentId]?.componentId === 'muiTabPanel')
if (generationDesktop.length !== 1 || generationPanels.length !== COLUMNS.length) {
  problems.push(
    `expected the generation row once on the desktop table and in ${COLUMNS.length} panels, ` +
      `found ${generationDesktop.length} + ${generationPanels.length}`,
  )
  refuse()
}
{
  const row = nodes[generationDesktop[0].parentId]
  childIds(row)
    .slice(1)
    .forEach((id, i) => {
      const cell = nodes[id]
      const { plan, label } = COLUMNS[i]
      const to = generationRow.values[plan]
      if (textOf(cell) === to) return
      if (to !== '✓') {
        problems.push(`desktop generation cell ${id} (${label}) reads "${textOf(cell)}", the code says "${to}"`)
        return
      }
      const sxBefore = JSON.stringify(cell.sx)
      if (setText(cell, GENERATION_FROM, to, `desktop compare table, generation row, ${label}`)) {
        cell.sx = { ...cell.sx, ...TICK_SX }
        changes.push({
          id,
          where: `desktop compare table, generation row, ${label}`,
          field: 'sx',
          from: sxBefore,
          to: JSON.stringify(cell.sx),
        })
      }
    })
}
for (const label of generationPanels) {
  const row = nodes[label.parentId]
  const panel = nodes[row.parentId]
  const plan = planOfPanel(panel)
  const cell = nodes[childIds(row)[1]]
  const to = generationRow.values[plan]
  if (textOf(cell) === to) continue
  if (to !== '✓') {
    problems.push(`${panel.props.label} panel generation cell reads "${textOf(cell)}", the code says "${to}"`)
    continue
  }
  // The panel's own tick style: what most ticked value cells in it carry.
  const tickStyles = new Map()
  for (const rowId of childIds(panel)) {
    const value = nodes[childIds(nodes[rowId])[1]]
    if (textOf(value) !== '✓') continue
    const key = JSON.stringify(value.sx)
    tickStyles.set(key, (tickStyles.get(key) ?? 0) + 1)
  }
  const [panelTick] = [...tickStyles].sort((a, b) => b[1] - a[1])[0] ?? []
  const where = `${panel.props.label} panel, generation row`
  const sxBefore = JSON.stringify(cell.sx)
  const sxAfter = JSON.stringify({ ...cell.sx, ...TICK_SX })
  if (sxAfter !== panelTick) {
    problems.push(`${where}: a tick here would be styled ${sxAfter}, the panel's ticks are ${panelTick}`)
    continue
  }
  if (setText(cell, GENERATION_FROM, to, where) && sxAfter !== sxBefore) {
    cell.sx = JSON.parse(sxAfter)
    changes.push({ id: cell.$id, where, field: 'sx', from: sxBefore, to: sxAfter })
  }
}

// ---- (3) the Aglyn AI card's sentence --------------------------------------------------
const aiSentences = withText(AI_SENTENCE_FROM, AI_SENTENCE_TO)
if (aiSentences.length !== 1) {
  problems.push(`expected one Aglyn AI card sentence, found ${aiSentences.length}`)
  refuse()
}
{
  const [sentence] = aiSentences
  const card = nodes[sentence.parentId]
  const [headerId] = childIds(card)
  const headline = childIds(nodes[headerId]).map((id) => textOf(nodes[id]))
  if (headline.join('|') !== `${aiCard.label}|${aiCard.priceLabel}`) {
    problems.push(`card ${card.$id} is headed ${headline.join(' | ')}, expected ${aiCard.label} | ${aiCard.priceLabel}`)
  }
  setText(sentence, AI_SENTENCE_FROM, AI_SENTENCE_TO, 'Aglyn AI card sentence')
}

// ---- (4) the Site Care card's link -------------------------------------------------------
const siteCareCards = withText(siteCareCard.label)
  .map((title) => nodes[title.parentId])
  .filter((row) => row && childIds(row).some((id) => textOf(nodes[id]) === SITE_CARE_PRICE))
  .map((row) => nodes[row.parentId])
  .filter(Boolean)
if (siteCareCards.length !== 1) {
  problems.push(`expected one "${siteCareCard.label}" card priced "${SITE_CARE_PRICE}", found ${siteCareCards.length}`)
  refuse()
}
const [siteCare] = siteCareCards
const siteCareKids = childIds(siteCare)
const existingLink = siteCareKids
  .map((id) => nodes[id])
  .find((node) => node.componentId === 'muiScreenLink' && node.props?.screenId === MANAGED_SCREEN)
let linkId = null
if (existingLink) {
  already.push(`${existingLink.$id} (Site Care card) already links to /${MANAGED_SLUG}`)
} else {
  const last = nodes[siteCareKids.at(-1)]
  if (textOf(last) !== SITE_CARE_LAST_SENTENCE) {
    problems.push(`card ${siteCare.$id} ends with "${textOf(last)}", expected "${SITE_CARE_LAST_SENTENCE}"`)
  }
  if (!managedSnap.exists || managedSnap.get('deletedAt') || !managedSnap.get('versionId')) {
    problems.push(`the /${MANAGED_SLUG} screen ${MANAGED_SCREEN} is missing, deleted or unpublished`)
  } else if (managedSnap.get('slug') !== MANAGED_SLUG || hostSnap.get('screens')?.[MANAGED_SCREEN] !== MANAGED_SLUG) {
    problems.push(`screen ${MANAGED_SCREEN} is not routed at /${MANAGED_SLUG}`)
  }
  if (siteCareKids.some((id) => typeof id !== 'string')) {
    problems.push('the Site Care card holds its children inline, which this script does not edit')
  }
  if (!problems.length) {
    linkId = createResourceUid()
    nodes[linkId] = {
      $id: linkId,
      type: 'node',
      parentId: siteCare.$id,
      pluginId: 'mui',
      componentId: 'muiScreenLink',
      props: { ...LINK_PROPS },
      sx: { ...LINK_SX },
    }
    siteCare.nodes = [...siteCareKids, linkId]
    intended.add(siteCare.$id)
    changes.push({
      id: linkId,
      where: `Site Care card ${siteCare.$id}, after "${SITE_CARE_LAST_SENTENCE}" (${last.$id})`,
      field: 'new node',
      from: '(none)',
      to: JSON.stringify({ componentId: 'muiScreenLink', props: LINK_PROPS, sx: LINK_SX }),
    })
    changes.push({
      id: siteCare.$id,
      where: 'Site Care card',
      field: 'nodes',
      from: `${siteCareKids.length} children`,
      to: `${siteCareKids.length + 1} children, ending with ${linkId}`,
    })
  }
}

// ---- nothing inside a reusable component ---------------------------------------------------
for (const id of [...intended, ...(linkId ? [linkId] : [])]) {
  const inside = ancestorsOf(nodes[id]).find((node) => node.props?.refId || node.componentId === 'reusableInstance')
  if (inside) problems.push(`${id} sits in reusable component ${inside.props?.refId ?? inside.$id}`)
}
if (problems.length) refuse()

// ---- the diff against live: only the intended nodes may differ ---------------------------------
const differ = []
const added = []
const removed = []
for (const id of new Set([...Object.keys(before), ...Object.keys(nodes)])) {
  if (!(id in before)) added.push(id)
  else if (!(id in nodes)) removed.push(id)
  else if (JSON.stringify(before[id]) !== JSON.stringify(nodes[id])) differ.push(id)
}
const unexpected = [
  ...differ.filter((id) => !intended.has(id)).map((id) => `changed ${id}`),
  ...[...intended].filter((id) => !differ.includes(id)).map((id) => `meant to change ${id}, unchanged`),
  ...added.filter((id) => id !== linkId).map((id) => `added ${id}`),
  ...removed.map((id) => `removed ${id}`),
]
if (unexpected.length) {
  problems.push(`the new version differs from live beyond the four changes: ${unexpected.join(', ')}`)
  refuse()
}

// ---- report -----------------------------------------------------------------------------------
console.log(`${ROUTE} → hosts/${HOST}/screens/${SCREEN}`)
console.log(`  live version: ${sourceVersionId} ("${source.displayName ?? ''}")`)
console.log(`  nodes: ${Object.keys(before).length} → ${Object.keys(nodes).length}; ` +
  `${differ.length} changed, ${added.length} added, ${removed.length} removed`)
for (const change of changes) {
  console.log(`\n  ~ ${change.id}  ${change.where}  [${change.field}]`)
  console.log(`      before: ${change.from}`)
  console.log(`      after:  ${change.to}`)
}
if (already.length) console.log(`\n  already done:\n${already.map((line) => `    = ${line}`).join('\n')}`)

if (!differ.length && !added.length) {
  console.log(`\nNothing to do: ${ROUTE} already carries all four changes.`)
  process.exit(0)
}
if (!WRITE) {
  console.log(
    `\nDry run. ${differ.length + added.length} node(s) would change. To publish:\n` +
      `  node tools/scripts/publish-pricing-ai-tiers.mjs --write --expect-live=${sourceVersionId}`,
  )
  process.exit(0)
}

// ---- back up what is live, then write -------------------------------------------------------
/** Firestore values as JSON: a Timestamp becomes its ISO string. */
const plain = (value) => {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (Buffer.isBuffer(value)) return { base64: value.toString('base64') }
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  return value
}
const takenAt = new Date().toISOString()
const backupPath = join(ROOT, '.scratch', `pricing-backup-${takenAt.replace(/[:.]/g, '-')}.json`)
mkdirSync(dirname(backupPath), { recursive: true })
const { nodes: _sourceNodes, ...sourceFields } = source
writeFileSync(
  backupPath,
  JSON.stringify(
    {
      hostId: HOST,
      screenId: SCREEN,
      takenAt,
      screen: plain(screenSnap.data()),
      version: {
        id: sourceVersionId,
        ...plain(sourceFields),
        nodesStoredAs: storedAsBytes ? 'msgpack' : 'map',
        nodesMsgpackBase64: storedAsBytes ? source.nodes.toString('base64') : null,
        nodes: before,
      },
    },
    null,
    1,
  ),
)
console.log(`\nBacked up the live screen and version ${sourceVersionId} to ${backupPath}`)

const newVersionRef = versionsRef.doc(createResourceUid())
const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
const { createdAt: _createdAt, updatedAt: _updatedAt, ...carried } = sourceFields
await firestore.runTransaction(async (tx) => {
  const live = await tx.get(screenRef)
  if (live.get('versionId') !== sourceVersionId) {
    throw new Error(`the live version moved to ${live.get('versionId')} while this ran; nothing written`)
  }
  tx.create(newVersionRef, {
    ...carried,
    displayName: VERSION_NAME,
    nodes: encodeNodes(nodes, storedAsBytes),
    hostId: HOST,
    screenId: SCREEN,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  tx.update(screenRef, { versionId: newVersionRef.id, updatedAt: FieldValue.serverTimestamp() })
  tx.create(outboxRef, {
    hostId: HOST,
    paths: [ROUTE],
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
  })
})

console.log(`\nPublished NEW version ${newVersionRef.id} "${VERSION_NAME}" (was ${sourceVersionId}).`)
console.log(`Announced ${ROUTE} in publishOutbox/${outboxRef.id}; the console's drain revalidates it.`)
console.log(
  `Revert: set hosts/${HOST}/screens/${SCREEN}.versionId back to ${sourceVersionId}, ` +
    `then add a publishOutbox entry { hostId: '${HOST}', paths: ['${ROUTE}'], attempts: 0 }.`,
)
