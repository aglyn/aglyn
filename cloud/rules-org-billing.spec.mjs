/**
 * AGL-1028. The commercial keys moved off `orgs/{orgId}` into
 * `orgs/{orgId}/billing/stripe`, gated on `canManageOrg()`.
 *
 * The point of the move is one specific reader: a SCOPED SITE COLLABORATOR.
 * Adding one writes a real org membership (that is what lets them into the
 * console), so `isOrgMember()` is true for them — and the org doc is readable
 * by any member, because it carries the `plan`/`entitlements` every console
 * surface gates on. Firestore has no field-level reads, so until now that same
 * read handed a contractor invited to one microsite the workspace's Stripe
 * customer id, subscription status, price and seat add-ons.
 *
 * This asserts the new boundary in BOTH directions: managers keep their access,
 * collaborators lose the billing keys, and — the control that matters most —
 * collaborators keep reading the org doc itself. A version of this change that
 * locked them out of `plan` would pass a naive "collaborator is denied" test
 * while breaking every site they were invited to.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-org-billing.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'

const ORG = 'org-billing-test'
const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const ORG_VIEWER = 'uid-org-viewer'
const COLLABORATOR = 'uid-collaborator'
const OUTSIDER = 'uid-outsider'
const CUSTOMER_ID = 'cus_TestCustomer'

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: 8082,
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

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), {
    name: 'Billing Test',
    slug: 'billing-test',
    plan: 'pro',
    // Stays on the org doc on purpose — the dunning banner is shown to every
    // member, and this string carries no amount, price id or customer id.
    billingStatus: 'past_due',
    suspendedAt: null,
  })
  await setDoc(doc(db, 'orgs', ORG, 'billing', 'stripe'), {
    stripeCustomerId: CUSTOMER_ID,
    subscription: { status: 'past_due', priceId: 'price_123', interval: 'month' },
    seatAddons: { managers: 2 },
  })
  await setDoc(doc(db, 'stripeCustomers', CUSTOMER_ID), { orgId: ORG })

  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), {
    role: 'owner',
    allHosts: true,
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), {
    role: 'admin',
    allHosts: true,
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', ORG_VIEWER), {
    role: 'viewer',
    allHosts: true,
  })
  // A site collaborator: a real membership, scoped to one host. `role: 'editor'`
  // here is NOT an org-wide editor — `allHosts: false` is what makes it scoped.
  await setDoc(doc(db, 'orgs', ORG, 'members', COLLABORATOR), {
    role: 'editor',
    allHosts: false,
    hostAccess: { 'host-abc': 'editor' },
  })
})

const as = (uid) =>
  env.authenticatedContext(uid, { email_verified: true }).firestore()

const billingDoc = (db) => doc(db, 'orgs', ORG, 'billing', 'stripe')

// ── Managers keep their access ──────────────────────────────────────────────
await check('an OWNER reads the billing doc', () =>
  assertSucceeds(getDoc(billingDoc(as(OWNER)))),
)
await check('an ADMIN reads the billing doc', () =>
  assertSucceeds(getDoc(billingDoc(as(ADMIN)))),
)

// ── The whole point of AGL-1028 ─────────────────────────────────────────────
await check('a scoped COLLABORATOR cannot read the billing doc', () =>
  assertFails(getDoc(billingDoc(as(COLLABORATOR)))),
)
await check('an org-wide VIEWER cannot read the billing doc', () =>
  assertFails(getDoc(billingDoc(as(ORG_VIEWER)))),
)
await check('an OUTSIDER cannot read the billing doc', () =>
  assertFails(getDoc(billingDoc(as(OUTSIDER)))),
)

// ── The control that stops this becoming a lockout ──────────────────────────
// If these fail, the change is worse than the bug: a collaborator who cannot
// read `plan`/`entitlements` is locked out of the site they were invited to.
await check('CONTROL — a COLLABORATOR still reads the org doc', () =>
  assertSucceeds(getDoc(doc(as(COLLABORATOR), 'orgs', ORG))),
)
await check('CONTROL — an org-wide VIEWER still reads the org doc', () =>
  assertSucceeds(getDoc(doc(as(ORG_VIEWER), 'orgs', ORG))),
)
// And the org doc must genuinely still be the fallback the banner reads from,
// not an empty shell — `billingStatus` is what keeps dunning working for the
// members who just lost `subscription`.
await check('CONTROL — the org doc a collaborator reads carries billingStatus', async () => {
  const snapshot = await getDoc(doc(as(COLLABORATOR), 'orgs', ORG))
  if (snapshot.get('billingStatus') !== 'past_due') {
    throw new Error(`expected billingStatus past_due, got ${snapshot.get('billingStatus')}`)
  }
})

// ── Nothing is client-writable, and the reverse index is invisible ──────────
await check('an OWNER cannot WRITE the billing doc', () =>
  assertFails(setDoc(billingDoc(as(OWNER)), { stripeCustomerId: 'cus_evil' })),
)
await check('an OWNER cannot read the stripeCustomers index', () =>
  assertFails(getDoc(doc(as(OWNER), 'stripeCustomers', CUSTOMER_ID))),
)
// The correlation this whole issue exists to prevent: customer id -> org.
await check('an OUTSIDER cannot read the stripeCustomers index', () =>
  assertFails(getDoc(doc(as(OUTSIDER), 'stripeCustomers', CUSTOMER_ID))),
)

// Remove ONLY what this spec seeded. Deliberately not `clearFirestore()` — the
// emulator is often shared with a running dev server, and wiping it would take
// that session's data with it.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const ref of [
    doc(db, 'orgs', ORG, 'billing', 'stripe'),
    doc(db, 'orgs', ORG, 'members', OWNER),
    doc(db, 'orgs', ORG, 'members', ADMIN),
    doc(db, 'orgs', ORG, 'members', ORG_VIEWER),
    doc(db, 'orgs', ORG, 'members', COLLABORATOR),
    doc(db, 'orgs', ORG),
    doc(db, 'stripeCustomers', CUSTOMER_ID),
  ]) {
    await deleteDoc(ref)
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
