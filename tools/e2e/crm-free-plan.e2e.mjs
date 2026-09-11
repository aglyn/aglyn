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

// THE CRM ON A FREE WORKSPACE, end to end (AGL-2809, AGL-2851, AGL-2839).
//
// The CRM is included from Starter and a Free workspace has none of it
// (AGL-2851): the shell draws every CRM section locked beside the upgrade
// notice and mounts no CRM page, the `crm/*` routes refuse every read and
// write, and the rules refuse a client's CRM writes — while the workspace
// still exports and erases the people it holds from Settings → Privacy
// (AGL-2839). Every other CRM spec drives the primary e2e org, which is on
// Business, so none of them can see any of it. This one signs in as the
// non-staff owner of a workspace that is always on Free
// (`tools/scripts/lib/crm-free-plan-fixtures.mjs`) and proves, in order:
//
// 1. A bare `/crm` under a site stays where it is and draws the CRM notice
//    beside a rail with every section locked, Leads included, and no person
//    the workspace holds.
// 2. Each section, a lead's page and a contact's page answer with the same
//    notice and draw none of the workspace's people.
// 3. The organization's hub draws the same.
// 4. A `crm/*` read (`crm/contact-email-history`) and `crm/*` writes
//    (`crm/contacts-create`, `crm/lead-convert`) answer 403 `plan_required` /
//    `crm` to the owner — the create to staff too — and write nothing, and
//    `/api/crm/export` refuses the companies file the same way.
// 5. The rules refuse a lead's status change and a company's create and
//    update, and still serve both reads.
// 6. THE COMPLIANCE DOOR. Settings → Privacy downloads every contact and
//    every lead, and files an erasure by address for a contact who has no
//    lead.
// 7. THE CONTROL. The same workspace moved to Starter admits the same acts:
//    `/crm` lands on Contacts with the rail open, Leads lists its people, the
//    read and the writes answer, the rules admit the writes, and the companies
//    file downloads. A refusal above that this step does not turn into an
//    admission is not the plan's refusal.
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

