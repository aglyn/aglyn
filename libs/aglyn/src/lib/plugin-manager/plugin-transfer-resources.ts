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

import type { ComponentType } from 'react'
import type { PicklistSpec, PicklistValue, PicklistValueSet } from '../app-utils/picklists'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  buildTransferFieldCatalog,
  type TransferCatalogInput,
  type TransferFieldCatalog,
} from '../data-transfer/field-catalog'
import type { TransferAliasDictionary } from '../data-transfer/header-match'
import type { MatchKeySpec, MatchLookup, MatchLookupRequest } from '../data-transfer/match'
import type {
  ExistingPackageItem,
  PackageDependency,
  PackageItemDecision,
  PackageManifestItem,
} from '../data-transfer/package'
import {
  buildTransferPlan,
  type BuildTransferPlanInput,
  type PlannedTransferRow,
  type TransferPlan,
} from '../data-transfer/plan'
import type { TransferLockedRule } from '../data-transfer/policy'
import type {
  TransferChunk,
  TransferRowResult,
  TransferUndoEntry,
  TransferUndoSnapshot,
  TransferUndoStep,
} from '../data-transfer/job'
import {
  transferFieldProblems,
  transferResourceProblems,
  type TransferKind,
  type TransferResourceDescriptor,
} from '../data-transfer/resource'
import type { MdiIconProps } from '../types/nodes'
import {
  filterPluginsByReleaseFlags,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
} from './enabled-plugins'
import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * WHAT A PLUGIN CAN IMPORT AND EXPORT (AGL-3523), the extension point every
 * import wizard, export dialog and transfer job reads.
 *
 * The core in `data-transfer/` knows how a column is matched to a field, how
 * a cell is read, how a row finds its record and what a policy does to it —
 * for no resource in particular. This module is where a resource joins it.
 * The plugin that owns the records declares the resource and answers for it;
 * the job engine and the UI kit ask here and never name a plugin.
 *
 * ## Declared, then registered — and an absent resource is refused
 *
 * The plugin declares the resource in `plugins.config.json`
 * (`transferResources`: a `TransferResourceDescriptor` — key, label, scope,
 * kinds, formats, limits), which the generator compiles. It registers two
 * halves:
 *
 * - the SERVER half, {@link registerPluginTransferResource}, from its
 *   `serverDeclarations` or `consoleServerDeclarations` entry: the field
 *   catalog, the match keys, the reads, the planned writes and their undo;
 * - the CLIENT half, {@link registerPluginTransferResourceUi}, from its
 *   console registrar: how the hub and the wizard show it, and any wizard
 *   steps of its own. The registrar loads at
 *   {@link TRANSFER_RESOURCES_LOAD_POINT}, which the plugin declares among its
 *   `console.slots`.
 *
 * A resource on the hub that fails at Apply is worse than one that is not on
 * the hub at all, so a declared resource with no server half is never read
 * as "nothing to move": {@link resolveTransferResource} runs the app's
 * declarations step once and throws if it is still missing.
 *
 * ## The plugin writes through its own paths
 *
 * `apply` and `revert` are the plugin's, not a generic writer's: plan bands,
 * consent rules, derived fields and activity entries live on the plugin's
 * write paths, and a transfer that went around them would be a way past
 * every one. The engine owns the job — chunks, the ledger, the time budget —
 * and hands the plugin a {@link TransferApplyWriter} that records each row
 * the moment its write lands, so a retried chunk never writes a row twice.
 *
 * Reached by its own subpath, never the barrel: its readers are the transfer
 * routes, the UI kit, and the plugins that answer them.
 */

/*==========================================
 * DECLARATIONS
 *=========================================*/

/** A declaration with the plugin that made it, as the generator compiles it. */
export type ResolvedTransferResourceDeclaration = TransferResourceDescriptor & {
  pluginId: string
}

/**
 * The load point a plugin with a transfer resource declares in its
 * `console.slots`, so the hub and the wizard load its console registrar and
 * with it the client half.
 */
