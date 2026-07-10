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

// Read-only Firestore inventory (AGL-238 cleanup prep): every root
// collection with doc counts, plus subcollections found under each
// document (walked to two levels), so unused/legacy data is visible
// before anything is deleted.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/firestore-inventory.mjs

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore()

async function walk(parent, depth, prefix) {
  const collections = await parent.listCollections()
  for (const collection of collections) {
    const count = (await collection.count().get()).data().count
    console.log(`${'  '.repeat(depth)}${prefix}${collection.id}: ${count} doc(s)`)
    if (depth >= 2 || count === 0) continue
    // Sample up to 3 docs for nested subcollections.
    const docs = await collection.limit(3).get()
    const seen = new Set()
    for (const docSnapshot of docs.docs) {
      for (const sub of await docSnapshot.ref.listCollections()) {
        if (seen.has(sub.id)) continue
        seen.add(sub.id)
        const subCount = (await sub.count().get()).data().count
        console.log(
          `${'  '.repeat(depth + 1)}${collection.id}/${docSnapshot.id}/${sub.id}: ${subCount} doc(s)` +
            (docs.size > 1 ? ' (sampled)' : ''),
        )
        if (depth + 1 < 2) {
          const subDocs = await sub.limit(2).get()
          for (const subDoc of subDocs.docs) {
            for (const deep of await subDoc.ref.listCollections()) {
              const deepCount = (await deep.count().get()).data().count
              console.log(
                `${'  '.repeat(depth + 2)}…/${sub.id}/${subDoc.id}/${deep.id}: ${deepCount} doc(s)`,
              )
            }
          }
        }
      }
    }
  }
}

console.log(`Firestore inventory — project ${projectId}\n`)
await walk(db, 0, '')
console.log('\nDone (read-only).')
