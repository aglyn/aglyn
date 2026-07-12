/**
 * Realm-trust key rotation: re-sign every granted version (AGL-437).
 *
 *   PLUGIN_TRUST_PRIVATE_KEY=<new base64 pkcs8> \
 *   GOOGLE_APPLICATION_CREDENTIALS=... \
 *   node tools/scripts/resign-realm-plugins.mjs [--dry-run]
 *
 * Walks every `pluginVersions` doc carrying `trust: 'realm'` and replaces
 * its Ed25519 `signature` with one made by the NEW private key. Rotation
 * order (see docs/PLUGIN_LOADING.md): generate the new pair → run this →
 * deploy the new public key everywhere → retire the old private key.
 * Loaders verify against whichever public key a deployment carries, so
 * re-sign BEFORE swapping the public key to avoid a window where nothing
 * loads.
 */
import { createPrivateKey, sign as nodeSign } from 'node:crypto'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const dryRun = process.argv.includes('--dry-run')
const privateKeyBase64 = process.env.PLUGIN_TRUST_PRIVATE_KEY
if (!privateKeyBase64) {
  console.error('Set PLUGIN_TRUST_PRIVATE_KEY to the NEW base64 PKCS8 key')
  process.exit(1)
}
const privateKey = createPrivateKey({
  key: Buffer.from(privateKeyBase64, 'base64'),
  format: 'der',
  type: 'pkcs8',
})

initializeApp({ credential: applicationDefault() })
const firestore = getFirestore()

const snapshot = await firestore
  .collectionGroup('pluginVersions')
  .where('trust', '==', 'realm')
  .get()

console.log(`${snapshot.size} realm-trusted version(s)`)
for (const doc of snapshot.docs) {
  const sha256 = String(doc.get('sha256') ?? '')
  if (!sha256) {
    console.warn(`  SKIP ${doc.ref.path} — no sha256`)
    continue
  }
  const signature = nodeSign(null, Buffer.from(sha256), privateKey).toString(
    'base64',
  )
  if (dryRun) {
    console.log(`  would re-sign ${doc.ref.path}`)
  } else {
    await doc.ref.set(
      { signature, resignedAt: new Date() },
      { merge: true },
    )
    console.log(`  re-signed ${doc.ref.path}`)
  }
}
console.log(dryRun ? 'Dry run complete.' : 'Done — now swap the public keys.')