export const TRANSFER_RESOURCES_LOAD_POINT = 'transferResources'

/** Every declared resource, in config order — the order the hub lists them. */
export function listDeclaredTransferResources(): readonly ResolvedTransferResourceDeclaration[] {
  return PLUGIN_TRANSFER_RESOURCES_DECLARED
}

/** The declared resource with this key, or `null`. */
export function declaredTransferResource(key: string): ResolvedTransferResourceDeclaration | null {
  const name = key.trim()
  return listDeclaredTransferResources().find((one) => one.key === name) ?? null
}

/** Whose resources are being listed: a workspace, or one of its sites. */
export type TransferResourceSubject = (
  | { scope: 'org'; org: { enabledPlugins?: string[] } | null | undefined }
  | {
      scope: 'host'
      org: { enabledPlugins?: string[] } | null | undefined
      host: { disabledPlugins?: string[]; enabledPlugins?: string[] } | null | undefined
    }
) & {
  /**
   * The release-flag verdict for the subject, when the caller has one: a
   * plugin whose flag is off for them offers nothing to move.
   */
  isFlagOn?: (flagKey: string) => boolean
  /** Staff preview keeps a dark plugin's resources listed. */
  staffBypass?: boolean
}

/**
 * The declared resources of `subject.scope` whose plugin runs for the
 * subject — the workspace's enabled set for `org`, the site's for `host` —
 * in config order. A resource of a plugin switched off is not offered, the
 * same rule every other surface of that plugin follows.
 */
export function listTransferResourcesFor(
  subject: TransferResourceSubject,
): ResolvedTransferResourceDeclaration[] {
  const enabled =
    subject.scope === 'host'
      ? resolveHostEnabledPlugins(subject.org, subject.host)
      : resolveEnabledPlugins(subject.org)
  const running = new Set(
    subject.isFlagOn
      ? filterPluginsByReleaseFlags(enabled, subject.isFlagOn, { staffBypass: subject.staffBypass })
      : enabled,
  )
  return listDeclaredTransferResources().filter(
    (one) => one.scope === subject.scope && running.has(one.pluginId),
  )
}

/*==========================================
 * THE SERVER HALF
 *=========================================*/

/** Who is moving what, handed to every server hook. */
export interface TransferResourceContext {
  /** The resource key. */
  resource: string
  orgId: string
  /** The site, for a `host` resource; `null` for an `org` one. */
  hostId: string | null
  /** The member moving the data, for the plugin's own checks and audit lines. */
  actorUid: string | null
  /** The job, once one exists; absent for a catalog read or an export page. */
  jobId?: string
}

/** Which records an export page reads. */
export interface TransferReadOptions {
  /** The most rows one page answers; the plugin may answer fewer. */
  pageSize?: number
  /** Only these records ("the selection"). */
  ids?: readonly string[]
  /** The list's own filter, in the plugin's own terms ("the current filter"). */
  filter?: Readonly<Record<string, unknown>>
}

/** One page of an export: rows keyed by field id, and where the next page starts. */
export interface TransferReadPage {
  rows: Array<Record<string, unknown>>
  /** `null` when this was the last page. */
  next: string | null
}

/** One picklist as the organization holds it: the platform's spec and the effective values. */
export interface TransferPicklistList {
  spec: PicklistSpec
  set: PicklistValueSet
}

/** What a lookup found: the match map, and each found record's current values. */
export interface TransferLookupResult {
  lookup: MatchLookup
  /** Record id → its current values by field id, for the plan's before → after. */
  records: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}

/**
 * A rule a row must keep that a field policy cannot say — a value that only
 * moves one way, two fields that must agree. Checked against each planned
 * row before the dry run is shown, so a row that breaks it is reported, not
 * discovered at Apply.
 */
