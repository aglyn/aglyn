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

/*==========================================
 * WORKSPACE PACKAGES (AGL-3535) — a workspace's sequences, campaigns,
 * automations and email templates as one file, imported as a job.
 *
 * A row import's file is rows; a package's is items, each owned by the
 * plugin whose `package` transfer resource its kind names. So a package
 * does not go through the row engine's upload, analyze and chunked plan —
 * there is no column to map — but it is the same kind of job, under the
 * same guarantees, in the same place:
 *
 *  - the job is `orgs/{orgId}/transferJobs/{jobId}` with `kind: 'package'`
 *    and `resource: 'package'`, so the hub's history lists it beside every
 *    row import, the sweep resumes and cleans it, and only one package
 *    import runs per workspace at a time (the lease's per-resource lock);
 *  - the file is stored where a row import's is
 *    (`orgs/{orgId}/transfers/{jobId}/source`), and the dry run in
 *    `chunks/0` — the plan the person reviewed is the plan applied;
 *  - every item's write is recorded in the ledger the moment it lands, so
 *    a retried apply never writes an item twice;
 *  - the undo snapshot (`undo/0`) is taken BEFORE the first write: each
 *    replaced item's content as the workspace held it. Once the writes
 *    land, each written item's content hash is added to it, so undo can
 *    tell the import's own content from a later edit and asks before it
 *    overwrites or deletes one — for seven days;
 *  - plan, apply and undo are audited by the route.
 *
 * Why not the row engine's routes: a row import plans 200 rows a chunk
 * against a column mapping; a package is planned whole, against item
 * identities and references (`planTransferPackage`), and its writes are
 * grouped by owning plugin in dependency order. One route
 * (`/api/transfer/package`) speaks its actions; this module is the engine
 * behind it, built on the row engine's job, ledger and lease.
 *
 * The plugin reads, writes and reverts through its own paths; this module
 * decides what to write, in which order, under which id, and what undo
 * does.
 *=========================================*/

import {
  TRANSFER_PACKAGE_MAX_BYTES,
  TRANSFER_PACKAGE_MAX_ITEMS,
  TRANSFER_PACKAGE_RESOURCE,
  TRANSFER_RESULT_COLUMNS,
  TRANSFER_SITE_KIND,
  buildPackageManifest,
  canApplyTransferPackage,
  contentHash,
  missingPackageAcknowledgements,
  packageIdMap,
  packageItemKey,
  planTransferPackage,
  readPackageManifest,
  summarizeTransferResults,
  transferLedgerKey,
  transferUndoAvailable,
  transferUndoExpiresAt,
  TRANSFER_WRITE_CONCURRENCY,
  type ExistingPackageItem,
  type PackageItemDecision,
  type PackageManifestItem,
  type TransferJobRecord,
  type TransferPackage,
  type TransferPackageDependencyChoice,
  type TransferPackageJobState,
  type TransferPackageListItem,
  type TransferPackagePlan,
  type TransferPackagePlanItem,
  type TransferPackageReference,
  type TransferPackageResourceList,
  type TransferPackageRuleView,
  type TransferPackageUndoConflict,
  type TransferPackageUndoEntry,
  type TransferPackageWarningClass,
  type TransferReferenceKind,
  type TransferRowResult,
  type TransferUndoCounts,
  type TransferUndoDecision,
  type TransferUndoState,
} from '@aglyn/aglyn/data-transfer'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { escapeCsvCell } from '@aglyn/aglyn/app-utils/csv'
import { inspectUploadBytes } from '@aglyn/aglyn/app-utils/upload-inspection'
import {
  resolveTransferResource,
  transferPackageHooks,
  TransferResourceUnavailableError,
  type ResolvedTransferResource,
  type TransferApplyWriter,
  type TransferPackageHooks,
  type TransferPackageItemWrite,
  type TransferPackageRevertStep,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  clock,
  eachLimited,
  emptyResults,
  emptyUndoCounts,
  isAlreadyExists,
  moveJob,
  readJob,
  readJsonDoc,
  saveJob,
  stored,
  takeLease,
  transferJobsCollection,
  transferSourcePath,
  TransferEngineError,
  TRANSFER_LEASE_GRACE_MS,
  TRANSFER_MIN_CHUNK_BUDGET_MS,
  writeJsonDoc,
  type TransferEngineDeps,
} from './transfer-jobs'

/*==========================================
 * RESOURCES
 *=========================================*/

interface PackageResource {
  resource: ResolvedTransferResource
  hooks: TransferPackageHooks
}

/** The package resources among `keys` that the workspace may move, by key. */
async function packageResources(
  deps: TransferEngineDeps,
  keys: readonly string[],
): Promise<Map<string, PackageResource>> {
  const found = new Map<string, PackageResource>()
  for (const key of keys) {
    try {
      const resource = await (deps.resolveResource ?? resolveTransferResource)(key)
      if (resource.scope !== 'org' || !resource.kinds.includes('package')) continue
      found.set(resource.key, { resource, hooks: transferPackageHooks(resource) })
    } catch (error) {
      if (error instanceof TransferResourceUnavailableError && error.reason === 'undeclared') continue
      if (error instanceof TransferResourceUnavailableError) {
        throw new TransferEngineError('unavailable', 500, 'Importing packages is unavailable right now. Try again in a minute.')
      }
      throw error
    }
  }
  return found
}

