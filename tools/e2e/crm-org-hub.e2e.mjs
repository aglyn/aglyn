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

// The ORGANIZATION-LEVEL CRM hub, driven as a person drives it (AGL-2630).
//
// The same hub the site route mounts, opened over every site at once from
// the Organization tab: the old address book's address redirects into it, a
// bare `/crm` lands on the first section, the rail offers every section, the
// contacts list carries the Known-by column, a contact added here is stamped
// with the SITE the create names — the fact the org level exists to get
// right, so it is asserted on the document and not on the page — and a
// lead's address names its site.
//
// The seeded org has ONE site, so the Site picker on the create is silent
// (an org with one site has nothing to choose) and the spec says so rather
// than failing on a field that is deliberately absent; against an org with
// two sites it picks the demo site by name.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-org-hub.e2e.mjs

import {
  CRM_FIXTURE,
  removeContactsAtAddress,
  removeSiteContactsOutsideFixture,
  seedCrmFixtures,
} from '../scripts/lib/crm-fixtures.mjs'
import {
  adminFirestore,
  BASE_URL,
  cardNamed,
  expectSnackbar,
  HOST_ID,
  openConsole,
  ORG_ID,
  ORG_SLUG,
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

/** The org-level console, under the org and no site. */
const orgUrl = (path = '') => `${BASE_URL}/${ORG_SLUG}${path}`
const HUB = `/${ORG_SLUG}/crm`
/** How the seeded site reads on screen — its `displayName` in the seed. */
const SITE_NAME = 'Demo Bakery'
const PERSON = { email: 'org-hub@aglyn.test', name: 'Orla Hubbard' }
const { maya } = CRM_FIXTURE.contacts
const { owen } = CRM_FIXTURE.leads

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)
const personDoc = async () => {
  const found = await orgRef.collection('contacts').where('email', '==', PERSON.email).get()
  return found.empty ? null : { id: found.docs[0].id, ...found.docs[0].data() }
}

// ── Fixture reset ───────────────────────────────────────────────────────────
await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})
// The person this run adds, so the create is a create and not a merge.
await removeContactsAtAddress(firestore, ORG_ID, PERSON.email)
// What the sibling specs leave on the site — a lead's conversion, a contact
// added by hand. The list pages at the table default, the fixture's rows are
// its oldest, and two more people put the row this spec reads on page two.
await removeSiteContactsOutsideFixture(firestore, ORG_ID, HOST_ID)

const tally = verdicts()
const session = await openConsole()
const { page } = session
const rowOf = (text) => page.locator('.MuiDataGrid-row', { hasText: text }).first()

