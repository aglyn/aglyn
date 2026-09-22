// The Admin-SDK plumbing every Firestore backfill script here shares
// (AGL-3235): credentials from the root `.env`, a whole-collection walk
// paged on the document id, and batched commits under the operation
// ceiling. Lifted out of `backfill-crm-lifecycle-stages.mjs`, which reads
// the same way it did, so the next backfill starts from the decisions and
// not from the connection.
//
// Server only; nothing here is bundled.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'

/** Firestore refuses a batch of more than 500 operations. */
export const BATCH_OPERATIONS = 400
/** How many documents one page of a collection walk reads. */
export const PAGE_SIZE = 400

/**
 * The root `.env`, read from the checkout the caller names and from the
 * working directory, whichever holds one. Already-set variables win, so a
 * value on the command line is never overridden by the file.
 */
export function loadRootEnv(repoRoot) {
  const candidates = [join(repoRoot, '.env'), join(process.cwd(), '.env')]
  for (const file of new Set(candidates)) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const [, key] = match
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

/**
 * The Firestore handle for the project the environment names. The project
 * is named on the command line (`GOOGLE_CLOUD_PROJECT`) or in the root
 * `.env` (`FIREBASE_PROJECT_ID`), because the key file does not carry it
 * and a run against the wrong project must not be one variable away.
 * `FIRESTORE_EMULATOR_HOST` skips the credential for a local proof.
 * Exits 2 having written nothing when no project is named.
 */
export function connectFirestore({ repoRoot, apply }) {
  loadRootEnv(repoRoot)
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID
  if (!projectId) {
    console.error(
      'Name the project: GOOGLE_CLOUD_PROJECT=aglyn-main (or FIREBASE_PROJECT_ID in the root .env). NOTHING WAS WRITTEN.',
    )
    process.exit(2)
  }
  const emulator = process.env.FIRESTORE_EMULATOR_HOST
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  let via
  if (emulator) {
    initializeApp({ projectId })
    via = `emulator at ${emulator}`
  } else if (clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
    via = `service account ${clientEmail}`
  } else {
    initializeApp({ credential: applicationDefault(), projectId })
    via = 'application-default credentials'
  }
  console.log(`project ${projectId} via ${via} — ${apply ? 'APPLY' : 'DRY RUN'}`)
  return getFirestore(process.env.FIRESTORE_DATABASE_ID)
}

/**
 * Every document of a collection, paged on the document id.
 *
 * `orderBy` on a data field drops every document missing it, and the rows a
 * backfill exists for are the OLDEST — the ones an older writer never
 * stamped. The document id is the one path every document has.
 */
export async function* everyDocument(collectionRef) {
  let cursor = null
  for (;;) {
    let query = collectionRef.orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    if (page.empty) return
    for (const snapshot of page.docs) yield snapshot
    cursor = page.docs[page.docs.length - 1]
    if (page.size < PAGE_SIZE) return
  }
}

/** The whole collection as `{ id, data }` rows. */
export async function collect(collectionRef) {
  const rows = []
  for await (const snapshot of everyDocument(collectionRef)) {
    rows.push({ id: snapshot.id, data: snapshot.data() ?? {} })
  }
  return rows
}

/**
 * Commit a list of `{ kind, ref, value }` writes in batches under the
 * operation ceiling, in order. `create` refuses an existing document, which
 * is the one write that must never win a race with a live door; `set`
 * merges; `update` requires the document; `delete` removes it.
 */
export async function commitAll(db, writes) {
  for (let start = 0; start < writes.length; start += BATCH_OPERATIONS) {
    const batch = db.batch()
    for (const write of writes.slice(start, start + BATCH_OPERATIONS)) {
      if (write.kind === 'create') batch.create(write.ref, write.value)
      else if (write.kind === 'set') batch.set(write.ref, write.value, { merge: true })
      else if (write.kind === 'delete') batch.delete(write.ref)
      else batch.update(write.ref, write.value)
    }
    await batch.commit()
  }
}