function contextOf(orgId: string, resource: string, actorUid: string | null, jobId?: string): TransferResourceContext {
  return { resource, orgId, hostId: null, actorUid, ...(jobId ? { jobId } : {}) }
}

function rulesOf(entry: PackageResource): TransferPackageRuleView[] {
  return (entry.hooks.rules ?? []).map((rule) => ({ id: rule.id, label: rule.label, reason: rule.reason }))
}

/** The workspace's sites, as references to the `site` kind resolve. */
async function siteTargets(deps: TransferEngineDeps, orgId: string): Promise<TransferReferenceKind> {
  const snapshot = await deps.firestore.collection('hosts').where('orgId', '==', orgId).get()
  return {
    kind: TRANSFER_SITE_KIND,
    label: 'Site',
    targets: snapshot.docs
      .filter((doc) => !(doc.data() as { deletedAt?: unknown }).deletedAt)
      .map((doc) => {
        const data = doc.data() as { name?: unknown; title?: unknown }
        const name = String(data.name ?? data.title ?? '').trim()
        return { id: doc.id, ...(name ? { name } : {}) }
      }),
  }
}

/*==========================================
 * LIST AND EXPORT
 *=========================================*/

export interface TransferPackageListInput {
  orgId: string
  actorUid: string
  /** The package resources the workspace may move (its enabled plugins'). */
  allowed: readonly string[]
  /** Only these; every allowed one when absent. */
  resources?: readonly string[]
}

/** Every item of each package resource, with its name and what it names, for the export picker. */
export async function listTransferPackageItems(
  deps: TransferEngineDeps,
  input: TransferPackageListInput,
): Promise<TransferPackageResourceList[]> {
  const keys = input.resources?.length ? input.allowed.filter((key) => input.resources?.includes(key)) : input.allowed
  const resources = await packageResources(deps, keys)
  const lists: TransferPackageResourceList[] = []
  for (const [key, entry] of resources) {
    const ctx = contextOf(input.orgId, key, input.actorUid)
    const held = await entry.hooks.items(ctx)
    const contents = held.length ? await entry.hooks.readItems(ctx, held.map((item) => item.id)) : []
    const items: TransferPackageListItem[] = contents.map((one) => ({
      key: packageItemKey({ kind: key, id: one.id }),
      kind: key,
      id: one.id,
      ...(one.name ? { name: one.name } : {}),
      deps: entry.hooks.dependencies(one.content),
    }))
    lists.push({
      key,
      label: entry.resource.label,
      pluginId: entry.resource.pluginId,
      ...(entry.resource.description ? { description: entry.resource.description } : {}),
      items,
      rules: rulesOf(entry),
    })
  }
  return lists
}

export interface TransferPackageExportInput extends TransferPackageListInput {
  /** Item keys; every item of the resources when absent. */
  items?: readonly string[]
  /** Add what the chosen items name that the workspace holds as package items, transitively. */
  dependencies?: boolean
  /** Where the file says it came from ("Workspace: Acme"). */
  source?: string
}

/** The package file: the chosen items (and, when asked, what they need), hashed and listed. */
export async function exportTransferPackage(
  deps: TransferEngineDeps,
  input: TransferPackageExportInput,
): Promise<TransferPackage> {
  const resources = await packageResources(deps, input.allowed)
  const wanted = input.resources?.length ? new Set(input.resources) : null
  const contents = new Map<string, { kind: string; id: string; name?: string; slug?: string; content: unknown }>()
  const read = async (key: string, ids: readonly string[]) => {
    const entry = resources.get(key)
    if (!entry || !ids.length) return
    for (const one of await entry.hooks.readItems(contextOf(input.orgId, key, input.actorUid), ids)) {
      contents.set(packageItemKey({ kind: key, id: one.id }), {
        kind: key,
        id: one.id,
        ...(one.name ? { name: one.name } : {}),
        ...(one.slug ? { slug: one.slug } : {}),
        content: one.content,
      })
    }
  }
  if (input.items?.length) {
    const byKind = new Map<string, string[]>()
    for (const itemKey of input.items) {
      const at = itemKey.indexOf('/')
      const kind = itemKey.slice(0, at)
      if (at < 1 || (wanted && !wanted.has(kind))) continue
      byKind.set(kind, [...(byKind.get(kind) ?? []), itemKey.slice(at + 1)])
    }
    for (const [kind, ids] of byKind) await read(kind, ids)
  } else {
    for (const [key, entry] of resources) {
      if (wanted && !wanted.has(key)) continue
      const held = await entry.hooks.items(contextOf(input.orgId, key, input.actorUid))
      await read(key, held.map((item) => item.id))
    }
  }
  if (input.dependencies) {
    // What the chosen items name that is itself a package item here, until nothing new is named.
    for (let pass = 0; pass < TRANSFER_PACKAGE_MAX_ITEMS; pass += 1) {
      const missing = new Map<string, string[]>()
      for (const item of contents.values()) {
        for (const dep of resources.get(item.kind)?.hooks.dependencies(item.content) ?? []) {
          if (!resources.has(dep.kind) || contents.has(packageItemKey(dep))) continue
          missing.set(dep.kind, [...new Set([...(missing.get(dep.kind) ?? []), dep.id])])
        }
      }
      if (!missing.size) break
      const before = contents.size
      for (const [kind, ids] of missing) await read(kind, ids)
      if (contents.size === before) break
    }
  }
  if (contents.size > TRANSFER_PACKAGE_MAX_ITEMS) {
    throw new TransferEngineError('tooLarge', 413, `A package holds at most ${TRANSFER_PACKAGE_MAX_ITEMS} items. Choose fewer.`)
  }
  return buildPackageManifest(
    [...contents.values()],
    (item) => {
      const held = contents.get(packageItemKey(item))
      return {
        ...(held?.name ? { name: held.name } : {}),
        ...(held?.slug ? { slug: held.slug } : {}),
        deps: resources.get(item.kind)?.hooks.dependencies(item.content) ?? [],
      }
    },
    { createdAt: clock(deps), ...(input.source ? { source: input.source } : {}) },
  )
}

