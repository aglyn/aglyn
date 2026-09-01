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
 * Store every `nodes` tree as msgpack. DRY RUN BY DEFAULT.
 *
 *   node tools/scripts/backfill-compress-nodes.mjs [--host=<id>] [--apply]
 *   node tools/scripts/backfill-compress-nodes.mjs --self-test
 *
 * ## What this is for
 *
 * Every WRITE path now compresses (AGL-1151). The corpus does not: a document
 * written before its path learned to is still a plain Firestore map, and
 * nothing converts one until somebody happens to open and re-save it. This
 * converts the rest.
 *
 * ## Why a plain map costs something
 *
 * Firestore's per-document ceiling is 1 MiB and it is HARD — a screen that
 * reaches it can no longer be saved at all, which is data loss from the
 * author's point of view. Measured across production, the same tree stored as
 * a Firestore map costs 1.38x–1.49x what it costs as msgpack, so the encoding
 * alone decides whether a large page has room to grow.
 *
 * It also decides whether the editor's own warning is true. `measureNodeMap`
 * sizes a tree with the msgpack encoder, correctly for the documents that use
 * it — so for a plain-map document the near-limit warning reads the SMALLER
 * number, and the first thing an author learns about the ceiling is a save
 * that stopped working.
 *
 * ## Idempotent
 *
 * A document already stored as msgpack is counted and skipped, so a second
 * run writes nothing. That is what makes a partial run safe to repeat: the
 * scan is per-document and stateless, and resuming costs reads rather than
 * correctness.
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
 * Firestore's hard per-document ceiling, and the two thresholds the besigner
 * warns and refuses at. Mirrored from `measure-node-map.ts` rather than
 * imported: this is a plain `.mjs` script with no TypeScript build step, and
 * the numbers are reported here only to say how close a document is.
 */
const DOC_LIMIT_BYTES = 1_048_576
const WARN_BYTES = 700_000
const MAX_BYTES = 900_000

/**
 * Every per-host collection whose documents carry a `nodes` tree, and whether
 * the tree is on the PARENT document, on its `versions`, or on both.
 *
 * `templates` is parent-only: a template is inert until instantiated, so it
 * never versions. Everything else keeps editing history on `versions`, and
 * `components` and `forms` ALSO carry a published copy on the parent — the
 * tenant runtime reads every component in one collection query, so relocating
 * that copy would make a page render N+1.
 */
const HOST_KINDS = [
  { name: 'screens', parent: false, versions: true, drafts: true },
  { name: 'layouts', parent: false, versions: true, drafts: true },
  { name: 'components', parent: true, versions: true, drafts: true },
  { name: 'forms', parent: true, versions: true, drafts: true },
  { name: 'templates', parent: true, versions: false, drafts: false },
  { name: 'emailTemplates', parent: false, versions: true, drafts: false },
]

/**
 * The staff-owned email collection, which is TOP LEVEL rather than per-host.
 * Absent from the other node backfills, which walk `hosts/*` only — so its
 * seven version documents have never been swept by anything.
 */
const PLATFORM_KIND = { name: 'systemEmailTemplates', versions: true }

const args = parseDeployArgs({
  command: 'backfill-compress-nodes',
  summary:
    'Store every `nodes` tree as msgpack rather than as a plain Firestore ' +
    'map, which costs about 1.4x the bytes against a hard 1 MiB per-document ' +
    'ceiling. Writes to the live project with --apply.',
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

/** Per-kind tallies, so "0 changed" can be told from "decoded nothing". */
const kinds = new Map()
function bucket(kind) {
  if (!kinds.has(kind)) {
    kinds.set(kind, {
      docs: 0,
      map: 0,
      msgpack: 0,
      undecodable: 0,
      mapStored: 0,
      mapPacked: 0,
      converted: 0,
      nearLimitBefore: 0,
      overLimitBefore: 0,
    })
  }
  return kinds.get(kind)
}

/**
 * Firestore's OWN field-size accounting, so "stored bytes" means the bytes
 * this document actually spends against the ceiling.
 *
 * A JSON length would understate a map badly: Firestore charges the key
 * string plus a terminating byte for every entry at every depth, plus 32
 * bytes of overhead per map — which is most of the difference this script
 * exists to recover.
 */
function stringSize(value) {
  return Buffer.byteLength(value, 'utf8') + 1
}
export function fieldSize(value) {
  if (value === null || value === undefined) return 1
  if (typeof value === 'boolean') return 1
  if (typeof value === 'number') return 8
  if (typeof value === 'string') return stringSize(value)
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.length
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + fieldSize(item), 0)
  }
  if (typeof value === 'object') {
    // A Firestore Timestamp is 8 bytes, not the two numbers it looks like.
    if (typeof value.toDate === 'function') return 8
    let total = 32
    for (const [key, item] of Object.entries(value)) {
      total += stringSize(key) + fieldSize(item)
    }
    return total
  }
  return 8
}

