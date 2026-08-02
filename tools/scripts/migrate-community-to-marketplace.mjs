/**
 * AGL-975: copy `community*` collections to `marketplace*`.
 *
 * "Community" is being freed up for a public forum, so the marketplace's
 * collections stop borrowing the word. Document IDS ARE PRESERVED, which is
 * what makes this safe: every install pin (`orgs/{id}/installs/{listingId}`),
 * revocation (`revocations/{listingId}`) and artifact path refers to a listing
 * by id, and none of them change.
 *
 * Copy, never move. The source collections are left untouched so a cutover can
 * be reverted by redeploying the previous build, and are deleted only after
 * production has been verified reading the new ones.
 *
 * Idempotent: re-running overwrites the destination with the current source.
 *
 *   node tools/scripts/migrate-community-to-marketplace.mjs --dry-run
 *   node tools/scripts/migrate-community-to-marketplace.mjs
 *   node tools/scripts/migrate-community-to-marketplace.mjs --verify
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PAIRS = [
  ['communityListings', 'marketplaceListings'],
  ['communityPurchases', 'marketplacePurchases'],
  ['communityReports', 'marketplaceReports'],
  ['communityArtifactBases', 'marketplaceArtifactBases'],
]

const dryRun = process.argv.includes('--dry-run')
const verifyOnly = process.argv.includes('--verify')

const env = Object.fromEntries(
  readFileSync('apps/console/.env.production.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore()

/** Copy one document and every subcollection beneath it, preserving ids. */
async function copyDoc(fromRef, toRef) {
  const snap = await fromRef.get()
  let docs = 0
  if (snap.exists) {
    if (!dryRun) await toRef.set(snap.data())
    docs += 1
  }
  for (const sub of await fromRef.listCollections()) {
    const children = await sub.get()
    for (const child of children.docs) {
      docs += await copyDoc(child.ref, toRef.collection(sub.id).doc(child.id))
    }
  }
  return docs
}

/** Deep-compare a source tree against its destination. */
async function verifyDoc(fromRef, toRef, problems) {
  const [a, b] = await Promise.all([fromRef.get(), toRef.get()])
  if (a.exists && !b.exists) {
    problems.push(`MISSING ${toRef.path}`)
    return
  }
  if (a.exists && JSON.stringify(a.data()) !== JSON.stringify(b.data())) {
    problems.push(`DIFFERS ${toRef.path}`)
  }
  for (const sub of await fromRef.listCollections()) {
    for (const child of (await sub.get()).docs) {
      await verifyDoc(child.ref, toRef.collection(sub.id).doc(child.id), problems)
    }
  }
}

let total = 0
const problems = []
for (const [from, to] of PAIRS) {
  const source = await db.collection(from).get()
  console.log(`${from} → ${to}: ${source.size} top-level doc(s)`)
  for (const doc of source.docs) {
    const target = db.collection(to).doc(doc.id)
    if (verifyOnly) {
      await verifyDoc(doc.ref, target, problems)
    } else {
      const n = await copyDoc(doc.ref, target)
      total += n
      console.log(`   ${doc.id}: ${n} doc(s)${dryRun ? ' (dry run)' : ''}`)
    }
  }
}

if (verifyOnly) {
  if (problems.length) {
    console.log('\nPROBLEMS:')
    for (const p of problems) console.log('  ' + p)
    process.exit(1)
  }
  console.log('\nverified: every source document exists at the destination and matches')
} else {
  console.log(`\n${dryRun ? 'would copy' : 'copied'} ${total} document(s)`)
}