/*==========================================
 * PLAN
 *=========================================*/

/** The dry run as `chunks/0` keeps it. */
interface StoredPackagePlan {
  items: TransferPackagePlanItem[]
  references: TransferPackageReference[]
  order: string[]
  idMap: Record<string, string>
}

/** A package read from untrusted JSON, every item's content present and matching its hash — or why not. */
async function readPackageFile(raw: unknown): Promise<TransferPackage> {
  const source = (raw && typeof raw === 'object' ? raw : {}) as { manifest?: unknown; items?: unknown }
  const read = readPackageManifest(source.manifest)
  if (read.ok === false) {
    throw new TransferEngineError('rejectedFile', 422, 'This file is not a package this workspace can import.', { problems: read.problems })
  }
  const items = (source.items && typeof source.items === 'object' ? source.items : {}) as Record<string, unknown>
  if (read.manifest.items.length > TRANSFER_PACKAGE_MAX_ITEMS) {
    throw new TransferEngineError('tooLarge', 413, `A package holds at most ${TRANSFER_PACKAGE_MAX_ITEMS} items.`)
  }
  const problems: string[] = []
  for (const item of read.manifest.items) {
    const key = packageItemKey(item)
    if (!(key in items)) {
      problems.push(`${item.name ?? key} is listed and not carried.`)
      continue
    }
    if ((await contentHash(items[key])) !== item.contentHash) {
      problems.push(`${item.name ?? key} does not match its content hash: the file was changed after it was made.`)
    }
  }
  if (problems.length) {
    throw new TransferEngineError('rejectedFile', 422, 'This package is damaged.', { problems })
  }
  return { manifest: read.manifest, items }
}

async function loadPackage(deps: TransferEngineDeps, job: TransferJobRecord): Promise<TransferPackage> {
  if (!job.sourcePath) throw new TransferEngineError('state', 409, 'The file behind this import is gone.')
  const [bytes] = await deps.bucket.file(job.sourcePath).download()
  return JSON.parse(bytes.toString('utf8')) as TransferPackage
}

async function readStoredPlan(deps: TransferEngineDeps, job: TransferJobRecord): Promise<StoredPackagePlan> {
  const plan = await readJsonDoc<StoredPackagePlan>(
    transferJobsCollection(deps.firestore, job.orgId).doc(job.id).collection('chunks').doc('0'),
  )
  if (!plan) throw new TransferEngineError('state', 409, 'This import has no dry run.')
  return plan
}

export interface PlanTransferPackageInput {
  orgId: string
  actorUid: string
  allowed: readonly string[]
  jobId?: string | null
  /** The file's parsed JSON, on the first call. */
  package?: unknown
  fileName?: string | null
  decisions?: Readonly<Record<string, PackageItemDecision>>
  dependencyChoices?: Readonly<Record<string, TransferPackageDependencyChoice>>
}

export interface PlanTransferPackageOutcome {
  job: TransferJobRecord
  plan: TransferPackagePlan
  resources: Record<string, { label: string; rules: TransferPackageRuleView[] }>
  /** The first call made the job. */
  created: boolean
}

/**
 * The dry run (see the block header): reads what the workspace holds of
 * every kind the package carries or names, plans with the person's
 * choices, asks each written item's plugin what its own write would
 * refuse, and stores the plan. Writes no item.
 */
