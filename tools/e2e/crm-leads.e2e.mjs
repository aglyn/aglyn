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

// Leads, worked the way a person works them (AGL-2610, AGL-2608).
//
// The section's open view, a status moved in the row, an owner assigned from
// the row menu, a lead opened from its row, and the conversion — company
// created from the address's domain, a deal opened with it — landing on the
// contact it made. Then the two things a converted lead must do afterwards:
// answer a second conversion with `alreadyConverted` rather than a second
// contact, and read as Qualified with links to what it became. Then the
// other way out — unqualified, with a reason — and the Inbox's way in.
//
// Re-runnable: the two leads are re-seeded without their working state, and
// what the last conversion created — the contact at the address, the
// company at the domain, the deal — is removed first, so this run's
// conversion creates rather than dedupes.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-leads.e2e.mjs

import {
  CRM_FIXTURE,
  removeLeadConversionArtifacts,
  seedCrmFixtures,
} from '../scripts/lib/crm-fixtures.mjs'
import {
  adminFirestore,
  expectSnackbar,
  HOST_ID,
  hostUrl,
  openConsole,
  ORG_ID,
  OWNER_NAME,
  OWNER_UID,
  pickSelect,
  postAsUser,
  rowAction,
  shot,
  step,
  TEAMMATE_NAME,
  TEAMMATE_UID,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const { owen, june } = CRM_FIXTURE.leads
const COMPANY_NAME = 'Copper Kettle Diner'
const DEAL_TITLE = 'Copper Kettle Diner — breakfast pastry program'
const UNQUALIFIED_REASON = 'Booked a one-off class; not a wholesale account.'

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)
const leadRef = (lead) => firestore.collection('hosts').doc(HOST_ID).collection('leads').doc(lead.id)

await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
await removeLeadConversionArtifacts(firestore, ORG_ID, owen)

const tally = verdicts()
const session = await openConsole()
const { page } = session

const rowOf = (lead) => page.locator('[role="row"]', { hasText: lead.email }).first()

