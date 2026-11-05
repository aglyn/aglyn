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
 *
 * The publisher's own writes (AGL-4047) close it: a client update of the
 * workspace's publisher profile asks "Edit the publisher profile"
 * (`marketplace.publisherProfile`) and one of a published listing's copy asks
 * "Manage published listings" (`marketplace.manageListings`), of a member of
 * the publishing workspace, read off their stamped permissions with the
 * owner and admin roles as the default — exactly who the role lists let in
 * before. Half the rows are lockout controls: the owner and admin with no
 * stamp, and the admin whose stamp was written without the key, are what
 * every publisher looks like today.
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
  updateDoc,
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

/** The publishing workspace's members (AGL-4047), each as the projection writes them. */
const PUBLISHER_ORG = 'pub-org'
const PROFILE_KEY = 'marketplace.publisherProfile'
const LISTINGS_KEY = 'marketplace.manageListings'
const PUBLISHER_MEMBERS = {
  'pub-owner': { role: 'owner', allHosts: true },
  'pub-admin': { role: 'admin', allHosts: true },
  // Stamped before the keys existed: the map carries others, not these.
  'pub-admin-stamped': { role: 'admin', allHosts: true, resolvedPermissions: { 'data.manage': true } },
  'pub-editor': { role: 'editor', allHosts: true },
  'pub-viewer': { role: 'viewer', allHosts: true },
  // A custom role granted both: the projection stamped them.
  'pub-editor-granted': {
    role: 'editor',
    allHosts: true,
    resolvedPermissions: { [PROFILE_KEY]: true, [LISTINGS_KEY]: true },
  },
  // A member's own override, on a member the projection never stamped.
  'pub-viewer-override': { role: 'viewer', allHosts: true, permissions: { [LISTINGS_KEY]: true } },
  // An admin a custom role took both from.
  'pub-admin-revoked': {
    role: 'admin',
    allHosts: true,
    resolvedPermissions: { [PROFILE_KEY]: false, [LISTINGS_KEY]: false },
  },
}

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
  // The publishing workspace (AGL-4047), its profile and one listing.
  for (const [uid, member] of Object.entries(PUBLISHER_MEMBERS)) {
    await setDoc(doc(db, 'orgs', PUBLISHER_ORG, 'members', uid), member)
  }
  await setDoc(doc(db, 'orgs', 'other-org', 'members', 'pub-outsider'), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'publisherProfiles', PUBLISHER_ORG), { handle: 'pub-test', displayName: 'Pub Test' })
  await setDoc(doc(db, 'marketplaceListings', 'l-pub'), { profileId: PUBLISHER_ORG, displayName: 'Pub listing' })
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

// THE PUBLISHER'S OWN WRITES (AGL-4047).
const as = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore()
const profileEdit = (db) =>
  updateDoc(doc(db, 'publisherProfiles', PUBLISHER_ORG), { accentNote: 'blue' })
const listingEdit = (db) => updateDoc(doc(db, 'marketplaceListings', 'l-pub'), { tags: ['forms'] })
const PUBLISHER_CASES = [
  // [uid, may edit the profile, may edit the listing, why]
  ['pub-owner', true, true, 'the owner, no stamp: the default'],
  ['pub-admin', true, true, 'an admin, no stamp: the default'],
  ['pub-admin-stamped', true, true, 'an admin stamped without the keys: the default'],
  ['pub-editor', false, false, 'an editor, no stamp: the default refuses'],
  ['pub-viewer', false, false, 'a viewer, no stamp: the default refuses'],
  ['pub-editor-granted', true, true, 'an editor a custom role granted both'],
  ['pub-viewer-override', false, true, 'a viewer whose own override grants the listings'],
  ['pub-admin-revoked', false, false, 'an admin a custom role took both from'],
  ['pub-outsider', false, false, 'the owner of another workspace'],
]
for (const [uid, profile, listing, why] of PUBLISHER_CASES) {
  await check(`${why}: ${profile ? 'edits' : 'cannot edit'} the publisher profile`, () =>
    (profile ? assertSucceeds : assertFails)(profileEdit(as(uid))),
  )
  await check(`${why}: ${listing ? 'edits' : 'cannot edit'} the listing's copy`, () =>
    (listing ? assertSucceeds : assertFails)(listingEdit(as(uid))),
  )
}
await check('the key opens no server-owned field: a granted editor cannot rename the handle', () =>
  assertFails(updateDoc(doc(as('pub-editor-granted'), 'publisherProfiles', PUBLISHER_ORG), { handle: 'taken-over' })),
)
await check('the key opens no server-owned field: a granted editor cannot set the price', () =>
  assertFails(updateDoc(doc(as('pub-editor-granted'), 'marketplaceListings', 'l-pub'), { priceUsd: 0 })),
)
await check('a stranger signed out edits neither', async () => {
  await assertFails(profileEdit(anon))
  await assertFails(listingEdit(anon))
})

await env.cleanup()
for (const [status, label, detail] of results) {
  console.log(`${status} ${label}${detail ? `\n       ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0].trim() === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