export async function planTransferPackageImport(
  deps: TransferEngineDeps,
  input: PlanTransferPackageInput,
): Promise<PlanTransferPackageOutcome> {
  const now = clock(deps)
  let job: TransferJobRecord
  let pkg: TransferPackage
  let created = false
  if (input.jobId) {
    job = await readJob(deps, input.orgId, input.jobId)
    if (job.kind !== 'package') throw new TransferEngineError('invalid', 400, 'This import is not a package.')
    if (job.applyStartedAt !== undefined) {
      throw new TransferEngineError('state', 409, 'This import has started writing and cannot be planned again.')
    }
    if (job.status !== 'planned' && job.status !== 'failed') {
      throw new TransferEngineError('state', 409, `This import is ${job.status} and cannot be planned again.`)
    }
    pkg = await loadPackage(deps, job)
  } else {
    if (input.package === undefined) throw new TransferEngineError('invalid', 400, 'Choose a package file.')
    const text = JSON.stringify(input.package)
    if (Buffer.byteLength(text, 'utf8') > TRANSFER_PACKAGE_MAX_BYTES) {
      throw new TransferEngineError('tooLarge', 413, 'A package file holds at most 3 MB.')
    }
    pkg = await readPackageFile(input.package)
    const id = (deps.newJobId ?? createResourceUid)()
    const sourcePath = transferSourcePath(input.orgId, id)
    // A member's file, stored beside the workspace's other objects: inspected like every upload first.
    const bytes = Buffer.from(JSON.stringify(pkg), 'utf8')
    const refusal = inspectUploadBytes({ bytes, contentType: 'application/json', fileName: String(input.fileName ?? 'package.json') })
    if (refusal) throw new TransferEngineError('rejectedFile', 422, refusal.message, { code: refusal.code })
    await deps.bucket.file(sourcePath).save(bytes, {
      contentType: 'application/json',
      resumable: false,
    })
    created = true
    job = {
      id,
      resource: TRANSFER_PACKAGE_RESOURCE,
      kind: 'package',
      direction: 'import',
      format: 'json',
      status: 'planned',
      orgId: input.orgId,
      createdBy: input.actorUid,
      createdAt: now,
      updatedAt: now,
      fileName: String(input.fileName ?? '').trim().slice(0, 200) || 'package.json',
      sourcePath,
      rowCount: pkg.manifest.items.length,
      chunkCount: 1,
    }
    // Kept before planning, so a plan that fails still leaves a job the sweep expires with its file.
    await saveJob(deps, job)
  }

  const resources = await packageResources(deps, input.allowed)
  const owned = new Set(resources.keys())
  const manifest = pkg.manifest
  const kindsNeeded = new Set<string>()
  const foreignByResource = new Map<string, Set<string>>()
  let needsSites = false
  for (const item of manifest.items) {
    if (!owned.has(item.kind)) continue
    kindsNeeded.add(item.kind)
    for (const dep of item.deps) {
      if (owned.has(dep.kind)) kindsNeeded.add(dep.kind)
      else if (dep.kind === TRANSFER_SITE_KIND) needsSites = true
      else foreignByResource.set(item.kind, new Set([...(foreignByResource.get(item.kind) ?? []), dep.kind]))
    }
  }
  const existing: ExistingPackageItem[] = []
  for (const kind of kindsNeeded) {
    const entry = resources.get(kind) as PackageResource
    for (const one of await entry.hooks.items(contextOf(input.orgId, kind, input.actorUid, job.id))) {
      existing.push({ ...one, kind })
    }
  }
  const references: TransferReferenceKind[] = needsSites ? [await siteTargets(deps, input.orgId)] : []
  for (const [key, kinds] of foreignByResource) {
    const answered = await resources.get(key)?.hooks.referenceTargets?.(contextOf(input.orgId, key, input.actorUid, job.id), [...kinds])
    for (const kind of answered ?? []) {
      if (!references.some((known) => known.kind === kind.kind)) references.push(kind)
    }
  }
  const kindLabels = Object.fromEntries(
    [...resources].map(([key, entry]) => [key, entry.resource.singularLabel ?? entry.resource.label]),
  )
  // Kept-both ids are minted once and reused by the second pass, so the problems asked about are the ids applied.
  const minted: string[] = []
  let mintedAt = 0
  const newId = () => {
    if (mintedAt >= minted.length) minted.push(createResourceUid())
    return minted[mintedAt++] as string
  }
  const base = {
    manifest,
    ownedKinds: owned,
    existing,
    references,
    kindLabels,
    decisions: input.decisions ?? job.package?.decisions ?? {},
    dependencyChoices: input.dependencyChoices ?? job.package?.dependencyChoices ?? {},
  }
  const first = planTransferPackage({ ...base, newId })
  const problems: Record<string, string[]> = {}
  const idMap = packageIdMap(first.idMap)
  for (const item of first.items) {
    if (item.verdict === 'skip' || item.targetId === undefined) continue
    const entry = resources.get(item.kind) as PackageResource
    const hook = entry.hooks.problems
    if (!hook) continue
    const write = writeFor(entry, item, manifest.items[item.row] as PackageManifestItem, pkg.items[item.key], idMap)
    const found = await hook(contextOf(input.orgId, item.kind, input.actorUid, job.id), write)
    if (found.length) problems[item.key] = [...found]
  }
  mintedAt = 0
  const plan = planTransferPackage({ ...base, problems, newId })

  const jobRef = transferJobsCollection(deps.firestore, input.orgId).doc(job.id)
  const kept: StoredPackagePlan = { items: plan.items, references: plan.references, order: plan.order, idMap: plan.idMap }
  await writeJsonDoc(jobRef.collection('chunks').doc('0'), { jobId: job.id, index: 0, package: true }, kept)
  const state: TransferPackageJobState = {
    ...(manifest.source ? { source: manifest.source } : {}),
    resources: [...new Set(plan.items.filter((item) => owned.has(item.kind)).map((item) => item.kind))],
    summary: plan.summary,
    blocking: plan.blocking,
    acknowledgementsRequired: plan.acknowledgementsRequired,
    unknownKinds: plan.unknownKinds,
    decisions: { ...base.decisions },
    dependencyChoices: { ...base.dependencyChoices },
  }
  job =
    job.status === 'failed'
      ? moveJob(job, 'planned', clock(deps), { package: state, plannedAt: clock(deps) })
      : { ...job, status: 'planned', package: state, plannedAt: clock(deps), updatedAt: clock(deps) }
  await saveJob(deps, job)
  return {
    job,
    plan,
    created,
    resources: Object.fromEntries(
      [...resources].map(([key, entry]) => [key, { label: entry.resource.label, rules: rulesOf(entry) }]),
    ),
  }
}