/**
 * What this document holds and what converting it would do, or `null` when
 * there is nothing to convert.
 *
 * Pure, so `--self-test` can drive it with no project: the traversal is I/O
 * and the decision is not, and only the decision is worth a fixture.
 */
export function planDocument(raw) {
  if (raw === null || raw === undefined) return null
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      decode(bytes)
    } catch (error) {
      // Counted, never swallowed. A decode failure that reported nothing is
      // how a run over compressed documents looks exactly like a clean one.
      return { form: 'undecodable', reason: error.message }
    }
    // ALREADY DONE. This is what makes a second run write nothing.
    return { form: 'bytes', stored: bytes.length }
  }
  if (typeof raw !== 'object') return null
  const stored = fieldSize(raw)
  let packed
  try {
    packed = Buffer.from(encode(raw))
  } catch (error) {
    return { form: 'unencodable', reason: error.message }
  }
  return { form: 'map', stored, packed, saves: stored - packed.length }
}

async function processDoc(kind, ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  const tally = bucket(kind)
  const plan = planDocument(snapshot.get('nodes'))
  if (!plan) return
  tally.docs += 1

  if (plan.form === 'undecodable' || plan.form === 'unencodable') {
    tally.undecodable += 1
    console.warn(`  ! ${ref.path} — ${plan.form}: ${plan.reason}`)
    return
  }
  if (plan.form === 'bytes') {
    tally.msgpack += 1
    return
  }

  tally.map += 1
  tally.mapStored += plan.stored
  tally.mapPacked += plan.packed.length
  if (plan.stored > MAX_BYTES) tally.overLimitBefore += 1
  else if (plan.stored > WARN_BYTES) tally.nearLimitBefore += 1
  tally.converted += 1
  const pct = ((plan.saves / plan.stored) * 100).toFixed(1)
  console.log(
    `  ${ref.path} — ${plan.stored} -> ${plan.packed.length} bytes ` +
      `(saves ${plan.saves}, ${pct}%)`,
  )
  // ONLY `nodes`. An `update` naming one field leaves the rest of the
  // document exactly as it was, which matters because several of these
  // documents carry fields the rules freeze against a client write.
  if (apply) await ref.update({ nodes: plan.packed })
}

/* ── SELF-TEST ────────────────────────────────────────────────────────────
 *
 * The fixtures answer what a run cannot: does it convert a map, does it leave
 * an already-converted document alone (which is what makes the script
 * idempotent), does the round trip preserve the tree, and does it measure a
 * map the way Firestore charges for one. It touches no project and is the
 * thing to run before pointing this at one.
 */
