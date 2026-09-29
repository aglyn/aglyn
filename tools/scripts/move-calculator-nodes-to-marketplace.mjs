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
 * Move one site's saved calculator elements from mui onto the Calculators
 * marketplace plugin (AGL-3394). DRY RUN BY DEFAULT.
 *
 *   node tools/scripts/move-calculator-nodes-to-marketplace.mjs --host=<id>
 *   node tools/scripts/move-calculator-nodes-to-marketplace.mjs --host=<id> --apply
 *   node tools/scripts/move-calculator-nodes-to-marketplace.mjs --self-test
 *
 * Each calculator node gets the plugin's component id and names the plugin's
 * identity as its `pluginId`: `functionScope` becomes `aglyn.calculator.scope`,
 * `functionWidget` becomes `aglyn.calculator.widget`, and so on.
 *
 * ## One site at a time, and only once it can draw them
 *
 * A node the site cannot register renders as nothing. So `--apply` refuses
 * unless:
 *
 * - production serves AGL-3390, which server-renders a signed plugin's elements;
 * - this host's workspace (or the host itself) pins a version of the plugin
 *   that staff signed, published under its identity.
 *
 * There is no all-hosts mode: each site installs the plugin first.
 *
 * ## Take a snapshot first
 *
 *   node tools/scripts/backup-host-nodes.mjs --host=<id> --out=nodes-before.json
 */
import { execFileSync } from 'node:child_process'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { withProbeHeaders } from './lib/probe-headers.mjs'

/** The plugin's identity: the `pluginId` its elements carry. */
const IDENTITY = 'aglyn.calculator'

/** mui's component id → the plugin's. */
const MOVED = {
  functionWidget: `${IDENTITY}.widget`,
  functionScope: `${IDENTITY}.scope`,
  functionInput: `${IDENTITY}.input`,
  functionOutput: `${IDENTITY}.result`,
  functionShow: `${IDENTITY}.showWhen`,
  functionDocument: `${IDENTITY}.document`,
  functionSave: `${IDENTITY}.saveButton`,
}

/** The commit production must serve before a site's nodes move: AGL-3390. */
const REQUIRED_COMMIT = '981db5432'

/** Every per-host collection whose documents carry a `nodes` tree. */
const KINDS = ['screens', 'layouts', 'components', 'templates', 'forms', 'emailTemplates']

const counts = {
  docsScanned: 0,
  docsWithNodes: 0,
  formMap: 0,
  formBytes: 0,
  formUndecodable: 0,
  nodesSeen: 0,
  nodesMoved: 0,
  docsChanged: 0,
}

/** `nodes` in whichever form the document stores, and the form. */
function readNodes(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    try {
      counts.formBytes += 1
      return { form: 'bytes', nodes: decode(Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw) }
    } catch (error) {
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

/** Back in the form it came out of: rewriting bytes as a map inflates the document. */
const writeNodes = (form, nodes) => (form === 'bytes' ? Buffer.from(encode(nodes)) : nodes)

/**
 * The moved tree, or `null` when nothing in it moves. Pure, so the self-test
 * can drive it with no project.
 */
export function moveNodes(nodes) {
  let moved = 0
  const next = { ...nodes }
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') continue
    const componentId = MOVED[node.componentId]
    if (!componentId) continue
    next[nodeId] = { ...node, componentId, pluginId: IDENTITY }
    moved += 1
  }
  return { nodes: moved ? next : null, moved }
}

function selfTest() {
  const failures = []
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) failures.push(`${name}\n    expected ${b}\n    actual   ${a}`)
  }
  const tree = {
    root: { $id: 'root', componentId: 'div', nodes: ['s1'] },
    s1: { $id: 's1', componentId: 'functionScope', pluginId: 'mui', props: { functionName: 'quote' } },
    i1: { $id: 'i1', componentId: 'functionInput', pluginId: 'mui' },
    o1: { $id: 'o1', componentId: 'functionOutput', pluginId: 'calculator' },
    w1: { $id: 'w1', componentId: 'functionShow' },
    x1: { $id: 'x1', componentId: 'functionWidget', pluginId: 'mui' },
    t1: { $id: 't1', componentId: 'muiTypography', pluginId: 'mui' },
  }
  const result = moveNodes(tree)
  check('moves the Calculator', result.nodes?.s1.componentId, 'aglyn.calculator.scope')
  check('keeps its props', result.nodes?.s1.props, { functionName: 'quote' })
  check('stamps the identity', result.nodes?.s1.pluginId, 'aglyn.calculator')
  check('renames Result', result.nodes?.o1.componentId, 'aglyn.calculator.result')
  check('stamps a node that named no plugin', result.nodes?.w1.pluginId, 'aglyn.calculator')
  check('counts what moved', result.moved, 5)
  check('moves the Function Widget', result.nodes?.x1.componentId, 'aglyn.calculator.widget')
  check('leaves other elements alone', result.nodes?.t1, tree.t1)
  check('does not mutate the input', tree.s1.componentId, 'functionScope')
  check('a tree with nothing to move is null', moveNodes({ t1: tree.t1 }).nodes, null)
  const round = readNodes(Buffer.from(encode(tree)))
  check('decodes msgpack', round?.form, 'bytes')
  const written = writeNodes('bytes', moveNodes(round.nodes).nodes)
  check('writes msgpack back as bytes', Buffer.isBuffer(written), true)
  check('round-trips the move', decode(written).i1.componentId, 'aglyn.calculator.input')
  if (failures.length) {
    console.error(`SELF-TEST FAILED — ${failures.length} check(s):`)
    for (const failure of failures) console.error(`  ✗ ${failure}`)
    process.exit(1)
  }
  console.log('SELF-TEST PASSED — no project was touched.')
}