/** Every CRM section, in the rail's order (`crm-console-sections.ts`). */
const CRM_SECTIONS = [
  { id: 'contacts', label: 'Contacts' },
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
/** The shell's notice for the CRM on a plan without it (`blockedExtensionNotice`). */
const NOTICE = 'CRM is not included in your current plan.'
/** How the notice ends: the plan that includes the CRM. */
const PLAN_SENTENCE = 'Included from Starter.'
const RUN = Date.now().toString(36)
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main'

const firestore = adminFirestore()
const seed = () => seedFreePlanWorkspace({ firestore, auth: getAuth(), password: PASSWORD })
await seed()

const orgRef = firestore.collection('orgs').doc(FREE.orgId)
const leadsRef = firestore.collection('hosts').doc(FREE.hostId).collection('leads')
const sitePath = (path) => `/${FREE.orgSlug}/hosts/${FREE.hostId}${path}`
const siteUrl = (path) => `${BASE_URL}${sitePath(path)}`
const orgPath = (path) => `/${FREE.orgSlug}${path}`
const orgUrl = (path) => `${BASE_URL}${orgPath(path)}`
const billingPath = `/${FREE.orgSlug}/billing`
const leads = Object.values(FREE.leads)
const contacts = Object.values(FREE.contacts)
/** Everyone the workspace holds, by the name a page would draw. */
const people = [...new Set([...leads, ...contacts].map((person) => person.name))]
const rosa = FREE.leads.rosa
const priya = FREE.leads.priya
const rosaLeadId = leadIdFor(rosa.email)
const priyaLeadId = leadIdFor(priya.email)
const ben = FREE.contacts.ben
const lena = FREE.contacts.lena
const contactsAt = async (email) =>
  (await orgRef.collection('contacts').where('email', '==', email).get()).size

/** A `plan_required` / `crm` refusal, in the console routes' flat shape. */
const refusedForPlan = (answer) =>
  answer.status === 403 && answer.body?.reason === 'plan_required' && answer.body?.code === 'crm'

/** `GET /api/crm/export` as a user: the status, and the body as JSON when it is JSON. */
async function exportAs(uid, resource) {
  const response = await fetch(
    `${BASE_URL}/api/crm/export?orgId=${encodeURIComponent(FREE.orgId)}&resource=${resource}`,
    { headers: { Authorization: `Bearer ${await idTokenFor(uid)}` } },
  )
  const text = await response.text()
  let body = {}
  try {
    body = JSON.parse(text)
  } catch {
    // A CSV file.
  }
  return { status: response.status, body }
}

/*==========================================
 * CLIENT-DIRECT WRITES
 *
 * The browser SDK writes a lead's working state and the CRM's records
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
const goto = (url) => page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
/**
 * Where a notice's View plans goes. Found as the anchor rather than by role:
 * the button-styled link the shell draws carries `role="button"`, and the
 * destination is what the steps assert.
 */
const plansHref = (notice) =>
  notice.locator('a', { hasText: 'View plans' }).first().getAttribute('href', { timeout: TIMEOUT_MS })
/** The shell's CRM notice with the plan that includes it. */
const crmNotice = () =>
  page.getByRole('alert').filter({ hasText: NOTICE }).filter({ hasText: PLAN_SENTENCE }).first()

/** Which sections the rail locks and which it leaves open, once the org has settled. */
async function readRail({ expectLocks }) {
  await (expectLocks ? lockedTab('Leads') : openTab('Leads')).waitFor({ timeout: TIMEOUT_MS })
  const locked = []
  const open = []
  for (const { label } of CRM_SECTIONS) {
    if ((await lockedTab(label).count()) === 1) locked.push(label)
    else if ((await openTab(label).count()) === 1) open.push(label)
  }
  return { locked, open }
}

/** How many of the workspace's people the page draws by name. */
async function peopleDrawn() {
  let drawn = 0
  for (const name of people) drawn += await page.getByText(name, { exact: true }).count()
  return drawn
}

/*==========================================
 * ON FREE
 *=========================================*/

await step(tally, page, 'a bare /crm stays put and draws the CRM notice beside a rail with every section locked, and no person', async () => {
  await goto(siteUrl('/crm'))
  const notice = crmNotice()
  await notice.waitFor({ timeout: TIMEOUT_MS })
  const { locked, open } = await readRail({ expectLocks: true })
  const plans = await plansHref(notice)
  const path = new URL(page.url()).pathname
  const drawn = await peopleDrawn()
  const plan = (await orgRef.get()).get('plan')
  tally.check(
    'a bare /crm stays put and draws the CRM notice beside a rail with every section locked, and no person',
    plan === 'free' &&
      path === sitePath('/crm') &&
      locked.length === CRM_SECTIONS.length &&
      open.length === 0 &&
      Boolean(plans?.startsWith(billingPath)) &&
      drawn === 0,
    `plan ${plan} · at ${path} · locked ${locked.join(' · ')} · open ${open.join(' · ') || 'none'} · ` +
      `View plans → ${plans} · people drawn ${drawn}`,
  )
  await shot(page, 'crm-free-plan-locked-hub')
})

await step(tally, page, 'every section, a lead and a contact answer with the same notice, and draw no person', async () => {
  const answered = []
  for (const { id, label } of CRM_SECTIONS) {
    await goto(siteUrl(`/crm/${id}`))
    await crmNotice().waitFor({ timeout: TIMEOUT_MS })
    const drawn = await peopleDrawn()
    answered.push(`${label} ${drawn}`)
  }
  const records = []
  for (const [kind, path] of [
    ['lead', `/crm/leads/${rosaLeadId}`],
    ['contact', `/crm/contacts/${FREE.contacts.rosa.id}`],
  ]) {
    await goto(siteUrl(path))
    await crmNotice().waitFor({ timeout: TIMEOUT_MS })
    records.push(`${kind} ${await peopleDrawn()}`)
  }
  tally.check(
    'every section, a lead and a contact answer with the same notice, and draw no person',
    answered.length === CRM_SECTIONS.length &&
      [...answered, ...records].every((entry) => entry.endsWith(' 0')),
    `people drawn per page: ${[...answered, ...records].join(' · ')}`,
  )
})

await step(tally, page, "the organization's hub draws the same", async () => {
  await goto(orgUrl('/crm'))
  await crmNotice().waitFor({ timeout: TIMEOUT_MS })
  const { locked, open } = await readRail({ expectLocks: true })
  const path = new URL(page.url()).pathname
  const drawn = await peopleDrawn()
  await goto(orgUrl('/crm/leads'))
  await crmNotice().waitFor({ timeout: TIMEOUT_MS })
  const leadsDrawn = await peopleDrawn()
  tally.check(
    "the organization's hub draws the same",
    path === orgPath('/crm') &&
      locked.length === CRM_SECTIONS.length &&
      open.length === 0 &&
      drawn === 0 &&
      leadsDrawn === 0,
    `at ${path} · locked ${locked.length} · open ${open.length} · people drawn ${drawn} · on Leads ${leadsDrawn}`,
  )
})

await step(tally, page, 'a crm/* read and crm/* writes answer 403 plan_required, staff included, writing nothing', async () => {
  const read = await postAsUser(FREE.ownerUid, '/api/crm/contact-email-history', {
    hostId: FREE.hostId,
    contactId: lena.id,
  })
  const email = `walk-in-${RUN}@example.com`
  const staffEmail = `staff-walk-in-${RUN}@example.com`
  const create = await postAsUser(FREE.ownerUid, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email,
    name: 'Walk-in Customer',
  })
  const staffCreate = await postAsUser(OWNER_UID, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email: staffEmail,
    name: 'Staff Walk-in',
  })
  const convert = await postAsUser(FREE.ownerUid, '/api/crm/lead-convert', {
    hostId: FREE.hostId,
    leadId: priyaLeadId,
  })
  const companiesFile = await exportAs(FREE.ownerUid, 'companies')
  const rows = (await contactsAt(email)) + (await contactsAt(staffEmail))
  // The same read, for an address that IS on file, so "no rows" cannot be a
  // query that matches nothing.
  const seeded = await contactsAt(ben.email)
  const converted = (await leadsRef.doc(priyaLeadId).get()).get('convertedContactId')
  const refusal = (answer) => `${answer.status} ${answer.body?.reason}/${answer.body?.code}`
  tally.check(
    'a crm/* read and crm/* writes answer 403 plan_required, staff included, writing nothing',
    refusedForPlan(read) &&
      refusedForPlan(create) &&
      refusedForPlan(staffCreate) &&
      refusedForPlan(convert) &&
      refusedForPlan(companiesFile) &&
      rows === 0 &&
      seeded === 1 &&
      !converted,
    `contact-email-history ${refusal(read)} · contacts-create ${refusal(create)} · staff ${refusal(staffCreate)} · ` +
      `lead-convert ${refusal(convert)} · export companies ${refusal(companiesFile)} · rows ${rows} (seeded address ${seeded})`,
  )
})

