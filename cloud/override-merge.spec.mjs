/**
 * AGL-1109. What does a `{ merge: true }` write do to a nested map?
 *
 * The staff override dialog builds `entitlements.features` from the flags that
 * are NOT set to "Inherit", and writes it with merge. The assumption was that
 * a key left out of that map would be removed. It is not: a merge writes
 * nested maps key by key, so an omitted key keeps whatever was stored.
 *
 * That is why only "Force off" appeared to work — writing an explicit `false`
 * is a change a merge can see, while omitting the key is not a change at all.
 * A staff member could turn an override off but never remove it.
 *
 * This pins the mechanism, in both directions, against a real Firestore.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/override-merge.spec.mjs
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8082'
initializeApp({ projectId: 'aglyn-main' })
const db = getFirestore()
const ref = db.collection('orgs').doc('zz-override-merge')

const results = []
const check = (label, pass, detail = '') =>
  results.push([pass ? 'ok  ' : 'FAIL', label, detail])

const seed = async () =>
  ref.set({
    plan: 'pro',
    entitlements: { maxHosts: 25, features: { whiteLabel: true, apiAccess: true } },
  })

// 1. The bug: omitting a key from the nested map changes nothing.
await seed()
await ref.set(
  { entitlements: { maxHosts: 25, features: { apiAccess: true } } },
  { merge: true },
)
let after = (await ref.get()).get('entitlements')
check(
  'THE BUG — an omitted nested key survives a merge',
  after.features.whiteLabel === true,
  `whiteLabel is ${JSON.stringify(after.features.whiteLabel)} (expected: still true)`,
)

// 2. The fix: a delete sentinel in the nested map removes it.
await seed()
await ref.set(
  {
    entitlements: {
      maxHosts: 25,
      features: { apiAccess: true, whiteLabel: FieldValue.delete() },
    },
  },
  { merge: true },
)
after = (await ref.get()).get('entitlements')
check(
  'THE FIX — a delete sentinel removes it',
  !('whiteLabel' in after.features),
  `features = ${JSON.stringify(after.features)}`,
)
check(
  'and leaves the other override alone',
  after.features.apiAccess === true && after.maxHosts === 25,
  `features = ${JSON.stringify(after.features)}, maxHosts = ${after.maxHosts}`,
)

// 3. Clearing every flag while a quota override remains.
await seed()
await ref.set(
  {
    entitlements: {
      maxHosts: 25,
      features: {
        whiteLabel: FieldValue.delete(),
        apiAccess: FieldValue.delete(),
      },
    },
  },
  { merge: true },
)
after = (await ref.get()).get('entitlements')
check(
  'clearing every flag leaves no feature overrides',
  Object.keys(after.features ?? {}).length === 0,
  `features = ${JSON.stringify(after.features)}`,
)
check(
  'and does NOT take the quota override with it',
  after.maxHosts === 25,
  `maxHosts = ${after.maxHosts}`,
)

// 4. Clearing everything deletes the map outright — the no-overrides path.
await seed()
await ref.set({ entitlements: FieldValue.delete() }, { merge: true })
check(
  'no overrides at all removes `entitlements` entirely',
  (await ref.get()).get('entitlements') === undefined,
)

await ref.delete()
for (const [status, label, detail] of results) {
  console.log(`${status} ${label}${detail ? `\n       ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0].trim() === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
