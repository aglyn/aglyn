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
 * Name every node that carries a retired colour (AGL-1431). READ ONLY.
 *
 * ```
 * npm run audit:retired-colours-data
 * node tools/scripts/audit-retired-colours-data.mjs --published-only
 * node tools/scripts/audit-retired-colours-data.mjs --host=DXnRbPH4CQ --json
 * ```
 *
 * Needs Admin-SDK credentials with ADC on `aglyn-main`. App Check blocks the
 * client SDK from Node, so there is no credential-free way to read this.
 *
 * ## Why this cannot be the CI gate, and what it is instead
 *
 * It reads production. CI has no ADC and should not have it, so this is a
 * periodic check and a repair tool — the thing you run when the scheduled
 * rendered census (`check-retired-colours.mjs`) goes red and you need to know
 * which node to open. The parts that CAN run in CI are the pure ones:
 * `lib/retired-colours.test.mjs` pins both detectors, including the msgpack
 * decode and the source sweep that keeps a retired colour from being minted by
 * our own tooling.
 *
 * ## Why it defaults to the marketing host alone
 *
 * `#0090d9` is retired for AGLYN. It is an ordinary colour on a customer site,
 * and AGL-1293 rejected a render-time remap for exactly this reason: the
 * renderer serves every tenant, and silently rewriting an author's pinned hex
 * would repaint customer content and make the colour picker lie. A sweep that
 * reported Northwind's blues as violations would be the same mistake in
 * reporting form. `--host=` opts in to another host deliberately.
 *
 * ## Two ways this would otherwise report a clean zero
 *
 *  * The parent `screens/{id}` document on the marketing host has NO `nodes`
 *    field — it carries `versionId`, and the nodes live in
 *    `versions/{versionId}`. Measured 2026-08-12: 62 of 62 marketing screens.
 *    Walking parents alone reads the whole corpus and finds nothing.
 *  * `nodes` is msgpack bytes on every one of those versions. A scan that
 *    treats a non-object field as absent reports zero across the corpus.
 *    `decodeNodesField` throws instead, and a throw is reported as an ERROR
 *    for that document.
 *
 * Both are asserted in `lib/retired-colours.test.mjs`, so the sweep cannot
 * quietly go blind in either direction.
 *
 * Drafts are included by default and labelled. An unpublished version serves
 * nobody today and is one Publish click from serving everybody, which is
 * precisely how AGL-1431 happened.
 *
 * Exit codes: 0 clean · 1 retired colours found · 2 operational.
 */

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  decodeNodesField,
  describeNodeFinding,
  findRetiredColoursInNodes,
} from './lib/retired-colours-nodes.mjs'
import { RETIRED_COLOURS } from './lib/retired-colours.mjs'

const arg = (name) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? null

const asJson = process.argv.includes('--json')
const publishedOnly = process.argv.includes('--published-only')
const hostId = arg('host')
/** The marketing site. Every other host is a customer site — see the header. */
const subdomain = arg('subdomain') ?? 'aglyn-marketing'

/** Where node documents live under a host. */
const KINDS = ['screens', 'layouts', 'components', 'templates']

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

async function resolveHost() {
  if (hostId) {
    const snapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!snapshot.exists) throw new Error(`host ${hostId} not found`)
    return snapshot
  }
  const matches = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .get()
  if (matches.size !== 1)
    throw new Error(
      `expected exactly one host with subdomain "${subdomain}", found ${matches.size}`,
    )
  return matches.docs[0]
}

const documents = []
const errors = []
let nodesWalked = 0
const forms = { map: 0, msgpack: 0, absent: 0 }

/** Audit one node-bearing document. `label` is what a repair ticket quotes. */
function audit(snapshot, label, meta) {
  let decoded
  try {
    decoded = decodeNodesField(snapshot.get('nodes'))
  } catch (error) {
    errors.push({
      path: snapshot.ref.path,
      error: String(error?.message ?? error),
    })
    return
  }
  forms[decoded.form] += 1
  if (decoded.form === 'absent') return

  const { findings, nodesWalked: walked } = findRetiredColoursInNodes(
    decoded.nodes,
  )
  nodesWalked += walked
  documents.push({
    path: snapshot.ref.path,
    label,
    ...meta,
    form: decoded.form,
    nodes: walked,
    findings,
  })
}

let host
try {
  host = await resolveHost()

  for (const kind of KINDS) {
    for (const parent of (await host.ref.collection(kind).get()).docs) {
      const name = parent.get('slug') ?? parent.get('displayName') ?? parent.id
      const publishedVersion = parent.get('versionId') ?? null

      // The parent doc is audited too. It carries the nodes on hosts that
      // store them inline, and nothing here should depend on which shape a
      // given host happens to use.
      audit(parent, `${kind}/${name}`, {
        kind,
        name,
        version: null,
        published: true,
      })

      for (const version of (await parent.ref.collection('versions').get())
        .docs) {
        const published = version.id === publishedVersion
        if (publishedOnly && !published) continue
        audit(version, `${kind}/${name}`, {
          kind,
          name,
          version: version.id,
          published,
        })
      }
    }
  }
} catch (error) {
  console.error(`FAILED: ${String(error?.message ?? error)}`)
  process.exit(2)
}

const dirty = documents.filter((doc) => doc.findings.length)

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        host: { id: host.id, subdomain: host.get('subdomain') ?? null },
        retired: RETIRED_COLOURS.map((colour) => colour.hex),
        scanned: documents.length,
        nodesWalked,
        forms,
        errors,
        documents: dirty,
      },
      null,
      2,
    )}\n`,
  )
} else {
  console.log(
    `retired colour data audit · host ${host.id} ` +
      `(${host.get('subdomain') ?? '?'}) · ${new Date().toISOString()}`,
  )
  console.log(
    `  ${documents.length} document(s) carried nodes — ` +
      `msgpack ${forms.msgpack}, map ${forms.map} · ` +
      `${nodesWalked} node(s) walked` +
      // Named, not hidden. A high `absent` count next to a clean verdict is
      // what a sweep looks like when it is reading the wrong level.
      `\n  ${forms.absent} document(s) had no \`nodes\` field — expected: on ` +
      `this host the parent screen holds a \`versionId\` and the nodes live ` +
      `in its versions`,
  )
  console.log('')

  for (const doc of dirty) {
    const provenance = doc.version
      ? `${doc.published ? 'PUBLISHED' : 'draft'} version ${doc.version}`
      : 'parent document'
    console.log(`  ${doc.label} — ${provenance}`)
    console.log(`    ${doc.path}`)
    for (const finding of doc.findings)
      console.log(`      ${describeNodeFinding(finding)}`)
    const total = doc.findings.reduce((sum, f) => sum + f.occurrences, 0)
    console.log(
      `      → ${total} occurrence(s) across ${doc.findings.length} value(s)`,
    )
    console.log('')
  }

  for (const failure of errors)
    console.log(`  ERROR ${failure.path} — ${failure.error}`)

  // A zero is the dangerous answer here, so say what it was measured over.
  if (!dirty.length)
    console.log(
      `No retired colour in ${nodesWalked} node(s) across ` +
        `${documents.length} document(s). ` +
        (publishedOnly ? 'Published versions only.' : 'Drafts included.'),
    )
  else
    console.log(
      `${dirty.length}/${documents.length} document(s) carry a retired colour. ` +
        'Each needs a DATA repair in the besigner — this script never writes.',
    )
}

if (errors.length) process.exit(2)
process.exit(dirty.length ? 1 : 0)
