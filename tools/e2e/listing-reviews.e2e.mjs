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
// Exercises the reviews API (AGL-655) against the emulators. No browser:
// every rule worth testing lives in the route, and asserting on Firestore
// is a stronger claim than asserting on a rendered star.
//
// Setup (see docs/E2E_LOCAL.md):
//   cd cloud && npx -y firebase-tools@13 emulators:start \
//     --config firebase.e2e.json --project aglyn-main --only auth,firestore
//   npm run seed:e2e
//   npm run serve:console:emulated
//
// Then:  npm run e2e:reviews

import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8082'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099'

if (!getApps().length) initializeApp({ projectId: 'aglyn-main' })
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const tokens = new Map()
async function idToken(uid) {
  if (tokens.has(uid)) return tokens.get(uid)
  const customToken = await getAuth().createCustomToken(uid)
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  const payload = await response.json()
  if (!payload.idToken) throw new Error(`token exchange failed for ${uid}`)
  tokens.set(uid, payload.idToken)
  return payload.idToken
}

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function review(uid, body, method = 'POST') {
  const response = await fetch(`${BASE_URL}/api/marketplace/reviews`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await idToken(uid)}`,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

const LISTING = 'e2e-reviewed-listing'
const PUBLISHER_ORG = 'e2e-owner' // the org e2e-owner belongs to
const RATER = 'e2e-nonstaff-owner' // owns a different org

const listingRef = db.collection('marketplaceListings').doc(LISTING)
await listingRef.set({
  displayName: 'Reviewed Thing',
  artifactType: 'component',
  profileId: PUBLISHER_ORG,
  latestVersion: 1,
  priceUsd: 0,
  createdAt: new Date(),
})
// Start from a clean slate so counts are absolute, not cumulative.
const existingReviews = await listingRef.collection('reviews').get()
await Promise.all(existingReviews.docs.map((entry) => entry.ref.delete()))
await listingRef.update({
  ratingSum: 0,
  ratingCount: 0,
  commentCount: 0,
  ratingAverage: 0,
})
await db
  .collection('orgs')
  .doc('e2e-nonstaff-owner')
  .collection('installs')
  .doc(LISTING)
  .delete()
  .catch(() => undefined)

// 1. The publishing org cannot review its own listing.
const selfReview = await review('e2e-owner', { listingId: LISTING, rating: 5 })
check(
  'publisher cannot review own listing',
  selfReview.status === 403,
  `${selfReview.status} ${selfReview.body.error ?? ''}`,
)

// 2. A non-installer may comment but not rate.
const rateWithoutInstall = await review(RATER, { listingId: LISTING, rating: 5 })
check(
  'rating refused without an install',
  rateWithoutInstall.status === 403,
  `${rateWithoutInstall.status}`,
)
const commentOnly = await review(RATER, {
  listingId: LISTING,
  comment: 'Does this support multi-region?',
})
check('comment allowed without an install', commentOnly.status === 200)
check(
  'comment is not marked as a verified install',
  commentOnly.body.verifiedInstaller === false,
  JSON.stringify(commentOnly.body),
)

let listing = await listingRef.get()
check(
  'a comment moves no rating numbers',
  Number(listing.get('ratingCount')) === 0 &&
    Number(listing.get('commentCount')) === 1,
  `ratingCount=${listing.get('ratingCount')} commentCount=${listing.get('commentCount')}`,
)

// 3. With an install pin, rating is allowed.
await db
  .collection('orgs')
  .doc('e2e-nonstaff-owner')
  .collection('installs')
  .doc(LISTING)
  .set({ listingId: LISTING, version: 1, installedAt: new Date() })

const rated = await review(RATER, {
  listingId: LISTING,
  rating: 4,
  comment: 'Worked well.',
})
check('rating allowed once installed', rated.status === 200)
check('marked as verified installer', rated.body.verifiedInstaller === true)

listing = await listingRef.get()
check(
  'aggregates updated',
  Number(listing.get('ratingCount')) === 1 &&
    Number(listing.get('ratingAverage')) === 4,
  `count=${listing.get('ratingCount')} avg=${listing.get('ratingAverage')}`,
)

// 4. Re-submitting edits rather than stacking.
const edited = await review(RATER, { listingId: LISTING, rating: 2 })
check('re-submitting succeeds', edited.status === 200)
listing = await listingRef.get()
const reviewCount = (await listingRef.collection('reviews').get()).size
check(
  'edit replaces rather than stacking',
  reviewCount === 1 && Number(listing.get('ratingCount')) === 1,
  `docs=${reviewCount} count=${listing.get('ratingCount')}`,
)
check(
  'average follows the edit',
  Number(listing.get('ratingAverage')) === 2,
  `avg=${listing.get('ratingAverage')}`,
)

// 5. Out-of-range ratings are clamped, not rejected outright.
const clamped = await review(RATER, { listingId: LISTING, rating: 99 })
check('out-of-range rating clamped to 5', clamped.body.rating === 5)

// 6. A moderator's hide survives the author editing their review.
await listingRef.collection('reviews').doc(RATER).update({ hidden: true })
await review(RATER, { listingId: LISTING, rating: 5, comment: 'Trying again' })
const afterEdit = await listingRef.collection('reviews').doc(RATER).get()
check(
  'hidden survives an author edit',
  afterEdit.get('hidden') === true,
  `hidden=${afterEdit.get('hidden')}`,
)

// 7. Removing a review takes its numbers with it.
const removed = await review(RATER, { listingId: LISTING }, 'DELETE')
check('delete succeeds', removed.status === 200)
listing = await listingRef.get()
check(
  'aggregates return to zero',
  Number(listing.get('ratingCount')) === 0 &&
    Number(listing.get('ratingAverage')) === 0 &&
    Number(listing.get('commentCount')) === 0,
  `count=${listing.get('ratingCount')} avg=${listing.get('ratingAverage')} comments=${listing.get('commentCount')}`,
)

// 8. Unauthenticated writes are refused.
const anon = await fetch(`${BASE_URL}/api/marketplace/reviews`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ listingId: LISTING, rating: 5 }),
})
check('unauthenticated review refused', anon.status === 401, `${anon.status}`)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
