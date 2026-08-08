/**
 * Blog entry title is not an `h1` (AGL-1291).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/fix-blog-entry-h1.mjs [--apply] [--host=<hostId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * The entry template renders `{{entry.title}}` as a Typography with
 * `variant: 'h3'` and no `component`, so MUI emits an `<h3>`. Every published
 * entry therefore ships with **no `<h1>` at all** while its body headings are
 * `<h2>` — the document outline starts at level 2 and the title sits below it.
 *
 * `component` overrides the rendered element without touching the type scale,
 * so the fix is one prop: the title keeps its h3 styling and becomes the page's
 * `h1`. Verified on three live entries, each reporting `h1=0, h2=4..5`.
 *
 * Idempotent: a title that already carries `component` is left alone.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'

const apply = process.argv.includes('--apply')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

/** The token an entry template binds its title to. */
const TITLE_TOKEN = '{{entry.title}}'

/**
 * Only a template that renders ONE entry may promote its title to `h1`.
 *
 * A list template binds the same `{{entry.title}}` token, but it renders it
 * once per card — promoting that would put a dozen `<h1>`s on `/blog`, which is
 * worse than the zero we started with. Caught by the dry run before it landed.
 */
const isEntryTemplate = (path) => /entrytmpl/i.test(path) && !/list/i.test(path)

function readNodes(raw) {
  if (raw === undefined || raw === null) return null
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      return { form: 'bytes', nodes: decode(bytes) }
    } catch (error) {
      console.warn(`  ! could not decode msgpack nodes: ${error.message}`)
      return null
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return { form: 'map', nodes: raw }
  return null
}

const writeNodes = (form, nodes) =>
  form === 'bytes' ? Buffer.from(encode(nodes)) : nodes

let docsScanned = 0
let titlesSeen = 0
let docsChanged = 0
let titlesFixed = 0

async function processDoc(ref) {
  const snapshot = await ref.get()
  if (!snapshot.exists) return
  docsScanned += 1
  const read = readNodes(snapshot.get('nodes'))
  if (!read) return
  const { form, nodes } = read
  if (!nodes || typeof nodes !== 'object') return

  const next = {}
  let changed = 0
  for (const [id, node] of Object.entries(nodes)) {
    const props = node?.props
    const binds =
      props && typeof props.children === 'string' &&
      props.children.includes(TITLE_TOKEN)
    if (!binds) {
      next[id] = node
      continue
    }
    titlesSeen += 1
    if (!isEntryTemplate(ref.path)) {
      console.log(
        `  - ${ref.path}#${id} SKIPPED — renders per card, not once per page`,
      )
      next[id] = node
      continue
    }
    if (props.component) {
      // Already explicit — respect whatever the author chose.
      console.log(`  = ${ref.path}#${id} already renders as <${props.component}>`)
      next[id] = node
      continue
    }
    next[id] = { ...node, props: { ...props, component: 'h1' } }
    changed += 1
    titlesFixed += 1
    console.log(
      `${apply ? 'write' : 'would write'}  ${ref.path}#${id}  variant=${props.variant ?? '-'} → component="h1"`,
    )
  }

  if (!changed) return
  docsChanged += 1
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
  for (const kind of ['screens', 'templates', 'layouts', 'components']) {
    const parents = await host.ref.collection(kind).get()
    for (const parent of parents.docs) {
      await processDoc(parent.ref)
      const versions = await parent.ref.collection('versions').get()
      for (const version of versions.docs) await processDoc(version.ref)
    }
  }
}

// "0 changed" is ambiguous alone — it reads the same whether every title was
// already correct or none were found. Report what was actually seen.
console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${docsScanned} document(s), ` +
    `${titlesSeen} title node(s) bound to ${TITLE_TOKEN}, ` +
    `${docsChanged} document(s) needed changes, ${titlesFixed} title(s) ${apply ? 'fixed' : 'pending'}.`,
)
if (!apply) console.log('\nRe-run with --apply to write.')
