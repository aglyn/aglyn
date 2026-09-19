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
 * Outreach (AGL-2974): who may read a workspace's mailboxes, sequences,
 * enrollments, compliance settings and do-not-contact list (AGL-2980), and
 * that nobody reads a mailbox credential.
 *
 * `outreachMailboxes`, `outreachSequences` and `outreachEnrollments` under
 * `orgs/{orgId}` are read through `canReadOutreach()`: an org-wide member,
 * holding `outreach.use`, in an org whose per-org override carries Outreach —
 * no plan grants it. Every one of them is server-written. The top-level
 * `outreachMailboxCredentials` is closed to every client, staff included.
 *
 * ⚠️ Half the rows are controls against a lockout. "The revoked admin is
 * refused" also passes against a rule that refuses every admin, and "the
 * Enterprise org without the override is refused" also passes against a rule
 * that refuses every org. The owner and admin reads in the entitled org, the
 * admin with NO permissions map and the admin whose stamped map was written
 * without the plugin's key are the load-bearing half: they are what every
 * entitled workspace's managers look like.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-outreach.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

/** Entitled by the per-org override, on a plan that does not carry Outreach. */
const ORG = 'org-outreach-test'
/** The top plan, with no override: no plan grants Outreach. */
const ENTERPRISE_ORG = 'org-outreach-enterprise-test'
/** An override that says `false`, on the same plan as the entitled org. */
const OVERRIDE_OFF_ORG = 'org-outreach-override-off-test'

const OWNER = 'uid-outreach-owner'
/**
 * An admin whose `resolvedPermissions` was stamped WITHOUT `outreach.use` —
 * the shape the projection writes for a member no custom role or override has
 * touched, because tier defaults are not stamped.
 */
const ADMIN = 'uid-outreach-admin'
/** The control: an admin with no permissions map at all. */
const BARE_ADMIN = 'uid-outreach-admin-bare'
/** An admin whose per-member override revokes the key, and nothing stamped. */
const OVERRIDE_REVOKED_ADMIN = 'uid-outreach-admin-override-revoked'
/** An admin whose stamped map carries the revocation. */
const STAMP_REVOKED_ADMIN = 'uid-outreach-admin-stamp-revoked'
/** An org-wide editor with nothing stamped: the tier default refuses them. */
const ORG_EDITOR = 'uid-outreach-editor'
/** An org-wide viewer a custom role explicitly granted `outreach.use`. */
const GRANTED_VIEWER = 'uid-outreach-viewer-granted'
/** A scoped site collaborator carrying the same explicit grant. */
const COLLABORATOR = 'uid-outreach-collaborator'
const OUTSIDER = 'uid-outreach-outsider'
const STAFF = 'uid-outreach-staff'
const SUPER_STAFF = 'uid-outreach-staff-super'

const MAILBOX = 'mbx-outreach-1'

/** Each server-written collection, with one seeded document. */
const COLLECTIONS = [
  {
    name: 'outreachMailboxes',
    id: MAILBOX,
    data: { email: 'rep@example.com', dailySendCap: 50, sentToday: 12 },
  },
  {
    name: 'outreachSequences',
    id: 'seq-outreach-1',
    data: { name: 'Follow-up', steps: [{ delayDays: 0 }, { delayDays: 3 }] },
  },
  {
    name: 'outreachEnrollments',
    id: 'enr-outreach-1',
    data: {
      sequenceId: 'seq-outreach-1',
      nextDueAt: 0,
      stoppedReason: 'replied',
    },
  },
  // The compliance settings and the do-not-contact list (AGL-2980): read
  // like the rest, and written only by the routes — a client that could
  // write the footer's postal address, or take an address off the list,
  // could send mail the law or the recipient forbids.
  {
    name: 'outreachSettings',
    id: 'compliance',
    data: {
      legalName: 'Example Co LLC',
      brandName: '',
      postalAddress: '100 Example St\nSpringfield, IL 62701',
      allowedCountries: ['US'],
    },
  },
  {
    name: 'outreachDoNotContact',
    id: 'dnc-outreach-key-1',
    data: {
      key: 'dnc-outreach-key-1',
      reason: 'manual',
      source: 'member',
      addedByUid: 'uid-outreach-owner',
      addedAtMs: 1,
    },
  },
]

// `firebase emulators:exec` exports the emulator's address; a run on other
// ports than the shared default must not reach whichever emulator holds 8082.
const [emulatorHost, emulatorPort] = (
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082'
).split(':')

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: emulatorHost,
    port: Number(emulatorPort),
    rules: readFileSync('cloud/firebase-firestore.rules', 'utf8'),
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

const docOf = (db, orgId, { name, id }) => doc(db, 'orgs', orgId, name, id)
const listOf = (db, orgId, { name }) => collection(db, 'orgs', orgId, name)
const credentialOf = (db, id = MAILBOX) =>
  doc(db, 'outreachMailboxCredentials', id)