await step(tally, page, 'the old address book redirects into the org hub, permanently', async () => {
  const response = await page.goto(orgUrl('/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.waitForURL((url) => url.pathname === `${HUB}/contacts`, { timeout: TIMEOUT_MS })
  // The first hop is the server's redirect; `goto` resolves to the final
  // response, so the status is read off the redirect chain it followed.
  const hop = response?.request().redirectedFrom()
  const status = hop ? (await hop.response())?.status() : null
  tally.check(
    'the old address book redirects into the org hub, permanently',
    new URL(page.url()).pathname === `${HUB}/contacts` && (status === null || status === 308),
    `landed on ${new URL(page.url()).pathname}${status ? ` via ${status}` : ''}`,
  )
})

await step(tally, page, 'a bare /crm lands on the first section', async () => {
  await page.goto(orgUrl('/crm'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.waitForURL((url) => url.pathname === `${HUB}/contacts`, { timeout: TIMEOUT_MS })
  tally.pass('a bare /crm lands on the first section', new URL(page.url()).pathname)
})

await step(tally, page, 'the org hub lists the contacts with a Known by column', async () => {
  await page.getByRole('columnheader', { name: 'Known by' }).waitFor({ timeout: TIMEOUT_MS })
  await rowOf(maya.name).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const knownBy = await rowOf(maya.name).getByText(SITE_NAME, { exact: true }).count()
  tally.check(
    'the org hub lists the contacts with a Known by column',
    knownBy >= 1,
    `${maya.name} is known by "${SITE_NAME}" ×${knownBy}`,
  )
  await shot(page, 'crm-org-hub-contacts')
})

await step(tally, page, 'the rail offers every section under the org', async () => {
  const sections = ['Leads', 'Companies', 'Deals', 'Tasks', 'Reports', 'Fields', 'Settings']
  // The rail is a set of tabs, each an anchor — `HubSections` in the shared
  // UI — scoped to the tablist that holds Contacts, because the org's own
  // nav strip has a Settings tab of its own.
  const rail = page
    .locator('[role="tablist"]', { has: page.getByRole('tab', { name: 'Contacts', exact: true }) })
    .last()
  await rail.waitFor({ timeout: TIMEOUT_MS })
  const hrefs = {}
  for (const label of sections) {
    const tab = rail.getByRole('tab', { name: label, exact: true })
    await tab.waitFor({ timeout: TIMEOUT_MS })
    hrefs[label] = await tab.getAttribute('href')
  }
  const wrong = sections.filter((label) => hrefs[label] !== `${HUB}/${label.toLowerCase()}`)
  tally.check(
    'the rail offers every section under the org',
    wrong.length === 0,
    wrong.length ? `wrong: ${JSON.stringify(wrong.map((label) => hrefs[label]))}` : sections.join(' · '),
  )
})

await step(tally, page, 'a contact added at the org level is stamped with the site the create names', async () => {
  await page.getByRole('button', { name: 'New contact' }).click({ timeout: TIMEOUT_MS })
  const drawer = page.getByRole('dialog').last()
  await drawer.getByRole('textbox', { name: /^Email/ }).waitFor({ timeout: TIMEOUT_MS })
  // The Site picker: shown only when there is a choice to make.
  const sitePicker = drawer.getByRole('combobox', { name: /^Site/ })
  const asked = (await sitePicker.count()) > 0
  if (asked) {
    await pickSelect(page, 'Site', SITE_NAME, drawer)
    tally.pass('the create asks which site captures the person', SITE_NAME)
  } else {
    tally.pass('the create asks which site captures the person', 'silent — the org has one site')
  }
  await shot(page, 'crm-org-hub-new-contact')
  await drawer.getByRole('textbox', { name: /^Email/ }).fill(PERSON.email)
  await drawer.getByRole('textbox', { name: /^Name/ }).fill(PERSON.name)
  await drawer.getByRole('button', { name: 'Add contact' }).click()
  await expectSnackbar(page, 'Contact added')
  const stored = await waitFor(personDoc, (found) => Boolean(found))
  const stamped =
    stored?.hostId === HOST_ID &&
    (stored?.visibleTo ?? []).includes(`host:${HOST_ID}`) &&
    (stored?.capturedByHostIds ?? []).includes(HOST_ID)
  tally.check(
    'a contact added at the org level is stamped with the site the create names',
    stamped,
    JSON.stringify({
      hostId: stored?.hostId,
      visibleTo: stored?.visibleTo,
      capturedByHostIds: stored?.capturedByHostIds,
    }),
  )
  // The console opens the person it just added, under the org hub.
  await page.waitForURL((url) => new RegExp(`^${HUB}/contacts/[^/]+$`).test(url.pathname), {
    timeout: TIMEOUT_MS,
  })
  await page.getByRole('heading', { name: PERSON.name }).first().waitFor({ timeout: TIMEOUT_MS })
  tally.pass('Add contact lands on the new record under the org hub', new URL(page.url()).pathname)
})

await step(tally, page, 'the record names the site that knows the person, with its consent', async () => {
  const card = cardNamed(page, 'Known by')
  await card.waitFor({ timeout: TIMEOUT_MS })
  await card.getByText(SITE_NAME, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  // The verdict always names its controller — never a bare "consented".
  const label = await card.getByText(new RegExp(`^${SITE_NAME} · (Opted in|Opted out|No record)$`)).count()
  tally.check(
    'the record names the site that knows the person, with its consent',
    label >= 1,
    `"${SITE_NAME} · …" ×${label}`,
  )
  await shot(page, 'crm-org-hub-contact-record')
})

await step(tally, page, "a lead's org-level address names its site", async () => {
  await page.goto(orgUrl('/crm/leads'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('columnheader', { name: 'Site' }).waitFor({ timeout: TIMEOUT_MS })
  await rowOf(owen.name).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await rowOf(owen.name).getByText(owen.name, { exact: true }).click()
  await page.waitForURL((url) => url.pathname.endsWith(`/crm/leads/${HOST_ID}/${owen.id}`), {
    timeout: TIMEOUT_MS,
  })
  await page.getByRole('heading', { name: owen.name }).first().waitFor({ timeout: TIMEOUT_MS })
  tally.pass("a lead's org-level address names its site", new URL(page.url()).pathname)
})

await session.close()
// Leave no trace of this run's person for whoever runs next.
await removeContactsAtAddress(firestore, ORG_ID, PERSON.email)
process.exit(tally.finish())
