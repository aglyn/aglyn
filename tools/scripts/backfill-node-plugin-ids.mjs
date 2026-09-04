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
 * Point every saved node's `pluginId` at the bundle that registers its
 * component. DRY RUN BY DEFAULT.
 *
 *   node tools/scripts/backfill-node-plugin-ids.mjs [--host=<id>] [--apply]
 *   node tools/scripts/backfill-node-plugin-ids.mjs --self-test
 *
 * ## Why a node's `pluginId` can be wrong at all
 *
 * It is copied onto the node from the preset literal at insertion and never
 * recomputed. A preset reads its bundle id from a RELATIVE import, so moving
 * an element's file between packages changes what every future node is
 * stamped with — silently, with no diff on the element itself — and leaves
 * every node saved before the move naming the old bundle.
 *
 * ## Why that costs something
 *
 * Rendering resolves by `componentId` alone, so a stale node still draws.
 * `requiredSitePlugins` does not: it reads `pluginId` off each node to decide
 * which bundles must register BEFORE first paint. A node naming a bundle that
 * no longer registers its component leaves the real bundle out of that set, so
 * the element paints only after the post-hydration load of the rest of the
 * enabled set — a visible pop-in, on exactly the pages that contain it.
 *
 * ## The two storage forms, and why reading one is worse than reading none
 *
 * `nodes` is stored as a plain Firestore map OR as msgpack bytes, and both are
 * live. A reader that handles one walks the whole corpus, matches nothing and
 * reports a clean zero — indistinguishable from "there was nothing to fix".
 * The per-form counts printed at the end are what tell those apart, and the
 * write goes back in the form it came out of: rewriting a compressed document
 * as a plain map inflates it toward Firestore's document ceiling.
 *
 * ## Take a snapshot first
 *
 *   node tools/scripts/backup-host-nodes.mjs --out=nodes-before.json
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'
import { parseDeployArgs } from './lib/deploy-args.mjs'

/**
 * Which bundle registers each component id that has ever changed packages.
 *
 * Only MOVED ids belong here. A node whose component never left its bundle is
 * already correct, and sweeping every id would turn a targeted correction into
 * a rewrite of every document on the platform.
 *
 * `plugin-id-backfill-table.spec.ts` reads this table out of this file and
 * checks each entry against the bundle that actually registers the id, so a
 * future move that forgets to add a row is caught before it is shipped rather
 * than after somebody notices a slow page.
 *
 * `eventList` is camelCase. The prose in several places calls it `event-list`,
 * which is not a component id anywhere and would match nothing.
 */
const OWNING_BUNDLE = {
  form: 'forms',
  formField: 'forms',
  booking: 'bookings',
  eventList: 'events-calendar',
}

/**
 * Every per-host collection whose documents carry a `nodes` tree.
 *
 * `forms` and `emailTemplates` are here and are NOT in the `NODE_KINDS` list
 * the other node backfills use: a form's design and a per-site email design
 * are both besigner documents, and a form is the very kind this table's first
 * two rows are about. `systemEmailTemplates` is deliberately absent — it is a
 * top-level staff collection, its nodes are email elements, and nothing in the
 * table above can appear in one.
 */
const KINDS = [
  'screens',
  'layouts',
  'components',
  'templates',
  'forms',
  'emailTemplates',
]

const args = parseDeployArgs({
  command: 'backfill-node-plugin-ids',
  summary:
    "Point each saved node's `pluginId` at the bundle that registers its " +
    'component, for the elements that have changed packages. Writes to the ' +
    'live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    {
      flag: '--self-test',
      key: 'selfTest',
      describe: 'Run the fixtures, touching no project.',
    },
    {
      flag: '--host',
      key: 'host',
      value: 'string',
      describe: 'Limit to one host.',
    },
  ],
})

const apply = args.apply
const onlyHost = args.host

const counts = {
  hostsScanned: 0,
  docsScanned: 0,
  docsWithNodes: 0,
  formMap: 0,
  formBytes: 0,
  formUndecodable: 0,
  nodesSeen: 0,
  nodesMovedComponent: 0,
  nodesRestamped: 0,
  docsChanged: 0,
}

/**
 * `nodes` in whichever form this document uses, plus the form itself so the
 * write goes back the same way it came out.
 */
function readNodes(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      counts.formBytes += 1
      return { form: 'bytes', nodes: decode(bytes) }
    } catch (error) {
      // Counted, not swallowed. A decode failure that reported nothing is how
      // a run over compressed documents looks exactly like a clean one.
      counts.formUndecodable += 1
      console.warn(`  ! could not decode msgpack nodes: ${error.message}`)
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    counts.formMap += 1
    return { form: 'map', nodes: raw }
  }
  return null
}

const writeNodes = (form, nodes) =>
  form === 'bytes' ? Buffer.from(encode(nodes)) : nodes

/**
 * The corrected tree, or `null` when nothing in it moved.
 *
 * Exported shape kept pure so `--self-test` can drive it with no project:
 * the traversal below is I/O and the decision is not, and only the decision
 * is worth a fixture.
 */
