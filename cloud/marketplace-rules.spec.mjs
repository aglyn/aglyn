/**
 * AGL-975. The marketplace collections were renamed off their old name,
 * which is being freed for a public forum.
 *
 * The cutover ran duplicate rule blocks under both names until production was
 * confirmed reading the new ones; those duplicates are now collapsed, so this
 * asserts the END state: the new names carry the rules, and the retired ones
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
// a "NEW" label — true, and hollow, once the AGL-975 rename made both strings
// equal. The retired name needs no case here: it is matched by no rule, and
// the naming guard in apps/console/specs fails on the mere presence of the
// old word in this file or in the rules it loads.

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
