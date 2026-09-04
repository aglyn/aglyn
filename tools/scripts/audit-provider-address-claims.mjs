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

// READ-ONLY audit of federated `providerData` addresses against the email
// uniqueness index. Writes NOTHING.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-provider-address-claims.mjs [--json]
//
// ## Why this exists
//
// `emailIdentityIndex/{address}` is what stops two accounts holding one
// address. It is claimed in exactly two places — the primary backfill in
// `listAccountEmails`, and `confirmAccountEmail` — and NEITHER of them looks
// at `providerData`. So an address asserted by a federated provider was
// verified by that provider, usable to sign in, and entirely outside the
// guard: absent from `users/{uid}/emails`, holding no index entry, and free
// to be claimed by a different account or already be another account's
// primary.
//
// The consequence is misattribution. Anything mapping address → uid —
// invitation matching, an audit entry's subject, and `sso-jit`, which grants
// ORG MEMBERSHIP from a verified address's domain — resolves to whoever
// claimed the address while a different account authenticates with it.
//
// The session mint now registers provider addresses as they sign in, so this
// closes going forward and backfills each account on its next sign-in. What
// it cannot do is tell you about accounts that have not signed in since, or
// resolve a collision that already exists.
//
// ## It reports and does not fix, deliberately
//
// A collision means two REAL accounts hold one address. Merging them,
// reassigning the index entry, or disabling either is a decision about two
// people's accounts and belongs to whoever owns them — an automated
// tie-break here would pick a winner silently, which is the same class of
// mistake as the silent skip that produced the collisions in the first place.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const asJson = process.argv.includes('--json')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const auth = getAuth()
const firestore = getFirestore()

const normalize = (value) => String(value ?? '').trim().toLowerCase()
const federated = (providerId) => {
  const id = String(providerId ?? '')
  return id !== '' && id !== 'password' && id !== 'phone' && id !== 'anonymous'
}

/*
 * PASS ONE — every account, and every address it holds.
 *
 * `primaryOf` is built from the same sweep rather than from a `getUserByEmail`
 * per address: the directory is already in hand, and one lookup per provider
 * address would be a second full pass' worth of API calls to learn something
 * this loop already saw.
 */
const primaryOf = new Map()
const providerHolders = new Map()
let scanned = 0
let pageToken
do {
  const page = await auth.listUsers(1000, pageToken)
  for (const user of page.users) {
    scanned += 1
    const primary = normalize(user.email)
    if (primary) {
      const holders = primaryOf.get(primary) ?? []
      holders.push(user.uid)
      primaryOf.set(primary, holders)
    }
    for (const provider of user.providerData ?? []) {
      if (!federated(provider.providerId)) continue
      const address = normalize(provider.email)
      if (!address || address === primary) continue
      const holders = providerHolders.get(address) ?? []
      holders.push({ uid: user.uid, providerId: provider.providerId })
      providerHolders.set(address, holders)
    }
  }
  pageToken = page.pageToken
} while (pageToken)

/*
 * PASS TWO — what the index says about each of those addresses.
 *
 * `getAll` in chunks rather than one `get()` each: this is a document-id read,
 * so it needs no query and no index of its own, and the batch keeps a large
 * directory to a bounded number of round trips.
 */
const addresses = [...providerHolders.keys()]
const indexOwner = new Map()
for (let index = 0; index < addresses.length; index += 300) {
  const chunk = addresses.slice(index, index + 300)
  const refs = chunk.map((address) =>
    firestore.collection('emailIdentityIndex').doc(address),
  )
  const docs = await firestore.getAll(...refs)
  docs.forEach((doc, offset) => {
    indexOwner.set(chunk[offset], doc.exists ? String(doc.get('uid') ?? '') : null)
  })
}

const collisions = []
const unclaimed = []
for (const [address, holders] of providerHolders) {
  const owner = indexOwner.get(address) ?? null
  const primaryHolders = primaryOf.get(address) ?? []
  // Every distinct account that holds this address by ANY route.
  const everyHolder = new Set([
    ...holders.map((entry) => entry.uid),
    ...primaryHolders,
    ...(owner ? [owner] : []),
  ])

  if (everyHolder.size > 1) {
    collisions.push({
      address,
      indexOwner: owner,
      primaryHolders,
      providerHolders: holders,
      accounts: [...everyHolder],
    })
    continue
  }
  if (!owner) {
    unclaimed.push({ address, providerHolders: holders })
  }
}

const report = {
  scannedAccounts: scanned,
  providerAddresses: addresses.length,
  // Two accounts or more hold one address. A HUMAN DECISION each — the
  // script names them and stops.
  collisions,
  // Held by exactly one account but outside the index. These close on their
  // own at that account's next sign-in; they are listed so a long tail of
  // dormant accounts is visible rather than assumed empty.
  unclaimed,
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(
    `Scanned ${scanned} accounts; ${addresses.length} federated provider addresses.`,
  )
  console.log(
    `\nCOLLISIONS (${collisions.length}) — more than one account holds the address.`,
  )
  console.log('These are not auto-resolvable: two real accounts are involved.')
  for (const entry of collisions) {
    console.log(`  ${entry.address}`)
    console.log(`    index owner : ${entry.indexOwner ?? '(unclaimed)'}`)
    console.log(`    primary on  : ${entry.primaryHolders.join(', ') || '(none)'}`)
    for (const holder of entry.providerHolders) {
      console.log(`    provider    : ${holder.uid} via ${holder.providerId}`)
    }
  }
  console.log(
    `\nUNCLAIMED (${unclaimed.length}) — one holder, no index entry yet.`,
  )
  console.log('Each closes itself at that account\'s next sign-in.')
  for (const entry of unclaimed) {
    console.log(
      `  ${entry.address} — ${entry.providerHolders.map((h) => h.uid).join(', ')}`,
    )
  }
}

process.exit(collisions.length > 0 ? 1 : 0)
