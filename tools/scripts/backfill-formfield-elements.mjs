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
 * Rebuild every saved all-in-one Form Field (`formField`) from MUI's separate
 * form elements. DRY RUN BY DEFAULT.
 *
 *   node tools/scripts/backfill-formfield-elements.mjs [--host=<id>] [--apply]
 *   node tools/scripts/backfill-formfield-elements.mjs --self-test
 *
 * ## What it does
 *
 * Each `formField` node becomes a Form Control (same id, same `sx`) holding a
 * Form Label and the answer element (Input, Select › Select Options, Radio
 * Group › Choice Labels › Radios, Choice Labels › Checkboxes, Rating), built
 * by `formFieldToElements` in `libs/plugins/forms/src/lib/model/
 * form-field-elements.ts` — the same function the seeds and presets follow,
 * imported straight from its TypeScript source (Node strips the types).
 *
 * A placed form's (and a reusable component instance's) `attrOverrides`
 * keyed by a field's id are re-keyed onto the piece that now owns each prop
 * (`rekeyFormFieldOverrides`): `label` onto the Form Label, `placeholder` and
 * `fieldName` onto the Input. That read needs the DEFINITION, so the host's
 * form designs and component definitions are read first; the re-key works
 * whether a definition was migrated already or not, so a re-run is a no-op.
 *
 * ## What it reports and cannot fix
 *
 * An `sx` that reaches into the TextField the old element drew
 * (`& .MuiInputLabel-root`, `& .MuiOutlinedInput-notchedOutline`, …) may match
 * nothing once the field is separate elements. Every such style — on a field
 * itself or in a placement's override of one — is listed with its host,
 * document and node so a person can restate it on the right element. So is
 * every placement override with no new home (`fieldType`, `options`).
 *
 * ## The two storage forms
 *
 * `nodes` is a plain Firestore map OR msgpack bytes, both live; it is read in
 * either and written back in the form it came out of (see
 * `backfill-node-plugin-ids.mjs`, which this follows). Every version is
 * rewritten too, so a rollback never brings a `formField` back.
 *
 * ## Take a snapshot first
 *
 *   node tools/scripts/backup-host-nodes.mjs --host=<id> --out=nodes-before.json
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { decode, encode } from '@msgpack/msgpack'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  LEGACY_FORM_FIELD_COMPONENT_ID,
  migrateFormFieldNodes,
  muiClassSelectorsIn,
  rekeyFormFieldOverrides,
} from '../../libs/plugins/forms/src/lib/model/form-field-elements.ts'

/** Every per-host collection whose documents carry a `nodes` tree. */
const KINDS = [
  'screens',
  'layouts',
  'components',
  'templates',
  'forms',
  'emailTemplates',
]

/** The placements whose override layers are keyed by a definition's ids. */
const PLACEMENTS = {
  form: { prop: 'formId', kind: 'forms' },
  reusableInstance: { prop: 'refId', kind: 'components' },
}