export interface TransferInvariant {
  id: string
  /** What the rule is, in a sentence the person reads. */
  label: string
  /** Why this row breaks the rule, or `null` when it keeps it. */
  check(
    row: PlannedTransferRow,
    before: Readonly<Record<string, unknown>> | null,
  ): string | null
}

/**
 * The engine's ledger, handed to `apply` and `writeItems`. Rows are numbered
 * the way the plan numbers them; a package's items by their manifest index.
 */
export interface TransferApplyWriter {
  /** The result an earlier attempt recorded for this row, or `null` — a row with one is not written again. */
  alreadyApplied(row: number): Promise<TransferRowResult | null>
  /** Records a row's result and its undo entry the moment its write lands. */
  markApplied(result: TransferRowResult, undo?: TransferUndoEntry): Promise<void>
  /** Milliseconds left in the chunk's budget; stop at a row boundary when it runs short. */
  timeLeftMs(): number
}

/** What one chunk's writes came to. */
export interface TransferApplyResult {
  /** One per row handled, the rows already applied included. */
  results: TransferRowResult[]
  /** What undo needs, for every row written. */
  undo: TransferUndoEntry[]
}

/** The person's answer for each undo conflict, by record id. */
export type TransferRevertDecisions = Readonly<Record<string, 'revert' | 'keep'>>

/** What a revert did, and what it left for the person. */
export interface TransferRevertResult {
  /** The steps carried out. */
  done: TransferUndoStep[]
  /** The records edited since the import, waiting on a decision. */
  conflicts: TransferUndoStep[]
}

/** The hooks a `records` resource answers with. */
export interface TransferRecordsHooks {
  /** The field catalog: standard, custom, derived and system fields, and their groups. */
  fields(ctx: TransferResourceContext): Promise<TransferCatalogInput> | TransferCatalogInput
  /** The keys a row finds its record by, in priority order. */
  matchKeys: readonly MatchKeySpec[]
  /** Other products' header spellings for these fields. */
  aliases?: readonly TransferAliasDictionary[]
  /** One page of an export, holding only `fieldIds`. `cursor` is `null` for the first page. */
  readPage(
    ctx: TransferResourceContext,
    cursor: string | null,
    fieldIds: readonly string[],
    options?: TransferReadOptions,
  ): Promise<TransferReadPage>
  /**
   * The records holding each requested key value. Undo also asks it for
   * records by id — `TRANSFER_ID_FIELD` with the `aglynId` normalizer — to
   * read what each record holds now, so it answers that key whether or not
   * `matchKeys` names it.
   */
  lookup(
    ctx: TransferResourceContext,
    requests: readonly MatchLookupRequest[],
  ): Promise<TransferLookupResult>
  /**
   * The organization's effective list for each picklist the catalog names
   * (`TransferField.picklistId`), by picklist id. Without it a picklist
   * column is imported as typed, and the values step has nothing to match.
   */
  picklists?(
    ctx: TransferResourceContext,
    picklistIds: readonly string[],
  ): Promise<Readonly<Record<string, TransferPicklistList>>>
  /**
   * Adds the values the person chose to add to a picklist, before the
   * import's first write. Called again with the same values if that write
   * is retried, so an id the list already holds is left as it is.
   */
  addPicklistValues?(
    ctx: TransferResourceContext,
    picklistId: string,
    values: readonly PicklistValue[],
  ): Promise<void>
  /** The plan, when the core's `buildTransferPlan` is not enough. */
  plan?(
    ctx: TransferResourceContext,
    input: BuildTransferPlanInput,
  ): Promise<TransferPlan> | TransferPlan
  /** The plugin's locked rules, shown locked in the wizard with their reasons. */
  lockedRules?(
    ctx: TransferResourceContext,
  ): Promise<readonly TransferLockedRule[]> | readonly TransferLockedRule[]
  /** Rules each planned row must keep. */
  invariants?: readonly TransferInvariant[]
  /** Writes one chunk's planned rows through the plugin's own write paths. */
  apply(
    ctx: TransferResourceContext,
    chunk: TransferChunk<PlannedTransferRow>,
    writer: TransferApplyWriter,
  ): Promise<TransferApplyResult>
  /**
   * Reverses one chunk's writes, deciding each entry with the core's
   * `planTransferUndo` against the record as it is now. A conflict is
   * carried out only when `decisions` says `revert`.
   */
  revert(
    ctx: TransferResourceContext,
    snapshot: TransferUndoSnapshot,
    decisions?: TransferRevertDecisions,
  ): Promise<TransferRevertResult>
}

