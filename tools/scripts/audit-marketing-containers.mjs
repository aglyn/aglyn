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
 * Census every page section's width on a host (AGL-1298). READ ONLY.
 *
 * ```
 * npm run audit:marketing-containers
 * node tools/scripts/audit-marketing-containers.mjs --include-deleted --json
 * node tools/scripts/audit-marketing-containers.mjs --subdomain=demo
 * ```
 *
 * Needs Admin-SDK credentials with ADC on `aglyn-main`. App Check blocks the
 * client SDK from Node, so there is no credential-free way to read this.
 *
 * ## Why this exists as a script rather than as a one-off scan
 *
 * AGL-1298 has been re-counted three times and the numbers disagreed every
 * time — "225 containers, 144 with a bespoke `sx.maxWidth: '1328px'`, 79 with
 * no cap" was already stale when it was written down, and nobody could tell
 * whether a later zero meant "swept" or "scanned blind". The corpus is DATA:
 * it changes when an author clicks, with no commit to diff. So the answer has
 * to be re-derivable on demand, and it has to report what it measured over.
 *
 * It answers the three questions that issue keeps asking:
 *
 *  1. **What width is each `muiContainer`?** `props.maxWidth`, counted.
 *  2. **Does any container still carry a bespoke `sx` cap?** A hand-rolled
 *     `sx.maxWidth` on a Container is the thing AGL-1298 exists to remove —
 *     1328 was 1280 + the Container's own 24px gutters, and it is not
 *     reproducible with a stock MUI width.
 *  3. **Does every page section sit in a Container?** the standard, stated
 *     2026-08-08: every section is a Container, and full-bleed is expressed
 *     with the width attribute rather than by omitting the component.
 *  4. **Does any Container sit INSIDE another one?** (AGL-2366) Two stock
 *     `xl` Containers, one nested in the other, take two sets of 24px
 *     gutters — so the inner one's content starts 24px right of every other
 *     section on the page while questions 1-3 all report clean. The
 *     changelog and newsroom lists shipped that way: the offending node was
 *     a single authored Container inside a `collectionEntries` block, which
 *     clones its children once per published entry, so ONE node produced ten
 *     misaligned rows on `/changelog` and one on `/newsroom`.
 *
 * ## Three ways a scan of this corpus reports a confident wrong answer
 *
 *  * The parent `screens/{id}` document has NO `nodes` field — it holds a
 *    `versionId`, and the nodes live in `versions/{versionId}`. Walking
 *    parents alone reads ~62 screens and finds nothing. Hence the `absent`
 *    count in the output: a clean verdict next to a large `absent` is what
 *    reading the wrong level looks like.
 *  * `nodes` is msgpack bytes on most documents. `decodeNodesField` throws
 *    rather than returning `{}`, so an undecodable document is an ERROR for
 *    that document and never a zero for the corpus.
 *  * Soft-deleted screens still carry nodes. Six starter-template screens
 *    (`home`, `about-us`, `contact-us`, `shop`, `cart`, `account`) sit in the
 *    marketing host's trash, and they are the ONLY screens whose sections
 *    lack a Container. Counting them turns a clean audit into a false 10-item
 *    work order, so they are excluded unless `--include-deleted` asks for
 *    them. `kind: 'email'` screens are excluded too — an email renders
 *    through the email pipeline, where Container is not a control.
 *
 * ## What counts as a "section"
 *
 * A depth-1 child of the document's root node — the band a page stacks. A
 * band is compliant when it IS a Container or CONTAINS one; the Container is
 * usually the band's direct child, but `Site nav` reaches it through a
 * Toolbar and that is fine, so the search is over the subtree and the depth
 * is reported. A `reusableInstance` band resolves to a component document
 * that is audited on its own, so it is counted as delegated, not as missing.
 *
 * Exit codes: 0 clean · 1 a bespoke cap, a non-stock width, a nested
 * Container or an uncontained section · 2 operational.
 */

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { decodeNodesField } from './lib/retired-colours-nodes.mjs'
// The detector itself, split out so it can be self-tested without Firestore
// (AGL-1296). `npm run test:marketing-containers` proves it flags a bespoke
// `sx` cap and a non-stock `props.maxWidth`, and only then is a clean census
// here worth anything.
import { auditContainerNodes } from './lib/marketing-containers.mjs'

const arg = (name) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? null

const asJson = process.argv.includes('--json')
const includeDeleted = process.argv.includes('--include-deleted')
const publishedOnly = process.argv.includes('--published-only')
const subdomain = arg('subdomain') ?? 'aglyn-marketing'

/** Where node documents live under a host. */
const KINDS = ['screens', 'layouts', 'components', 'templates']

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const forms = { map: 0, msgpack: 0, absent: 0 }
const errors = []
const widths = {}
const bespoke = []
/**
 * A `props.maxWidth` that is not one of MUI's six prebuilt values (AGL-1298).
 * The attribute dropdown cannot produce one, so a hit here means an import, an
 * API write or a pasted node map — the write paths the dropdown does not
 * cover, and the reason the ban needed measuring rather than assuming.
 */
const nonStock = []
const nested = []
const uncontained = []
let reads = 0
let documents = 0
let sections = 0
let skippedDocuments = 0

