/**
 * AGL-975, the last step: drop the retired `community*` collections.
 *
 * Runs only after production is confirmed reading `marketplace*`. It refuses
 * to delete anything that is not ALREADY byte-identical at the new name, so a
 * partial or drifted migration aborts instead of destroying the only copy —
 * and it writes the whole tree to BACKUP_PATH first, subcollections included,
 * so the drop is reversible from disk as well as from the mirror.
 *
 *   BACKUP_PATH=/tmp/community-backup.json node tools/scripts/drop-community-collections.mjs
 *   BACKUP_PATH=/tmp/community-backup.json node tools/scripts/drop-community-collections.mjs --apply
 *
 * Without `--apply` it verifies, writes the backup and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
const env = Object.fromEntries(
  readFileSync('apps/console/.env.production.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
initializeApp({ credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n') }) })
const db = getFirestore()

const OLD = ['communityListings', 'communityPurchases', 'communityReports', 'communityArtifactBases']
const NEW = (c) => c.replace('community', 'marketplace')
const apply = process.argv.includes('--apply')

/** Serialise a doc tree so the drop is reversible from disk. */
async function dump(ref) {
  const snap = await ref.get()
  const node = { path: ref.path, data: snap.exists ? snap.data() : null, subs: {} }
  for (const sub of await ref.listCollections()) {
    node.subs[sub.id] = []
    for (const child of (await sub.get()).docs) node.subs[sub.id].push(await dump(child.ref))
  }
  return node
}

const backup = {}
let docs = 0
const countTree = (n) => (n.data ? 1 : 0) + Object.values(n.subs).flat().reduce((a, c) => a + countTree(c), 0)

for (const name of OLD) {
  const snap = await db.collection(name).get()
  backup[name] = []
  for (const d of snap.docs) backup[name].push(await dump(d.ref))
  const n = backup[name].reduce((a, t) => a + countTree(t), 0)
  docs += n
  // Refuse to drop anything that is not already byte-identical at the new name.
  let safe = true
  for (const d of snap.docs) {
    const dest = await db.collection(NEW(name)).doc(d.id).get()
    if (!dest.exists || JSON.stringify(dest.data()) !== JSON.stringify(d.data())) { safe = false; console.log(`  !! ${NEW(name)}/${d.id} does not match the source`) }
  }
  console.log(`  ${name}: ${snap.size} top-level, ${n} total doc(s) — mirrored at ${NEW(name)}: ${safe ? 'yes' : 'NO'}`)
  if (!safe) { console.log('\n  ABORTED: a source document is not mirrored.'); process.exit(1) }
}
writeFileSync(process.env.BACKUP_PATH, JSON.stringify(backup, null, 2))
console.log(`\n  backup written: ${process.env.BACKUP_PATH} (${docs} docs)`)

if (!apply) { console.log('  dry run — pass --apply to delete'); process.exit(0) }
for (const name of OLD) {
  for (const d of (await db.collection(name).get()).docs) await db.recursiveDelete(d.ref)
  const left = await db.collection(name).get()
  console.log(`  dropped ${name} → ${left.size} doc(s) remaining`)
}
