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

// THE CRM PLAN GATE ON A FREE WORKSPACE, end to end (AGL-2809).
//
// The CRM suite is included from Starter. On Free the shell locks the suite's
// sections (AGL-2611, AGL-2783, AGL-2794), the Contacts section locks the
// suite's acts (AGL-2788), the `crm/*` routes refuse them (AGL-2787) and the
// rules refuse the suite's client-direct writes (AGL-2801). Every other CRM
// spec drives the primary e2e org, which is on Business, so none of them can
// see any of it. This one signs in as the non-staff owner of a workspace that
// is always on Free (`tools/scripts/lib/crm-free-plan-fixtures.mjs`) and
// proves, in order:
//
// 1. The Contacts list reads every person.
// 2. The rail draws Leads, Companies, Deals, Tasks, Reports, Fields and
//    Settings with the lock, named to assistive technology, and Contacts
//    without one.
// 3. New contact and Import CSV stand disabled with their reason, under the
//    suite notice and its way to the plans; Export CSV stays enabled and
//    downloads every person.
// 4. Each locked section's body is the shell's upgrade notice.
// 5. The organization's hub lands a bare `/crm` on Contacts and draws the
//    same locks.
// 6. `POST /api/crm/contacts-create` answers 403 `plan_required` / `crm` to
//    the owner and to staff, and writes nothing.
// 7. The rules refuse the owner a client-direct company create and update,
//    and still serve the read.
// 8. A record opens, and an erasure is filed from it.
// 9. THE CONTROL. The same workspace moved to Starter admits the same two
//    writes and the same create, and opens the same acts. A refusal above that
//    this step does not turn into an admission is not the plan's refusal.
//
// Prerequisites (docs/E2E_LOCAL.md): the Auth and Firestore emulators and a
// console dev server (E2E_BASE_URL). The spec writes its own workspace before
// it runs and again after, so it needs nothing else seeded.
//
//   npm run e2e:crm:free-plan

