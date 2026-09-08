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
 * Stamp the current content pin onto every stored media reference
 * (AGL-2685). DRY RUN BY DEFAULT.
 *
 *   node tools/scripts/backfill-media-content-pins.mjs [--host=<id>] [--media=<id>] [--apply]
 *   node tools/scripts/backfill-media-content-pins.mjs --self-test
 *
 * ## What a pin buys, and why this is an optimisation rather than a repair
 *
 * `media:{scope}/{id}` resolves to the CDN's stable URL, cached in a browser
 * for 60 seconds. `media:{scope}/{id}@{contentHash}` resolves to the
 * immutable URL, cached for a year. Every reference written since the picker
 * learned to pin already carries one; this is the corpus that predates it.
 *
 * Nothing here fixes a defect. An unpinned reference renders exactly as it
 * always has, and a run that changes nothing costs nothing. That is the
 * frame to keep while reading the guards below: the failure mode worth
 * spending care on is not "a pin was missed", it is "a document was damaged
 * in pursuit of a cache header".
 *
 * ## Why a stale pin is safe to write, and why it is still worth re-running
 *
 * A pin can go stale the moment the asset is REPLACED. `serveMediaCdn`
 * answers a stale one with a 302 to the stable URL, so a stale pin costs an
 * extra hop and never a broken image. Re-running with `--media=<id>` after a
 * replace is how that hop goes away; it is a tidy-up, and it is why this
 * script is Repeatable rather than a one-shot.
 *
 * ## What it will not do
 *
 * - **It never removes a reference or changes which asset one names.** The
 *   only edit is the pin, and {@link repinString} is a pure function over one
 *   string so that claim is checkable rather than asserted.
 * - **It never invents a pin.** An asset whose media document is missing, or
 *   carries no `contentHash` (a legacy upload), is left exactly as found.
 * - **It never widens a scope.** The reference's own scope segment is what
 *   the media document is looked up under.
 *
 * ## The two storage forms
 *
 * `nodes` is stored as a plain Firestore map OR as msgpack bytes, and both
 * are live. A reader that handles one walks the whole corpus, matches nothing
 * and reports a clean zero — indistinguishable from "there was nothing to
 * pin". The per-form counts at the end are what tell those apart, and the
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
 * Every per-host collection whose documents carry a `nodes` tree.
 *
 * Deliberately the same list `backfill-node-plugin-ids.mjs` uses, including
 * `forms` and `emailTemplates` — a form's design and a per-site email design
 * are both besigner documents and both can hold a picked image.
 */
const KINDS = [
  'screens',
  'layouts',
  'components',
  'templates',
  'forms',
  'emailTemplates',
]

/**
 * A stored media reference, with the optional pin as a separate group.
 *
 * Mirrors `mediaRefPattern` / `parseMediaRef` in
 * `libs/aglyn/src/lib/app-utils/media-ref.ts` and is deliberately a COPY: a
 * `.mjs` deploy script cannot import a TypeScript path alias, and the
 * alternative — a looser regex written from memory — is how a rewrite over
 * customer documents matches something it should not. The self-test drives
 * the same shapes that module's spec does.
 *
 * The trailing guard is what stops `med1` matching inside `med12`. `@` sits
 * outside the segment grammar, so a pinned reference satisfies it too.
 */
const SEG = '[A-Za-z0-9_-]{1,64}'
const REFERENCE = new RegExp(
  `media:((?:org:${SEG}(?::${SEG})?)|${SEG})/(${SEG})(@${SEG})?(?![A-Za-z0-9_-])`,
  'g',
)

const args = parseDeployArgs({
  command: 'backfill-media-content-pins',
  summary:
    'Stamp each stored media reference with its asset’s current content ' +
    'hash, so it resolves to the CDN’s immutable URL. Writes to the live ' +
    'project with --apply.',
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
    {
      flag: '--media',
      key: 'media',
      value: 'string',
      describe: 'Limit to one asset — the post-replace re-pin.',
    },
  ],
})

const apply = args.apply
const onlyHost = args.host
const onlyMedia = args.media

const counts = {
  hostsScanned: 0,
  docsScanned: 0,
  docsWithNodes: 0,
  formMap: 0,
  formBytes: 0,
  formUndecodable: 0,
  referencesSeen: 0,
  referencesPinned: 0,
  referencesRepinned: 0,
  referencesUnresolvable: 0,
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

/** Every `{scope, mediaId}` a value mentions, at any depth. */
export function collectReferences(value, found = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(REFERENCE)) found.add(`${match[1]}/${match[2]}`)
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, found)
    return found
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectReferences(item, found)
    return found
  }
  return found
}

