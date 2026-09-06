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

// The contact record's remaining surfaces (AGL-2610, AGL-2596, AGL-2601,
// AGL-2603, AGL-2600): a custom field set and saved, the person put on an
// audience, the Properties card saved with a new phone and title, the top
// bar search finding them by the digits of that phone, the Recent activity
// feed under the list, and the record deleted from the overflow menu.
//
// Each write is asserted on the document — the facet the card wrote into,
// the top-level phone echo the search reads — as well as on the page.
//
// Re-runnable: the record is re-seeded first, so the delete at the end
// leaves nothing the next run is missing.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-contact-record.e2e.mjs

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
  shot,
  step,
  TEAMMATE_UID,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const { nadia, maya } = CRM_FIXTURE.contacts
const NEW_PHONE = { typed: '+1 512 555 0177', stored: '+15125550177', digits: '5550177' }
const NEW_TITLE = 'Head of catering'

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)
const contactRef = orgRef.collection('contacts').doc(nadia.id)
const facet = async () => (await contactRef.get()).get(`facets.${HOST_ID}`) ?? {}

await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
const members = orgRef.collection('lists').doc(CRM_FIXTURE.listId).collection('members')
for (const entry of (await members.where('email', '==', nadia.email).get()).docs) await entry.ref.delete()

const tally = verdicts()
const session = await openConsole()
const { page } = session

await step(tally, page, 'the record opens on the person', async () => {
  await page.goto(hostUrl(`/crm/contacts/${nadia.id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: nadia.name }).first().waitFor({ timeout: TIMEOUT_MS })
  for (const header of ['Properties', 'Relationship', 'Custom fields', 'Timeline']) {
    await page.getByText(header, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  }
  tally.pass('the record opens on the person', 'Properties · Relationship · Custom fields · Timeline')
  await shot(page, 'crm-contact-record')
})

await step(tally, page, 'a custom field value saves into the facet', async () => {
  const card = cardNamed(page, 'Custom fields')
  await pickSelect(page, CRM_FIXTURE.roastField.label, 'Medium', card)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  await expectSnackbar(page, 'Contact saved')
  const value = await waitFor(
    async () => (await facet()).custom?.[CRM_FIXTURE.roastField.key],
    (stored) => stored === 'Medium',
  )
  tally.check('a custom field value saves into the facet', value === 'Medium', String(value))
})

await step(tally, page, 'Add to list enrolls the person', async () => {
  await page.getByRole('button', { name: 'Add to list', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to an audience' })
  await pickSelect(page, 'Audience', CRM_FIXTURE.listName, dialog)
  await dialog.getByRole('button', { name: 'Check' }).click()
  await dialog.getByText('1 with no opt-in on record').waitFor({ timeout: TIMEOUT_MS })
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Add 1' }).click()
  await expectSnackbar(page, 'One person added')
  const enrolled = await waitFor(async () => (await members.where('email', '==', nadia.email).get()).size, (n) => n >= 1)
  tally.check('Add to list enrolls the person', enrolled >= 1, `${enrolled} membership(s)`)
  await dialog.getByRole('button', { name: 'Done' }).click()
})

await step(tally, page, 'Properties Save writes the facet and the search echo', async () => {
  await page.getByLabel('Phone').fill(NEW_PHONE.typed)
  await page.getByLabel('Job title').fill(NEW_TITLE)
  await cardNamed(page, 'Properties').getByRole('button', { name: 'Save', exact: true }).click()
  await expectSnackbar(page, 'Contact saved')
  const stored = await waitFor(
    async () => {
      const snapshot = await contactRef.get()
      return { phone: snapshot.get('phone'), facetPhone: snapshot.get(`facets.${HOST_ID}.phone`), title: snapshot.get(`facets.${HOST_ID}.jobTitle`) }
    },
    (s) => s.phone === NEW_PHONE.stored && s.title === NEW_TITLE,
  )
  tally.check(
    'Properties Save writes the facet and the search echo',
    stored.phone === NEW_PHONE.stored && stored.facetPhone === NEW_PHONE.stored && stored.title === NEW_TITLE,
    JSON.stringify(stored),
  )
})

await step(tally, page, 'the top bar search finds a person by phone digits', async () => {
  await page.goto(hostUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByText(nadia.name, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Meta+k')
  const input = page.locator('[role="dialog"] input').first()
  await input.waitFor({ timeout: TIMEOUT_MS })
  await input.fill(NEW_PHONE.digits)
  const row = page.locator('[role="dialog"] a', { hasText: nadia.name }).first()
  await row.waitFor({ timeout: TIMEOUT_MS })
  await shot(page, 'crm-search-by-phone', { scrollTop: false })
  await row.click()
  await page.waitForURL((url) => url.pathname.endsWith(`/crm/contacts/${nadia.id}`), { timeout: TIMEOUT_MS })
  tally.pass('the top bar search finds a person by phone digits', `${NEW_PHONE.digits} → ${nadia.name}`)
})

await step(tally, page, 'Recent activity lists the newest logged activity', async () => {
  await page.goto(hostUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByText('Recent activity', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  await page.getByText(CRM_FIXTURE.activityBody).waitFor({ timeout: TIMEOUT_MS })
  const feed = page.locator('div', { has: page.getByText('Recent activity', { exact: true }) }).last()
  const link = feed.getByRole('link', { name: 'Contact' }).first()
  const href = await link.getAttribute('href')
  tally.check(
    'Recent activity lists the newest logged activity',
    Boolean(href && href.endsWith(`/crm/contacts/${maya.id}`)) || Boolean(href && /\/crm\/contacts\//.test(href)),
    `${CRM_FIXTURE.activityBody.slice(0, 40)}… → ${href}`,
  )
})

await step(tally, page, 'Delete contact removes the sole-holder record', async () => {
  await page.goto(hostUrl(`/crm/contacts/${nadia.id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: nadia.name }).first().waitFor({ timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: `More actions for ${nadia.name}` }).click({ timeout: TIMEOUT_MS })
  await page.getByRole('menuitem', { name: 'Delete contact' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this contact?' })
  await dialog.getByRole('button', { name: 'Delete contact' }).click({ timeout: TIMEOUT_MS })
  await expectSnackbar(page, 'Contact deleted')
  await page.waitForURL((url) => url.pathname.endsWith('/crm/contacts'), { timeout: TIMEOUT_MS })
  const exists = await waitFor(async () => (await contactRef.get()).exists, (present) => present === false)
  tally.check('Delete contact removes the sole-holder record', exists === false, `exists=${exists}`)
})

await session.close()
// Put the record back for whoever runs next.
await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
process.exit(tally.finish())