/** Refuses unless production can render the moved nodes, and this host runs the plugin. */
async function gate(firestore, hostId) {
  const health = await fetch('https://aglyn.com/api/health', {
    headers: withProbeHeaders({ 'user-agent': 'aglyn-move-calculator-nodes' }),
  }).then((response) => response.json())
  execFileSync('git', ['fetch', 'origin', '--quiet'])
  const serves = (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', REQUIRED_COMMIT, String(health.commit)])
      return true
    } catch {
      return false
    }
  })()
  const host = await firestore.collection('hosts').doc(hostId).get()
  const orgId = host.get('orgId')
  const claim = await firestore.collection('pluginIdentities').doc(IDENTITY).get()
  const listingId = claim.get('listingId')
  const pins = listingId
    ? await Promise.all([
        orgId ? firestore.doc(`orgs/${orgId}/installs/${listingId}`).get() : null,
        firestore.doc(`hosts/${hostId}/installs/${listingId}`).get(),
      ])
    : []
  // The host's own pin wins over the workspace's, as the loaders read them.
  const version = [pins[1], pins[0]].map((pin) => pin?.get('version')).find(Boolean)
  const pinned = version
    ? await firestore.doc(`marketplaceListings/${listingId}/pluginVersions/${version}`).get()
    : null
  const signed =
    pinned?.get('trust') === 'realm' &&
    Boolean(pinned?.get('signature')) &&
    pinned?.get('identity') === IDENTITY
  console.log(
    JSON.stringify({
      production: { serving: String(health.commit).slice(0, 9), servesAgl3390: serves },
      install: { orgId: orgId ?? null, listingId: listingId ?? null, version: version ?? null, signed },
    }),
  )
  if (!serves) throw new Error('production does not serve AGL-3390 yet')
  if (!signed) throw new Error(`host ${hostId} does not run a signed ${IDENTITY} install`)
}

const args = parseDeployArgs({
  command: 'move-calculator-nodes-to-marketplace',
  summary:
    "Move one site's calculator elements from mui onto the Calculators " +
    'marketplace plugin. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'The host to move. Required.' },
  ],
})

if (args.selfTest) {
  selfTest()
} else {
  if (!args.host) {
    console.error('--host=<id> is required: a site moves once it has installed the plugin.')
    process.exit(1)
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
  })
  const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
  const host = await firestore.collection('hosts').doc(args.host).get()
  if (!host.exists) {
    console.error(`host ${args.host} not found`)
    process.exit(1)
  }
  if (args.apply) await gate(firestore, args.host)

  for (const kind of KINDS) {
    const parents = await host.ref.collection(kind).get()
    for (const parent of parents.docs) {
      // EVERY version: a restore point naming mui's ids would bring them back.
      const refs = [parent.ref, ...(await parent.ref.collection('versions').get()).docs.map((d) => d.ref)]
      for (const ref of refs) {
        const snapshot = await ref.get()
        if (!snapshot.exists) continue
        counts.docsScanned += 1
        const read = readNodes(snapshot.get('nodes'))
        if (!read?.nodes || typeof read.nodes !== 'object') continue
        counts.docsWithNodes += 1
        counts.nodesSeen += Object.keys(read.nodes).length
        const result = moveNodes(read.nodes)
        if (!result.nodes) continue
        counts.nodesMoved += result.moved
        counts.docsChanged += 1
        console.log(`  ${ref.path} — ${result.moved} node(s)`)
        if (args.apply) await ref.update({ nodes: writeNodes(read.form, result.nodes) })
      }
    }
  }

  console.log(
    `\n${args.apply ? 'APPLIED' : 'DRY RUN'} — ${args.host}: ${counts.docsScanned} document(s), ` +
      `${counts.docsWithNodes} with nodes (${counts.formMap} map, ${counts.formBytes} msgpack, ` +
      `${counts.formUndecodable} undecodable), ${counts.nodesSeen} node(s), ` +
      `${counts.nodesMoved} moved across ${counts.docsChanged} document(s).`,
  )
  if (counts.formUndecodable) {
    console.error(`\n${counts.formUndecodable} document(s) could not be decoded; this run is not complete.`)
    process.exit(1)
  }
  if (!args.apply) console.log('\nRe-run with --apply to write.')
}