await step(tally, page, "the rules refuse a lead's status change and a company's create and update, and serve the reads", async () => {
  const status = await setLeadStatus(priyaLeadId, 'unqualified')
  const leadRead = await readLead(priyaLeadId)
  const create = await createCompany(`rules-probe-free-${RUN}`)
  const update = await updateCompany(`Noted on Free ${RUN}`)
  const read = await readCompany()
  const still = (await leadsRef.doc(priyaLeadId).get()).get('status')
  tally.check(
    "the rules refuse a lead's status change and a company's create and update, and serve the reads",
    status.startsWith('403') &&
      leadRead === '200' &&
      still === 'working' &&
      create.startsWith('403') &&
      update.startsWith('403') &&
      read === '200',
    `lead status ${status} · lead read ${leadRead} (status ${still}) · ` +
      `company create ${create} · update ${update} · read ${read}`,
  )
})

await step(tally, page, 'Settings → Privacy downloads every contact and every lead, and erases a contact with no lead by address', async () => {
  await goto(orgUrl('/settings/privacy'))
  const downloadOf = async (label) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: TIMEOUT_MS }),
      button(label).click({ timeout: TIMEOUT_MS }),
    ])
    return { name: download.suggestedFilename(), csv: readFileSync(await download.path(), 'utf8') }
  }
  const contactsFile = await downloadOf('Export contacts')
  const leadsFile = await downloadOf('Export leads')
  const missing = [
    ...contacts.filter((person) => !contactsFile.csv.includes(person.email)),
    ...leads.filter((lead) => !leadsFile.csv.includes(lead.email)),
  ].map((person) => person.email)
  // Ben arrived by the newsletter: a contact the workspace holds with no lead,
  // who no page on Free shows (AGL-2839).
  const benHasLead = (await leadsRef.doc(leadIdFor(ben.email)).get()).exists
  await page.getByLabel('Email address', { exact: true }).fill(ben.email)
  await page.getByLabel('Type the email address again', { exact: true }).fill(ben.email)
  await button('Erase permanently').click({ timeout: TIMEOUT_MS })
  await expectSnackbar(page, 'Erasure requested')
  const pending = await waitFor(
    async () =>
      (
        await firestore
          .collection('personErasures')
          .where('orgId', '==', FREE.orgId)
          .where('status', '==', 'pending')
          .get()
      ).docs.map((doc) => doc.get('email')),
    (emails) => Array.isArray(emails) && emails.includes(ben.email),
  )
  const marker = (await orgRef.collection('contacts').doc(ben.id).get()).get('erasureRequestedAtMs')
  const lines = (file) => file.csv.trim().split('\n').length
  tally.check(
    'Settings → Privacy downloads every contact and every lead, and erases a contact with no lead by address',
    missing.length === 0 &&
      !benHasLead &&
      Array.isArray(pending) &&
      pending.includes(ben.email) &&
      typeof marker === 'number',
    `${contactsFile.name} ${lines(contactsFile)} lines · ${leadsFile.name} ${lines(leadsFile)} lines` +
      (missing.length ? ` · missing ${missing.join(', ')}` : '') +
      ` · Ben has a lead ${benHasLead} · pending ${JSON.stringify(pending)} · contact marker ${marker}`,
  )
  await shot(page, 'crm-free-plan-privacy')
})

