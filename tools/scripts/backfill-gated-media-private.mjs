#!/usr/bin/env node
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

/**
 * Make every file a product sells as a members video private, and kill the
 * download links buyers were already handed (AGL-2814). DRY RUN BY DEFAULT.
 *
 *   node --env-file=.env tools/scripts/backfill-gated-media-private.mjs \
 *     [--host=<id>] [--include-shared] [--bucket=<name>] [--apply]
 *
 * Reads as the service account in FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL
 * and FIREBASE_PRIVATE_KEY. The media bucket is `--bucket`, else
 * NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, else `{project}.appspot.com`, and the
 * run prints which one it used.
 *
 * For each file a product's `gatedVideos` names, in the selling site's own
 * library or its org's, `--apply` writes, in this order:
 *
 * 1. a new download token on the object, when the file was public or a stored
 *    link carries the current token (existing custom metadata is kept);
 * 2. `private: true` on the media document, dropping `cdnPath` and `url`;
 * 3. the product entry's raw download URL, replaced by the media reference.
 *
 * A public file used anywhere else is listed as `shared` and left alone
 * unless `--include-shared` is passed. The decisions, and why each is shaped
 * the way it is, live in `lib/gated-media-backfill.mjs` and are proved by its
 * test file without a project.
 */

import { randomUUID } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  DOWNLOAD_TOKEN_METADATA_KEY,
  haystackOf,
  mentionsMediaId,
  runGatedMediaBackfill,
  summarize,
} from './lib/gated-media-backfill.mjs'

const args = parseDeployArgs({
  command: 'backfill-gated-media-private',
  summary:
    'Make every file a product sells as a members video private, rotate the ' +
    'download tokens buyers were handed, and replace stored download URLs ' +
    'with media references. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site.' },
    {
      flag: '--include-shared',
      key: 'includeShared',
      describe: 'Also make private a file used elsewhere, which breaks those uses.',
    },
    {
      flag: '--bucket',
      key: 'bucket',
      value: 'string',
      describe: 'The media bucket, when it is not {project}.appspot.com.',
    },
  ],
})

