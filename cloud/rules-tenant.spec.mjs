/**
 * AGL-1143. Does the real rules file allow a GCIP tenant (SSO) user to read
 * its own documents?
 *
 * Every client-side Firestore read is denied for the one live SSO account,
 * across unrelated collections, on a session minted minutes earlier. The rule
 * involved is `request.auth.uid == userId`, which is as permissive as it gets
 * — so either the rules engine does not see what we think it sees for a
 * tenant token, or the denial is coming from somewhere other than the rules.
 *
 * This answers that against the actual `firebase-firestore.rules`, with a
 * synthetic token shaped exactly like the measured production one.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-tenant.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const UID = 'IHumyGGhGxZKjVV26qCRx5Okf573'
const ORG = 'jWmGooWE3L'

/** Shaped from the real decoded token measured on production 2026-08-01. */
const TENANT_CLAIMS = {
  email: 'zach@aglyn.com',
  email_verified: true,
  firebase: {
    tenant: 'aglyn-org-y5v14',
    sign_in_provider: 'saml.aglyn-workspace',
    sign_in_attributes: { firstName: 'Zach', lastName: 'Gover' },
  },
}

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

// Seed with rules disabled.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'users', UID), { firstName: 'Zach' })
  await setDoc(doc(db, 'orgs', ORG), { name: 'Aglyn LLC', slug: 'aglyn-org' })
  await setDoc(doc(db, 'orgs', ORG, 'members', UID), { role: 'owner' })
})

// The control: an ordinary, non-tenant user. If this fails, the harness is
// wrong and nothing below means anything.
const plain = env.authenticatedContext(UID, { email_verified: true })
await check('CONTROL — a plain user reads its own users/{uid}', () =>
  assertSucceeds(getDoc(doc(plain.firestore(), 'users', UID))),
)

// The subject.
const tenant = env.authenticatedContext(UID, TENANT_CLAIMS)
await check('a TENANT user reads its own users/{uid}', () =>
  assertSucceeds(getDoc(doc(tenant.firestore(), 'users', UID))),
)
await check('a TENANT user reads its org doc', () =>
  assertSucceeds(getDoc(doc(tenant.firestore(), 'orgs', ORG))),
)
await check('a TENANT user reads its own roster row', () =>
  assertSucceeds(getDoc(doc(tenant.firestore(), 'orgs', ORG, 'members', UID))),
)

// The negative control: rules must still deny someone else's profile, or a
// green run above would just mean "the rules allow everything".
await check("NEGATIVE — a tenant user CANNOT read another user's profile", () =>
  assertFails(getDoc(doc(tenant.firestore(), 'users', 'someone-else'))),
)

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
