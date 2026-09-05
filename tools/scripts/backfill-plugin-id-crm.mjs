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

// Rewrite the persisted plugin id `contacts` as `crm` (AGL-2595).
//
// The CRM plugin's id was `contacts` while the surface was one list. The id
// is stored in every org's `enabledPlugins`, every site's `disabledPlugins`
// and `enabledPlugins`, and as the document id under each `pluginSettings`
// collection. The runtime reads the old value through `LEGACY_PLUGIN_IDS`
// (`enabled-plugins.ts`), so nothing breaks before this runs; this is what
// lets that alias be retired, and it says how many documents still carry the
// old id so the retirement can be dated.
//
//   node tools/scripts/backfill-plugin-id-crm.mjs            # dry run, counts
//   node tools/scripts/backfill-plugin-id-crm.mjs --apply    # write
//
// Idempotent: a document already on the new id is skipped, and a settings
// document that already exists under the new id is never overwritten — the
// old one is deleted only after its fields have been merged beneath.

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  planHostUpdate,
  planOrgUpdate,
  pluginSettingsTarget,
} from './lib/plugin-id-rename.mjs'

const args = parseDeployArgs({
  command: 'backfill-plugin-id-crm',
  summary:
    'Rewrite the plugin id `contacts` as `crm` in org.enabledPlugins, ' +
    'host.disabledPlugins, host.enabledPlugins and pluginSettings/contacts. ' +
    'Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
  ],
})
const apply = Boolean(args.apply)

const PAGE_SIZE = 400

/** Every document of a top-level collection, paged on the document id. */
async function* pages(db, collectionName) {
  let cursor = null
  for (;;) {
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    if (page.empty) return
    yield page.docs
    cursor = page.docs[page.docs.length - 1]
    if (page.size < PAGE_SIZE) return
  }
}

async function run(db) {
  const report = {
    orgsScanned: 0,
    orgsUpdated: 0,
    hostsScanned: 0,
    hostsUpdated: 0,
    settingsMoved: 0,
    settingsMerged: 0,
  }
  const writes = []

  for await (const docs of pages(db, 'orgs')) {
    for (const snapshot of docs) {
      report.orgsScanned += 1
      const patch = planOrgUpdate(snapshot.data())
      if (!patch) continue
      report.orgsUpdated += 1
      writes.push({ ref: snapshot.ref, patch, label: `orgs/${snapshot.id}` })
    }
  }
  for await (const docs of pages(db, 'hosts')) {
    for (const snapshot of docs) {
      report.hostsScanned += 1
      const patch = planHostUpdate(snapshot.data())
      if (!patch) continue
      report.hostsUpdated += 1
      writes.push({ ref: snapshot.ref, patch, label: `hosts/${snapshot.id}` })
    }
  }
  /*
   * The settings documents, wherever a `pluginSettings` collection sits — the
   * org and the host both carry one. A collection-group read on the document
   * id finds every one without walking each parent.
   */
  const settings = await db
    .collectionGroup('pluginSettings')
    .where(FieldPath.documentId(), '>=', 'contacts')
    .where(FieldPath.documentId(), '<=', 'contacts')
    .get()
  for (const snapshot of settings.docs) {
    const target = pluginSettingsTarget(snapshot.id)
    if (!target) continue
    const targetRef = snapshot.ref.parent.doc(target)
    const existing = await targetRef.get()
    if (existing.exists) report.settingsMerged += 1
    else report.settingsMoved += 1
    writes.push({
      move: { from: snapshot.ref, to: targetRef, data: snapshot.data() },
      label: `${snapshot.ref.path} → ${targetRef.path}`,
    })
  }

  for (const write of writes) console.log(`  ${apply ? 'writing' : 'would write'}  ${write.label}`)

  if (apply) {
    /*
     * Chunked BEFORE anything is awaited: a settings move is two operations
     * and a batch holds five hundred, so the chunks are cut by operation
     * count and each is committed in turn.
     */
    const chunks = []
    let chunk = []
    let operations = 0
    for (const write of writes) {
      const cost = write.move ? 2 : 1
      if (operations + cost > 400) {
        chunks.push(chunk)
        chunk = []
        operations = 0
      }
      chunk.push(write)
      operations += cost
    }
    if (chunk.length) chunks.push(chunk)
    for (const group of chunks) {
      const batch = db.batch()
      for (const write of group) {
        if (write.move) {
          // Merge beneath an existing target so a setting saved under the
          // new id since the deploy is never overwritten by the old copy.
          batch.set(write.move.to, write.move.data, { merge: true })
          batch.delete(write.move.from)
        } else {
          batch.update(write.ref, write.patch)
        }
      }
      await batch.commit()
    }
  }
  return report
}

initializeApp(
  process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() },
)
const report = await run(getFirestore())
console.log(
  `\n${apply ? 'Wrote' : 'Dry run'}: orgs ${report.orgsUpdated}/${report.orgsScanned} updated, ` +
    `hosts ${report.hostsUpdated}/${report.hostsScanned} updated, ` +
    `pluginSettings moved ${report.settingsMoved}, merged ${report.settingsMerged}.`,
)
if (!apply) console.log('  Re-run with --apply to write.\n')
process.exit(0)