import { readFileSync } from 'node:fs'
import { getAuth } from 'firebase-admin/auth'
import {
  FREE_PLAN_FIXTURE as FREE,
  seedFreePlanWorkspace,
} from '../scripts/lib/crm-free-plan-fixtures.mjs'
import {
  adminFirestore,
  BASE_URL,
  cardNamed,
  expectSnackbar,
  idTokenFor,
  openConsole,
  OWNER_UID,
  PASSWORD,
  postAsUser,
  shot,
  step,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

/** The suite's sections, in the rail's order (`crm-console-sections.ts`). */
const SUITE_SECTIONS = [
  { id: 'leads', label: 'Leads' },
  { id: 'companies', label: 'Companies' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reports', label: 'Reports' },
  { id: 'fields', label: 'Fields' },
  { id: 'settings', label: 'Settings' },
]
/** What the lock on a rail tab is named (`hub-tabs.tsx`, AGL-2794). */
const LOCK_NAME = 'Not included in your plan'
/** What a locked act says about itself (`crm-suite-lock.tsx`). */
const LOCKED_REASON = 'Part of the CRM suite, included from Starter'
/** How every refusal on Free ends: the plan that includes the suite. */
const PLAN_SENTENCE = 'Included from Starter.'
const RUN = Date.now().toString(36)
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main'

const firestore = adminFirestore()
const seed = () => seedFreePlanWorkspace({ firestore, auth: getAuth(), password: PASSWORD })
await seed()

const orgRef = firestore.collection('orgs').doc(FREE.orgId)
const siteUrl = (path) => `${BASE_URL}/${FREE.orgSlug}/hosts/${FREE.hostId}${path}`
const orgUrl = (path) => `${BASE_URL}/${FREE.orgSlug}${path}`
const billingPath = `/${FREE.orgSlug}/billing`
const people = Object.values(FREE.contacts)
const rosa = FREE.contacts.rosa
const contactsAt = async (email) =>
  (await orgRef.collection('contacts').where('email', '==', email).get()).size

/** A `plan_required` / `crm` refusal, in the console routes' flat shape. */
const refusedForPlan = (answer) =>
  answer.status === 403 && answer.body.reason === 'plan_required' && answer.body.code === 'crm'

/*==========================================
 * CLIENT-DIRECT WRITES
 *
 * The browser SDK writes the suite's records straight to Firestore, so the
 * rules are the gate there. The emulator's REST surface evaluates the same
 * rules against the same ID token, which lets the spec make the write a
 * member's browser would make without reaching into the page's SDK.
 *=========================================*/

const companiesPath = `orgs/${FREE.orgId}/companies`

/** One Firestore REST call as the Free owner; answers the status and the error's name. */
async function asOwner(method, path, body) {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${await idTokenFor(FREE.ownerUid)}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  )
  const payload = await response.json().catch(() => ({}))
  return `${response.status}${payload?.error?.status ? ` ${payload.error.status}` : ''}`
}

/** A company as the console files one: the site's token, the site, its author. */
const createCompany = (id) =>
  asOwner('POST', `${companiesPath}?documentId=${id}`, {
    fields: {
      name: { stringValue: `Rules probe ${id}` },
      visibleTo: { arrayValue: { values: [{ stringValue: `host:${FREE.hostId}` }] } },
      hostId: { stringValue: FREE.hostId },
      createdByUid: { stringValue: FREE.ownerUid },
    },
  })
const updateCompany = (notes) =>
  asOwner('PATCH', `${companiesPath}/${FREE.company.id}?updateMask.fieldPaths=notes`, {
    fields: { notes: { stringValue: notes } },
  })
const readCompany = () => asOwner('GET', `${companiesPath}/${FREE.company.id}`)

const tally = verdicts()
const session = await openConsole({ email: FREE.ownerEmail, password: PASSWORD })
const { page } = session

/*==========================================
 * WHAT THE PAGE DRAWS
 *=========================================*/

const rail = () => cardNamed(page, 'Navigation')
const lockedTab = (label) =>
  rail().getByRole('tab', { name: new RegExp(`^${label}\\s*${LOCK_NAME}$`) })
const openTab = (label) => rail().getByRole('tab', { name: label, exact: true })
const act = (name) => page.getByRole('button', { name, exact: true }).first()
/**
 * Where a notice's View plans goes. Found as the anchor rather than by role:
 * the button-styled link the shell draws carries `role="button"`, and the
 * destination is what the steps assert.
 */
const plansHref = (notice) =>
  notice.locator('a', { hasText: 'View plans' }).first().getAttribute('href', { timeout: TIMEOUT_MS })

/** Which suite sections the rail locks, and whether Contacts stands open. */
async function readRail() {
  // The lock is drawn once the org has settled, so wait for one before counting.
  await lockedTab('Leads').waitFor({ timeout: TIMEOUT_MS })
  const locked = []
  for (const { label } of SUITE_SECTIONS) {
    if ((await lockedTab(label).count()) === 1) locked.push(label)
  }
  const contacts = openTab('Contacts')
  const contactsOpen =
    (await contacts.count()) === 1 &&
    (await contacts.getByRole('img', { name: LOCK_NAME }).count()) === 0
  return { locked, contactsOpen }
}

/**
 * The Contacts toolbar's three acts. A locked act's reason is the title its
 * tooltip leaves on the span around the disabled button.
 */
async function readActs() {
  await act('New contact').waitFor({ timeout: TIMEOUT_MS })
  const reason = (name) =>
    act(name).evaluate((button) => button.closest('[title]')?.getAttribute('title') ?? null)
  return {
    newContact: { disabled: await act('New contact').isDisabled(), reason: await reason('New contact') },
    importCsv: { disabled: await act('Import CSV').isDisabled(), reason: await reason('Import CSV') },
    exportEnabled: await act('Export CSV').isEnabled(),
  }
}

const actsLocked = (acts) =>
  acts.newContact.disabled &&
  acts.importCsv.disabled &&
  acts.newContact.reason === LOCKED_REASON &&
  acts.importCsv.reason === LOCKED_REASON &&
  acts.exportEnabled

/*==========================================
 * ON FREE
 *=========================================*/

await step(tally, page, 'a Free workspace reads every person on its Contacts list', async () => {
  await page.goto(siteUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  for (const person of people) {
    await page.getByText(person.name, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  }
  const plan = (await orgRef.get()).get('plan')
  tally.check(
    'a Free workspace reads every person on its Contacts list',
    plan === 'free',
    `${people.map((person) => person.name).join(' · ')} · plan ${plan}`,
  )
})

await step(tally, page, 'the rail locks the seven suite sections and leaves Contacts open', async () => {
  const { locked, contactsOpen } = await readRail()
  tally.check(
    'the rail locks the seven suite sections and leaves Contacts open',
    locked.length === SUITE_SECTIONS.length && contactsOpen,
    `locked ${locked.join(' · ')} · Contacts open ${contactsOpen}`,
  )
})

await step(tally, page, 'New contact and Import CSV stand locked under the suite notice', async () => {
  const notice = page
    .getByRole('alert')
    .filter({ hasText: `part of the CRM suite. ${PLAN_SENTENCE}` })
    .first()
  await notice.waitFor({ timeout: TIMEOUT_MS })
  const plans = await plansHref(notice)
  const acts = await readActs()
  tally.check(
    'New contact and Import CSV stand locked under the suite notice',
    actsLocked(acts) && Boolean(plans?.startsWith(billingPath)),
    `${JSON.stringify(acts)} · View plans → ${plans}`,
  )
  await shot(page, 'crm-free-plan-contacts')
})

await step(tally, page, 'Export CSV downloads every person', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: TIMEOUT_MS }),
    act('Export CSV').click({ timeout: TIMEOUT_MS }),
  ])
  const csv = readFileSync(await download.path(), 'utf8')
  const missing = people.filter((person) => !csv.includes(person.email))
  tally.check(
    'Export CSV downloads every person',
    missing.length === 0,
    `${download.suggestedFilename()} — ${csv.trim().split('\n').length} lines` +
      (missing.length ? ` · missing ${missing.map((person) => person.email).join(', ')}` : ''),
  )
})

