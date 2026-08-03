#!/usr/bin/env node
/**
 * AGL-958 blocker #1 — put a marketplace plugin node on the demo site, so a
 * takedown has something VISIBLE to break.
 *
 *   node tools/scripts/place-demo-plugin-node.mjs            place it
 *   node tools/scripts/place-demo-plugin-node.mjs --revert   put the previous
 *                                                            version back live
 *
 * The plugin `Tfnrb4wJzF` (Promo Countdown) is already installed at org scope
 * on test-org, and was placed on zero screens — which is exactly the gap the
 * issue describes.
 *
 * Publishes a NEW version rather than mutating the live one. That is how the
 * product does it, and it means the current version stays in history as the
 * revert path: republish `ywEvip-oEw` to undo this entirely.
 */
import { config as loadEnv } from 'dotenv'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

loadEnv({ path: '.env' })
loadEnv({ path: 'apps/console/.env.production.local' })
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  }),
})

const HOST = '4uYCmrbU5t' // northwind-coffee
const SCREEN = '4L_o499p_p' // "/" — Business Home
const LISTING = 'Tfnrb4wJzF' // Promo Countdown, installed at org scope
const ROOT = '_@_'
const SECTION_ID = 'b_plugin_fixture'
const PLUGIN_NODE_ID = 'b_plugin_fixture_node'

const REVERT = process.argv.includes('--revert')

const db = getFirestore()
const screenRef = db.collection('hosts').doc(HOST).collection('screens').doc(SCREEN)
const screen = await screenRef.get()
const liveVersionId = screen.get('versionId')
const live = await screenRef.collection('versions').doc(liveVersionId).get()

const raw = live.get('nodes')
const nodes = decode(raw?.toUint8Array?.() ?? new Uint8Array(raw))

if (REVERT) {
  // Republish the newest version that predates the fixture. Version history is
  // the revert path precisely because this publishes rather than mutates.
  const versions = await screenRef.collection('versions').get()
  const clean = versions.docs
    .filter((doc) => {
      const raw = doc.get('nodes')
      if (!raw) return false
      const decoded = decode(raw?.toUint8Array?.() ?? new Uint8Array(raw))
      return !decoded[PLUGIN_NODE_ID]
    })
    .sort((a, b) => (b.get('createdAt')?.toMillis?.() ?? 0) - (a.get('createdAt')?.toMillis?.() ?? 0))[0]
  if (!clean) {
    console.log(JSON.stringify({ error: 'no version without the fixture node' }, null, 2))
    process.exit(1)
  }
  await screenRef.set({ versionId: clean.id }, { merge: true })
  console.log(JSON.stringify({ reverted: true, nowLive: clean.id, wasLive: liveVersionId }, null, 2))
  process.exit(0)
}

if (nodes[PLUGIN_NODE_ID]) {
  // Idempotent: re-running must not stack duplicate sections onto the page.
  console.log(JSON.stringify({ skipped: 'fixture node already present', liveVersionId }, null, 2))
  process.exit(0)
}

// A titled section wrapping the plugin, appended after the existing content so
// nothing already on the page moves.
nodes[SECTION_ID] = {
  $id: SECTION_ID,
  type: 'node',
  parentId: ROOT,
  pluginId: 'mui',
  componentId: 'muiStack',
  props: { spacing: 2, sx: { px: 4, py: 6, alignItems: 'center' } },
  nodes: [`${SECTION_ID}_heading`, PLUGIN_NODE_ID],
}
nodes[`${SECTION_ID}_heading`] = {
  $id: `${SECTION_ID}_heading`,
  type: 'node',
  parentId: SECTION_ID,
  pluginId: 'mui',
  componentId: 'muiTypography',
  props: { variant: 'h5', children: 'This week at Northwind' },
}
nodes[PLUGIN_NODE_ID] = {
  $id: PLUGIN_NODE_ID,
  type: 'node',
  parentId: SECTION_ID,
  pluginId: 'marketplace',
  componentId: 'marketplacePlugin',
  // `listingId` is the only prop an author sets. `version`, `sha256`,
  // `capabilities` and `revoked` are stamped at compose time by
  // `attachPluginInstalls` from the resolved install — which is precisely the
  // path a takedown has to break.
  props: { listingId: LISTING },
}
nodes[ROOT] = { ...nodes[ROOT], nodes: [...(nodes[ROOT].nodes ?? []), SECTION_ID] }

const newVersionRef = screenRef.collection('versions').doc()
await newVersionRef.set({
  screenId: SCREEN,
  displayName: live.get('displayName') ?? 'Business Home',
  nodes: Buffer.from(encode(nodes)),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})
await screenRef.set({ versionId: newVersionRef.id }, { merge: true })

console.log(JSON.stringify({
  previousVersionId: liveVersionId,
  newVersionId: newVersionRef.id,
  listingId: LISTING,
  pluginNodeId: PLUGIN_NODE_ID,
  nodeCount: Object.keys(nodes).length,
  revertWith: `set screens/${SCREEN}.versionId = ${liveVersionId}`,
}, null, 2))
