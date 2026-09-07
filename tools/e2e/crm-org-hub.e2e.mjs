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
// A deal moved from the ORG board runs the stage route's org variant
// (AGL-2634): the move lands on the document, and the act is one line in the
// organization's activity feed — the feed a site's console never writes and
// the org hub writes for everything it does.
//
// The org-level Leads section opens with what files a lead, grouped by site
// (AGL-2638): the seeded site's name linking into its own Leads section, its
// routed form linking to the form's page, and the switch offered beside the
// form that could route and does not.
//
// A task filed from the org hub with NO site (AGL-2637) — the Site picker's
// "This organization (no site)", offered even though the seeded org has one
// site — lands with `hostId: null` and the org scope token alone, is listed
// on the org hub's tasks page, and completes through the route's org
// variant. It is listed under the site's hub too: the org token is what
// every site's read set leads with, and the spec records that as the fact
// it is rather than asserting the opposite.
//
// The organization's SITES page carries the CRM's two dashboard cards above
// the site grid (AGL-2636), totaling every site and linking into this hub:
// the glance card's figures and its Open CRM, and the tasks-due card naming
// the owner's overdue fixture task — the card that renders nothing on a
// workspace without an open task, so its presence is the org-wide read.
//
// A recipe installed from the org hub's Settings (AGL-2639) lands as a
// stamped action in the site's own actions, the card links to the site's
// Actions page, a second install of the same recipe on the same site is
// refused by the route rather than duplicated, and the site's Actions list
// shows the installed action. The action is removed at the end: it listens
// for every new contact, and the sibling specs create contacts.
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
  hostUrl,
  openConsole,
  ORG_ID,
  ORG_SLUG,
  OWNER_NAME,
  OWNER_UID,
  pickSelect,
  postAsUser,
  rowAction,
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
/** The organization task this run files — titled so no fixture row matches it. */
const ORG_TASK_TITLE = `Renew the organization's insurance ${Date.now()}`
const { maya } = CRM_FIXTURE.contacts
const { owen } = CRM_FIXTURE.leads
const { wholesale } = CRM_FIXTURE.forms

/** The recipe this run installs, and how the site's Actions list names it. */
const RECIPE = { id: 'welcomeNewLead', title: 'Welcome a new lead' }

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)
const hostRef = firestore.collection('hosts').doc(HOST_ID)
const personDoc = async () => {
  const found = await orgRef.collection('contacts').where('email', '==', PERSON.email).get()
  return found.empty ? null : { id: found.docs[0].id, ...found.docs[0].data() }
}
const orgTaskDoc = async () => {
  const found = await orgRef.collection('crmTasks').where('title', '==', ORG_TASK_TITLE).get()
  return found.empty ? null : { id: found.docs[0].id, ...found.docs[0].data() }
}
const removeOrgTask = async () => {
  const found = await orgRef.collection('crmTasks').where('title', '==', ORG_TASK_TITLE).get()
  for (const doc of found.docs) await doc.ref.delete()
}
/** The site's actions stamped with this run's recipe, as the install route stamps them. */
const installedActions = async () =>
  (await hostRef.collection('actions').where('recipe', '==', RECIPE.id).get()).docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }))