/** Every member document this spec seeds, by org, for the cleanup below. */
const seededMembers = []

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  const member = async (orgId, uid, fields) => {
    await setDoc(doc(db, 'orgs', orgId, 'members', uid), fields)
    seededMembers.push([orgId, uid])
  }

  await setDoc(doc(db, 'orgs', ORG), {
    name: 'Outreach Test',
    slug: 'outreach-test',
    plan: 'pro',
    entitlements: { features: { outreach: true } },
  })
  await setDoc(doc(db, 'orgs', ENTERPRISE_ORG), {
    name: 'Outreach Enterprise Test',
    slug: 'outreach-enterprise-test',
    plan: 'enterprise',
  })
  await setDoc(doc(db, 'orgs', OVERRIDE_OFF_ORG), {
    name: 'Outreach Override Off Test',
    slug: 'outreach-override-off-test',
    plan: 'pro',
    entitlements: { features: { outreach: false } },
  })

  await member(ORG, OWNER, { role: 'owner', allHosts: true })
  await member(ORG, ADMIN, {
    role: 'admin',
    allHosts: true,
    resolvedPermissions: { 'data.manage': true, 'billing.view': true },
  })
  await member(ORG, BARE_ADMIN, { role: 'admin', allHosts: true })
  await member(ORG, OVERRIDE_REVOKED_ADMIN, {
    role: 'admin',
    allHosts: true,
    permissions: { 'outreach.use': false },
  })
  await member(ORG, STAMP_REVOKED_ADMIN, {
    role: 'admin',
    allHosts: true,
    resolvedPermissions: { 'outreach.use': false },
  })
  await member(ORG, ORG_EDITOR, { role: 'editor', allHosts: true })
  await member(ORG, GRANTED_VIEWER, {
    role: 'viewer',
    allHosts: true,
    resolvedPermissions: { 'outreach.use': true },
  })
  await member(ORG, COLLABORATOR, {
    role: 'editor',
    allHosts: false,
    hostAccess: { 'host-outreach': 'editor' },
    resolvedPermissions: { 'outreach.use': true },
  })
  // The same owner, in the two orgs that do not carry Outreach — so a refusal
  // there can only be the entitlement.
  await member(ENTERPRISE_ORG, OWNER, { role: 'owner', allHosts: true })
  await member(OVERRIDE_OFF_ORG, OWNER, { role: 'owner', allHosts: true })

  for (const orgId of [ORG, ENTERPRISE_ORG, OVERRIDE_OFF_ORG]) {
    for (const entry of COLLECTIONS) {
      await setDoc(docOf(db, orgId, entry), entry.data)
    }
  }
  await setDoc(credentialOf(db), {
    orgId: ORG,
    mailboxId: MAILBOX,
    provider: 'google',
    ciphertext: 'fixture-ciphertext-not-a-real-grant',
  })
})

const as = (uid) =>
  env.authenticatedContext(uid, { email_verified: true }).firestore()