/** One planned item as its plugin writes it: references rewritten, a kept-both copy's new name and slug. */
function writeFor(
  entry: PackageResource,
  item: TransferPackagePlanItem,
  manifestItem: PackageManifestItem,
  content: unknown,
  idMap: ReadonlyMap<string, string>,
): TransferPackageItemWrite {
  return {
    row: item.row,
    item: manifestItem,
    decision: item.decision,
    targetId: item.targetId as string,
    ...(item.rename ? { rename: item.rename } : {}),
    content: entry.hooks.remapIds(content, idMap),
  }
}

/*==========================================
 * APPLY
 *=========================================*/

export interface ApplyTransferPackageInput {
  orgId: string
  jobId: string
  actorUid: string
  acknowledged?: readonly TransferPackageWarningClass[]
  deadlineMs: number
  driver: string
}

export interface ApplyTransferPackageOutcome {
  job: TransferJobRecord
  done: boolean
  /** This call moved the job into `applying`. */
  started: boolean
  resumed: boolean
  results: TransferRowResult[]
}

const WRITE_VERDICTS = new Set(['create', 'replace', 'keepBoth'])

/** What an item the plan does not write comes to. */
function unwrittenResult(item: TransferPackagePlanItem): TransferRowResult {
  if (item.verdict === 'fail') {
    return { row: item.row, outcome: 'failed', reason: 'problems', ...(item.problems[0] ? { message: item.problems.join(' ') } : {}) }
  }
  return { row: item.row, outcome: 'skipped', ...(item.reason ? { reason: item.reason } : {}) }
}

/**
 * Writes the planned items (see the block header): the undo snapshot
 * first, then each owning plugin's items in dependency order through the
 * ledger, then the written hashes and the results. Called again until
 * `done`; a plugin that throws fails the job, and calling again resumes it.
 */
