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

// Contacts backfill (AGL-197): builds hosts/{hostId}/contacts from the
// four pre-existing silos — formSubmissions, siteMembers, orders,
// bookings. Idempotent: contacts merge by normalized email, and re-runs
// replace each contact's sources/interactions from source data (notes and
// tags on existing contacts are preserved). Quota is NOT enforced here —
// backfill is an owner-initiated migration; the live ingestion enforces
// contactsPerHost for new contacts.
//
// Usage:
//   node tools/scripts/backfill-contacts.mjs --host <hostId> [--dry-run]
//   node tools/scripts/backfill-contacts.mjs --all [--dry-run]

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// KEEP IN SYNC with libs/aglyn/src/lib/app-utils/contacts.ts.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CAP = 50
const normalizeEmail = (input) => {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}
const extractFromFields = (fields) => {
  const entries = Object.entries(fields ?? {})
  const preferred = entries.find(([key]) => /email/i.test(key))
  return (
    normalizeEmail(preferred?.[1]) ??
    entries.map(([, value]) => normalizeEmail(value)).find(Boolean) ??
    null
  )
}

function initAdmin() {
  if (getApps().length) return
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY',
    )
    process.exit(1)
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const atMs = (value) =>
  value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : Date.now())

async function backfillHost(firestore, hostId, dryRun) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  /** email → { name, sources, interactions } */
  const people = new Map()
  const record = (email, name, source, interaction) => {
    if (!email) return
    const person = people.get(email) ?? {
      name: undefined,
      sources: {},
      interactions: [],
    }
    person.name = person.name || name || undefined
    person.sources[source] = true
    person.interactions.push(interaction)
    people.set(email, person)
  }

  const forms = await hostRef.collection('formSubmissions').limit(2000).get()
  for (const doc of forms.docs) {
    record(
      extractFromFields(doc.get('fields')),
      doc.get('fields')?.name,
      'form',
      {
        type: 'form',
        refId: doc.id,
        atMs: atMs(doc.get('createdAt')),
        summary: `Submitted "${String(doc.get('formName') ?? 'Form').slice(0, 60)}"`,
      },
    )
  }
  const members = await hostRef.collection('siteMembers').limit(2000).get()
  for (const doc of members.docs) {
    record(normalizeEmail(doc.get('email')), doc.get('displayName'), 'member', {
      type: 'member',
      refId: doc.id,
      atMs: atMs(doc.get('createdAt')),
      summary: 'Joined as a member',
    })
  }
  const orders = await hostRef.collection('orders').limit(2000).get()
  for (const doc of orders.docs) {
    record(normalizeEmail(doc.get('customerEmail')), undefined, 'order', {
      type: 'order',
      refId: doc.id,
      atMs: atMs(doc.get('createdAt')),
      summary: `Placed an order ($${(Number(doc.get('amountCents') ?? 0) / 100).toFixed(2)})`,
    })
  }
  const bookings = await hostRef.collection('bookings').limit(2000).get()
  for (const doc of bookings.docs) {
    record(normalizeEmail(doc.get('email')), doc.get('name'), 'booking', {
      type: 'booking',
      refId: doc.id,
      atMs: atMs(doc.get('createdAt')),
      summary: `Booked "${String(doc.get('serviceName') ?? 'a service').slice(0, 60)}"`,
    })
  }

  // Merge into existing contacts by email.
  const existingDocs = await hostRef.collection('contacts').limit(5000).get()
  const existingByEmail = new Map(
    existingDocs.docs.map((doc) => [doc.get('email'), doc]),
  )
  let created = 0
  let updated = 0
  const writer = firestore.bulkWriter()
  for (const [email, person] of people) {
    const interactions = person.interactions
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, CAP)
    const existing = existingByEmail.get(email)
    const payload = {
      email,
      ...(person.name ? { name: String(person.name).slice(0, 120) } : {}),
      sources: person.sources,
      interactions,
      updatedAt: new Date(),
    }
    if (existing) {
      updated += 1
      if (!dryRun) writer.set(existing.ref, payload, { merge: true })
    } else {
      created += 1
      if (!dryRun) {
        writer.set(hostRef.collection('contacts').doc(), {
          ...payload,
          tags: [],
          createdAt: new Date(),
        })
      }
    }
  }
  if (!dryRun) await writer.close()
  console.log(
    `${hostId}: ${people.size} people — ` +
      `${dryRun ? 'would create' : 'created'} ${created}, ` +
      `${dryRun ? 'would update' : 'updated'} ${updated}`,
  )
  return { created, updated }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')
  const hostFlag = args.indexOf('--host')
  const hostId = hostFlag >= 0 ? args[hostFlag + 1] : null
  if (!all && !hostId) {
    console.error(
      'Usage: node tools/scripts/backfill-contacts.mjs ' +
        '(--host <hostId> | --all) [--dry-run]',
    )
    process.exit(1)
  }
  initAdmin()
  const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
  if (all) {
    const hosts = await firestore.collection('hosts').select().get()
    for (const host of hosts.docs) {
      await backfillHost(firestore, host.id, dryRun)
    }
  } else {
    await backfillHost(firestore, hostId, dryRun)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
