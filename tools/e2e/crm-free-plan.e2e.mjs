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

// THE CRM ON A FREE WORKSPACE, end to end (AGL-2809, AGL-2790).
//
// On a plan without the CRM suite the CRM opens on Leads, read-only
// (AGL-2790): the shell locks Contacts with Companies, Deals, Tasks, Reports,
// Fields and Settings; the Leads section and a lead's page draw no working
// act; the `crm/*` routes refuse every contact edit and every lead write; and
// the rules refuse a lead's change and its removal. Every other CRM spec
// drives the primary e2e org, which is on Business, so none of them can see
// any of it. This one signs in as the non-staff owner of a workspace that is
// always on Free (`tools/scripts/lib/crm-free-plan-fixtures.mjs`) and proves,
// in order:
//
// 1. A bare `/crm` lands on Leads, and the list reads every lead.
// 2. The rail draws Contacts, Companies, Deals, Tasks, Reports, Fields and
//    Settings with the lock, named to assistive technology, and Leads without.
// 3. Leads is read-only under the suite notice and its way to the plans: no
//    Import CSV, no status select on a row, and Open lead alone on its menu.
// 4. Export CSV downloads every lead, and a ticked row's bar offers the
//    exports alone.
// 5. Each locked section's body is the shell's upgrade notice — Contacts
//    included, and a contact's record beneath it.
// 6. The organization's hub lands a bare `/crm` on Leads and draws the same.
// 7. A lead's page is read-only, and an erasure is filed from it.
// 8. `POST /api/crm/contacts-create` answers 403 `plan_required` / `crm` to
//    the owner and to staff, and writes nothing.
// 9. `crm/contact-update` refuses a name, notes and a tag, and
//    `crm/lead-convert` refuses a conversion, writing nothing.
// 10. The rules refuse a client-direct lead status change and a lead's delete,
//     and a company create and update, and still serve both reads.
// 11. THE CONTROL. The same workspace moved to Starter admits the same writes —
//     the lead's conversion among them — lands `/crm` on Contacts with New
//     contact open, and offers Import CSV on Leads. A refusal above that this
//     step does not turn into an admission is not the plan's refusal.
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
  leadIdFor,
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
  { id: 'contacts', label: 'Contacts' },
  { id: 'companies', label: 'Companies' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reports', label: 'Reports' },
  { id: 'fields', label: 'Fields' },
  { id: 'settings', label: 'Settings' },
]
/** What the lock on a rail tab is named (`hub-tabs.tsx`, AGL-2794). */
const LOCK_NAME = 'Not included in your plan'
/** How every refusal on Free ends: the plan that includes the suite. */
const PLAN_SENTENCE = 'Included from Starter.'
/** What the Leads section and a lead's page say on Free (`leads-section.tsx`, `lead-properties-card.tsx`). */
const LEADS_READ_ONLY = 'Leads are read-only on your plan.'
const LEAD_READ_ONLY = 'This lead is read-only on your plan.'
const RUN = Date.now().toString(36)
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main'

const firestore = adminFirestore()
const seed = () => seedFreePlanWorkspace({ firestore, auth: getAuth(), password: PASSWORD })
await seed()

const orgRef = firestore.collection('orgs').doc(FREE.orgId)
const leadsRef = firestore.collection('hosts').doc(FREE.hostId).collection('leads')
const sitePath = (path) => `/${FREE.orgSlug}/hosts/${FREE.hostId}${path}`
const siteUrl = (path) => `${BASE_URL}${sitePath(path)}`
const orgUrl = (path) => `${BASE_URL}/${FREE.orgSlug}${path}`
const billingPath = `/${FREE.orgSlug}/billing`
const leads = Object.values(FREE.leads)
const rosa = FREE.leads.rosa
const priya = FREE.leads.priya
const rosaLeadId = leadIdFor(rosa.email)
const priyaLeadId = leadIdFor(priya.email)
const ben = FREE.contacts.ben
const contactsAt = async (email) =>
  (await orgRef.collection('contacts').where('email', '==', email).get()).size

/** A `plan_required` / `crm` refusal, in the console routes' flat shape. */
const refusedForPlan = (answer) =>
  answer.status === 403 && answer.body.reason === 'plan_required' && answer.body.code === 'crm'

/*==========================================
 * CLIENT-DIRECT WRITES
 *
 * The browser SDK writes a lead's working state and the suite's records
 * straight to Firestore, so the rules are the gate there. The emulator's REST
 * surface evaluates the same rules against the same ID token, which lets the
 * spec make the write a member's browser would make without reaching into the
 * page's SDK.
 *=========================================*/