export async function applyTransferPackage(
  deps: TransferEngineDeps,
  input: ApplyTransferPackageInput,
): Promise<ApplyTransferPackageOutcome> {
  let job = await readJob(deps, input.orgId, input.jobId)
  if (job.kind !== 'package' || !job.package) throw new TransferEngineError('invalid', 400, 'This import is not a package.')
  if (job.status === 'applied') return { job, done: true, started: false, resumed: false, results: [] }
  if (job.status !== 'planned' && job.status !== 'applying' && job.status !== 'failed') {
    throw new TransferEngineError('state', 409, `This import is ${job.status}; plan it before applying.`)
  }
  const acknowledged = [...(input.acknowledged ?? job.package.acknowledged ?? [])]
  if (job.applyStartedAt === undefined) {
    if (job.package.blocking.length) {
      throw new TransferEngineError('choicesNeeded', 422, 'Answer every choice the dry run asks before importing.', {
        blocking: job.package.blocking,
      })
    }
    if (!canApplyTransferPackage(job.package, acknowledged)) {
      const missing = missingPackageAcknowledgements(job.package, acknowledged)
      if (!missing.length) throw new TransferEngineError('state', 409, 'The dry run writes nothing.')
      throw new TransferEngineError('acknowledgementsMissing', 422, 'Acknowledge every warning before importing.', { missing })
    }
  }
  let started = false
  let resumed = false
  job = await takeLease(deps, job, input.driver, input.deadlineMs + TRANSFER_LEASE_GRACE_MS, (current, now) => {
    if (current.status === 'applying') return current
    started = true
    resumed = current.status === 'failed'
    return moveJob(current, 'applying', now, {
      ...(current.applyStartedAt === undefined && current.package
        ? { package: { ...current.package, acknowledged: acknowledged as TransferPackageWarningClass[] } }
        : {}),
      cursor: current.cursor ?? { chunk: 0, rowsDone: 0 },
      applyStartedAt: current.applyStartedAt ?? now,
      results: current.results ?? emptyResults(),
    })
  })

  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  const timeLeft = () => input.deadlineMs - clock(deps)
  try {
    const plan = await readStoredPlan(deps, job)
    const pkg = await loadPackage(deps, job)
    const resources = await packageResources(deps, job.package?.resources ?? [])
    const byKey = new Map(plan.items.map((item) => [item.key, item]))
    const writes = plan.order.map((key) => byKey.get(key)).filter((item): item is TransferPackagePlanItem =>
      Boolean(item && WRITE_VERDICTS.has(item.verdict)),
    )
    for (const item of writes) {
      if (!resources.has(item.kind)) throw new Error(`nothing here writes ${item.kind} any more`)
    }

    // The snapshot first: nothing is written that undo could not put back.
    const undoRef = jobRef.collection('undo').doc('0')
    let entries = await readJsonDoc<TransferPackageUndoEntry[]>(undoRef)
    if (!entries) {
      entries = []
      const replaced = new Map<string, string[]>()
      for (const item of writes) {
        if (item.verdict === 'replace') replaced.set(item.kind, [...(replaced.get(item.kind) ?? []), item.targetId as string])
      }
      const previous = new Map<string, unknown>()
      for (const [kind, ids] of replaced) {
        const entry = resources.get(kind) as PackageResource
        for (const one of await entry.hooks.readItems(contextOf(job.orgId, kind, input.actorUid, job.id), ids)) {
          previous.set(packageItemKey({ kind, id: one.id }), one.content)
        }
      }
      for (const item of writes) {
        const targetKey = packageItemKey({ kind: item.kind, id: item.targetId as string })
        const before = previous.get(targetKey)
        entries.push({
          row: item.row,
          key: item.key,
          resource: item.kind,
          id: item.targetId as string,
          ...((item.rename?.name ?? item.existing?.name ?? item.name) ? { name: item.rename?.name ?? item.existing?.name ?? item.name } : {}),
          action: item.verdict === 'replace' ? 'updated' : 'created',
          ...(before !== undefined ? { previous: before, previousHash: await contentHash(before) } : {}),
        })
      }
      await writeJsonDoc(undoRef, { jobId: job.id, chunk: 0, package: true }, entries)
    }

    const ledgerCollection = jobRef.collection('ledger')
    const ledger = new Map<number, TransferRowResult>()
    for (const doc of (await ledgerCollection.where('chunk', '==', 0).get()).docs) {
      const data = doc.data() as { row: number; result: TransferRowResult }
      ledger.set(data.row, data.result)
    }
    const writer: TransferApplyWriter = {
      async alreadyApplied(row) {
        return ledger.get(row) ?? null
      },
      async markApplied(result) {
        if (ledger.has(result.row)) return
        try {
          await ledgerCollection
            .doc(transferLedgerKey(job.id, result.row))
            .create(stored({ row: result.row, chunk: 0, result, undoJson: null, at: clock(deps) }))
        } catch (error) {
          if (!isAlreadyExists(error)) throw error
        }
        ledger.set(result.row, result)
      },
      timeLeftMs: timeLeft,
    }

    const idMap = packageIdMap(plan.idMap)
    // Each owner's run of items in dependency order, handed over together.
    const runs: TransferPackagePlanItem[][] = []
    for (const item of writes) {
      const last = runs[runs.length - 1]
      if (last && last[0]?.kind === item.kind) last.push(item)
      else runs.push([item])
    }
    for (const run of runs) {
      const pending = run.filter((item) => !ledger.has(item.row))
      if (!pending.length) continue
      if (timeLeft() <= TRANSFER_MIN_CHUNK_BUDGET_MS) break
      const kind = run[0]?.kind as string
      const entry = resources.get(kind) as PackageResource
      const items = pending.map((item) =>
        writeFor(entry, item, pkg.manifest.items[item.row] as PackageManifestItem, pkg.items[item.key], idMap),
      )
      const applied = await entry.hooks.writeItems(contextOf(job.orgId, kind, input.actorUid, job.id), items, writer)
      const planned = new Set(pending.map((item) => item.row))
      for (const result of applied.results) {
        if (planned.has(result.row) && !ledger.has(result.row)) await writer.markApplied(result)
      }
    }

    if (writes.some((item) => !ledger.has(item.row))) {
      job = { ...job, lease: null, updatedAt: clock(deps) }
      await saveJob(deps, job)
      return { job, done: false, started, resumed, results: [] }
    }

    // Every write landed: what each item holds now is what undo compares a later edit against.
    const hashes = new Map<string, string>()
    for (const kind of new Set(writes.map((item) => item.kind))) {
      const entry = resources.get(kind) as PackageResource
      for (const one of await entry.hooks.items(contextOf(job.orgId, kind, input.actorUid, job.id))) {
        hashes.set(packageItemKey({ kind, id: one.id }), one.contentHash)
      }
    }
    const settled = entries.map((entry) => {
      const written = ledger.get(entry.row)
      const hash = hashes.get(packageItemKey({ kind: entry.resource, id: entry.id }))
      return written && written.outcome !== 'failed' && hash ? { ...entry, writtenHash: hash } : entry
    }).filter((entry) => ledger.get(entry.row)?.outcome !== 'failed')
    await writeJsonDoc(undoRef, { jobId: job.id, chunk: 0, package: true }, settled)

    const results = plan.items.map((item) => (WRITE_VERDICTS.has(item.verdict) ? (ledger.get(item.row) as TransferRowResult) : unwrittenResult(item)))
    const now = clock(deps)
    // The results before the job: a crash between the two resumes into the same results from the ledger.
    await jobRef.collection('results').doc('0').set(stored({ jobId: job.id, index: 0, results, completedAt: now }))
    job = moveJob(job, 'applied', now, {
      lease: null,
      cursor: { chunk: 1, rowsDone: plan.items.length },
      results: summarizeTransferResults(results),
    })
    await saveJob(deps, job)
    const ledgerDocs = (await ledgerCollection.where('chunk', '==', 0).get()).docs
    await eachLimited(ledgerDocs, TRANSFER_WRITE_CONCURRENCY, async (doc) => {
      await doc.ref.delete()
    })
    return { job, done: true, started, resumed, results }
  } catch (error) {
    if (error instanceof TransferEngineError) throw error
    const message = error instanceof Error ? error.message : String(error)
    job = moveJob(job, 'failed', clock(deps), {
      error: { code: 'applyFailed', message: `The package could not be written: ${message}`, chunk: 0 },
      lease: null,
    })
    await saveJob(deps, job)
    return { job, done: false, started, resumed, results: [] }
  }
}

