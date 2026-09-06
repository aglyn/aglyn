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

// The deals pipeline (AGL-2620, AGL-2598): the board with a card in every
// open stage, a card moved between stages and marked won through its menu
// (the keyboard route — a drag is the same request), the table view of the
// same pipeline, and then the surfaces AGL-2620 added: the Pipelines dialog
// (create, refuse an archive that would strand an open deal, set the
// default and set it back, archive an empty one), the pipeline switcher,
// line items on a deal from the catalog and by hand with the amount
// following them, and the forecast by close month on Reports.
//
// Every write is asserted on the document as well as on the page: a stage
// move lands in `stageId`/`status`, a line lands in `lineItems` with the
// sum in `amountCents`, an archive lands in `archivedAt`.
//
// Re-runnable: the fixtures are re-seeded first (the moved and won deals
// come back open), and the pipeline this script creates is removed before
// it is created again.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-deals.e2e.mjs

import { CRM_FIXTURE, seedCrmFixtures } from '../scripts/lib/crm-fixtures.mjs'
import {
  adminFirestore,
  cardNamed,
  expectSnackbar,
  HOST_ID,
  hostUrl,
  openConsole,
  ORG_ID,
  OWNER_NAME,
  OWNER_UID,
  pickSelect,
  rowAction,
  shot,
  step,
  TEAMMATE_UID,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const F = CRM_FIXTURE
const NEW_PIPELINE = 'Partners'
const READ_TOKENS = ['org', `host:${HOST_ID}`]

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)
const dealRef = (id) => orgRef.collection('deals').doc(id)
const dealDoc = async (id) => (await dealRef(id).get()).data() ?? {}
const pipelinesNamed = (name) => orgRef.collection('pipelines').where('name', '==', name).get()
const money = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
for (const entry of (await pipelinesNamed(NEW_PIPELINE)).docs) await entry.ref.delete()

const tally = verdicts()
const session = await openConsole()
const { page } = session

/** The board's card for a deal — its title is a button that opens the deal. */
const card = (title) => page.getByRole('button', { name: title, exact: true })