const companiesPath = `orgs/${FREE.orgId}/companies`
const leadsPath = `hosts/${FREE.hostId}/leads`

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
/** A lead's status, as the row's inline select writes it. */
const setLeadStatus = (leadId, status) =>
  asOwner('PATCH', `${leadsPath}/${leadId}?updateMask.fieldPaths=status`, {
    fields: { status: { stringValue: status } },
  })
const deleteLead = (leadId) => asOwner('DELETE', `${leadsPath}/${leadId}`)
const readLead = (leadId) => asOwner('GET', `${leadsPath}/${leadId}`)

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
const button = (name) => page.getByRole('button', { name, exact: true })
const rowOf = (email) => page.getByRole('row').filter({ hasText: email }).first()
/**
 * Where a notice's View plans goes. Found as the anchor rather than by role:
 * the button-styled link the shell draws carries `role="button"`, and the
 * destination is what the steps assert.
 */
const plansHref = (notice) =>
  notice.locator('a', { hasText: 'View plans' }).first().getAttribute('href', { timeout: TIMEOUT_MS })

/** Which suite sections the rail locks, and whether Leads stands open. */
async function readRail() {
  // The lock is drawn once the org has settled, so wait for one before counting.
  await lockedTab('Contacts').waitFor({ timeout: TIMEOUT_MS })
  const locked = []
  for (const { label } of SUITE_SECTIONS) {
    if ((await lockedTab(label).count()) === 1) locked.push(label)
  }
  const leadsTab = openTab('Leads')
  const leadsOpen =
    (await leadsTab.count()) === 1 &&
    (await leadsTab.getByRole('img', { name: LOCK_NAME }).count()) === 0
  return { locked, leadsOpen }
}