/*==========================================
 * RESULTS
 *=========================================*/

/** The result file of a package import: each item, what was decided, and what happened. */
export async function transferPackageResultFile(
  deps: TransferEngineDeps,
  job: TransferJobRecord,
): Promise<{ csv: string; rows: number; fileName: string }> {
  if (job.trimmedAt !== undefined) {
    throw new TransferEngineError('state', 409, 'This import was cleared once its undo window closed; its results are still counted.')
  }
  const plan = await readStoredPlan(deps, job)
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  const results = new Map<number, TransferRowResult>()
  for (const doc of (await jobRef.collection('results').get()).docs) {
    for (const result of (doc.data() as { results?: TransferRowResult[] }).results ?? []) results.set(result.row, result)
  }
  const cell = (value: string) => escapeCsvCell(value)
  const lines = [['Kind', 'Name', 'ID', 'Decision', ...TRANSFER_RESULT_COLUMNS].map(cell).join(',')]
  for (const item of plan.items) {
    const result = results.get(item.row)
    lines.push(
      [
        item.kind,
        item.name ?? '',
        item.id,
        item.verdict,
        result?.outcome ?? 'pending',
        result ? (result.message ?? (result.reason ? String(result.reason) : '')) : '',
        result?.recordId ?? '',
      ]
        .map(cell)
        .join(','),
    )
  }
  const base = (job.fileName ?? 'package').replace(/\.[a-z0-9]+$/i, '')
  return { csv: `${lines.join('\r\n')}\r\n`, rows: plan.items.length, fileName: `${base}-results.csv` }
}

/*==========================================
 * UNDO
 *=========================================*/

type PackageUndoStep =
  | { action: 'delete' | 'restore'; entry: TransferPackageUndoEntry }
  | { action: 'conflict'; entry: TransferPackageUndoEntry }
  | { action: 'nothing'; entry: TransferPackageUndoEntry }

/**
 * What undo does to one item, against what it holds now: an item the
 * import created and nobody touched is deleted; one it replaced and nobody
 * touched is restored; one edited since is a conflict; one already back
 * where it was, or gone, needs nothing.
 */
function packageUndoStep(entry: TransferPackageUndoEntry, currentHash: string | undefined): PackageUndoStep {
  if (currentHash === undefined) return { action: 'nothing', entry }
  if (entry.action === 'updated' && entry.previousHash && currentHash === entry.previousHash) return { action: 'nothing', entry }
  if (entry.writtenHash && currentHash === entry.writtenHash) {
    return { action: entry.action === 'created' ? 'delete' : 'restore', entry }
  }
  return { action: 'conflict', entry }
}

async function undoSteps(
  deps: TransferEngineDeps,
  job: TransferJobRecord,
  actorUid: string,
): Promise<{ steps: PackageUndoStep[]; resources: Map<string, PackageResource> }> {
  const entries =
    (await readJsonDoc<TransferPackageUndoEntry[]>(
      transferJobsCollection(deps.firestore, job.orgId).doc(job.id).collection('undo').doc('0'),
    )) ?? []
  const resources = await packageResources(deps, [...new Set(entries.map((entry) => entry.resource))])
  const hashes = new Map<string, string>()
  for (const [kind, entry] of resources) {
    for (const one of await entry.hooks.items(contextOf(job.orgId, kind, actorUid, job.id))) {
      hashes.set(packageItemKey({ kind, id: one.id }), one.contentHash)
    }
  }
  const steps = entries.map((entry) => packageUndoStep(entry, hashes.get(packageItemKey({ kind: entry.resource, id: entry.id }))))
  return { steps, resources }
}