/** Every per-site collection whose documents carry a design `nodes` tree. */
const NODE_KINDS = ['screens', 'layouts', 'components', 'templates', 'forms', 'emailTemplates']

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY. ' +
      'Run with: node --env-file=.env tools/scripts/backfill-gated-media-private.mjs',
  )
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID || '(default)')
const bucketName =
  args.bucket || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`
const bucket = getStorage().bucket(bucketName)

const mediaRef = (collection, scopeId, mediaId) =>
  firestore.collection(collection).doc(scopeId).collection('media').doc(mediaId)

const io = {
  async listSites(hostFilter) {
    const hosts = hostFilter
      ? [await firestore.collection('hosts').doc(hostFilter).get()]
      : (await firestore.collection('hosts').select('orgId').get()).docs
    const sites = []
    for (const host of hosts) {
      if (!host.exists) throw new Error(`site ${hostFilter} not found`)
      const index = await firestore.collection('hostIndex').doc(host.id).get()
      const orgId = index.get('orgId') || host.get('orgId') || null
      sites.push({ hostId: host.id, orgId: orgId ? String(orgId) : null })
    }
    return sites
  },

  async listOrgSites(orgId) {
    const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).select().get()
    return hosts.docs.map((host) => host.id)
  },

  async listProducts(hostId) {
    const products = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('products')
      .select('name', 'deletedAt', 'gatedVideos')
      .get()
    return products.docs.map((product) => ({
      id: product.id,
      name: String(product.get('name') ?? product.id),
      deleted: Boolean(product.get('deletedAt')),
      gatedVideos: product.get('gatedVideos'),
    }))
  },

  async readMedia(collection, scopeId, mediaId) {
    const snapshot = await mediaRef(collection, scopeId, mediaId).get()
    return snapshot.exists ? snapshot.data() : null
  },

  async readObjectToken(objectPath) {
    try {
      const [metadata] = await bucket.file(objectPath).getMetadata()
      return metadata?.metadata?.[DOWNLOAD_TOKEN_METADATA_KEY] ?? null
    } catch (error) {
      if (Number(error?.code) === 404) return null
      throw error
    }
  },

  async findOtherUses({ asset, hostIds }) {
    const places = []
    const check = (label, data) => {
      if (mentionsMediaId(haystackOf(data), asset.mediaId)) places.push(label)
    }
    if (asset.collection === 'orgs') {
      const org = await firestore.collection('orgs').doc(asset.scopeId).get()
      if (org.exists) check(`orgs/${asset.scopeId}`, org.data())
    }
    for (const hostId of hostIds) {
      const host = firestore.collection('hosts').doc(hostId)
      const snapshot = await host.get()
      if (snapshot.exists) check(`hosts/${hostId}`, snapshot.data())
      for (const kind of NODE_KINDS) {
        for (const parent of (await host.collection(kind).get()).docs) {
          check(`hosts/${hostId}/${kind}/${parent.id}`, parent.data())
          for (const version of (await parent.ref.collection('versions').get()).docs) {
            check(`hosts/${hostId}/${kind}/${parent.id}/versions/${version.id}`, version.data())
          }
        }
      }
      for (const collection of (await host.collection('collections').get()).docs) {
        for (const entry of (await collection.ref.collection('entries').get()).docs) {
          check(`hosts/${hostId}/collections/${collection.id}/entries/${entry.id}`, entry.data())
        }
      }
      for (const product of (await host.collection('products').get()).docs) {
        // A members video list is a paid use, not somewhere the file shows.
        const { gatedVideos: _paid, ...shown } = product.data()
        check(`hosts/${hostId}/products/${product.id}`, shown)
      }
    }
    return places
  },

  async rotateToken(objectPath) {
    const file = bucket.file(objectPath)
    const [metadata] = await file.getMetadata()
    const existing = metadata?.metadata ?? {}
    // No token, no download URL to kill, and writing one would create it.
    if (!existing[DOWNLOAD_TOKEN_METADATA_KEY]) return false
    await file.setMetadata({
      metadata: { ...existing, [DOWNLOAD_TOKEN_METADATA_KEY]: randomUUID() },
    })
    return true
  },

  async updateMedia(asset) {
    await mediaRef(asset.collection, asset.scopeId, asset.mediaId).set(
      {
        private: true,
        cdnPath: FieldValue.delete(),
        url: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  },

  async rewriteProductEntries(hostId, productId, rewrites) {
    const ref = firestore.collection('hosts').doc(hostId).collection('products').doc(productId)
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const list = snapshot.get('gatedVideos')
      if (!Array.isArray(list)) return 0
      let changed = 0
      const next = list.map((entry) => {
        const hit = rewrites.find((rewrite) => entry && entry.url === rewrite.from)
        if (!hit) return entry
        changed += 1
        return { ...entry, url: hit.to }
      })
      if (changed) transaction.update(ref, { gatedVideos: next })
      return changed
    })
  },
}

console.log(
  `backfill-gated-media-private: ${args.apply ? 'APPLY' : 'DRY RUN — nothing written'} ` +
    `against ${projectId}, bucket ${bucketName}` +
    `${args.host ? `, site ${args.host}` : ''}` +
    `${args.includeShared ? ', including shared files' : ''}`,
)

const report = await runGatedMediaBackfill({
  io,
  bucket: bucketName,
  apply: args.apply,
  includeShared: args.includeShared,
  hostFilter: args.host,
  emulatorHost: process.env.FIREBASE_STORAGE_EMULATOR_HOST,
})

// Keys and ids only. A stored download URL carries a live token, so no URL is
// ever printed.
for (const plan of report.assets) {
  const steps = [
    plan.rotate.length ? 'rotate token' : '',
    plan.markPrivate ? 'make private' : '',
    plan.deleteUrl ? 'drop url' : '',
    plan.deleteCdnPath ? 'drop cdnPath' : '',
    plan.rewrites.length ? `rewrite ${plan.rewrites.length} entr${plan.rewrites.length === 1 ? 'y' : 'ies'}` : '',
  ].filter(Boolean)
  console.log(
    `  ${plan.status.padEnd(9)} ${plan.key} on ${plan.products.join(', ')}` +
      `${steps.length ? ` — ${steps.join(', ')}` : ''}`,
  )
  for (const place of plan.otherUses) console.log(`            also used: ${place}`)
}
for (const plan of report.orphans) {
  console.log(`  ${plan.status.padEnd(9)} ${plan.objectPath} (no media document)${plan.rotate.length ? ' — rotate token' : ''}`)
}
for (const entry of report.skipped) {
  console.log(`  skipped   ${entry.hostId}/${entry.productId} video ${entry.index} — ${entry.reason}`)
}

console.log(`\n${JSON.stringify(summarize(report), null, 2)}`)

if (args.apply) {
  console.log(`\nAPPLIED ${JSON.stringify({ ...report.applied, failures: report.applied.failures.length })}`)
  for (const failure of report.applied.failures) {
    console.error(`  ✗ ${failure.label}: ${failure.message}`)
  }
  if (report.applied.failures.length) process.exit(1)
} else {
  console.log('\nRe-run with --apply to write.')
}