/** One item as the plugin reads it for a package: its manifest identity and its content. */
export interface TransferPackageItemContent<T = unknown> {
  kind: string
  id: string
  slug?: string
  name?: string
  content: T
}

/** One item a package import writes, with what the person decided for it. */
export interface TransferPackageItemWrite<T = unknown> {
  /** Its index in the manifest — the row the ledger and the results name. */
  row: number
  item: PackageManifestItem
  decision: PackageItemDecision
  /** The id it is written under: its own, or a new one when kept beside an existing item. */
  targetId: string
  /** The content, references already rewritten by `remapIds`. */
  content: T
}

/** The hooks a `package` resource answers with. */
export interface TransferPackageHooks<T = unknown> {
  /** What the site or workspace holds now, for matching incoming items. */
  items(ctx: TransferResourceContext): Promise<ExistingPackageItem[]>
  /** The items one item refers to. */
  dependencies(item: T): PackageDependency[]
  /**
   * The item with its references rewritten: `idMap` maps an item key
   * (`<kind>/<id>`, `packageItemKey`) to the id it now has.
   */
  remapIds(item: T, idMap: ReadonlyMap<string, string>): T
  /** The content of these items, for an export. */
  readItems(
    ctx: TransferResourceContext,
    ids: readonly string[],
  ): Promise<Array<TransferPackageItemContent<T>>>
  /** Writes the decided items through the plugin's own write paths. */
  writeItems(
    ctx: TransferResourceContext,
    items: ReadonlyArray<TransferPackageItemWrite<T>>,
    writer: TransferApplyWriter,
  ): Promise<TransferApplyResult>
  /** Reverses a package import's writes, on the same terms as a records `revert`. */
  revert?(
    ctx: TransferResourceContext,
    snapshot: TransferUndoSnapshot,
    decisions?: TransferRevertDecisions,
  ): Promise<TransferRevertResult>
}

/**
 * A resource's server half. A `records` kind answers every required
 * {@link TransferRecordsHooks} member; a `package` kind every required
 * {@link TransferPackageHooks} member — checked against the declaration at
 * registration. `revert` is shared: a resource of both kinds registers one.
 */
export type PluginTransferResource = Partial<TransferRecordsHooks> &
  Partial<Omit<TransferPackageHooks, 'revert'>>

const RECORDS_HOOKS = ['fields', 'matchKeys', 'readPage', 'lookup', 'apply', 'revert'] as const
const PACKAGE_HOOKS = ['items', 'dependencies', 'remapIds', 'readItems', 'writeItems'] as const

/** What is missing from `impl` for the kinds a resource declares, as sentences. */
export function pluginTransferResourceProblems(
  declared: Pick<TransferResourceDescriptor, 'key' | 'kinds'>,
  impl: PluginTransferResource,
): string[] {
  const problems: string[] = []
  const need = (kind: TransferKind, hooks: readonly string[]) => {
    if (!declared.kinds.includes(kind)) return
    for (const hook of hooks) {
      if ((impl as Record<string, unknown>)[hook] === undefined) {
        problems.push(`${declared.key} declares ${kind} and registers no "${hook}".`)
      }
    }
  }
  need('records', RECORDS_HOOKS)
  need('package', PACKAGE_HOOKS)
  if (impl.matchKeys && !impl.matchKeys.length && declared.kinds.includes('records')) {
    problems.push(`${declared.key} names no match key, so no row could find its record.`)
  }
  return problems
}

