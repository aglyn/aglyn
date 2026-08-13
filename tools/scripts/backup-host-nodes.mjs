/**
 * Snapshot every node document for a host, and put it back (AGL-1293).
 *
 *   node tools/scripts/backup-host-nodes.mjs --host=<hostId> --out=<file.json>
 *   node tools/scripts/backup-host-nodes.mjs --host=<hostId> --in=<file.json> [--apply]
 *
 * RESTORE IS DRY RUN BY DEFAULT.
 *
 * The data fixes in this directory rewrite live marketing content in place, and
 * some of them DELETE things (`fix-brand-blue-token.mjs` drops 454 `@scheme
 * dark` overrides). Those are derivable in principle and annoying in practice,
 * so take a snapshot first and stop having to reason about reversibility.
 *
 * `nodes` has two storage forms — a plain Firestore map and msgpack bytes — and
 * the form is a property of the document, not of the host. The snapshot records
 * which form each document used and restores it unchanged, base64 for bytes so
 * the file stays plain JSON.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : null
}
const apply = process.argv.includes('--apply')
const hostId = arg('host')
const out = arg('out')
const input = arg('in')

if (!hostId || (!out && !input)) {
  console.error('need --host=<id> and one of --out=<file> / --in=<file>')
  process.exit(1)
}

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const KINDS = ['screens', 'layouts', 'components', 'templates']

async function* nodeDocs(hostRef) {
  for (const kind of KINDS) {
    for (const parent of (await hostRef.collection(kind).get()).docs) {
      yield parent.ref
      for (const version of (await parent.ref.collection('versions').get()).docs) {
        yield version.ref
      }
    }
  }
}

const hostRef = firestore.collection('hosts').doc(hostId)
if (!(await hostRef.get()).exists) {
  console.error(`host ${hostId} not found`)
  process.exit(1)
}

if (out) {
  const entries = []
  const perForm = { map: 0, bytes: 0, absent: 0 }
  for await (const ref of nodeDocs(hostRef)) {
    const raw = (await ref.get()).get('nodes')
    if (raw === undefined || raw === null) {
      perForm.absent += 1
      continue
    }
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
      perForm.bytes += 1
      entries.push({ path: ref.path, form: 'bytes', base64: Buffer.from(raw).toString('base64') })
    } else {
      perForm.map += 1
      entries.push({ path: ref.path, form: 'map', nodes: raw })
    }
  }
  // The host theme too — `set-host-primary-dark.mjs` edits it, and it is small.
  const theme = (await hostRef.get()).get('theme') ?? null
  writeFileSync(out, JSON.stringify({ hostId, takenFor: 'AGL-1293', theme, entries }, null, 1))
  console.log(
    `snapshot → ${out}\n  ${entries.length} document(s) — map ${perForm.map}, ` +
      `msgpack ${perForm.bytes}, ${perForm.absent} without a \`nodes\` field`,
  )
  process.exit(0)
}

const snapshot = JSON.parse(readFileSync(input, 'utf8'))
if (snapshot.hostId !== hostId) {
  console.error(`snapshot is for host ${snapshot.hostId}, not ${hostId}`)
  process.exit(1)
}
let restored = 0
for (const entry of snapshot.entries) {
  const value =
    entry.form === 'bytes' ? Buffer.from(entry.base64, 'base64') : entry.nodes
  console.log(`${apply ? 'restore' : 'would restore'}  ${entry.path}  [${entry.form}]`)
  if (apply) await firestore.doc(entry.path).update({ nodes: value })
  restored += 1
}
if (snapshot.theme) {
  console.log(`${apply ? 'restore' : 'would restore'}  hosts/${hostId}.theme`)
  if (apply) await hostRef.update({ theme: snapshot.theme })
}
console.log(`\n${apply ? 'RESTORED' : 'DRY RUN'} — ${restored} document(s).`)
if (!apply) console.log('Re-run with --apply to write.')
