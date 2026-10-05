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
 *
 * The marketplace LISTS are queries since AGL-3321, and a rules-shaped list
 * is judged against the query, not the documents — so the second half asks
 * each list's query as the reader who really runs it: the browse shelf as a
 * stranger (anonymous or signed in), and the licenses tab as an org member
 * and as the buyer. The staff review and report queues read through Admin-SDK
 * routes, which the rules do not see. `FIRESTORE_EMULATOR_PORT` points it at
 * an emulator on another port.
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8082),
    // The comment-stripped artifact is what deploys (AGL-3544).
    rules: readFileSync('cloud/firebase-firestore.deploy.rules', 'utf8'),
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
  // The licenses tab's fixtures (AGL-3321): an org, a member and a stranger.
  await setDoc(doc(db, 'orgs', 'org1', 'members', 'member1'), { role: 'viewer' })
  await setDoc(doc(db, 'marketplacePurchases', 'cs_1'), {
    listingId: 'l1',
    buyerUid: 'member1',
    buyerOrgId: 'org1',
    sellerOrgId: 'seller1',
    refundedAt: null,
  })
  await setDoc(doc(db, 'marketplacePurchases', 'cs_2'), {
    listingId: 'l1',
    buyerUid: 'member1',
    buyerOrgId: null,
    sellerOrgId: 'seller1',
    refundedAt: null,
  })
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

// THE LISTS, AS THEIR READERS RUN THEM (AGL-3321).
const signedIn = env.authenticatedContext('member1', { email_verified: true }).firestore()
const stranger = env.authenticatedContext('stranger1', { email_verified: true }).firestore()
const listings = (db) => collection(db, 'marketplaceListings')
for (const [who, db] of [
  ['a stranger', anon],
  ['a signed-in reader', signedIn],
]) {
  await check(`${who} runs the browse shelf's audience query`, () =>
    assertSucceeds(
      getDocs(
        query(
          listings(db),
          where('browseAudience', 'array-contains-any', ['*', 'org1']),
          orderBy('createdAt', 'desc'),
          limit(26),
        ),
      ),
    ),
  )
  await check(`${who} runs browse's search, category and sort`, () =>
    assertSucceeds(
      getDocs(
        query(
          listings(db),
          where('browseTokens', 'array-contains-any', ['*~prom', 'org1~prom']),
          where('category', '==', 'marketing'),
          orderBy('installCount', 'desc'),
          limit(26),
        ),
      ),
    ),
  )
}
await check('a reader runs the licenses search’s listing-name lookup', () =>
  assertSucceeds(
    getDocs(
      query(
        listings(signedIn),
        where('nameTokens', 'array-contains', 'prom'),
        orderBy(documentId()),
        limit(31),
      ),
    ),
  ),
)
const purchases = (db) => collection(db, 'marketplacePurchases')
await check('an org member lists the licenses the workspace holds', () =>
  assertSucceeds(
    getDocs(
      query(
        purchases(signedIn),
        where('buyerOrgId', '==', 'org1'),
        where('refundedAt', '==', null),
        where('listingId', 'in', ['l1']),
        where('buyerUid', '==', 'member1'),
        orderBy(documentId()),
        limit(26),
      ),
    ),
  ),
)
await check('a buyer lists their own receipts, the every-workspace ones too', () =>
  assertSucceeds(
    getDocs(
      query(
        purchases(signedIn),
        where('buyerUid', '==', 'member1'),
        where('refundedAt', '==', null),
        where('buyerOrgId', '==', null),
        orderBy(documentId()),
        limit(26),
      ),
    ),
  ),
)
await check('a stranger cannot list a workspace’s licenses', () =>
  assertFails(
    getDocs(
      query(
        purchases(stranger),
        where('buyerOrgId', '==', 'org1'),
        where('refundedAt', '==', null),
        orderBy(documentId()),
        limit(26),
      ),
    ),
  ),
)
await check('a stranger cannot list someone else’s receipts', () =>
  assertFails(
    getDocs(
      query(
        purchases(stranger),
        where('buyerUid', '==', 'member1'),
        where('refundedAt', '==', null),
        orderBy(documentId()),
        limit(26),
      ),
    ),
  ),
)

await env.cleanup()
for (const [status, label, detail] of results) {
  console.log(`${status} ${label}${detail ? `\n       ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0].trim() === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