interface Registered {
  pluginId: string
  impl: PluginTransferResource
}

/**
 * One table per process, on `globalThis` (AGL-3412): a plugin registers from
 * its declarations at boot, which Next compiles apart from the routes that
 * read, and a module-scoped map would be filled in one copy and read empty in
 * the other.
 */
const RESOURCES_KEY = Symbol.for('@aglyn/aglyn:transfer-resources')
const UIS_KEY = Symbol.for('@aglyn/aglyn:transfer-resource-uis')

const globalScope = globalThis as typeof globalThis & {
  [RESOURCES_KEY]?: Map<string, Registered>
  [UIS_KEY]?: Map<string, RegisteredUi>
}

const resources: Map<string, Registered> =
  globalScope[RESOURCES_KEY] ?? (globalScope[RESOURCES_KEY] = new Map())

/** The owner a registration is filed under, and the declaration it must match. */
function claim(
  what: string,
  key: string,
  options: { pluginId?: string } | undefined,
): ResolvedTransferResourceDeclaration {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `${what} "${key}" registered with no owner: pass { pluginId } ` +
        'when registering outside a plugin register fn',
    )
  }
  const declared = declaredTransferResource(key)
  if (!declared) {
    throw new Error(
      `${what} "${key}" is not declared in plugins.config.json ` +
        '(transferResources), so no wizard or job would ever offer it',
    )
  }
  if (declared.pluginId !== pluginId) {
    throw new Error(`${what} "${key}" is declared by "${declared.pluginId}"; refused "${pluginId}"`)
  }
  return declared
}

/**
 * Registers the server half of a resource the plugin declared. The owner is
 * the plugin whose register fn is running, or the `pluginId` passed from a
 * boot declaration. Refused, naming why: no owner, a key nobody declared, a
 * key another plugin declared, a declaration the core's
 * `transferResourceProblems` rejects, and hooks missing for a declared kind.
 * The same plugin registering again replaces its answers.
 */
export function registerPluginTransferResource(
  key: string,
  impl: PluginTransferResource,
  options?: { pluginId?: string },
): void {
  const name = key.trim()
  const declared = claim('transfer resource', name, options)
  const problems = [
    ...transferResourceProblems(declared),
    ...pluginTransferResourceProblems(declared, impl),
  ]
  if (problems.length) {
    throw new Error(`transfer resource "${name}" refused: ${problems.join(' ')}`)
  }
  resources.set(name, { pluginId: declared.pluginId, impl })
}

/** A declared resource with the server half its plugin registered. */
export type ResolvedTransferResource = ResolvedTransferResourceDeclaration & {
  impl: PluginTransferResource
}

/** Why a resource could not be resolved: nobody declared the key, or nobody registered it. */
export class TransferResourceUnavailableError extends Error {
  constructor(
    readonly key: string,
    readonly reason: 'undeclared' | 'unregistered',
    message: string,
  ) {
    super(message)
    this.name = 'TransferResourceUnavailableError'
  }
}

async function ensureRegistered(
  declared: readonly ResolvedTransferResourceDeclaration[],
): Promise<void> {
  const missing = () => declared.filter((one) => !resources.has(one.key))
  if (missing().length) await runPluginDeclarationsRepair()
  const absent = missing()
  if (absent.length) {
    const names = absent.map((one) => `"${one.key}" (${one.pluginId})`).join(', ')
    throw new TransferResourceUnavailableError(
      absent[0].key,
      'unregistered',
      `[plugins] transfer resource(s) ${names} declared and not registered in this process`,
    )
  }
}

/**
 * The resource with this key and its server half. Throws
 * {@link TransferResourceUnavailableError}: `undeclared` for a key no plugin
 * declares (a route answers 404), and `unregistered` for one declared and
 * still missing after the app's declarations step ran once (a route answers
 * 500 — a boot that dropped a registration, never "nothing to move").
 */