for (const entry of COLLECTIONS) {
  const { name } = entry

  // ── An entitled org's managers read ───────────────────────────────────────
  await check(`${name}: an OWNER gets a document`, () =>
    assertSucceeds(getDoc(docOf(as(OWNER), ORG, entry))),
  )
  await check(`${name}: an OWNER lists the collection`, () =>
    assertSucceeds(getDocs(listOf(as(OWNER), ORG, entry))),
  )
  await check(`${name}: an ADMIN stamped without the key gets a document`, () =>
    assertSucceeds(getDoc(docOf(as(ADMIN), ORG, entry))),
  )
  await check(
    `${name}: an ADMIN stamped without the key lists the collection`,
    () => assertSucceeds(getDocs(listOf(as(ADMIN), ORG, entry))),
  )
  // ⚠️ The control that stops the revoked rows below being a lockout of
  // every admin.
  await check(`${name}: CONTROL — an ADMIN with NO permissions map reads`, () =>
    assertSucceeds(getDoc(docOf(as(BARE_ADMIN), ORG, entry))),
  )

  // ── A revocation narrows an admin ─────────────────────────────────────────
  await check(
    `${name}: an ADMIN whose per-member override revokes outreach.use is refused`,
    () => assertFails(getDoc(docOf(as(OVERRIDE_REVOKED_ADMIN), ORG, entry))),
  )
  await check(
    `${name}: an ADMIN whose stamped map revokes outreach.use is refused`,
    () => assertFails(getDoc(docOf(as(STAMP_REVOKED_ADMIN), ORG, entry))),
  )

  // ── The tier default, and an explicit grant ───────────────────────────────
  await check(
    `${name}: an org-wide EDITOR with nothing stamped is refused`,
    () => assertFails(getDoc(docOf(as(ORG_EDITOR), ORG, entry))),
  )
  await check(
    `${name}: an org-wide VIEWER explicitly granted outreach.use gets a document`,
    () => assertSucceeds(getDoc(docOf(as(GRANTED_VIEWER), ORG, entry))),
  )
  await check(
    `${name}: an org-wide VIEWER explicitly granted outreach.use lists the collection`,
    () => assertSucceeds(getDocs(listOf(as(GRANTED_VIEWER), ORG, entry))),
  )

  // ── The reach ─────────────────────────────────────────────────────────────
  await check(
    `${name}: a scoped COLLABORATOR is refused a document, grant and all`,
    () => assertFails(getDoc(docOf(as(COLLABORATOR), ORG, entry))),
  )
  await check(
    `${name}: a scoped COLLABORATOR is refused the list, grant and all`,
    () => assertFails(getDocs(listOf(as(COLLABORATOR), ORG, entry))),
  )
  await check(`${name}: an OUTSIDER is refused`, () =>
    assertFails(getDoc(docOf(as(OUTSIDER), ORG, entry))),
  )

  // ── The entitlement: no plan grants it, and only `true` does ──────────────
  await check(
    `${name}: the OWNER of an ENTERPRISE org with no override is refused a document`,
    () => assertFails(getDoc(docOf(as(OWNER), ENTERPRISE_ORG, entry))),
  )
  await check(
    `${name}: the OWNER of an ENTERPRISE org with no override is refused the list`,
    () => assertFails(getDocs(listOf(as(OWNER), ENTERPRISE_ORG, entry))),
  )
  await check(
    `${name}: the OWNER of an org whose override is FALSE is refused a document`,
    () => assertFails(getDoc(docOf(as(OWNER), OVERRIDE_OFF_ORG, entry))),
  )
  await check(
    `${name}: the OWNER of an org whose override is FALSE is refused the list`,
    () => assertFails(getDocs(listOf(as(OWNER), OVERRIDE_OFF_ORG, entry))),
  )

  // ── Nobody writes: the documents are the sending engine's state ───────────
  await check(`${name}: an entitled OWNER cannot CREATE a document`, () =>
    assertFails(
      setDoc(
        docOf(as(OWNER), ORG, { name, id: `${entry.id}-new` }),
        entry.data,
      ),
    ),
  )
  await check(
    `${name}: an entitled OWNER cannot UPDATE the seeded document`,
    () =>
      assertFails(
        updateDoc(docOf(as(OWNER), ORG, entry), { updatedBy: OWNER }),
      ),
  )
  await check(
    `${name}: an entitled OWNER cannot DELETE the seeded document`,
    () => assertFails(deleteDoc(docOf(as(OWNER), ORG, entry))),
  )
}

// ── A mailbox credential is closed to every client ──────────────────────────
await check(
  'outreachMailboxCredentials: the entitled OWNER cannot get their org’s credential',
  () => assertFails(getDoc(credentialOf(as(OWNER)))),
)
await check(
  'outreachMailboxCredentials: the entitled OWNER cannot list their org’s credentials by orgId',
  () =>
    assertFails(
      getDocs(
        query(
          collection(as(OWNER), 'outreachMailboxCredentials'),
          where('orgId', '==', ORG),
        ),
      ),
    ),
)
await check(
  'outreachMailboxCredentials: the entitled OWNER cannot write a credential',
  () =>
    assertFails(
      setDoc(credentialOf(as(OWNER), 'mbx-outreach-2'), {
        orgId: ORG,
        mailboxId: 'mbx-outreach-2',
        provider: 'google',
      }),
    ),
)
await check(
  'outreachMailboxCredentials: a STAFF token cannot get a credential',
  () =>
    assertFails(
      getDoc(
        credentialOf(
          env
            .authenticatedContext(STAFF, { staff: true, email_verified: true })
            .firestore(),
        ),
      ),
    ),
)
await check(
  'outreachMailboxCredentials: a SUPER staff token cannot get a credential',
  () =>
    assertFails(
      getDoc(
        credentialOf(
          env
            .authenticatedContext(SUPER_STAFF, {
              staff: true,
              staffRole: 'super',
              email_verified: true,
            })
            .firestore(),
        ),
      ),
    ),
)

// Remove ONLY what this spec seeded — and the documents its write rows would
// have created had a rule let them, so a regression leaves no residue behind
// for the next run to read. Deliberately not `clearFirestore()` — the emulator
// is often shared with a running dev server.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await deleteDoc(credentialOf(db))
  await deleteDoc(credentialOf(db, 'mbx-outreach-2'))
  for (const orgId of [ORG, ENTERPRISE_ORG, OVERRIDE_OFF_ORG]) {
    for (const entry of COLLECTIONS) {
      await deleteDoc(docOf(db, orgId, entry))
      await deleteDoc(
        docOf(db, orgId, { name: entry.name, id: `${entry.id}-new` }),
      )
    }
  }
  for (const [orgId, uid] of seededMembers) {
    await deleteDoc(doc(db, 'orgs', orgId, 'members', uid))
  }
  for (const orgId of [ORG, ENTERPRISE_ORG, OVERRIDE_OFF_ORG]) {
    await deleteDoc(doc(db, 'orgs', orgId))
  }
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(
    `${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`,
  )
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
