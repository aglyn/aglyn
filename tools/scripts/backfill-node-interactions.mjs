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
 * Moves element-scoped interactions out of `hosts/{h}/actions` and onto the
 * nodes that carry them.
 *
 * An interaction is what an ELEMENT does; a host action is what the SITE
 * does. Both were stored as actions, bound to an element by a
 * `[data-aglyn="leaf:<id>"]` selector, which made an interaction a site-wide
 * object pointing at one element — so it never published or rolled back with
 * its screen, never travelled with a copied component, and outlived the
 * element it drove. The runtime and the editor both read node interactions
 * already; this is what moves the ones written before that.
 *
 * ## What it does
 *
 * 1. Reads every live action whose trigger names a leaf, per host.
 * 2. Walks that host's `screens`, `layouts`, `components` and `templates` —
 *    the parent doc AND every doc in its `versions` subcollection — and
 *    appends each action onto the matching node's `interactions`.
 * 3. Soft-deletes the actions it placed (`deletedAt` + `enabled: false`,
 *    which is what the compiler already reads as "do not run"), so nothing
 *    fires twice.
 *
 * ## The choices worth knowing
 *
 * - **Every version that holds the node, not just the live one.** Before this
 *   the action ran whatever version was published, because it belonged to the
 *   host. Writing it only to the current one would change what an older
 *   restore point does — the migration would be a behaviour change wearing a
 *   migration's clothes.
 * - **The selector is dropped, not stored.** It is re-derived from the node
 *   id at render. A carried-over selector is a second name for the element
 *   that survives a duplicate or a paste still naming the ORIGINAL, which is
 *   the failure this whole move exists to remove.
 * - **An action whose node exists nowhere is left alone and REPORTED.** It is
 *   already dead — the selector resolves to nothing — but deleting other
 *   people's data on the strength of a walk that could have missed a
 *   collection is not a trade worth making. They print at the end.
 * - **Idempotent.** An interaction already on the node by id is skipped, and
 *   a document is only written when something actually changed.
 *
 * `nodes` is stored in TWO forms in production and both are live: a plain
 * Firestore map, and msgpack bytes (AGL-1151 compression at rest). Reading
 * one form walks the whole corpus, matches nothing, and reports a clean zero
 * — see the intermediate counts at the end, which exist so a zero can be told
 * apart from a blindfold.
 *
 *   node tools/scripts/backfill-node-interactions.mjs [--host=<id>] [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const KINDS = ['screens', 'layouts', 'components', 'templates']
const LEAF_SELECTOR = /^\[data-aglyn="leaf:(.+)"\]$/

let hostsScanned = 0
let actionsFound = 0
let docsScanned = 0
let docsWithNodes = 0
let formMap = 0
let formBytes = 0
let nodesMatched = 0
let docsChanged = 0
let actionsRetired = 0
const orphans = []

/**
 * `nodes` in whichever form this document uses, plus the form itself so the
 * write goes back the same way it came out.
 */
function readNodes(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      formBytes += 1
      return { form: 'bytes', nodes: decode(bytes) }
    } catch (error) {
      console.warn(`  ! could not decode msgpack nodes: ${error.message}`)
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    formMap += 1
    return { form: 'map', nodes: raw }
  }
  return null
}

const writeNodes = (form, nodes) =>
  form === 'bytes' ? Buffer.from(encode(nodes)) : nodes

/** The interaction an action becomes, with its selector dropped. */
function interactionFromAction(id, action) {
  const { trigger, createdAt, updatedAt, deletedAt, ...rest } = action
  const { selector, ...triggerWithoutSelector } = trigger ?? {}
  return { ...rest, id, trigger: triggerWithoutSelector }
}

async function processDoc(ref, byNode, placed) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return
  docsWithNodes += 1

  let changed = 0
  const next = { ...nodes }
  for (const [nodeId, node] of Object.entries(nodes)) {
    const pending = byNode.get(nodeId)
    if (!pending?.length || !node || typeof node !== 'object') continue
    const existing = Array.isArray(node.interactions) ? node.interactions : []
    const have = new Set(existing.map((entry) => entry?.id))
    const additions = pending
      .filter(({ id }) => !have.has(id))
      .map(({ id, action }) => interactionFromAction(id, action))
    for (const { id } of pending) placed.add(id)
    nodesMatched += pending.length
    if (!additions.length) continue
    next[nodeId] = { ...node, interactions: [...existing, ...additions] }
    changed += additions.length
  }
  if (!changed) return
  docsChanged += 1
  console.log(`  ${ref.path} — ${changed} interaction(s)`)
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
}

const hosts = onlyHost
  ? [await firestore.collection('hosts').doc(onlyHost).get()]
  : (await firestore.collection('hosts').get()).docs

for (const host of hosts) {
  if (!host.exists) {
    console.error(`host ${onlyHost} not found`)
    process.exit(1)
  }
  hostsScanned += 1
  const actions = await host.ref.collection('actions').get()
  const byNode = new Map()
  const subject = new Map()
  for (const doc of actions.docs) {
    const action = doc.data()
    if (action?.deletedAt) continue
    const match = LEAF_SELECTOR.exec(String(action?.trigger?.selector ?? ''))
    const nodeId = match?.[1]
    if (!nodeId) continue
    actionsFound += 1
    subject.set(doc.id, { hostId: host.id, nodeId, name: action?.name })
    byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), { id: doc.id, action }])
  }
  if (!byNode.size) continue
  // `subject.size`, not the running total: a per-host line that prints a
  // cumulative counter overstates every host after the first, and this log is
  // what a person reads to decide whether to run it for real.
  console.log(`\n${host.id} — ${subject.size} element-scoped action(s)`)

  const placed = new Set()
  for (const kind of KINDS) {
    const parents = await host.ref.collection(kind).get()
    for (const parent of parents.docs) {
      await processDoc(parent.ref, byNode, placed)
      const versions = await parent.ref.collection('versions').get()
      for (const version of versions.docs) {
        await processDoc(version.ref, byNode, placed)
      }
    }
  }

  for (const [actionId, where] of subject) {
    if (!placed.has(actionId)) {
      orphans.push({ ...where, actionId })
      continue
    }
    actionsRetired += 1
    if (apply) {
      await host.ref.collection('actions').doc(actionId).set(
        {
          deletedAt: FieldValue.serverTimestamp(),
          enabled: false,
          migratedToNode: where.nodeId,
        },
        { merge: true },
      )
    }
  }
}

// The intermediate counts, not just the final one. "0 changes" reads
// identically whether every interaction had already moved or the script
// decoded no nodes at all — which is exactly what a nodes migration that
// handles one storage form does.
console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${hostsScanned} host(s), ` +
    `${actionsFound} element-scoped action(s), ` +
    `${docsScanned} document(s) scanned, ${docsWithNodes} carried nodes ` +
    `(${formMap} map, ${formBytes} msgpack), ` +
    `${nodesMatched} node match(es), ${docsChanged} document(s) changed, ` +
    `${actionsRetired} action(s) ${apply ? 'retired' : 'to retire'}.`,
)
if (orphans.length) {
  console.log(
    `\n${orphans.length} action(s) name a node no document holds. Their ` +
      `selector already resolves to nothing, so they do nothing today. ` +
      `LEFT ALONE — delete them by hand once you have read them:`,
  )
  for (const orphan of orphans) {
    console.log(
      `  ${orphan.hostId}/actions/${orphan.actionId} → leaf:${orphan.nodeId}` +
        `${orphan.name ? `  (${orphan.name})` : ''}`,
    )
  }
}
if (!apply) console.log('\nRe-run with --apply to write.')
