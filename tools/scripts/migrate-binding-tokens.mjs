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

// Legacy binding-token migration (AGL-188): rewrites {{name}} and
// {{fn:name(args)}} tokens to their rename-safe id forms ({{var:id}},
// {{fn:id(args)}}) across a host's screens/layouts version docs and
// function/workflow definitions. Idempotent — id-form tokens and names
// that resolve to nothing are left as-is (unresolvable names are counted
// and reported; they were already broken and stay fail-open).
//
// Usage:
//   node tools/scripts/migrate-binding-tokens.mjs --host <hostId> [--dry-run]
//   node tools/scripts/migrate-binding-tokens.mjs --all [--dry-run]
//
// Requires FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
// (same env as the other admin scripts here).

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// --- token grammar -------------------------------------------------------
// KEEP IN SYNC with libs/aglyn/src/lib/app-utils/binding-tokens.ts — this
// script cannot import the TS lib, so the two regexes and the rewrite
// rules are duplicated here verbatim.
const REF = '[a-zA-Z0-9_-]{1,64}'
const FUNCTION_TOKEN_PATTERN = new RegExp(
  `\\{\\{\\s*fn:(${REF}(?: ${REF})*)\\s*\\(([^)]*)\\)\\s*\\}\\}`,
  'g',
)
const NAME_TOKEN_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]{0,39})\s*\}\}/g

const unresolved = new Map()

function normalizeText(text, variables, functions) {
  const withFunctions = text.replace(
    FUNCTION_TOKEN_PATTERN,
    (token, ref, rawArgs) => {
      const definition = functions.get(String(ref).trim())
      if (!definition) {
        unresolved.set(`fn:${ref}`, (unresolved.get(`fn:${ref}`) ?? 0) + 1)
        return token
      }
      // Already id-form (lookups are keyed by id too): leave untouched.
      if (definition.id === String(ref).trim()) return token
      return `{{fn:${definition.id}(${String(rawArgs)})}}`
    },
  )
  return withFunctions.replace(NAME_TOKEN_PATTERN, (token, name) => {
    const variable = variables.get(name)
    if (!variable) {
      unresolved.set(name, (unresolved.get(name) ?? 0) + 1)
      return token
    }
    return `{{var:${variable.id}}}`
  })
}

function rewriteDeep(value, variables, functions) {
  if (typeof value === 'string') {
    if (!value.includes('{{')) return { value, changed: false }
    const next = normalizeText(value, variables, functions)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const result = rewriteDeep(item, variables, functions)
      changed = changed || result.changed
      return result.value
    })
    return { value: changed ? next : value, changed }
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    let changed = false
    const next = {}
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteDeep(item, variables, functions)
      changed = changed || result.changed
      next[key] = result.value
    }
    return { value: changed ? next : value, changed }
  }
  return { value, changed: false }
}

// --- firestore plumbing --------------------------------------------------

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

/**
 * Loads a host's live variables/functions keyed by name AND doc id (ids
 * make already-migrated tokens recognizable instead of "unresolvable").
 */
async function loadLookups(hostRef) {
  const byNameAndId = async (collectionName) => {
    const map = new Map()
    const snapshot = await hostRef.collection(collectionName).limit(1000).get()
    for (const doc of snapshot.docs) {
      const name = doc.get('name')
      if (name && !doc.get('deletedAt')) {
        map.set(String(name), { id: doc.id, name: String(name) })
        map.set(doc.id, { id: doc.id, name: String(name) })
      }
    }
    return map
  }
  return {
    variables: await byNameAndId('variables'),
    functions: await byNameAndId('functions'),
  }
}

async function migrateHost(firestore, hostId, dryRun) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  if (!host.exists) {
    console.error(`Host ${hostId} not found`)
    return { scanned: 0, changed: 0 }
  }
  const { variables, functions } = await loadLookups(hostRef)
  const pendingWrites = []
  let scanned = 0

  const scanDoc = (ref, data) => {
    scanned += 1
    const { value, changed } = rewriteDeep(data, variables, functions)
    if (changed) pendingWrites.push({ ref, value })
  }

  // Screens/layouts: every version doc (published pages read the published
  // one, but drafts should migrate too so re-publishing stays clean).
  for (const collectionName of ['screens', 'layouts']) {
    const docs = await hostRef.collection(collectionName).limit(500).get()
    for (const docSnapshot of docs.docs) {
      const versions = await docSnapshot.ref
        .collection('versions')
        .limit(100)
        .get()
      for (const version of versions.docs) {
        scanDoc(version.ref, version.data())
      }
    }
  }
  // Function/workflow definitions (string props inside operations/steps).
  for (const collectionName of ['functions', 'workflows']) {
    const docs = await hostRef.collection(collectionName).limit(1000).get()
    for (const docSnapshot of docs.docs) {
      scanDoc(docSnapshot.ref, docSnapshot.data())
    }
  }

  if (!dryRun) {
    // Full-doc rewrites; chunk under the 500-writes batch cap.
    for (let index = 0; index < pendingWrites.length; index += 400) {
      const batch = firestore.batch()
      for (const write of pendingWrites.slice(index, index + 400)) {
        batch.set(write.ref, write.value)
      }
      await batch.commit()
    }
  }
  console.log(
    `${hostId}: scanned ${scanned} docs, ` +
      `${dryRun ? 'would rewrite' : 'rewrote'} ${pendingWrites.length}`,
  )
  return { scanned, changed: pendingWrites.length }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')
  const hostFlag = args.indexOf('--host')
  const hostId = hostFlag >= 0 ? args[hostFlag + 1] : null
  if (!all && !hostId) {
    console.error(
      'Usage: node tools/scripts/migrate-binding-tokens.mjs ' +
        '(--host <hostId> | --all) [--dry-run]',
    )
    process.exit(1)
  }

  initAdmin()
  const firestore = getFirestore()
  let totals = { scanned: 0, changed: 0 }
  if (all) {
    const hosts = await firestore.collection('hosts').select().get()
    for (const host of hosts.docs) {
      const result = await migrateHost(firestore, host.id, dryRun)
      totals = {
        scanned: totals.scanned + result.scanned,
        changed: totals.changed + result.changed,
      }
    }
  } else {
    totals = await migrateHost(firestore, hostId, dryRun)
  }

  console.log(
    `\nTotal: ${totals.scanned} docs scanned, ${totals.changed} ` +
      `${dryRun ? 'would change' : 'changed'}${dryRun ? ' (dry run)' : ''}`,
  )
  if (unresolved.size) {
    console.log('\nUnresolvable names left as-is (already broken, fail-open):')
    for (const [name, count] of unresolved) {
      console.log(`  {{${name}}} × ${count}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