// ── The board ───────────────────────────────────────────────────────────────
await step(tally, page, 'the board opens on Sales with a card in every open stage', async () => {
  await page.goto(hostUrl('/crm/deals'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  for (const column of ['Qualified', 'Contact made', 'Proposal sent', 'Negotiation']) {
    await page.getByText(column, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  }
  for (const title of [F.dealTitle, F.boardDeals.voss.title, F.boardDeals.northShore.title, F.boardDeals.cedar.title]) {
    await card(title).waitFor({ timeout: TIMEOUT_MS })
  }
  const switcher = page.getByRole('combobox', { name: /^Pipeline/ })
  await switcher.waitFor({ timeout: TIMEOUT_MS })
  const chosen = (await switcher.textContent())?.trim()
  tally.check('the board opens on Sales with a card in every open stage', chosen === 'Sales', `switcher reads ${chosen}`)
  await shot(page, 'crm-deals-board')
})

await step(tally, page, 'a card moves to another stage through its menu', async () => {
  await rowAction(page, F.dealTitle, 'Move to Negotiation')
  await expectSnackbar(page, 'Moved to Negotiation')
  const stored = await waitFor(() => dealDoc(F.dealId), (d) => d.stageId === 'negotiation')
  tally.check(
    'a card moves to another stage through its menu',
    stored.stageId === 'negotiation' && stored.status === 'open' && typeof stored.stageChangedAtMs === 'number',
    `${stored.stageId} · ${stored.status}`,
  )
})

await step(tally, page, 'Mark won closes the deal and the Won column shows it', async () => {
  await rowAction(page, F.dealTitle, 'Mark won')
  await expectSnackbar(page, 'Deal won')
  const stored = await waitFor(() => dealDoc(F.dealId), (d) => d.status === 'won')
  // The closed columns fold away; opening Won reads its rows.
  await page.getByRole('button', { name: 'Won', exact: true }).first().click()
  await card(F.dealTitle).waitFor({ timeout: TIMEOUT_MS })
  tally.check(
    'Mark won closes the deal and the Won column shows it',
    stored.status === 'won' && stored.stageId === 'won' && typeof stored.closedAtMs === 'number',
    `${stored.status} · closed ${stored.closedAtMs}`,
  )
})

await step(tally, page, 'the table lists the pipeline with the won deal marked', async () => {
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  const row = page.locator('[role="row"]', { hasText: F.dealTitle }).first()
  await row.waitFor({ timeout: TIMEOUT_MS })
  await row.getByText('Won', { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  // Every row is a Sales deal: the Renewals deal is not on this table.
  const renewalRows = await page.locator('[role="row"]', { hasText: F.renewalDealTitle }).count()
  tally.check('the table lists the pipeline with the won deal marked', renewalRows === 0, `${renewalRows} Renewals rows on the Sales table`)
  await page.getByRole('button', { name: 'Board', exact: true }).click()
})

// ── Pipelines ───────────────────────────────────────────────────────────────
await step(tally, page, 'the Pipelines dialog creates a pipeline from the default stages', async () => {
  await page.getByRole('button', { name: 'Pipelines', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Pipelines' })
  await dialog.getByText('Sales', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  await dialog.getByText(F.renewalsPipelineName, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  await dialog.getByLabel('New pipeline').fill(NEW_PIPELINE)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expectSnackbar(page, 'Pipeline created')
  const created = await waitFor(async () => (await pipelinesNamed(NEW_PIPELINE)).docs[0]?.data(), (d) => Boolean(d))
  tally.check(
    'the Pipelines dialog creates a pipeline from the default stages',
    created.stages?.length === 6 && created.isDefault === false && created.archivedAt === null && Array.isArray(created.visibleTo),
    `${created.stages?.length} stages · default ${created.isDefault} · visibleTo ${JSON.stringify(created.visibleTo)}`,
  )
  await dialog.getByText(NEW_PIPELINE, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  await shot(page, 'crm-pipelines-dialog')
})

await step(tally, page, 'archiving a pipeline with an open deal is refused by the count', async () => {
  await rowAction(page, F.renewalsPipelineName, 'Archive')
  await expectSnackbar(page, '1 open deal is in this pipeline')
  const stored = (await orgRef.collection('pipelines').doc(F.renewalsPipelineId).get()).data()
  tally.check('archiving a pipeline with an open deal is refused by the count', stored.archivedAt === null, `archivedAt ${stored.archivedAt}`)
})

await step(tally, page, 'Set as default moves the flag in one batch, and back', async () => {
  await rowAction(page, F.renewalsPipelineName, 'Set as default')
  await expectSnackbar(page, `${F.renewalsPipelineName} is now the default pipeline`)
  const flags = async () => ({
    sales: (await orgRef.collection('pipelines').doc(F.pipelineId).get()).get('isDefault'),
    renewals: (await orgRef.collection('pipelines').doc(F.renewalsPipelineId).get()).get('isDefault'),
  })
  const moved = await waitFor(flags, (f) => f.renewals === true && f.sales === false)
  await rowAction(page, 'Sales', 'Set as default')
  await expectSnackbar(page, 'Sales is now the default pipeline')
  const back = await waitFor(flags, (f) => f.sales === true && f.renewals === false)
  tally.check('Set as default moves the flag in one batch, and back', moved.renewals && !moved.sales && back.sales && !back.renewals, JSON.stringify({ moved, back }))
})

await step(tally, page, 'an empty pipeline archives and leaves the active list', async () => {
  await rowAction(page, NEW_PIPELINE, 'Archive')
  await expectSnackbar(page, `${NEW_PIPELINE} archived`)
  const stored = await waitFor(async () => (await pipelinesNamed(NEW_PIPELINE)).docs[0]?.data(), (d) => typeof d?.archivedAt === 'number')
  const dialog = page.getByRole('dialog', { name: 'Pipelines' })
  await dialog.getByText('Archived — kept so closed deals still show their stages').waitFor({ timeout: TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  tally.check('an empty pipeline archives and leaves the active list', typeof stored.archivedAt === 'number' && stored.isDefault === false, `archivedAt ${stored.archivedAt}`)
})

await step(tally, page, 'the switcher shows the other pipeline\'s board', async () => {
  // The board is this step's own precondition: a failed table step above
  // would otherwise leave the section on the table, where no card exists.
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await pickSelect(page, 'Pipeline', F.renewalsPipelineName)
  await card(F.renewalDealTitle).waitFor({ timeout: TIMEOUT_MS })
  const salesCards = await waitFor(() => card(F.boardDeals.voss.title).count(), (n) => n === 0)
  // The archived pipeline is not offered.
  await page.getByRole('combobox', { name: /^Pipeline/ }).click()
  const offered = await page.locator('[role="listbox"]').last().getByRole('option').allTextContents()
  await page.keyboard.press('Escape')
  tally.check(
    "the switcher shows the other pipeline's board",
    salesCards === 0 && offered.includes('Sales') && offered.includes(F.renewalsPipelineName) && !offered.includes(NEW_PIPELINE),
    `offered ${JSON.stringify(offered)}`,
  )
})

// ── Line items ──────────────────────────────────────────────────────────────
await step(tally, page, 'a catalog product becomes a line and the amount follows it', async () => {
  await card(F.renewalDealTitle).click()
  await page.waitForURL((url) => url.pathname.endsWith(`/crm/deals/${F.renewalDealId}`), { timeout: TIMEOUT_MS })
  const products = cardNamed(page, 'Products')
  await products.getByText('No line items yet', { exact: false }).waitFor({ timeout: TIMEOUT_MS })
  await products.getByRole('button', { name: 'Add line', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a line' })
  await dialog.getByLabel('Product').fill('house')
  await page.getByRole('option', { name: new RegExp(F.product.name) }).first().click({ timeout: TIMEOUT_MS })
  await dialog.getByLabel('Quantity').fill('10')
  await dialog.getByRole('button', { name: 'Add line', exact: true }).click()
  await expectSnackbar(page, 'Line added')
  const stored = await waitFor(() => dealDoc(F.renewalDealId), (d) => Array.isArray(d.lineItems) && d.lineItems.length === 1)
  const [line] = stored.lineItems
  tally.check(
    'a catalog product becomes a line and the amount follows it',
    line.productId === F.product.id && line.quantity === 10 && line.unitAmountCents === F.product.priceUsd * 100 && stored.amountCents === 10 * F.product.priceUsd * 100,
    `${JSON.stringify(line)} · amount ${stored.amountCents}`,
  )
  await page.getByText(money(stored.amountCents)).first().waitFor({ timeout: TIMEOUT_MS })
})

await step(tally, page, 'a line by hand adds to the sum, and the drawer\'s amount is read-only', async () => {
  const products = cardNamed(page, 'Products')
  await products.getByRole('button', { name: 'Add line', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a line' })
  await dialog.getByRole('button', { name: 'By hand', exact: true }).click()
  await dialog.getByLabel('Name').fill('Delivery')
  await dialog.getByLabel(/^Unit amount/).fill('25.00')
  await dialog.getByRole('button', { name: 'Add line', exact: true }).click()
  await expectSnackbar(page, 'Line added')
  const stored = await waitFor(() => dealDoc(F.renewalDealId), (d) => d.lineItems?.length === 2)
  const expected = 10 * F.product.priceUsd * 100 + 2_500
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const amount = page.getByRole('textbox', { name: 'Amount' })
  await amount.waitFor({ timeout: TIMEOUT_MS })
  const readOnly = (await amount.getAttribute('readonly')) !== null
  const caption = await page.getByText("The sum of the deal's line items").count()
  const value = await amount.inputValue()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  tally.check(
    "a line by hand adds to the sum, and the drawer's amount is read-only",
    stored.amountCents === expected && readOnly && caption > 0 && value === (expected / 100).toFixed(2),
    `amount ${stored.amountCents} vs ${expected} · readonly ${readOnly} · caption ${caption} · field ${value}`,
  )
  await shot(page, 'crm-deal-products')
})

await step(tally, page, 'removing a line writes the new sum', async () => {
  await page.getByRole('button', { name: 'Remove Delivery', exact: true }).click()
  await expectSnackbar(page, 'Line removed')
  const stored = await waitFor(() => dealDoc(F.renewalDealId), (d) => d.lineItems?.length === 1)
  tally.check('removing a line writes the new sum', stored.amountCents === 10 * F.product.priceUsd * 100, `amount ${stored.amountCents}`)
})

// ── Forecast by close month ─────────────────────────────────────────────────
await step(tally, page, 'the forecast lays the open pipeline out by close month', async () => {
  const open = await orgRef
    .collection('deals')
    .where('visibleTo', 'array-contains-any', READ_TOKENS)
    .where('status', '==', 'open')
    .get()
  const total = open.docs.reduce((sum, entry) => sum + Number(entry.get('amountCents') ?? 0), 0)
  const undated = open.docs
    .filter((entry) => typeof entry.get('expectedCloseAtMs') !== 'number')
    .reduce((sum, entry) => sum + Number(entry.get('amountCents') ?? 0), 0)
  await page.goto(hostUrl('/crm/reports'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const table = page.getByRole('table', { name: 'Forecast by close month' })
  await table.waitFor({ timeout: TIMEOUT_MS })
  const headers = await table.getByRole('columnheader').allTextContents()
  const undatedRow = table.locator('[data-forecast-row="undated"]')
  // The row repeats the figure in the "All pipelines" cell when one pipeline holds every undated deal.
  await undatedRow.getByText(money(undated), { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  const lastRow = table.getByRole('row').last()
  const totals = await lastRow.allTextContents()
  tally.check(
    'the forecast lays the open pipeline out by close month',
    headers.includes('Sales') && headers.includes(F.renewalsPipelineName) && headers.includes('All pipelines') && !headers.includes(NEW_PIPELINE) && totals.join(' ').includes(money(total)),
    `headers ${JSON.stringify(headers)} · open pipeline ${money(total)} · undated ${money(undated)}`,
  )
  await table.scrollIntoViewIfNeeded()
  await shot(page, 'crm-reports-forecast', { scrollTop: false })
})

await session.close()
process.exit(tally.finish())