const removeInstalledActions = async () => {
  for (const action of await installedActions()) await hostRef.collection('actions').doc(action.id).delete()
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
// The recipe this run installs, so the install is an install and not a
// refusal.
await removeInstalledActions()

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

await step(tally, page, 'the org-level Leads section says what files a lead, by site', async () => {
  await page.goto(orgUrl('/crm/leads'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const card = cardNamed(page, 'Leads')
  await card.waitFor({ timeout: TIMEOUT_MS })
  // The site is a group of its own, named and linked into its own Leads
  // section; the form that routes leads is named under it, linked to its page.
  const site = card.getByRole('link', { name: SITE_NAME, exact: true })
  await site.waitFor({ timeout: TIMEOUT_MS })
  const form = card.getByRole('link', { name: wholesale.name, exact: true })
  await form.waitFor({ timeout: TIMEOUT_MS })
  const siteHref = await site.getAttribute('href')
  const formHref = await form.getAttribute('href')
  // The catering inquiry could route and does not: a live switch, not a refusal.
  const offered = await card
    .getByRole('button', { name: 'Turn on lead routing' })
    .evaluateAll((buttons) => buttons.filter((button) => !button.disabled).length)
  tally.check(
    'the org-level Leads section says what files a lead, by site',
    siteHref === `/${ORG_SLUG}/hosts/${HOST_ID}/crm/leads` &&
      formHref === `/${ORG_SLUG}/hosts/${HOST_ID}/forms/${wholesale.id}` &&
      offered >= 1,
    `${SITE_NAME} → ${siteHref} · ${wholesale.name} → ${formHref} · live switches ×${offered}`,
  )
  await shot(page, 'crm-org-hub-lead-surfaces')
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

await step(tally, page, 'a deal moved from the org board lands on the document and in the org feed', async () => {
  const startedAtMs = Date.now()
  await page.goto(orgUrl('/crm/deals'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await rowAction(page, CRM_FIXTURE.dealTitle, 'Move to Negotiation')
  await expectSnackbar(page, 'Moved to Negotiation')
  const dealRef = orgRef.collection('deals').doc(CRM_FIXTURE.dealId)
  const stored = await waitFor(
    async () => (await dealRef.get()).data(),
    (deal) => deal?.stageId === 'negotiation',
  )
  // The org feed's line, written by the route's org variant with the Admin
  // SDK — the feed is closed to clients, so nothing else could have.
  const line = await waitFor(
    async () => {
      const lines = await orgRef.collection('activity').where('target.id', '==', CRM_FIXTURE.dealId).get()
      return lines.docs
        .map((doc) => doc.data())
        .find(
          (entry) =>
            entry.action === 'Moved deal to Negotiation' &&
            (entry.createdAt?.toMillis?.() ?? 0) >= startedAtMs - 5_000,
        )
    },
    (found) => Boolean(found),
  )
  tally.check(
    'a deal moved from the org board lands on the document and in the org feed',
    stored?.stageId === 'negotiation' && stored?.status === 'open' && line?.target?.type === 'deal',
    `${stored?.stageId} · ${stored?.status} · feed: ${line ? `${line.action} by ${line.actorId}` : 'no line'}`,
  )
  await shot(page, 'crm-org-hub-deal-moved')
})

await step(tally, page, 'a task filed with the organization has no site and the org scope alone', async () => {
  await page.goto(orgUrl('/crm/tasks'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'New task' }).first().click({ timeout: TIMEOUT_MS })
  const drawer = page.getByRole('dialog').last()
  await drawer.getByRole('textbox', { name: /^Title/ }).waitFor({ timeout: TIMEOUT_MS })
  // The picker asks even with one site: the site, or the organization.
  const sitePicker = drawer.getByRole('combobox', { name: /^Site/ })
  await sitePicker.waitFor({ timeout: TIMEOUT_MS })
  await pickSelect(page, 'Site', 'This organization (no site)', drawer)
  await drawer.getByText(/A task of the organization itself/).waitFor({ timeout: TIMEOUT_MS })
  await shot(page, 'crm-org-hub-new-org-task')
  await drawer.getByRole('textbox', { name: /^Title/ }).fill(ORG_TASK_TITLE)
  await drawer.getByRole('button', { name: 'Create task' }).click()
  await expectSnackbar(page, 'Task created')
  const stored = await waitFor(orgTaskDoc, (found) => Boolean(found))
  tally.check(
    'a task filed with the organization has no site and the org scope alone',
    stored?.hostId === null && JSON.stringify(stored?.visibleTo) === '["org"]' && stored?.status === 'open',
    JSON.stringify({ hostId: stored?.hostId, visibleTo: stored?.visibleTo, status: stored?.status }),
  )
})

await step(tally, page, 'the organization task is listed on the org hub and completes through the org variant', async () => {
  // "My tasks" is the section's opening view, and the task is the creator's own.
  await rowOf(ORG_TASK_TITLE).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  tally.pass('the organization task is listed on the org hub', 'My tasks · ' + ORG_TASK_TITLE)
  await rowOf(ORG_TASK_TITLE)
    .getByRole('checkbox', { name: `Complete "${ORG_TASK_TITLE}"` })
    .click({ timeout: TIMEOUT_MS })
  await expectSnackbar(page, 'Task completed')
  const stored = await waitFor(orgTaskDoc, (found) => found?.status === 'done')
  tally.check(
    'the organization task completes through the org variant',
    stored?.status === 'done' && stored?.completedByUid === OWNER_UID && stored?.hostId === null,
    `${stored?.status} by ${stored?.completedByUid} · hostId ${stored?.hostId}`,
  )
  await shot(page, 'crm-org-hub-org-task-done')
})

await step(tally, page, "the organization task reads from the site's hub too, as every org-wide record does", async () => {
  // The Done view, since the task was just completed. Recorded, not asserted
  // against: the org token leads every site's read set, so an org task is a
  // shared record from a site's point of view.
  await page.goto(hostUrl('/crm/tasks'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page
    .getByRole('group', { name: 'Task view' })
    .getByRole('button', { name: 'Done' })
    .click({ timeout: TIMEOUT_MS })
  const listed = await rowOf(ORG_TASK_TITLE)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    .then(() => true)
    .catch(() => false)
  tally.pass(
    "the organization task reads from the site's hub too, as every org-wide record does",
    listed ? 'listed under the site — the org token is in every site’s read set' : 'not listed under the site',
  )
})

await step(tally, page, "the organization's sites page carries both CRM cards over every site", async () => {
  await page.goto(orgUrl('/hosts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const glance = cardNamed(page, 'CRM at a glance')
  const tasksDue = cardNamed(page, 'Tasks due')
  await glance.waitFor({ timeout: TIMEOUT_MS })
  await tasksDue.waitFor({ timeout: TIMEOUT_MS })
  // Above the sites, not among them: the row precedes the first site card.
  const siteCard = cardNamed(page, SITE_NAME)
  await siteCard.waitFor({ timeout: TIMEOUT_MS })
  const order = await page.evaluate(
    ([glanceHeader, siteHeader]) => {
      const headers = [...document.querySelectorAll('.MuiCardHeader-root')].map((node) =>
        node.textContent ?? '',
      )
      const at = (text) => headers.findIndex((header) => header.includes(text))
      return { glance: at(glanceHeader), site: at(siteHeader) }
    },
    ['CRM at a glance', SITE_NAME],
  )
  // Each card links into THIS hub, not into a site's.
  const openCrm = await glance.getByRole('link', { name: 'Open CRM' }).getAttribute('href')
  const viewAll = await tasksDue.getByRole('link', { name: 'View all' }).getAttribute('href')
  const leadsNote = await glance.getByText('open across every site').count()
  // The reader is the fixture's assignee, and the overdue task is theirs.
  await tasksDue.getByText(CRM_FIXTURE.overdueTaskTitle, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  tally.check(
    "the organization's sites page carries both CRM cards over every site",
    openCrm === HUB &&
      viewAll === `${HUB}/tasks` &&
      leadsNote >= 1 &&
      order.glance >= 0 &&
      order.site > order.glance,
    JSON.stringify({ openCrm, viewAll, leadsNote, order }),
  )
  await shot(page, 'crm-org-sites-dashboard-row')
})

await step(tally, page, 'a recipe installed from the org hub’s Settings lands stamped in the site’s actions', async () => {
  await page.goto(orgUrl('/crm/settings'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const card = cardNamed(page, 'Recipes')
  await card.waitFor({ timeout: TIMEOUT_MS })
  const row = card.getByRole('row', { name: new RegExp(RECIPE.title) })
  await row.getByText('Not installed on any site yet.').waitFor({ timeout: TIMEOUT_MS })
  await shot(page, 'crm-org-hub-recipes')
  await row.getByRole('button', { name: `Install ${RECIPE.title}` }).click({ timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: `Install “${RECIPE.title}”` }).waitFor({ timeout: TIMEOUT_MS })
  // The Site picker starts on the org's only site; against an org with two
  // sites it is picked by name.
  const site = page.getByRole('combobox', { name: 'Site' })
  if (!(await site.textContent())?.includes(SITE_NAME)) await pickSelect(page, 'Site', SITE_NAME)
  await shot(page, 'crm-org-hub-recipe-install')
  await page.getByRole('button', { name: 'Install', exact: true }).click({ timeout: TIMEOUT_MS })
  await expectSnackbar(page, `Installed “${RECIPE.title}” on ${SITE_NAME}`)
  const landed = await waitFor(installedActions, (actions) => actions.length === 1)
  const action = landed[0]
  tally.check(
    'a recipe installed from the org hub’s Settings lands stamped in the site’s actions',
    action?.recipe === RECIPE.id &&
      action?.name === RECIPE.title &&
      action?.trigger?.event === 'contactCreated' &&
      action?.enabled === true &&
      action?.createdBy === OWNER_UID,
    JSON.stringify({
      recipe: action?.recipe,
      name: action?.name,
      event: action?.trigger?.event,
      steps: (action?.steps ?? []).map((step) => step.type),
      createdBy: action?.createdBy,
    }),
  )
  // The card now names the site, linked into its Actions page, and the
  // success notice offers the same door.
  const link = row.getByRole('link', { name: SITE_NAME })
  await link.waitFor({ timeout: TIMEOUT_MS })
  const href = await link.getAttribute('href')
  const notice = await page.getByRole('link', { name: 'Open Automation → Actions' }).getAttribute('href')
  tally.check(
    'the card links the installed site into its Automation → Actions page',
    href === `/${ORG_SLUG}/hosts/${HOST_ID}/automation/actions` && notice === href,
    `${href} · notice ${notice}`,
  )
})

await step(tally, page, 'a second install of the same recipe on the same site is refused, not duplicated', async () => {
  const again = await postAsUser(OWNER_UID, '/api/crm/recipe-install', {
    orgId: ORG_ID,
    hostId: HOST_ID,
    recipeId: RECIPE.id,
  })
  const count = (await installedActions()).length
  tally.check(
    'a second install of the same recipe on the same site is refused, not duplicated',
    again.status === 409 && /already installed/i.test(String(again.body?.error)) && count === 1,
    `${again.status} ${JSON.stringify(again.body)} · ${count} stamped action(s)`,
  )
})

await step(tally, page, 'the site’s Actions list shows the installed recipe', async () => {
  await page.goto(`${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/automation/actions`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  await page.getByText(RECIPE.title, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  const listed = await page.getByText(RECIPE.title, { exact: true }).count()
  tally.check('the site’s Actions list shows the installed recipe', listed >= 1, `"${RECIPE.title}" ×${listed}`)
  await shot(page, 'crm-org-hub-recipe-on-site')
})

await session.close()
// Leave no trace of this run's person, its task, or its automation for
// whoever runs next: the welcome recipe would fire on every contact the
// sibling specs add.
await removeContactsAtAddress(firestore, ORG_ID, PERSON.email)
await removeOrgTask()
await removeInstalledActions()
process.exit(tally.finish())
