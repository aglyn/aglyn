/**
 * AGL-975. The cutover duplicates four `marketplace*` rule blocks under
 * `marketplace*` names. Two things need proving, and the second is the one
 * that nearly went wrong: an earlier attempt used a single
 * `match /{collection}/{id}` to serve both names, which is a WILDCARD over
 * every top-level collection — and `marketplaceListings` is `allow read: if
 * true`, so it would have made every unmatched collection world-readable.
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
  await setDoc(doc(db, 'marketplaceListings', 'l1'), { displayName: 'Old' })
  await setDoc(doc(db, 'marketplaceListings', 'l1'), { displayName: 'New' })
  await setDoc(doc(db, 'apiKeys', 'secret1'), { hash: 'nope' })
  await setDoc(doc(db, 'adminAudit', 'a1'), { action: 'x' })
})

const anon = env.unauthenticatedContext().firestore()

await check('a stranger reads the OLD listings collection (unchanged)', () =>
  assertSucceeds(getDoc(doc(anon, 'marketplaceListings', 'l1'))),
)
await check('a stranger reads the NEW listings collection', () =>
  assertSucceeds(getDoc(doc(anon, 'marketplaceListings', 'l1'))),
)
await check('neither is writable by a stranger', () =>
  assertFails(setDoc(doc(anon, 'marketplaceListings', 'l1'), { x: 1 })),
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
