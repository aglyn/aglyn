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
 * Site Care (AGL-3959): nobody reads or writes a request's billing record,
 * its append-only history or a workspace's Site Care month from a client —
 * not the owner, not an admin holding billing.manage, not staff.
 *
 * `supportTickets/{id}` carries the request's minutes, approval and charge;
 * `supportTickets/{id}/siteCareHistory` is the append-only record of every
 * minute, approval, charge, email and correction;
 * `supportTickets/{id}/siteCareStaff` holds, for staff only, the other Site
 * Care workspaces an emailed request's sender belongs to (AGL-4031);
 * `orgs/{orgId}/siteCareMonths`
 * holds goodwill minutes, with its own `siteCareHistory`; and
 * `orgs/{orgId}/siteCareProjects` holds each flat-quoted project (AGL-3970),
 * with its own `siteCareHistory`. No rule names any of
 * them, so each is refused by default, and the console reads and writes them
 * only through `/api/site-care/*` and `/api/admin/site-care` (and `/projects`). These rows prove
 * that default reaches them, so a wildcard added one day cannot quietly let a
 * client rewrite history or the minutes a bill is computed from.
 *
 * The control row — the owner reading the org document itself — keeps the
 * suite from passing against an emulator that refuses everything.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-site-care.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-site-care-test'
const OWNER = 'uid-site-care-owner'
const ADMIN = 'uid-site-care-admin'
const STAFF = 'uid-site-care-staff'
const TICKET = 'ticket-site-care-test'
const MONTH = '2026-10'
const PROJECT = 'project-site-care-test'

const HISTORY_ROW = {
  atMs: 1_760_886_000_000,
  byUid: STAFF,
  byEmail: null,
  kind: 'minutes.corrected',
  summary: 'Corrected the time from 90 min to 2 h.',
  reason: 'Logged the wrong number',
  before: { minutesLogged: 90 },
  after: { minutesLogged: 120 },
  stripe: null,
  subjectId: TICKET,
}

/** Each path a client must not touch, as the segments `doc()` takes. */
const PATHS = [
  {
    label: 'supportTickets/{id} (a Site Care request)',
    collection: ['supportTickets'],
    id: TICKET,
    data: {
      orgId: ORG,
      kind: 'siteCare',
      status: 'closed',
      subject: 'New hours',
      siteCare: { state: 'closed', minutesLogged: 90, billedHours: 1 },
    },
    change: { 'siteCare.minutesLogged': 5 },
  },
  {
    label: 'supportTickets/{id}/siteCareHistory',
    collection: ['supportTickets', TICKET, 'siteCareHistory'],
    id: 'row-1',
    data: HISTORY_ROW,
    change: { summary: 'Rewritten' },
  },
  // Which other workspaces the sender belongs to is the sender's, not the
  // filed workspace's to read (AGL-4031).
  {
    label: 'supportTickets/{id}/siteCareStaff',
    collection: ['supportTickets', TICKET, 'siteCareStaff'],
    id: 'intake',
    data: {
      candidates: [{ orgId: ORG, name: 'Site Care test', uid: OWNER }],
      filedOnOrgId: ORG,
    },
    change: { filedOnOrgId: 'org-other' },
  },
  {
    label: 'orgs/{orgId}/siteCareMonths',
    collection: ['orgs', ORG, 'siteCareMonths'],
    id: MONTH,
    data: { orgId: ORG, month: MONTH, goodwillMinutes: 30 },
    change: { goodwillMinutes: 600 },
  },
  {
    label: 'orgs/{orgId}/siteCareMonths/{month}/siteCareHistory',
    collection: ['orgs', ORG, 'siteCareMonths', MONTH, 'siteCareHistory'],
    id: 'row-1',
    data: { ...HISTORY_ROW, kind: 'goodwill.added', subjectId: null },
    change: { reason: 'Rewritten' },
  },
  // A flat-quoted project (AGL-3970): its scope, price, the owner's yes and
  // every invoice, and its append-only history. A client that could write
  // the record could change the price after the yes, or mark an invoice paid.
  {
    label: 'orgs/{orgId}/siteCareProjects/{id}',
    collection: ['orgs', ORG, 'siteCareProjects'],
    id: PROJECT,
    data: {
      orgId: ORG,
      title: 'Holiday sale page',
      scope: ['A landing page'],
      quote: { kind: 'landingPage', estimatedHours: 2, billedHours: 2, priceUsd: 249, split: 'full' },
      status: 'invoiced',
      invoices: [{ seq: 1, kind: 'full', status: 'open', amountCents: 24900 }],
    },
    change: { 'quote.priceUsd': 1 },
  },
  {
    label: 'orgs/{orgId}/siteCareProjects/{id}/siteCareHistory',
    collection: ['orgs', ORG, 'siteCareProjects', PROJECT, 'siteCareHistory'],
    id: 'row-1',
    data: { ...HISTORY_ROW, kind: 'invoice.paid', subjectId: PROJECT },
    change: { summary: 'Rewritten' },
  },
]

const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: emulatorHost,
    port: Number(emulatorPort),
    // The comment-stripped artifact is what deploys (AGL-3544).
    rules: readFileSync('cloud/firebase-firestore.deploy.rules', 'utf8'),
  },
})

const results = []
const check = async (label, fn) => {
  try {
    await fn()
    results.push(['PASS', label])
  } catch (error) {
    results.push(['FAIL', label, String(error).slice(0, 160)])
  }
}

const docOf = (db, entry, id = entry.id) => doc(db, ...entry.collection, id)

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), {
    name: 'Site Care Test',
    slug: 'site-care-test',
    plan: 'starter',
    ownerUid: OWNER,
    seatAddons: { siteCare: 1 },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), {
    role: 'admin',
    allHosts: true,
    resolvedPermissions: { 'billing.manage': true, 'billing.view': true },
  })
  for (const entry of PATHS) await setDoc(docOf(db, entry), entry.data)
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const readers = [
  ['the OWNER', () => as(OWNER)],
  ['an ADMIN holding billing.manage', () => as(ADMIN)],
  ['STAFF', () => as(STAFF, { staff: true })],
  ['a signed-out visitor', () => env.unauthenticatedContext().firestore()],
]

await check('control: the owner reads the organization itself', () => assertSucceeds(getDoc(doc(as(OWNER), 'orgs', ORG))))

for (const entry of PATHS) {
  for (const [who, db] of readers) {
    await check(`${entry.label}: ${who} cannot get a document`, () => assertFails(getDoc(docOf(db(), entry))))
    await check(`${entry.label}: ${who} cannot list the collection`, () =>
      assertFails(getDocs(collection(db(), ...entry.collection))),
    )
    await check(`${entry.label}: ${who} cannot create a document`, () =>
      assertFails(setDoc(docOf(db(), entry, `${entry.id}-new`), entry.data)),
    )
    await check(`${entry.label}: ${who} cannot change a document`, () =>
      assertFails(updateDoc(docOf(db(), entry), entry.change)),
    )
    await check(`${entry.label}: ${who} cannot delete a document`, () => assertFails(deleteDoc(docOf(db(), entry))))
  }
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const entry of [...PATHS].reverse()) {
    await deleteDoc(docOf(db, entry))
    await deleteDoc(docOf(db, entry, `${entry.id}-new`))
  }
  for (const uid of [OWNER, ADMIN]) await deleteDoc(doc(db, 'orgs', ORG, 'members', uid))
  await deleteDoc(doc(db, 'orgs', ORG))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
