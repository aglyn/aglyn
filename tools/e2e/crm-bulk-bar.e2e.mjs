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

// The contacts bulk bar, driven as a person drives it (AGL-2610, AGL-2603).
//
// Two rows ticked, and every act the bar offers over them, in order: the
// count, a tag, a stage, an owner, an audience, a spreadsheet, and the
// removal — each asserted twice, on the page and on the document behind it.
// The page proves the bar said what it did; the Admin read proves it did it,
// which the unit specs (`contacts-bulk-bar.spec.tsx`) could only assert of a
// mocked writer.
//
// The two people are the fixture's own (`crm-fixtures.mjs`), and the spec
// re-seeds them first: the last step removes them from the site, and a run
// that found them missing would have nothing to tick.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-bulk-bar.e2e.mjs

import { readFileSync } from 'node:fs'
import { CRM_FIXTURE, seedCrmFixtures } from '../scripts/lib/crm-fixtures.mjs'
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
  shot,
  step,
  TEAMMATE_UID,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const { marcus, elena } = CRM_FIXTURE.contacts
const PAIR = [marcus, elena]
const TAG = 'spring-catalog'

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)
const facetOf = async (contact) =>
  (await orgRef.collection('contacts').doc(contact.id).get()).get(`facets.${HOST_ID}`) ?? null

// ── Fixture reset ───────────────────────────────────────────────────────────
await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
// The audience memberships a previous run added, so "2 people added" is a
// count of this run's adds and not of an already-enrolled pair.
const members = orgRef.collection('lists').doc(CRM_FIXTURE.listId).collection('members')
for (const contact of PAIR) {
  const stale = await members.where('email', '==', contact.email).get()
  for (const entry of stale.docs) await entry.ref.delete()
}

const tally = verdicts()
const session = await openConsole()
const { page } = session

const rowOf = (contact) => page.locator('[role="row"]', { hasText: contact.name })
const selectedCount = () => page.getByText(/^\d+ selected$/)

await step(tally, page, 'the list shows both people', async () => {
  await page.goto(hostUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  for (const contact of PAIR) {
    await rowOf(contact).first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  tally.pass('the list shows both people', PAIR.map((c) => c.name).join(', '))
})

await step(tally, page, 'ticking two rows raises the bar', async () => {
  for (const contact of PAIR) {
    await rowOf(contact).first().getByRole('checkbox').check({ timeout: TIMEOUT_MS })
  }
  await selectedCount().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = (await selectedCount().textContent()) ?? ''
  tally.check('ticking two rows raises the bar', text === '2 selected', text)
  await shot(page, 'crm-contacts-bulk-bar')
})

await step(tally, page, 'Add tag reaches both facets', async () => {
  await page.getByRole('button', { name: 'Add tag', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a tag' })
  await dialog.getByLabel('Tag').fill(TAG)
  await shot(page, 'crm-contacts-bulk-add-tag')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectSnackbar(page, 'Tagged 2 contacts')
  const tags = await waitFor(
    async () => Promise.all(PAIR.map(async (c) => (await facetOf(c))?.tags ?? [])),
    (all) => all.every((tags) => tags.includes(TAG)),
  )
  tally.check(
    'Add tag reaches both facets',
    tags.every((list) => list.includes(TAG)),
    JSON.stringify(tags),
  )
  // The rows repaint from the listener; the Tags cell joins them with commas.
  await rowOf(marcus).filter({ hasText: TAG }).first().waitFor({ timeout: TIMEOUT_MS })
  tally.pass('the row lists the new tag', TAG)
})

await step(tally, page, 'Set stage moves both people', async () => {
  await page.getByRole('button', { name: 'Set stage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Set the lifecycle stage' })
  await pickSelect(page, 'Lifecycle stage', 'Opportunity', dialog)
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectSnackbar(page, 'Stage set on 2 contacts')
  const stages = await waitFor(
    async () => Promise.all(PAIR.map(async (c) => (await facetOf(c))?.lifecycleStage)),
    (all) => all.every((stage) => stage === 'opportunity'),
  )
  tally.check('Set stage moves both people', stages.every((s) => s === 'opportunity'), JSON.stringify(stages))
  await rowOf(elena).first().getByText('Opportunity', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  tally.pass('the row shows the new stage chip', 'Opportunity')
})

await step(tally, page, 'Set owner hands both to a teammate', async () => {
  await page.getByRole('button', { name: 'Set owner', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Set the owner' })
  // The roster arrives after the dialog opens; the option is what proves it did.
  await pickSelect(page, 'Owner', OWNER_NAME, dialog)
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectSnackbar(page, 'Owner set on 2 contacts')
  const owners = await waitFor(
    async () => Promise.all(PAIR.map(async (c) => (await facetOf(c))?.ownerUid)),
    (all) => all.every((uid) => uid === OWNER_UID),
  )
  tally.check('Set owner hands both to a teammate', owners.every((uid) => uid === OWNER_UID), JSON.stringify(owners))
  await rowOf(marcus).first().getByText(OWNER_NAME, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  tally.pass('the row names the owner', OWNER_NAME)
})

await step(tally, page, 'Add to list checks, attests, then adds both', async () => {
  await page.getByRole('button', { name: 'Add to list', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add 2 people to an audience' })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await pickSelect(page, 'Audience', CRM_FIXTURE.listName, dialog)
  await dialog.getByRole('button', { name: 'Check' }).click()
  // Neither seeded person carries an opt-in, so both need the attestation.
  await dialog.getByText('2 with no opt-in on record').waitFor({ timeout: TIMEOUT_MS })
  tally.pass('the check counts the pair as needing attestation')
  await shot(page, 'crm-contacts-bulk-add-to-list')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Add 2' }).click()
  await expectSnackbar(page, '2 people added')
  const enrolled = await waitFor(
    async () =>
      Promise.all(
        PAIR.map(async (c) => (await members.where('email', '==', c.email).get()).size),
      ),
    (sizes) => sizes.every((size) => size >= 1),
  )
  tally.check('Add to list checks, attests, then adds both', enrolled.every((n) => n >= 1), JSON.stringify(enrolled))
  await dialog.getByRole('button', { name: 'Done' }).click()
})

await step(tally, page, 'Export CSV downloads the selection', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: TIMEOUT_MS }),
    page.getByRole('button', { name: 'Export CSV', exact: true }).last().click(),
  ])
  const path = await download.path()
  const csv = readFileSync(path, 'utf8')
  const lines = csv.trim().split('\n')
  const hasBoth = PAIR.every((c) => csv.includes(c.email))
  tally.check(
    'Export CSV downloads the selection',
    download.suggestedFilename() === 'contacts-selected.csv' && hasBoth && lines.length === 3,
    `${download.suggestedFilename()} — ${lines.length} lines`,
  )
})

await step(tally, page, 'Remove from this site deletes the sole-holder rows', async () => {
  await page.getByRole('button', { name: 'Remove from this site', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove 2 contacts?' })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Remove contacts' }).click()
  await expectSnackbar(page, '2 contacts removed from this site')
  const remaining = await waitFor(
    async () =>
      Promise.all(PAIR.map(async (c) => (await orgRef.collection('contacts').doc(c.id).get()).exists)),
    (all) => all.every((exists) => !exists),
  )
  tally.check(
    'Remove from this site deletes the sole-holder rows',
    remaining.every((exists) => !exists),
    JSON.stringify(remaining),
  )
  for (const contact of PAIR) {
    await rowOf(contact).first().waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  }
  tally.pass('the rows leave the table')
})

await session.close()
// Put the pair back for whoever runs next.
await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
process.exit(tally.finish())