function auditDocument(snapshot, meta) {
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
  documents += 1

  const where = { ...meta, path: snapshot.ref.path, form: decoded.form }
  const census = auditContainerNodes(decoded.nodes, where)

  for (const [width, count] of Object.entries(census.widths))
    widths[width] = (widths[width] ?? 0) + count
  bespoke.push(...census.bespoke)
  nonStock.push(...census.nonStock)
  nested.push(...census.nested)
  uncontained.push(...census.uncontained)
  sections += census.sections
}

let host
try {
  const matches = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .get()
  reads += Math.max(matches.size, 1)
  if (matches.size !== 1)
    throw new Error(
      `expected exactly one host with subdomain "${subdomain}", found ${matches.size}`,
    )
  host = matches.docs[0]

  for (const kind of KINDS) {
    const parents = await host.ref.collection(kind).get()
    reads += Math.max(parents.size, 1)
    for (const parent of parents.docs) {
      const name = parent.get('slug') ?? parent.get('displayName') ?? parent.id
      // Trashed screens and email documents are not marketing sections. See
      // the header: counting them is what turns a clean audit into a false
      // work order.
      if (
        (!includeDeleted && parent.get('deletedAt')) ||
        parent.get('kind') === 'email'
      ) {
        skippedDocuments += 1
        continue
      }
      const publishedVersion = parent.get('versionId') ?? null

      auditDocument(parent, { kind, name, version: null, published: true })

      const versions = await parent.ref.collection('versions').get()
      reads += Math.max(versions.size, 1)
      for (const version of versions.docs) {
        const published = version.id === publishedVersion
        if (publishedOnly && !published) continue
        auditDocument(version, {
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

const total = Object.values(widths).reduce((sum, count) => sum + count, 0)

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        host: { id: host.id, subdomain: host.get('subdomain') ?? null },
        reads,
        documents,
        skippedDocuments,
        forms,
        containers: { total, widths },
        sections,
        bespoke,
        nonStock,
        nested,
        uncontained,
        errors,
      },
      null,
      2,
    )}\n`,
  )
} else {
  console.log(
    `container width census · host ${host.id} ` +
      `(${host.get('subdomain') ?? '?'}) · ${new Date().toISOString()}`,
  )
  console.log(
    `  ${documents} document(s) carried nodes — ` +
      `msgpack ${forms.msgpack}, map ${forms.map} · ` +
      `${reads} read(s)` +
      // Named, not hidden. A clean verdict beside a large `absent` is what a
      // sweep looks like when it is reading parents instead of versions.
      `\n  ${forms.absent} document(s) had no \`nodes\` field — expected: the ` +
      `parent screen holds a \`versionId\` and the nodes live in its versions` +
      `\n  ${skippedDocuments} document(s) skipped as trashed or email` +
      (includeDeleted ? ' (deleted included)' : ''),
  )
  console.log(`\n  ${total} Container(s):`)
  for (const [width, count] of Object.entries(widths).sort(
    (a, b) => b[1] - a[1],
  ))
    console.log(`    props.maxWidth=${width} — ${count}`)

  console.log(`\n  ${sections} page section(s) audited.`)
  if (uncontained.length) {
    console.log(`  ${uncontained.length} NOT wrapped in a Container:`)
    for (const band of uncontained)
      console.log(
        `    ${band.kind}/${band.name} — ${band.componentId} ${band.nodeId}` +
          `${band.label ? ` (${band.label})` : ''}, ${band.blocks} block(s)` +
          `\n      ${band.path}`,
      )
  } else console.log('  Every section resolves to a Container.')

  if (bespoke.length) {
    console.log(`\n  ${bespoke.length} Container(s) carry a bespoke sx cap:`)
    for (const hit of bespoke)
      console.log(
        `    ${hit.kind}/${hit.name} ${hit.nodeId} — sx.maxWidth=` +
          `${JSON.stringify(hit.sx)}, props.maxWidth=${JSON.stringify(hit.props)}` +
          `\n      ${hit.path}`,
      )
  } else console.log('\n  No Container carries a bespoke `sx` width cap.')

  if (nonStock.length) {
    console.log(
      `\n  ${nonStock.length} Container(s) carry a NON-STOCK props.maxWidth:`,
    )
    for (const hit of nonStock)
      console.log(
        `    ${hit.kind}/${hit.name} ${hit.nodeId} — props.maxWidth=` +
          `${JSON.stringify(hit.props)}\n      ${hit.path}`,
      )
  } else console.log('  Every props.maxWidth is a prebuilt breakpoint.')

  if (nested.length) {
    console.log(
      `\n  ${nested.length} Container(s) sit INSIDE another Container ` +
        '(double gutters, +24px):',
    )
    for (const hit of nested)
      console.log(
        `    ${hit.kind}/${hit.name} ${hit.nodeId} — inside ${hit.ancestorId}` +
          `${hit.through.length ? ` via ${hit.through.join(' > ')}` : ''}` +
          `${hit.repeats ? ' — REPEATS once per published entry' : ''}` +
          `\n      ${hit.path}`,
      )
  } else console.log('  No Container sits inside another Container.')

  for (const failure of errors)
    console.log(`  ERROR ${failure.path} — ${failure.error}`)
}

if (errors.length) process.exit(2)
process.exit(
  bespoke.length || nonStock.length || nested.length || uncontained.length
    ? 1
    : 0,
)