export async function resolveTransferResource(key: string): Promise<ResolvedTransferResource> {
  const declared = declaredTransferResource(key)
  if (!declared) {
    throw new TransferResourceUnavailableError(
      key.trim(),
      'undeclared',
      `no plugin declares a transfer resource "${key.trim()}"`,
    )
  }
  await ensureRegistered([declared])
  return { ...declared, impl: (resources.get(declared.key) as Registered).impl }
}

/**
 * Every declared resource with its server half, in config order. Throws
 * naming each one declared and not registered, after the declarations step
 * ran once.
 */
export async function resolveTransferResources(): Promise<ResolvedTransferResource[]> {
  const declared = listDeclaredTransferResources()
  await ensureRegistered(declared)
  return declared.map((one) => ({ ...one, impl: (resources.get(one.key) as Registered).impl }))
}

/** The records hooks of a resolved resource; throws for one that does not declare `records`. */
export function transferRecordsHooks(resource: ResolvedTransferResource): TransferRecordsHooks {
  if (!resource.kinds.includes('records')) {
    throw new Error(`transfer resource "${resource.key}" does not move records`)
  }
  return resource.impl as TransferRecordsHooks
}

/** The package hooks of a resolved resource; throws for one that does not declare `package`. */
export function transferPackageHooks(resource: ResolvedTransferResource): TransferPackageHooks {
  if (!resource.kinds.includes('package')) {
    throw new Error(`transfer resource "${resource.key}" does not move a package`)
  }
  return resource.impl as TransferPackageHooks
}

/**
 * The resource's field catalog, built by the core. Throws naming every
 * problem `transferFieldProblems` finds: a catalog the wizard cannot trust
 * is refused before a person maps a column to it.
 */
export async function transferResourceCatalog(
  resource: ResolvedTransferResource,
  ctx: TransferResourceContext,
): Promise<TransferFieldCatalog> {
  const catalog = buildTransferFieldCatalog(await transferRecordsHooks(resource).fields(ctx))
  const problems = transferFieldProblems(catalog.fields)
  if (problems.length) {
    throw new Error(`transfer resource "${resource.key}" has a bad field catalog: ${problems.join(' ')}`)
  }
  return catalog
}

/** The plan for one chunk: the resource's own `plan`, or the core's `buildTransferPlan`. */
export async function planTransferResourceRows(
  resource: ResolvedTransferResource,
  ctx: TransferResourceContext,
  input: BuildTransferPlanInput,
): Promise<TransferPlan> {
  const hooks = transferRecordsHooks(resource)
  return hooks.plan ? hooks.plan(ctx, input) : buildTransferPlan(input)
}

/** The resource's locked rules, or none. */
export async function transferResourceLockedRules(
  resource: ResolvedTransferResource,
  ctx: TransferResourceContext,
): Promise<readonly TransferLockedRule[]> {
  return (await transferRecordsHooks(resource).lockedRules?.(ctx)) ?? []
}

/** One planned row that breaks one of the resource's invariants. */
export interface TransferInvariantFailure {
  row: number
  invariant: string
  message: string
}

/**
 * Every planned row that would write and breaks an invariant, checked
 * against the record as it was read (`existing`, by record id). Rows that
 * write nothing (`skip`, `fail`, `unchanged`) are not checked.
 */
export function transferInvariantFailures(
  invariants: readonly TransferInvariant[] | undefined,
  rows: readonly PlannedTransferRow[],
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): TransferInvariantFailure[] {
  const failures: TransferInvariantFailure[] = []
  if (!invariants?.length) return failures
  for (const row of rows) {
    if (row.verdict !== 'create' && row.verdict !== 'update') continue
    const before = row.recordId ? existing.get(row.recordId) ?? null : null
    for (const invariant of invariants) {
      const message = invariant.check(row, before)
      if (message) failures.push({ row: row.index, invariant: invariant.id, message })
    }
  }
  return failures
}