/**
 * One string with every reference re-pinned, and how many changed.
 *
 * Pure, and the whole correctness argument lives here: `hashes` is a plain
 * lookup, so the self-test drives every branch with no project. A reference
 * whose asset is absent from `hashes`, or whose pin is already current, comes
 * back byte-identical.
 */
export function repinString(value, hashes) {
  let changed = 0
  const next = value.replace(REFERENCE, (whole, scope, mediaId, pin) => {
    counts.referencesSeen += 1
    const hash = hashes.get(`${scope}/${mediaId}`)
    if (!hash) {
      counts.referencesUnresolvable += 1
      return whole
    }
    const wanted = `media:${scope}/${mediaId}@${hash}`
    if (whole === wanted) return whole
    changed += 1
    if (pin) counts.referencesRepinned += 1
    else counts.referencesPinned += 1
    return wanted
  })
  return { value: next, changed }
}

/** {@link repinString} over an arbitrary structure, rebuilt not mutated. */
export function repinValue(value, hashes) {
  if (typeof value === 'string') {
    const { value: next, changed } = repinString(value, hashes)
    return { value: next, changed }
  }
  if (Array.isArray(value)) {
    let changed = 0
    const next = value.map((item) => {
      const result = repinValue(item, hashes)
      changed += result.changed
      return result.value
    })
    return { value: changed ? next : value, changed }
  }
  if (value && typeof value === 'object') {
    let changed = 0
    const next = {}
    for (const [key, item] of Object.entries(value)) {
      const result = repinValue(item, hashes)
      changed += result.changed
      next[key] = result.value
    }
    return { value: changed ? next : value, changed }
  }
  return { value, changed: 0 }
}

/* ── PROJECT I/O ──────────────────────────────────────────────────────── */

/** `contentHash` per `{scope}/{mediaId}`, read once and remembered. */
function makeHashReader(firestore) {
  const cache = new Map()
  return async (key) => {
    if (cache.has(key)) return cache.get(key)
    const [scope, mediaId] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
    // `org:{orgId}` and `org:{orgId}:{hostId}` both name ORG media; the host
    // qualification is a delivery-time scope check, not a second library.
    const isOrg = scope.startsWith('org:')
    const owner = isOrg ? scope.slice('org:'.length).split(':')[0] : scope
    let hash
    try {
      const snapshot = await firestore
        .collection(isOrg ? 'orgs' : 'hosts')
        .doc(owner)
        .collection('media')
        .doc(mediaId)
        .get()
      // A deleted asset keeps its reference — the pin is not the place to
      // discover that, and stamping one would make a tombstone look current.
      hash =
        snapshot.exists && !snapshot.get('deletedAt')
          ? String(snapshot.get('contentHash') ?? '') || undefined
          : undefined
    } catch (error) {
      console.warn(`  ! could not read media ${key}: ${error.message}`)
      hash = undefined
    }
    cache.set(key, hash)
    return hash
  }
}

async function processDoc(ref, hashFor) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  counts.docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return
  counts.docsWithNodes += 1

  // Resolve first, substitute second: the rewrite is synchronous so it can be
  // a pure function, which is the only reason its behaviour is testable.
  const keys = [...collectReferences(nodes)].filter(
    (key) => !onlyMedia || key.endsWith(`/${onlyMedia}`),
  )
  if (!keys.length) return
  const hashes = new Map()
  for (const key of keys) {
    const hash = await hashFor(key)
    if (hash) hashes.set(key, hash)
  }
  if (!hashes.size) return

  const { value: next, changed } = repinValue(nodes, hashes)
  if (!changed) return
  counts.docsChanged += 1
  console.log(`  ${ref.path} — ${changed} reference(s)`)
  if (apply) await ref.update({ nodes: writeNodes(form, next) })
}

/* ── SELF-TEST ────────────────────────────────────────────────────────────
 *
 * The fixtures answer what a run cannot: does it pin an unpinned reference,
 * re-pin a stale one, leave a current one and an unknown asset alone, refuse
 * to touch a neighbouring id, and does a msgpack round-trip come back in the
 * same shape. It touches no project and is the thing to run before pointing
 * this at one.
 */