await step(tally, page, "each locked section's body is the shell's upgrade notice", async () => {
  const refused = []
  for (const { id, label } of SUITE_SECTIONS) {
    await page.goto(siteUrl(`/crm/${id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    const notice = page
      .getByRole('alert')
      .filter({ hasText: `${label} is not included in your current plan.` })
      .first()
    await notice.waitFor({ timeout: TIMEOUT_MS })
    const text = (await notice.textContent()) ?? ''
    const plans = await plansHref(notice)
    if (text.includes(PLAN_SENTENCE) && plans?.startsWith(billingPath)) refused.push(label)
    if (id === 'leads') await shot(page, 'crm-free-plan-locked-section')
  }
  tally.check(
    "each locked section's body is the shell's upgrade notice",
    refused.length === SUITE_SECTIONS.length,
    refused.join(' · '),
  )
})

await step(tally, page, "the organization's hub lands a bare /crm on Contacts and draws the same locks", async () => {
  await page.goto(orgUrl('/crm'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.waitForURL((url) => url.pathname === `/${FREE.orgSlug}/crm/contacts`, {
    timeout: TIMEOUT_MS,
  })
  await page.getByText(rosa.name, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  const { locked, contactsOpen } = await readRail()
  const acts = await readActs()
  await page.goto(orgUrl('/crm/deals'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page
    .getByRole('alert')
    .filter({ hasText: `Deals is not included in your current plan.` })
    .filter({ hasText: PLAN_SENTENCE })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  tally.check(
    "the organization's hub lands a bare /crm on Contacts and draws the same locks",
    locked.length === SUITE_SECTIONS.length && contactsOpen && actsLocked(acts),
    `/crm → /crm/contacts · locked ${locked.length} · ${JSON.stringify(acts)} · Deals refused`,
  )
})

await step(tally, page, 'crm/contacts-create answers 403 plan_required to the owner and writes nothing', async () => {
  const email = `walk-in-${RUN}@example.com`
  const answer = await postAsUser(FREE.ownerUid, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email,
    name: 'Walk-in Customer',
  })
  const rows = await contactsAt(email)
  // The same read, for an address that IS on file, so "no rows" cannot be a
  // query that matches nothing.
  const seeded = await contactsAt(rosa.email)
  tally.check(
    'crm/contacts-create answers 403 plan_required to the owner and writes nothing',
    refusedForPlan(answer) && rows === 0 && seeded === 1,
    `${answer.status} ${JSON.stringify(answer.body)} · rows ${rows} (seeded address ${seeded})`,
  )
})

await step(tally, page, 'crm/contacts-create refuses staff on Free too', async () => {
  const email = `staff-walk-in-${RUN}@example.com`
  const answer = await postAsUser(OWNER_UID, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email,
    name: 'Staff Walk-in',
  })
  const rows = await contactsAt(email)
  tally.check(
    'crm/contacts-create refuses staff on Free too',
    refusedForPlan(answer) && rows === 0,
    `${answer.status} ${answer.body.reason}/${answer.body.code} · rows ${rows}`,
  )
})

await step(tally, page, 'the rules refuse a client-direct company create and update, and serve the read', async () => {
  const create = await createCompany(`rules-probe-free-${RUN}`)
  const update = await updateCompany(`Noted on Free ${RUN}`)
  const read = await readCompany()
  tally.check(
    'the rules refuse a client-direct company create and update, and serve the read',
    create.startsWith('403') && update.startsWith('403') && read === '200',
    `create ${create} · update ${update} · read ${read}`,
  )
})

await step(tally, page, 'a record opens, and an erasure is filed from it', async () => {
  await page.goto(siteUrl(`/crm/contacts/${rosa.id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: rosa.name }).first().waitFor({ timeout: TIMEOUT_MS })
  await page.getByText('Properties', { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: `More actions for ${rosa.name}`, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByRole('menuitem', { name: 'Erase this person' }).click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog', { name: `Erase ${rosa.email} from this workspace?` })
  await dialog.getByLabel('Type the email address to confirm').fill(rosa.email)
  await dialog.getByRole('button', { name: 'Erase permanently' }).click({ timeout: TIMEOUT_MS })
  await expectSnackbar(page, 'Erasure requested')
  // By what it says: the Alert's `data-testid` does not reach the DOM.
  await page
    .getByRole('alert')
    .filter({ hasText: 'Erasure pending.' })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  const marker = await waitFor(
    async () => (await orgRef.collection('contacts').doc(rosa.id).get()).get('erasureRequestedAtMs'),
    (value) => typeof value === 'number' && value > 0,
  )
  const pending = await firestore
    .collection('personErasures')
    .where('orgId', '==', FREE.orgId)
    .where('status', '==', 'pending')
    .get()
  tally.check(
    'a record opens, and an erasure is filed from it',
    pending.size === 1 && pending.docs[0].get('email') === rosa.email,
    `marker ${marker} · ${pending.size} pending request(s)`,
  )
})

/*==========================================
 * THE CONTROL — the same workspace on Starter
 *=========================================*/

await step(tally, page, 'control: on Starter the same writes are admitted and the acts open', async () => {
  await orgRef.update({ plan: 'starter', subscription: { status: 'active' } })
  const create = await createCompany(`rules-probe-starter-${RUN}`)
  const update = await updateCompany(`Noted on Starter ${RUN}`)
  const email = `starter-walk-in-${RUN}@example.com`
  const answer = await postAsUser(FREE.ownerUid, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email,
    name: 'Starter Walk-in',
  })
  const rows = await contactsAt(email)
  await page.goto(siteUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const newContactOpen = await waitFor(
    () => act('New contact').isEnabled().catch(() => false),
    Boolean,
  )
  await openTab('Leads').waitFor({ timeout: TIMEOUT_MS })
  tally.check(
    'control: on Starter the same writes are admitted and the acts open',
    create === '200' &&
      update === '200' &&
      answer.status < 300 &&
      Boolean(answer.body.contactId) &&
      rows === 1 &&
      newContactOpen,
    `create ${create} · update ${update} · contacts-create ${answer.status} rows ${rows} · ` +
      `New contact enabled ${newContactOpen} · Leads unlocked`,
  )
})

await session.close()
// Back on Free, with what this run filed and created withdrawn, for whoever runs next.
await seed()
process.exit(tally.finish())