export function restampNodes(nodes) {
  let changed = 0
  const next = { ...nodes }
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') continue
    counts.nodesSeen += 1
    const owner = OWNING_BUNDLE[node.componentId]
    if (!owner) continue
    counts.nodesMovedComponent += 1
    // An ABSENT `pluginId` is left absent. `requiredSitePlugins` skips a node
    // with no id rather than mis-attributing it, and stamping one here would
    // widen a correction into an authorship claim about nodes this script
    // cannot know the provenance of.
    if (!node.pluginId || node.pluginId === owner) continue
    next[nodeId] = { ...node, pluginId: owner }
    changed += 1
  }
  if (!changed) return null
  counts.nodesRestamped += changed
  return { nodes: next, changed }
}

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  counts.docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return
  counts.docsWithNodes += 1

  const result = restampNodes(nodes)
  if (!result) return
  counts.docsChanged += 1
  console.log(`  ${ref.path} — ${result.changed} node(s)`)
  if (apply) await ref.update({ nodes: writeNodes(form, result.nodes) })
}

/* ── SELF-TEST ────────────────────────────────────────────────────────────
 *
 * The fixtures answer the three questions a run cannot: does it correct a
 * stale id, does it leave a correct one and an absent one alone, and does a
 * msgpack round-trip come back byte-identical in shape. It touches no project
 * and is the thing to run before pointing this at one.
 */
function selfTest() {
  const failures = []
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) failures.push(`${name}\n    expected ${b}\n    actual   ${a}`)
  }

  const stale = {
    root: { $id: 'root', componentId: 'div', nodes: ['f1'] },
    f1: { $id: 'f1', componentId: 'form', pluginId: 'mui' },
    f2: { $id: 'f2', componentId: 'formField', pluginId: 'mui' },
    b1: { $id: 'b1', componentId: 'booking', pluginId: 'mui' },
    e1: { $id: 'e1', componentId: 'eventList', pluginId: 'mui' },
  }
  const restamped = restampNodes(stale)
  check('restamps a stale form node', restamped?.nodes.f1.pluginId, 'forms')
  check('restamps a stale field node', restamped?.nodes.f2.pluginId, 'forms')
  check('restamps booking', restamped?.nodes.b1.pluginId, 'bookings')
  check('restamps eventList', restamped?.nodes.e1.pluginId, 'events-calendar')
  check('counts every stale node', restamped?.changed, 4)
  check('leaves an unmoved node alone', restamped?.nodes.root.pluginId, undefined)
  check('does not mutate the input', stale.f1.pluginId, 'mui')

  check(
    'a tree that is already right is left alone',
    restampNodes({
      f1: { $id: 'f1', componentId: 'form', pluginId: 'forms' },
    }),
    null,
  )
  check(
    'a node with NO pluginId is left with none',
    restampNodes({ f1: { $id: 'f1', componentId: 'form' } }),
    null,
  )
  check(
    'an unmoved component is never touched',
    restampNodes({
      t1: { $id: 't1', componentId: 'muiTypography', pluginId: 'mui' },
    }),
    null,
  )

  // The msgpack half. A backfill that only ever read plain maps would pass
  // every assertion above and rewrite nothing in production.
  const round = readNodes(Buffer.from(encode(stale)))
  check('decodes msgpack bytes', round?.form, 'bytes')
  check('finds the stale node inside them', round?.nodes.f1.pluginId, 'mui')
  const written = writeNodes('bytes', restampNodes(round.nodes).nodes)
  check('writes msgpack back as bytes', Buffer.isBuffer(written), true)
  check('round-trips the correction', decode(written).f1.pluginId, 'forms')
  check('leaves a map a map', typeof writeNodes('map', stale), 'object')
  check('a map is not a Buffer', Buffer.isBuffer(writeNodes('map', stale)), false)

  if (failures.length) {
    console.error(`SELF-TEST FAILED — ${failures.length} check(s):`)
    for (const failure of failures) console.error(`  ✗ ${failure}`)
    process.exit(1)
  }
  console.log('SELF-TEST PASSED — no project was touched.')
}

if (args.selfTest) {
  selfTest()
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
  })
  const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

  const hosts = onlyHost
    ? [await firestore.collection('hosts').doc(onlyHost).get()]
    : (await firestore.collection('hosts').get()).docs

  for (const host of hosts) {
    if (!host.exists) {
      console.error(`host ${onlyHost} not found`)
      process.exit(1)
    }
    counts.hostsScanned += 1
    console.log(`\n${host.id}`)
    for (const kind of KINDS) {
      const parents = await host.ref.collection(kind).get()
      for (const parent of parents.docs) {
        await processDoc(parent.ref)
        // EVERY version, not only the published one. A restore point that
        // still names the old bundle would reintroduce the stale value the
        // moment somebody rolled back to it.
        const versions = await parent.ref.collection('versions').get()
        for (const version of versions.docs) await processDoc(version.ref)
      }
    }
  }

  // The intermediate counts, not just the final one. "0 changed" reads
  // identically whether every node was already right or the script decoded
  // nothing at all, and those need very different responses.
  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${counts.hostsScanned} host(s), ` +
      `${counts.docsScanned} document(s), ${counts.docsWithNodes} with nodes ` +
      `(${counts.formMap} map, ${counts.formBytes} msgpack, ` +
      `${counts.formUndecodable} undecodable), ${counts.nodesSeen} node(s), ` +
      `${counts.nodesMovedComponent} of a moved component, ` +
      `${counts.nodesRestamped} restamped across ${counts.docsChanged} document(s).`,
  )
  if (counts.formUndecodable) {
    console.error(
      `\n${counts.formUndecodable} document(s) could not be decoded and were ` +
        'SKIPPED. Their nodes were not examined; this run is not complete.',
    )
    process.exit(1)
  }
  if (!apply) console.log('\nRe-run with --apply to write.')
}