await step(tally, page, 'the open view lists the unworked leads', async () => {
  await page.goto(hostUrl('/crm/leads'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await rowOf(owen).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await rowOf(june).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const chips = await Promise.all(
    [owen, june].map((lead) => rowOf(lead).getByText('New', { exact: true }).count()),
  )
  tally.check('the open view lists the unworked leads', chips.every((n) => n > 0), 'both read New')
  await shot(page, 'crm-leads')
})

await step(tally, page, 'the status chip moves a lead to Working', async () => {
  await rowOf(june).getByRole('combobox').click()
  await page.getByRole('option', { name: 'Working', exact: true }).click()
  await expectSnackbar(page, 'Status updated')
  const status = await waitFor(async () => (await leadRef(june).get()).get('status'), (s) => s === 'working')
  await rowOf(june).getByText('Working', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  tally.check('the status chip moves a lead to Working', status === 'working', status)
})

await step(tally, page, 'the row menu assigns an owner', async () => {
  await rowAction(page, june.email, 'Assign owner')
  const dialog = page.getByRole('dialog', { name: `Assign ${june.name}` })
  await pickSelect(page, 'Owner', TEAMMATE_NAME, dialog)
  await dialog.getByRole('button', { name: 'Assign' }).click()
  await expectSnackbar(page, 'Owner assigned')
  const owner = await waitFor(async () => (await leadRef(june).get()).get('ownerUid'), (uid) => uid === TEAMMATE_UID)
  await rowOf(june).getByText(TEAMMATE_NAME, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  tally.check('the row menu assigns an owner', owner === TEAMMATE_UID, owner)
})

await step(tally, page, 'a row opens the lead page', async () => {
  await rowOf(owen).getByText(owen.name, { exact: true }).click()
  await page.waitForURL((url) => url.pathname.endsWith(`/crm/leads/${owen.id}`), { timeout: TIMEOUT_MS })
  await page.getByText('Captured history', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Convert' }).waitFor({ timeout: TIMEOUT_MS })
  tally.pass('a row opens the lead page', new URL(page.url()).pathname)
  await shot(page, 'crm-lead-page')
})

let contactId = ''
await step(tally, page, 'Convert makes a contact, a company and a deal', async () => {
  await page.getByRole('button', { name: 'Convert' }).click()
  const dialog = page.getByRole('dialog', { name: `Convert ${owen.name}` })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // The address's domain proposes a company; the converter names it properly.
  const nameField = dialog.getByLabel('Company name')
  await nameField.waitFor({ timeout: TIMEOUT_MS })
  const proposed = await nameField.inputValue()
  tally.check(
    'the dialog proposes a company from the domain',
    proposed === 'Copperkettlediner' && (await dialog.getByLabel('Domain').inputValue()) === owen.companyDomain,
    `${proposed} @ ${await dialog.getByLabel('Domain').inputValue()}`,
  )
  await nameField.fill(COMPANY_NAME)
  await dialog.getByRole('checkbox', { name: 'Open a deal' }).check()
  await dialog.getByLabel('Deal title').fill(DEAL_TITLE)
  await dialog.getByLabel('Amount').fill('1,800')
  await shot(page, 'crm-lead-convert')
  await dialog.getByRole('button', { name: 'Convert' }).click()
  await expectSnackbar(page, 'Lead converted')
  await page.waitForURL((url) => /\/crm\/contacts\/[^/]+$/.test(url.pathname), { timeout: TIMEOUT_MS })
  contactId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '')
  await page.getByRole('heading', { name: owen.name }).first().waitFor({ timeout: TIMEOUT_MS })
  await page.getByText('Sales qualified', { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  const lead = (await leadRef(owen).get()).data() ?? {}
  const company = lead.companyId ? (await orgRef.collection('companies').doc(lead.companyId).get()).data() : null
  const deal = lead.dealId ? (await orgRef.collection('deals').doc(lead.dealId).get()).data() : null
  tally.check(
    'Convert makes a contact, a company and a deal',
    lead.convertedContactId === contactId &&
      lead.status === 'qualified' &&
      company?.name === COMPANY_NAME &&
      company?.domain === owen.companyDomain &&
      deal?.title === DEAL_TITLE &&
      deal?.amountCents === 180_000 &&
      deal?.status === 'open' &&
      deal?.contactId === contactId,
    `contact ${contactId}, company ${company?.name}, deal ${deal?.title} ${deal?.amountCents}`,
  )
})

await step(tally, page, 'a second conversion answers already converted', async () => {
  const before = (await orgRef.collection('deals').where('contactId', '==', contactId).count().get()).data().count
  const again = await postAsUser(OWNER_UID, '/api/crm/lead-convert', {
    hostId: HOST_ID,
    leadId: owen.id,
    deal: { title: 'A second deal the route must not open' },
  })
  const after = (await orgRef.collection('deals').where('contactId', '==', contactId).count().get()).data().count
  tally.check(
    'a second conversion answers already converted',
    again.status === 200 && again.body.alreadyConverted === true && again.body.contactId === contactId && after === before,
    `${again.status} ${JSON.stringify(again.body)} · deals ${before} → ${after}`,
  )
  await page.goto(hostUrl(`/crm/leads/${owen.id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByText('Qualified', { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  for (const name of ['Open contact', 'Open company', 'Open deal']) {
    await page.getByRole('link', { name }).waitFor({ timeout: TIMEOUT_MS })
  }
  tally.check(
    'a converted lead reads as Qualified with its links',
    (await page.getByRole('button', { name: 'Convert' }).count()) === 0,
    'Open contact · Open company · Open deal, no Convert',
  )
})

await step(tally, page, 'Unqualify closes a lead with its reason', async () => {
  await page.goto(hostUrl(`/crm/leads/${june.id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Unqualify' }).click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog', { name: `Unqualify ${june.name}?` })
  await dialog.getByLabel('Reason').fill(UNQUALIFIED_REASON)
  await dialog.getByRole('button', { name: 'Unqualify' }).click()
  await expectSnackbar(page, 'Lead marked unqualified')
  await page.getByText(`Unqualified: ${UNQUALIFIED_REASON}`).waitFor({ timeout: TIMEOUT_MS })
  const lead = (await leadRef(june).get()).data() ?? {}
  tally.check(
    'Unqualify closes a lead with its reason',
    lead.status === 'unqualified' && lead.unqualifiedReason === UNQUALIFIED_REASON,
    `${lead.status}: ${lead.unqualifiedReason}`,
  )
  await page.goto(hostUrl('/crm/leads'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await rowOf(owen).waitFor({ state: 'visible', timeout: TIMEOUT_MS }).catch(() => undefined)
  const openStill = await rowOf(june).count()
  await pickSelect(page, 'Show', 'Unqualified')
  await rowOf(june).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  tally.check('the open view drops it and the Unqualified view lists it', openStill === 0, `open rows for June: ${openStill}`)
})

await step(tally, page, 'the Inbox opens a lead in the CRM', async () => {
  await page.goto(hostUrl('/inbox/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  // The Inbox cell reads address and name together.
  await page.getByText(owen.email).first().waitFor({ timeout: TIMEOUT_MS })
  await rowAction(page, owen.email, 'Open in CRM')
  await page.waitForURL((url) => url.pathname.endsWith(`/crm/leads/${owen.id}`), { timeout: TIMEOUT_MS })
  await page.getByText('Captured history', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  tally.pass('the Inbox opens a lead in the CRM', new URL(page.url()).pathname)
})

await session.close()
process.exit(tally.finish())