function assertPackageUndoOpen(job: TransferJobRecord, now: number): void {
  if (job.kind !== 'package') throw new TransferEngineError('invalid', 400, 'This import is not a package.')
  if (job.status !== 'applied') throw new TransferEngineError('state', 409, `This import is ${job.status}; only an applied import can be undone.`)
  if (job.undo?.status === 'done') throw new TransferEngineError('state', 409, 'This import was already undone.')
  if (!job.undo && !transferUndoAvailable(job, now)) {
    throw new TransferEngineError('undoExpired', 410, 'An import can be undone for seven days; this one is older.')
  }
}

/** What undo would do, writing nothing: counts, and every item edited since the import. */
export async function planTransferPackageUndo(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string; actorUid: string },
): Promise<{ job: TransferJobRecord; counts: TransferUndoCounts; conflicts: TransferPackageUndoConflict[]; expiresAt: number | null }> {
  const job = await readJob(deps, input.orgId, input.jobId)
  assertPackageUndoOpen(job, clock(deps))
  const { steps } = await undoSteps(deps, job, input.actorUid)
  const counts = emptyUndoCounts()
  const conflicts: TransferPackageUndoConflict[] = []
  for (const step of steps) {
    counts[step.action] += 1
    if (step.action === 'conflict') {
      const { entry } = step
      conflicts.push({
        row: entry.row,
        key: entry.key,
        resource: entry.resource,
        id: entry.id,
        ...(entry.name ? { name: entry.name } : {}),
        action: entry.action,
      })
    }
  }
  return { job, counts, conflicts, expiresAt: transferUndoExpiresAt(job) }
}

export interface ApplyTransferPackageUndoInput {
  orgId: string
  jobId: string
  actorUid: string
  /** By item id. */
  decisions?: Readonly<Record<string, TransferUndoDecision>>
  otherwise: TransferUndoDecision
  deadlineMs: number
  driver: string
}

/**
 * Carries undo out through each plugin's `revertItems`: every untouched
 * item, and every edited one the person (or `otherwise`) said to revert.
 * A step a plugin's own rules refuse is counted as a conflict and left.
 */
export async function applyTransferPackageUndo(
  deps: TransferEngineDeps,
  input: ApplyTransferPackageUndoInput,
): Promise<{ job: TransferJobRecord; undo: TransferUndoState; done: boolean; started: boolean }> {
  if (input.otherwise !== 'keep' && input.otherwise !== 'revert') {
    throw new TransferEngineError('invalid', 400, 'Say what happens to an item edited since the import.')
  }
  let job = await readJob(deps, input.orgId, input.jobId)
  assertPackageUndoOpen(job, clock(deps))
  const decisions: Record<string, TransferUndoDecision> = { ...(input.decisions ?? {}) }
  let started = false
  job = await takeLease(deps, job, input.driver, input.deadlineMs + TRANSFER_LEASE_GRACE_MS, (current, now) => {
    if (current.undo) {
      return {
        ...current,
        undo: { ...current.undo, otherwise: input.otherwise, decisions: { ...current.undo.decisions, ...decisions } },
        updatedAt: now,
      }
    }
    started = true
    return {
      ...current,
      updatedAt: now,
      undo: {
        status: 'running',
        chunk: 0,
        startedAt: now,
        startedBy: input.actorUid,
        otherwise: input.otherwise,
        decisions,
        counts: emptyUndoCounts(),
      },
    }
  })
  let undo = job.undo as TransferUndoState
  Object.assign(decisions, undo.decisions ?? {}, input.decisions ?? {})
  try {
    const { steps, resources } = await undoSteps(deps, job, input.actorUid)
    const counts = emptyUndoCounts()
    const byResource = new Map<string, TransferPackageRevertStep[]>()
    for (const step of steps) {
      const { entry } = step
      const decided = decisions[entry.id] ?? input.otherwise
      if (step.action === 'nothing') {
        counts.nothing += 1
        continue
      }
      if (step.action === 'conflict' && decided !== 'revert') {
        counts.conflict += 1
        continue
      }
      const revert: TransferPackageRevertStep =
        entry.action === 'created'
          ? { action: 'delete', id: entry.id }
          : { action: 'restore', id: entry.id, content: entry.previous }
      byResource.set(entry.resource, [...(byResource.get(entry.resource) ?? []), revert])
    }
    for (const [kind, list] of byResource) {
      const entry = resources.get(kind)
      if (!entry) {
        counts.conflict += list.length
        continue
      }
      const reverted = await entry.hooks.revertItems(contextOf(job.orgId, kind, input.actorUid, job.id), list)
      for (const step of list) {
        if (reverted.done.includes(step.id)) counts[step.action] += 1
      }
      counts.conflict += reverted.refused.length
    }
    undo = { ...undo, chunk: 1, counts, status: 'done' }
    job = moveJob({ ...job, undo }, 'undone', clock(deps), { lease: null })
    await saveJob(deps, job)
    return { job, undo, done: true, started }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    job = { ...job, lease: null, updatedAt: clock(deps), error: { code: 'undoFailed', message, chunk: 0 } }
    await saveJob(deps, job)
    throw new TransferEngineError('failed', 500, `Undo stopped: ${message}. Try again to continue.`)
  }
}