/** A row's menu, opened, read and closed again. */
async function rowMenuItems(email) {
  await page
    .getByRole('button', { name: `More actions for ${email}`, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByRole('menuitem').first().waitFor({ timeout: TIMEOUT_MS })
  const items = (await page.getByRole('menuitem').allTextContents()).map((item) => item.trim())
  await page.keyboard.press('Escape')
  return items
}

/*==========================================
 * ON FREE
 *=========================================*/

await step(tally, page, 'a bare /crm lands on Leads, and the list reads every lead', async () => {
  await page.goto(siteUrl('/crm'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.waitForURL((url) => url.pathname === sitePath('/crm/leads'), { timeout: TIMEOUT_MS })
  for (const lead of leads) {
    await page.getByText(lead.name, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  }
  const plan = (await orgRef.get()).get('plan')
  tally.check(
    'a bare /crm lands on Leads, and the list reads every lead',
    plan === 'free',
    `/crm → /crm/leads · ${leads.map((lead) => lead.name).join(' · ')} · plan ${plan}`,
  )
})

await step(tally, page, 'the rail locks Contacts and the six other suite sections and leaves Leads open', async () => {
  const { locked, leadsOpen } = await readRail()
  tally.check(
    'the rail locks Contacts and the six other suite sections and leaves Leads open',
    locked.length === SUITE_SECTIONS.length && leadsOpen,
    `locked ${locked.join(' · ')} · Leads open ${leadsOpen}`,
  )
})

await step(tally, page, 'Leads is read-only under the suite notice', async () => {
  const notice = page
    .getByRole('alert')
    .filter({ hasText: LEADS_READ_ONLY })
    .filter({ hasText: `part of the CRM suite. ${PLAN_SENTENCE}` })
    .first()
  await notice.waitFor({ timeout: TIMEOUT_MS })
  const plans = await plansHref(notice)
  const importCsv = await button('Import CSV').count()
  await rowOf(rosa.email).waitFor({ timeout: TIMEOUT_MS })
  // A worked lead's status is where the inline select would be.
  const statusSelects = await rowOf(priya.email).getByRole('combobox').count()
  const items = await rowMenuItems(rosa.email)
  tally.check(
    'Leads is read-only under the suite notice',
    Boolean(plans?.startsWith(billingPath)) &&
      importCsv === 0 &&
      statusSelects === 0 &&
      items.length === 1 &&
      items[0] === 'Open lead',
    `View plans → ${plans} · Import CSV ${importCsv} · status selects ${statusSelects} · menu ${JSON.stringify(items)}`,
  )
  await shot(page, 'crm-free-plan-leads')
})

await step(tally, page, 'Export CSV downloads every lead, and a ticked row offers the exports alone', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: TIMEOUT_MS }),
    button('Export CSV').first().click({ timeout: TIMEOUT_MS }),
  ])
  const csv = readFileSync(await download.path(), 'utf8')
  const missing = leads.filter((lead) => !csv.includes(lead.email))
  await rowOf(rosa.email).getByRole('checkbox').check({ timeout: TIMEOUT_MS })
  await page.getByText('1 selected', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  const bar = {
    setOwner: await button('Set owner').count(),
    setStatus: await button('Set status').count(),
    unqualify: await button('Unqualify').count(),
    exportCsv: await button('Export CSV').count(),
    exportAll: await button('Export all…').count(),
  }
  await button('Clear').click({ timeout: TIMEOUT_MS })
  tally.check(
    'Export CSV downloads every lead, and a ticked row offers the exports alone',
    missing.length === 0 &&
      bar.setOwner === 0 &&
      bar.setStatus === 0 &&
      bar.unqualify === 0 &&
      // The toolbar's and the bar's.
      bar.exportCsv === 2 &&
      bar.exportAll === 1,
    `${download.suggestedFilename()} — ${csv.trim().split('\n').length} lines` +
      (missing.length ? ` · missing ${missing.map((lead) => lead.email).join(', ')}` : '') +
      ` · bar ${JSON.stringify(bar)}`,
  )
})

await step(tally, page, "each locked section's body is the shell's upgrade notice, Contacts and a contact's record included", async () => {
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
    if (id === 'contacts') await shot(page, 'crm-free-plan-locked-section')
  }
  // A record beneath a locked section is refused with it.
  await page.goto(siteUrl(`/crm/contacts/${FREE.contacts.rosa.id}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  await page
    .getByRole('alert')
    .filter({ hasText: 'Contacts is not included in your current plan.' })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  const recordHeading = await page.getByRole('heading', { name: FREE.contacts.rosa.name }).count()
  tally.check(
    "each locked section's body is the shell's upgrade notice, Contacts and a contact's record included",
    refused.length === SUITE_SECTIONS.length && recordHeading === 0,
    `${refused.join(' · ')} · contact record refused (heading ${recordHeading})`,
  )
})

await step(tally, page, "the organization's hub lands a bare /crm on Leads and draws the same", async () => {
  await page.goto(orgUrl('/crm'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.waitForURL((url) => url.pathname === `/${FREE.orgSlug}/crm/leads`, {
    timeout: TIMEOUT_MS,
  })
  await page.getByText(rosa.name, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  const { locked, leadsOpen } = await readRail()
  await page
    .getByRole('alert')
    .filter({ hasText: LEADS_READ_ONLY })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  const importCsv = await button('Import CSV').count()
  await page.goto(orgUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page
    .getByRole('alert')
    .filter({ hasText: 'Contacts is not included in your current plan.' })
    .filter({ hasText: PLAN_SENTENCE })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  tally.check(
    "the organization's hub lands a bare /crm on Leads and draws the same",
    locked.length === SUITE_SECTIONS.length && leadsOpen && importCsv === 0,
    `/crm → /crm/leads · locked ${locked.length} · Leads open ${leadsOpen} · Import CSV ${importCsv} · Contacts refused`,
  )
})

await step(tally, page, "a lead's page is read-only, and an erasure is filed from it", async () => {
  await page.goto(siteUrl(`/crm/leads/${rosaLeadId}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  await page.getByRole('heading', { name: rosa.name }).first().waitFor({ timeout: TIMEOUT_MS })
  await page
    .getByRole('alert')
    .filter({ hasText: LEAD_READ_ONLY })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  const acts = {
    convert: await button('Convert').count(),
    saveNotes: await button('Save notes').count(),
    status: await page.getByRole('combobox', { name: 'Status' }).count(),
    logActivity: await button('Log activity').count(),
    sendEmail: await button('Send email').count(),
  }
  await page
    .getByRole('button', { name: `More actions for ${rosa.name}`, exact: true })
    .click({ timeout: TIMEOUT_MS })
  const items = (await page.getByRole('menuitem').allTextContents()).map((item) => item.trim())
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
    async () => (await leadsRef.doc(rosaLeadId).get()).get('erasureRequestedAtMs'),
    (value) => typeof value === 'number' && value > 0,
  )
  const pending = await firestore
    .collection('personErasures')
    .where('orgId', '==', FREE.orgId)
    .where('status', '==', 'pending')
    .get()
  tally.check(
    "a lead's page is read-only, and an erasure is filed from it",
    Object.values(acts).every((count) => count === 0) &&
      !items.includes('Unqualify') &&
      pending.size === 1 &&
      pending.docs[0].get('email') === rosa.email,
    `${JSON.stringify(acts)} · menu ${JSON.stringify(items)} · marker ${marker} · ${pending.size} pending request(s)`,
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
  const seeded = await contactsAt(ben.email)
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

await step(tally, page, 'crm/contact-update refuses a name, notes and a tag, and crm/lead-convert refuses a conversion', async () => {
  const sets = [{ name: 'Ben O.' }, { notes: `Noted on Free ${RUN}` }, { addTag: 'wholesale' }]
  const answers = []
  for (const set of sets) {
    answers.push(
      await postAsUser(FREE.ownerUid, '/api/crm/contact-update', {
        hostId: FREE.hostId,
        contactIds: [ben.id],
        set,
      }),
    )
  }
  const facet = (await orgRef.collection('contacts').doc(ben.id).get()).get('facets')?.[FREE.hostId] ?? {}
  const convert = await postAsUser(FREE.ownerUid, '/api/crm/lead-convert', {
    hostId: FREE.hostId,
    leadId: priyaLeadId,
  })
  const converted = (await leadsRef.doc(priyaLeadId).get()).get('convertedContactId')
  tally.check(
    'crm/contact-update refuses a name, notes and a tag, and crm/lead-convert refuses a conversion',
    answers.every(refusedForPlan) &&
      facet.name === undefined &&
      facet.notes === undefined &&
      !(facet.tags ?? []).includes('wholesale') &&
      refusedForPlan(convert) &&
      !converted,
    `contact-update ${answers.map((answer) => answer.status).join(' · ')} · facet untouched · ` +
      `lead-convert ${convert.status} ${convert.body.reason}/${convert.body.code}`,
  )
})

await step(tally, page, "the rules refuse a lead's status change and its delete, and a company's create and update, and serve the reads", async () => {
  const status = await setLeadStatus(priyaLeadId, 'unqualified')
  const removal = await deleteLead(priyaLeadId)
  const leadRead = await readLead(priyaLeadId)
  const create = await createCompany(`rules-probe-free-${RUN}`)
  const update = await updateCompany(`Noted on Free ${RUN}`)
  const read = await readCompany()
  const still = (await leadsRef.doc(priyaLeadId).get()).get('status')
  tally.check(
    "the rules refuse a lead's status change and its delete, and a company's create and update, and serve the reads",
    status.startsWith('403') &&
      removal.startsWith('403') &&
      leadRead === '200' &&
      still === 'working' &&
      create.startsWith('403') &&
      update.startsWith('403') &&
      read === '200',
    `lead status ${status} · lead delete ${removal} · lead read ${leadRead} (status ${still}) · ` +
      `company create ${create} · update ${update} · read ${read}`,
  )
})

/*==========================================
 * THE CONTROL — the same workspace on Starter
 *=========================================*/

await step(tally, page, 'control: on Starter the same writes are admitted, and the CRM opens on Contacts', async () => {
  await orgRef.update({ plan: 'starter', subscription: { status: 'active' } })
  const status = await setLeadStatus(priyaLeadId, 'new')
  const create = await createCompany(`rules-probe-starter-${RUN}`)
  const update = await updateCompany(`Noted on Starter ${RUN}`)
  const email = `starter-walk-in-${RUN}@example.com`
  const answer = await postAsUser(FREE.ownerUid, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email,
    name: 'Starter Walk-in',
  })
  const rows = await contactsAt(email)
  const profile = await postAsUser(FREE.ownerUid, '/api/crm/contact-update', {
    hostId: FREE.hostId,
    contactIds: [ben.id],
    set: { name: 'Ben O.' },
  })
  const convert = await postAsUser(FREE.ownerUid, '/api/crm/lead-convert', {
    hostId: FREE.hostId,
    leadId: priyaLeadId,
  })
  const converted = await waitFor(
    async () => (await leadsRef.doc(priyaLeadId).get()).get('convertedContactId'),
    Boolean,
  )
  await page.goto(siteUrl('/crm'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.waitForURL((url) => url.pathname === sitePath('/crm/contacts'), { timeout: TIMEOUT_MS })
  const newContactOpen = await waitFor(
    () => button('New contact').first().isEnabled().catch(() => false),
    Boolean,
  )
  await page.goto(siteUrl('/crm/leads'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const importShown = await waitFor(
    () => button('Import CSV').count(),
    (count) => count > 0,
  )
  // Last, because the re-seed below is what puts the lead back.
  const removal = await deleteLead(priyaLeadId)
  tally.check(
    'control: on Starter the same writes are admitted, and the CRM opens on Contacts',
    status === '200' &&
      create === '200' &&
      update === '200' &&
      answer.status < 300 &&
      Boolean(answer.body.contactId) &&
      rows === 1 &&
      profile.status === 200 &&
      convert.status === 200 &&
      Boolean(converted) &&
      Boolean(newContactOpen) &&
      importShown > 0 &&
      removal === '200',
    `lead status ${status} · company create ${create} · update ${update} · contacts-create ${answer.status} rows ${rows} · ` +
      `contact-update ${profile.status} · lead-convert ${convert.status} (contact ${converted}) · ` +
      `/crm → /crm/contacts, New contact enabled ${newContactOpen} · ` +
      `Import CSV on Leads ${importShown} · lead delete ${removal}`,
  )
})

await session.close()
// Back on Free, with what this run filed, created and removed put back, for whoever runs next.
await seed()
process.exit(tally.finish())