/** Only for specs: forgets every registered server half. */
export function resetTransferResourcesForTests(): void {
  resources.clear()
}

/*==========================================
 * THE CLIENT HALF
 *=========================================*/

/** Where in the wizard a plugin's own step goes: after one of the core's steps. */
export type TransferWizardStepId =
  | 'upload'
  | 'mapping'
  | 'values'
  | 'matching'
  | 'conflicts'
  | 'dryRun'
  | 'apply'

/** The core wizard's steps, in order. */
export const TRANSFER_WIZARD_STEPS: readonly TransferWizardStepId[] = [
  'upload',
  'mapping',
  'values',
  'matching',
  'conflicts',
  'dryRun',
  'apply',
]

/** What a plugin's own wizard step is handed. */
export interface TransferWizardStepProps {
  resource: string
  orgId: string
  hostId: string | null
  /** The job, once the upload has made one. */
  jobId: string | null
  /** Whether the step is done; the wizard holds Next until it is. */
  setComplete(complete: boolean): void
}

/** A plugin's own step in the import wizard. */
export interface TransferWizardStep {
  id: string
  label: string
  /** The core step it follows. */
  after: TransferWizardStepId
  component: ComponentType<TransferWizardStepProps>
}

/** How the hub and the wizard show a resource. */
export interface PluginTransferResourceUi {
  /** The name on the hub and the wizard's title; the declaration's label is the fallback. */
  label: string
  icon?: MdiIconProps
  extraSteps?: readonly TransferWizardStep[]
}

interface RegisteredUi {
  pluginId: string
  ui: PluginTransferResourceUi
}

const uis: Map<string, RegisteredUi> = globalScope[UIS_KEY] ?? (globalScope[UIS_KEY] = new Map())

/**
 * Registers the client half of a resource the plugin declared, from its
 * console registrar. Refused on the same terms as the server half — no
 * owner, an undeclared key, another plugin's key — and for an extra step
 * that follows no core step or repeats another's id.
 */
export function registerPluginTransferResourceUi(
  key: string,
  ui: PluginTransferResourceUi,
  options?: { pluginId?: string },
): void {
  const name = key.trim()
  const declared = claim('transfer resource UI', name, options)
  const ids = new Set<string>()
  for (const step of ui.extraSteps ?? []) {
    if (!TRANSFER_WIZARD_STEPS.includes(step.after)) {
      throw new Error(`transfer resource UI "${name}": step "${step.id}" follows no wizard step ("${step.after}")`)
    }
    if (ids.has(step.id)) throw new Error(`transfer resource UI "${name}": step "${step.id}" is listed twice`)
    ids.add(step.id)
  }
  uis.set(name, { pluginId: declared.pluginId, ui })
}

/** The client half registered for a resource, or `null`. */
export function pluginTransferResourceUi(key: string): (PluginTransferResourceUi & { pluginId: string }) | null {
  const entry = uis.get(key.trim())
  return entry ? { ...entry.ui, pluginId: entry.pluginId } : null
}

/** Every registered client half, in registration order. */
export function listPluginTransferResourceUis(): Array<{ key: string; pluginId: string }> {
  return [...uis.entries()].map(([key, entry]) => ({ key, pluginId: entry.pluginId }))
}

/**
 * The wizard's steps for a resource: the core's, with the plugin's own
 * inserted after the step each names, in the order the plugin lists them.
 */
export function transferWizardSteps(
  key: string,
): Array<{ id: string; core: true } | (TransferWizardStep & { core: false })> {
  const extra = pluginTransferResourceUi(key)?.extraSteps ?? []
  return TRANSFER_WIZARD_STEPS.flatMap((id) => [
    { id, core: true as const },
    ...extra.filter((step) => step.after === id).map((step) => ({ ...step, core: false as const })),
  ])
}

/** Only for specs: forgets every registered client half. */
export function resetTransferResourceUisForTests(): void {
  uis.clear()
}