function selfTest() {
  const failures = []
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) failures.push(`${name}\n    expected ${b}\n    actual   ${a}`)
  }
  const HASH = 'abc123def4567890'
  const hashes = new Map([
    ['site-a/med1', HASH],
    ['org:o1:h2/med9', HASH],
  ])

  check(
    'pins an unpinned reference',
    repinString('media:site-a/med1', hashes).value,
    `media:site-a/med1@${HASH}`,
  )
  check(
    're-pins a stale one',
    repinString('media:site-a/med1@oldhash', hashes).value,
    `media:site-a/med1@${HASH}`,
  )
  check(
    'leaves a current one byte-identical',
    repinString(`media:site-a/med1@${HASH}`, hashes).changed,
    0,
  )
  check(
    'leaves an asset it could not resolve alone',
    repinString('media:site-a/unknown', hashes).value,
    'media:site-a/unknown',
  )
  check(
    'pins a host-qualified org reference',
    repinString('media:org:o1:h2/med9', hashes).value,
    `media:org:o1:h2/med9@${HASH}`,
  )
  check(
    'does not touch a NEIGHBOURING id',
    repinString('media:site-a/med12', hashes).value,
    'media:site-a/med12',
  )
  check(
    'rewrites a reference embedded in prose',
    repinString('![alt](media:site-a/med1) and more', hashes).value,
    `![alt](media:site-a/med1@${HASH}) and more`,
  )
  check(
    'rewrites every occurrence in one string',
    repinString('media:site-a/med1 media:site-a/med1', hashes).changed,
    2,
  )
  check(
    'leaves a plain URL alone',
    repinString('https://example.com/a.png', hashes).value,
    'https://example.com/a.png',
  )

  const tree = {
    root: { $id: 'root', props: { src: 'media:site-a/med1' } },
    n2: { $id: 'n2', props: { poster: 'media:site-a/med1@oldhash', alt: 'x' } },
    n3: { $id: 'n3', props: { src: 'https://example.com/a.png' } },
    n4: { $id: 'n4', props: { items: ['media:org:o1:h2/med9'] } },
  }
  const repinned = repinValue(tree, hashes)
  check('walks nested props', repinned.value.root.props.src, `media:site-a/med1@${HASH}`)
  check('walks arrays', repinned.value.n4.props.items[0], `media:org:o1:h2/med9@${HASH}`)
  check('counts every change', repinned.changed, 3)
  check('does not mutate the input', tree.root.props.src, 'media:site-a/med1')
  check('leaves an untouched branch identical', repinned.value.n3, tree.n3)
  check(
    'collects the references it will need',
    [...collectReferences(tree)].sort(),
    ['org:o1:h2/med9', 'site-a/med1'],
  )
  check('a tree with nothing to do reports zero', repinValue(tree.n3, hashes).changed, 0)

  // The msgpack half. A backfill that only ever read plain maps would pass
  // every assertion above and rewrite nothing in production.
  const round = readNodes(Buffer.from(encode(tree)))
  check('decodes msgpack bytes', round?.form, 'bytes')
  check('finds the reference inside them', round?.nodes.root.props.src, 'media:site-a/med1')
  const written = writeNodes('bytes', repinValue(round.nodes, hashes).value)
  check('writes msgpack back as bytes', Buffer.isBuffer(written), true)
  check(
    'round-trips the pin',
    decode(written).root.props.src,
    `media:site-a/med1@${HASH}`,
  )
  check('leaves a map a map', typeof writeNodes('map', tree), 'object')
  check('a map is not a Buffer', Buffer.isBuffer(writeNodes('map', tree)), false)

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
  const hashFor = makeHashReader(firestore)

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
        await processDoc(parent.ref, hashFor)
        // EVERY version, not only the published one. A restore point holding
        // an unpinned reference is not wrong, but it is the version somebody
        // rolls back to, and leaving it behind means the pin quietly
        // regresses the day they do.
        const versions = await parent.ref.collection('versions').get()
        for (const version of versions.docs) await processDoc(version.ref, hashFor)
      }
    }
  }

  // The intermediate counts, not just the final one. "0 changed" reads
  // identically whether every reference was already pinned or the script
  // decoded nothing at all, and those need very different responses.
  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${counts.hostsScanned} host(s), ` +
      `${counts.docsScanned} document(s), ${counts.docsWithNodes} with nodes ` +
      `(${counts.formMap} map, ${counts.formBytes} msgpack, ` +
      `${counts.formUndecodable} undecodable), ${counts.referencesSeen} ` +
      `reference(s), ${counts.referencesPinned} newly pinned, ` +
      `${counts.referencesRepinned} re-pinned, ` +
      `${counts.referencesUnresolvable} left alone (asset missing, deleted, ` +
      `or carrying no contentHash), across ${counts.docsChanged} document(s).`,
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