const args = parseDeployArgs({
  command: 'backfill-formfield-elements',
  summary:
    'Rebuild every saved Form Field from MUI’s separate form elements and ' +
    're-key placement overrides onto them. Writes to the live project with ' +
    '--apply.',
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

const newKindCounts = () => ({
  docs: 0,
  docsChanged: 0,
  fields: 0,
  placementsRekeyed: 0,
})

const counts = {
  hostsScanned: 0,
  docsScanned: 0,
  docsWithNodes: 0,
  formMap: 0,
  formBytes: 0,
  formUndecodable: 0,
  docsChanged: 0,
  fieldsConverted: 0,
  placementsRekeyed: 0,
  byKind: Object.fromEntries(KINDS.map((kind) => [kind, newKindCounts()])),
}

/** Styles that select the old TextField's inner classes, for a person to fix. */
const sxFindings = []
/** Placement overrides with no new home. */
const droppedFindings = []

/**
 * `nodes` in whichever form this document uses, plus the form itself so the
 * write goes back the same way it came out.
 */
export function readNodes(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
    try {
      counts.formBytes += 1
      return { form: 'bytes', nodes: decode(bytes) }
    } catch (error) {
      // Counted, not swallowed: a run that decoded nothing must not read as
      // a clean one.
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

const isRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * One tree, migrated. Pure: `definitionFor(kind, id)` returns a definition's
 * nodes (or undefined) and is the only thing that reaches outside, so the
 * self-test drives it with fixtures.
 *
 * Returns `{ nodes, fields, placements, sx, dropped }`, with `nodes` null
 * when nothing changed.
 */
export async function migrateTree(nodes, definitionFor) {
  const sx = []
  const dropped = []
  const migrated = migrateFormFieldNodes(nodes)
  const fields = migrated?.converted ?? []
  for (const id of fields) {
    const classes = muiClassSelectorsIn(nodes[id]?.sx)
    if (classes.length) sx.push({ nodeId: id, where: 'sx', classes })
  }

  let tree = migrated?.nodes ?? nodes
  let placements = 0
  for (const [nodeId, node] of Object.entries(tree)) {
    if (!isRecord(node)) continue
    const placement = PLACEMENTS[node.componentId]
    if (!placement) continue
    const ref = node.props?.[placement.prop]
    if (typeof ref !== 'string' || !ref) continue
    if (!isRecord(node.attrOverrides) && !isRecord(node.styleOverrides)) continue
    const definition = await definitionFor(placement.kind, ref)
    if (!isRecord(definition)) continue

    const isField = (key) => {
      const target = definition[key]
      return (
        target?.componentId === LEGACY_FORM_FIELD_COMPONENT_ID ||
        target?.componentId === 'muiFormControl'
      )
    }
    for (const layer of ['styleOverrides', 'attrOverrides']) {
      if (!isRecord(node[layer])) continue
      for (const [key, slice] of Object.entries(node[layer])) {
        if (!isField(key)) continue
        const classes = muiClassSelectorsIn(layer === 'attrOverrides' ? slice?.sx : slice)
        if (classes.length) {
          sx.push({ nodeId, where: `${layer}.${key}`, classes })
        }
      }
    }

    const rekeyed = rekeyFormFieldOverrides(node.attrOverrides, definition)
    if (!rekeyed) continue
    for (const one of rekeyed.dropped) dropped.push({ nodeId, ...one })
    if (tree === nodes) tree = { ...nodes }
    tree[nodeId] = { ...node, attrOverrides: rekeyed.attrOverrides }
    placements += 1
  }

  const changed = fields.length > 0 || placements > 0
  return { nodes: changed ? tree : null, fields, placements, sx, dropped }
}

/* ── SELF-TEST ────────────────────────────────────────────────────────────
 *
 * The questions a run cannot answer: does it rebuild a field in a map and in
 * msgpack, re-key a placement before AND after its design moved, report the
 * styles it cannot carry, and leave an already-migrated tree alone.
 */
async function selfTest() {
  const failures = []
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) failures.push(`${name}\n    expected ${b}\n    actual   ${a}`)
  }

  const design = {
    root: { $id: 'root', componentId: 'form', pluginId: 'forms', props: { formId: 'f1' }, nodes: ['name'] },
    name: {
      $id: 'name',
      componentId: 'formField',
      pluginId: 'forms',
      parentId: 'root',
      props: { fieldName: 'name', label: 'Name', required: true },
      sx: { '& .MuiInputLabel-root': { color: 'red' } },
    },
  }
  const page = {
    page: { $id: 'page', componentId: 'div', nodes: ['placed'] },
    placed: {
      $id: 'placed',
      componentId: 'form',
      pluginId: 'forms',
      parentId: 'page',
      props: { formId: 'f1' },
      attrOverrides: { name: { label: 'Your name', fieldType: 'email' } },
      styleOverrides: { name: { '& .MuiOutlinedInput-root': { borderRadius: 0 } } },
    },
  }
  const definitions = { 'forms/f1': design }
  const lookup = async (kind, id) => definitions[`${kind}/${id}`]

  const migratedDesign = await migrateTree(design, lookup)
  check('rebuilds the field', migratedDesign.fields, ['name'])
  check('keeps the id on the wrapper', migratedDesign.nodes?.name?.componentId, 'muiFormControl')
  check('keeps the name exactly', migratedDesign.nodes?.['name-input']?.props?.name, 'name')
  check('reports the inner-class sx', migratedDesign.sx, [
    { nodeId: 'name', where: 'sx', classes: ['MuiInputLabel-root'] },
  ])
  check('does not mutate the input', design.name.componentId, 'formField')

  const placed = await migrateTree(page, lookup)
  check('re-keys the placement', placed.placements, 1)
  check('label moves onto the Form Label', placed.nodes?.placed?.attrOverrides, {
    'name-label': { children: 'Your name' },
  })
  check('reports what has no home', placed.dropped, [
    { nodeId: 'placed', key: 'name', prop: 'fieldType' },
  ])
  check('reports the override sx', placed.sx, [
    { nodeId: 'placed', where: 'styleOverrides.name', classes: ['MuiOutlinedInput-root'] },
  ])

  // After the design itself moved, the re-key reads the new tree the same way.
  definitions['forms/f1'] = migratedDesign.nodes
  const after = await migrateTree(page, lookup)
  check('re-keys against a migrated design', after.nodes?.placed?.attrOverrides, {
    'name-label': { children: 'Your name' },
  })
  check('a migrated tree is left alone', (await migrateTree(placed.nodes, lookup)).nodes, null)
  check('a migrated design is left alone', (await migrateTree(migratedDesign.nodes, lookup)).nodes, null)

  // The msgpack half: a backfill that only read maps would pass all of the
  // above and rewrite nothing in production.
  const round = readNodes(Buffer.from(encode(design)))
  check('decodes msgpack bytes', round?.form, 'bytes')
  const written = writeNodes('bytes', (await migrateTree(round.nodes, lookup)).nodes)
  check('writes msgpack back as bytes', Buffer.isBuffer(written), true)
  check('round-trips the rebuild', decode(written).name.componentId, 'muiFormControl')
  check('leaves a map a map', Buffer.isBuffer(writeNodes('map', design)), false)

  if (failures.length) {
    console.error(`SELF-TEST FAILED — ${failures.length} check(s):`)
    for (const failure of failures) console.error(`  ✗ ${failure}`)
    process.exit(1)
  }
  console.log('SELF-TEST PASSED — no project was touched.')
}

async function run() {
  const apply = args.apply
  const onlyHost = args.host
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

    // Definitions as they stand BEFORE this host is written, cached once.
    // The re-key reads either shape, so the order of the writes below does
    // not matter.
    const definitionCache = new Map()
    const definitionFor = async (kind, id) => {
      const key = `${kind}/${id}`
      if (!definitionCache.has(key)) {
        const snapshot = await host.ref.collection(kind).doc(id).get()
        const raw = snapshot.exists ? snapshot.get('nodes') : undefined
        let nodes
        if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
          try {
            nodes = decode(Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw)
          } catch {
            nodes = undefined
          }
        } else if (isRecord(raw)) nodes = raw
        definitionCache.set(key, nodes)
      }
      return definitionCache.get(key)
    }

    const processDoc = async (kind, ref) => {
      const snapshot = await ref.get()
      if (!snapshot.exists) return
      counts.docsScanned += 1
      counts.byKind[kind].docs += 1
      const read = readNodes(snapshot.get('nodes'))
      if (!read || !isRecord(read.nodes)) return
      counts.docsWithNodes += 1
      const result = await migrateTree(read.nodes, definitionFor)
      for (const finding of result.sx) {
        sxFindings.push({ host: host.id, doc: ref.path, ...finding })
      }
      for (const finding of result.dropped) {
        droppedFindings.push({ host: host.id, doc: ref.path, ...finding })
      }
      if (!result.nodes) return
      counts.docsChanged += 1
      counts.fieldsConverted += result.fields.length
      counts.placementsRekeyed += result.placements
      counts.byKind[kind].docsChanged += 1
      counts.byKind[kind].fields += result.fields.length
      counts.byKind[kind].placementsRekeyed += result.placements
      console.log(
        `  ${ref.path} — ${result.fields.length} field(s), ` +
          `${result.placements} placement(s) re-keyed`,
      )
      if (apply) await ref.update({ nodes: writeNodes(read.form, result.nodes) })
    }

    for (const kind of KINDS) {
      const parents = await host.ref.collection(kind).get()
      for (const parent of parents.docs) {
        await processDoc(kind, parent.ref)
        // EVERY version: a restore point still holding a formField would
        // bring it back the moment somebody rolled back to it.
        const versions = await parent.ref.collection('versions').get()
        for (const version of versions.docs) await processDoc(kind, version.ref)
      }
    }
  }

  console.log(`\nPer kind (documents scanned / changed / fields / placements re-keyed):`)
  for (const [kind, one] of Object.entries(counts.byKind)) {
    console.log(
      `  ${kind.padEnd(15)} ${String(one.docs).padStart(6)} / ` +
        `${String(one.docsChanged).padStart(5)} / ${String(one.fields).padStart(5)} / ` +
        `${String(one.placementsRekeyed).padStart(4)}`,
    )
  }

  console.log(
    `\nStyles selecting the old TextField's inner MUI classes (fix by hand): ${sxFindings.length}`,
  )
  for (const one of sxFindings) {
    console.log(`  ${one.host}  ${one.doc}  node ${one.nodeId}  ${one.where}  [${one.classes.join(', ')}]`)
  }
  console.log(`\nPlacement overrides with no new home (dropped): ${droppedFindings.length}`)
  for (const one of droppedFindings) {
    console.log(`  ${one.host}  ${one.doc}  node ${one.nodeId}  ${one.key}.${one.prop}`)
  }

  // The intermediate counts, not just the final one: "0 changed" reads the
  // same whether every field was already migrated or nothing was decoded.
  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${counts.hostsScanned} host(s), ` +
      `${counts.docsScanned} document(s), ${counts.docsWithNodes} with nodes ` +
      `(${counts.formMap} map, ${counts.formBytes} msgpack, ` +
      `${counts.formUndecodable} undecodable), ${counts.fieldsConverted} field(s) ` +
      `rebuilt and ${counts.placementsRekeyed} placement(s) re-keyed across ` +
      `${counts.docsChanged} document(s).`,
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

if (args.selfTest) {
  await selfTest()
} else {
  await run()
}
