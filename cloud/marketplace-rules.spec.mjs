/**
 * AGL-975. The marketplace collections were renamed off the word `community`,
 * which is being freed for a public forum.
 *
 * The cutover ran duplicate rule blocks under both names until production was
 * confirmed reading the new ones; those duplicates are now collapsed, so this
 * asserts the END state: the new names carry the rules, and the retired names
 * are matched by NOTHING — which in Firestore means denied, the default that
 * makes deleting the old collections safe.
 *
 * The wildcard checks are the reason this file exists at all. An earlier
 * attempt served both names from a single `match /{collection}/{id}`, which is
 * a wildcard over every top-level collection — and `marketplaceListings` is
 * `allow read: if true`, so it would have made `apiKeys` (API token hashes)
 * and `adminAudit` world-readable. They are kept as standing regressions.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/marketplace-rules.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

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
    results.push(['ok  ', label])
  } catch (error) {
    results.push(['FAIL', label, String(error).slice(0, 140)])
  }
}

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore()
  await setDoc(doc(db, 'marketplaceListings', 'l1'), { displayName: 'New' })
  // Seeded past the rules on purpose: the retired name must be unreadable
  // even when a document is genuinely sitting there. Asserting a denial over
  // an empty collection would pass for the wrong reason.
  await setDoc(doc(db, 'communityListings', 'l1'), { displayName: 'Retired' })
  await setDoc(doc(db, 'apiKeys', 'secret1'), { hash: 'nope' })
  await setDoc(doc(db, 'adminAudit', 'a1'), { action: 'x' })
})

const anon = env.unauthenticatedContext().firestore()

await check('a stranger reads the listings collection', () =>
  assertSucceeds(getDoc(doc(anon, 'marketplaceListings', 'l1'))),
)
await check('a stranger cannot write it', () =>
  assertFails(setDoc(doc(anon, 'marketplaceListings', 'l1'), { x: 1 })),
)
// The pair above used to assert the same collection twice under an "OLD" and
// a "NEW" label — true, and hollow, once the rename made both strings equal.
await check('the RETIRED community name is matched by no rule at all', () =>
  assertFails(getDoc(doc(anon, 'communityListings', 'l1'))),
)

// THE REGRESSION THIS EXISTS FOR.
await check('a wildcard did NOT leak apiKeys to the world', () =>
  assertFails(getDoc(doc(anon, 'apiKeys', 'secret1'))),
)
await check('a wildcard did NOT leak adminAudit to the world', () =>
  assertFails(getDoc(doc(anon, 'adminAudit', 'a1'))),
)
await check('a wildcard did NOT open an entirely unknown collection', () =>
  assertFails(getDoc(doc(anon, 'someCollectionNobodyDeclared', 'x'))),
)

await env.cleanup()
for (const [status, label, detail] of results) {
  console.log(`${status} ${label}${detail ? `\n       ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0].trim() === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