/*==========================================
 * THE CONTROL — the same workspace on Starter
 *=========================================*/

await step(tally, page, 'control: on Starter the same acts are admitted, and the CRM opens on Contacts', async () => {
  await orgRef.update({ plan: 'starter', subscription: { status: 'active' } })
  const status = await setLeadStatus(priyaLeadId, 'new')
  const create = await createCompany(`rules-probe-starter-${RUN}`)
  const update = await updateCompany(`Noted on Starter ${RUN}`)
  const read = await postAsUser(FREE.ownerUid, '/api/crm/contact-email-history', {
    hostId: FREE.hostId,
    contactId: lena.id,
  })
  const email = `starter-walk-in-${RUN}@example.com`
  const answer = await postAsUser(FREE.ownerUid, '/api/crm/contacts-create', {
    hostId: FREE.hostId,
    email,
    name: 'Starter Walk-in',
  })
  const rows = await contactsAt(email)
  const convert = await postAsUser(FREE.ownerUid, '/api/crm/lead-convert', {
    hostId: FREE.hostId,
    leadId: priyaLeadId,
  })
  const converted = await waitFor(
    async () => (await leadsRef.doc(priyaLeadId).get()).get('convertedContactId'),
    Boolean,
  )
  const companiesFile = await exportAs(FREE.ownerUid, 'companies')
  await goto(siteUrl('/crm'))
  await page.waitForURL((url) => url.pathname === sitePath('/crm/contacts'), { timeout: TIMEOUT_MS })
  const { locked, open } = await readRail({ expectLocks: false })
  const newContactOpen = await waitFor(
    () => button('New contact').first().isEnabled().catch(() => false),
    Boolean,
  )
  await goto(siteUrl('/crm/leads'))
  await page.getByText(rosa.name, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  const notices = await page.getByRole('alert').filter({ hasText: NOTICE }).count()
  // Last, because the re-seed below is what puts the lead back.
  const removal = await deleteLead(priyaLeadId)
  tally.check(
    'control: on Starter the same acts are admitted, and the CRM opens on Contacts',
    status === '200' &&
      create === '200' &&
      update === '200' &&
      read.status === 200 &&
      answer.status < 300 &&
      Boolean(answer.body?.contactId) &&
      rows === 1 &&
      convert.status === 200 &&
      Boolean(converted) &&
      companiesFile.status === 200 &&
      locked.length === 0 &&
      open.length === CRM_SECTIONS.length &&
      Boolean(newContactOpen) &&
      notices === 0 &&
      removal === '200',
    `lead status ${status} · company create ${create} · update ${update} · contact-email-history ${read.status} · ` +
      `contacts-create ${answer.status} rows ${rows} · lead-convert ${convert.status} (contact ${converted}) · ` +
      `export companies ${companiesFile.status} · /crm → /crm/contacts, open ${open.length}, locked ${locked.length}, ` +
      `New contact enabled ${newContactOpen} · Leads notices ${notices} · lead delete ${removal}`,
  )
})

await session.close()
// Back on Free, with what this run filed, created and removed put back, for whoever runs next.
await seed()
process.exit(tally.finish())