function selfTest() {
  const failures = []
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) failures.push(`${name}\n    expected ${b}\n    actual   ${a}`)
  }

  const tree = {
    '_@_': { $id: '_@_', componentId: 'container', nodes: ['t1'] },
    t1: {
      $id: 't1',
      componentId: 'muiTypography',
      parentId: '_@_',
      props: { children: 'Some copy long enough to be worth encoding' },
    },
  }

  const fromMap = planDocument(tree)
  check('reads a plain map as a map', fromMap?.form, 'map')
  check('round-trips the tree', decode(fromMap.packed), tree)
  check('reports a saving', fromMap.saves > 0, true)
  check(
    'measures the map larger than the encoding',
    fromMap.stored > fromMap.packed.length,
    true,
  )

  // IDEMPOTENCE, which is the property a re-run depends on.
  const fromBytes = planDocument(fromMap.packed)
  check('reads its own output as bytes', fromBytes?.form, 'bytes')
  check('has nothing to convert on a second pass', fromBytes.packed, undefined)

  // The pooled Buffer firebase-admin actually hands back: a view at a
  // non-zero offset into a shared allocation. Decoding the whole backing
  // ArrayBuffer instead of the field throws on the trailing bytes.
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const pooled = pool.subarray(64, 64 + fromMap.packed.length)
  fromMap.packed.copy(pooled)
  check('premise: the fixture is pooled', pooled.byteOffset > 0, true)
  check('reads a pooled Buffer as bytes', planDocument(pooled)?.form, 'bytes')

  check('reports an absent field as nothing to do', planDocument(undefined), null)
  check('reports a null field as nothing to do', planDocument(null), null)
  check(
    'reports undecodable bytes rather than skipping them',
    planDocument(Buffer.from([0xc1, 0xc1, 0xc1]))?.form,
    'undecodable',
  )

  // The size model, against values Firestore's own documentation fixes.
  check('a boolean is 1 byte', fieldSize(true), 1)
  check('a number is 8 bytes', fieldSize(1234), 8)
  check('a string is its utf8 length plus 1', fieldSize('abc'), 4)
  check('a map carries 32 bytes of overhead', fieldSize({}), 32)
  check('a map charges for its keys', fieldSize({ ab: true }), 32 + 3 + 1)

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

  let hostsScanned = 0
  for (const host of hosts) {
    if (!host.exists) {
      console.error(`host ${onlyHost} not found`)
      process.exit(1)
    }
    hostsScanned += 1
    console.log(`\n${host.id}`)
    for (const kind of HOST_KINDS) {
      const parents = await host.ref.collection(kind.name).get()
      for (const parent of parents.docs) {
        if (kind.parent) await processDoc(kind.name, parent.ref)
        if (!kind.versions) continue
        // EVERY version, not only the published one. A restore point left as
        // a plain map is a document that inflates the moment it is restored.
        const versions = await parent.ref.collection('versions').get()
        for (const version of versions.docs) {
          await processDoc(`${kind.name}/versions`, version.ref)
          if (!kind.drafts) continue
          const drafts = await version.ref.collection('draft').get()
          for (const draft of drafts.docs) {
            await processDoc(`${kind.name}/versions/draft`, draft.ref)
          }
        }
      }
    }
  }

  // The staff collection, only on a full run: it is not per-host, so a
  // --host run has no business touching it.
  if (!onlyHost) {
    console.log(`\n${PLATFORM_KIND.name}`)
    const templates = await firestore.collection(PLATFORM_KIND.name).get()
    for (const template of templates.docs) {
      const versions = await template.ref.collection('versions').get()
      for (const version of versions.docs) {
        await processDoc(`${PLATFORM_KIND.name}/versions`, version.ref)
      }
    }
  }

  const totals = {
    docs: 0,
    map: 0,
    msgpack: 0,
    undecodable: 0,
    stored: 0,
    packed: 0,
  }
  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${hostsScanned} host(s)\n\n` +
      'kind                              nodes    map  msgpk  undec' +
      '      stored ->      packed',
  )
  for (const [kind, tally] of [...kinds].sort()) {
    totals.docs += tally.docs
    totals.map += tally.map
    totals.msgpack += tally.msgpack
    totals.undecodable += tally.undecodable
    totals.stored += tally.mapStored
    totals.packed += tally.mapPacked
    console.log(
      `${kind.padEnd(32)} ${String(tally.docs).padStart(5)} ` +
        `${String(tally.map).padStart(6)} ${String(tally.msgpack).padStart(6)} ` +
        `${String(tally.undecodable).padStart(6)} ` +
        `${String(tally.mapStored).padStart(11)} -> ` +
        `${String(tally.mapPacked).padStart(11)}`,
    )
  }
  const saved = totals.stored - totals.packed
  console.log(
    `\n${totals.docs} document(s) with nodes — ${totals.map} map, ` +
      `${totals.msgpack} msgpack, ${totals.undecodable} undecodable.\n` +
      `Converting the map documents: ${totals.stored} -> ${totals.packed} ` +
      `bytes, saving ${saved}` +
      (totals.stored
        ? ` (${((saved / totals.stored) * 100).toFixed(1)}%).`
        : '.'),
  )

  // The ceiling, named rather than left to arithmetic: this is the number the
  // whole exercise is about, and a document over it cannot be saved at all.
  const near = [...kinds.values()].reduce((n, t) => n + t.nearLimitBefore, 0)
  const over = [...kinds.values()].reduce((n, t) => n + t.overLimitBefore, 0)
  if (near || over) {
    console.log(
      `\n${over} map document(s) past the ${MAX_BYTES}-byte refuse threshold ` +
        `and ${near} past the ${WARN_BYTES}-byte warn threshold, measured as ` +
        `stored. The hard ceiling is ${DOC_LIMIT_BYTES}.`,
    )
  }

  if (totals.undecodable) {
    console.error(
      `\n${totals.undecodable} document(s) could not be decoded and were ` +
        'SKIPPED. Their nodes were not examined; this run is not complete.',
    )
    process.exit(1)
  }
  if (!apply) console.log('\nRe-run with --apply to write.')
}
