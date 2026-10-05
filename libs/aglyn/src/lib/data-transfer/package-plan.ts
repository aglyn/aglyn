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
 * A WORKSPACE PACKAGE'S PLAN (AGL-3535) — what importing one would do,
 * decided before anything is written.
 *
 * A workspace package is an `aglyn-package` v2 file whose items belong to
 * the workspace rather than a site: sequences, campaigns, automations,
 * email templates. Each item's `kind` is the key of the transfer resource
 * that owns it (`outreach.sequences`), so the job engine knows which
 * plugin reads, writes and undoes it, and an item of a kind no enabled
 * plugin owns is set aside rather than guessed at.
 *
 * ## Matching and deciding
 *
 * Every item is matched against what the workspace holds — by id, then
 * slug, then name, within its kind (`matchPackageItems`) — and proposed a
 * decision (`proposePackageDecision`): a new item is created, an identical
 * one skipped, and one that differs waits for the person — replace, keep
 * both, or skip. Replacing is never assumed.
 *
 * ## The ids every item ends up with
 *
 * Before anything is written, each item that will be written is given the
 * id it will have: its own for a new item, the matched item's for a
 * replace, a fresh one (and a `-copy` slug and a "(copy)" name) for keep
 * both. A skipped item that matched points at the workspace's item. So
 * every reference between items can be rewritten up front (`idMap`), in
 * any order, and a pair of items that name each other is no harder than
 * one that names the other.
 *
 * ## References the package cannot satisfy
 *
 * An item may name something the package does not carry and the
 * workspace does not hold: a template from another workspace, a mailbox
 * that was never connected here, a site. Each such reference is listed
 * once, with what may be done about it — import the package's own copy
 * (when the package holds it and it was skipped), map it to something the
 * workspace has, drop the reference, or skip every item that needs it —
 * and nothing is applied until each has an answer.
 *
 * Pure: the engine reads the workspace, the plugins say what each item
 * names, and this decides.
 *=========================================*/

import {
  keepBothSlug,
  matchPackageItems,
  packageDecisionsFor,
  packageDependencyOrder,
  packageItemKey,
  proposePackageDecision,
  contentHash,
  type ExistingPackageItem,
  type PackageItemComparison,
  type PackageItemDecision,
  type PackageItemStatus,
  type PackageManifest,
  type PackageManifestItem,
} from './package'

/** The kind a reference to one of the workspace's sites carries. Answered by the engine, not a plugin. */
export const TRANSFER_SITE_KIND = 'site'

/** The resource a workspace package's job is filed under: one package import runs at a time. */
export const TRANSFER_PACKAGE_RESOURCE = 'package'

/** The most items one workspace package may carry. */
export const TRANSFER_PACKAGE_MAX_ITEMS = 1000

/** The most bytes one workspace package file may carry. */
export const TRANSFER_PACKAGE_MAX_BYTES = 3_000_000

/** What importing one item comes to. */
export type TransferPackageVerdict = 'create' | 'replace' | 'keepBoth' | 'skip' | 'fail'

export const TRANSFER_PACKAGE_VERDICTS: readonly TransferPackageVerdict[] = [
  'create',
  'replace',
  'keepBoth',
  'skip',
  'fail',
]

/** What to do about a reference the package cannot satisfy. */
export type TransferPackageDependencyChoice =
  /** Import the package's own copy of an item the person had skipped. */
  | { action: 'import' }
  /** Point the reference at something the workspace already has. */
  | { action: 'mapTo'; id: string }
  /** Leave the reference out of every item that names it. */
  | { action: 'dropReference' }
  /** Skip every item that needs it. */
  | { action: 'skipItem' }

export type TransferPackageDependencyAction = TransferPackageDependencyChoice['action']

/** One thing a reference may be mapped to. */
export interface TransferReferenceTarget {
  id: string
  name?: string
}

/** What the workspace holds of a kind no package resource owns (its sites, its mailboxes, its lists). */
export interface TransferReferenceKind {
  kind: string
  /** What one of them is called ("Mailbox"). */
  label: string
  targets: TransferReferenceTarget[]
}

/** The warnings an import must have acknowledged before it writes. */
export type TransferPackageWarningClass = 'replace' | 'dropReference' | 'failed'

export const TRANSFER_PACKAGE_WARNING_CLASSES: readonly TransferPackageWarningClass[] = [
  'replace',
  'dropReference',
  'failed',
]

/** Why an item is skipped or fails. */
export type TransferPackageItemReason =
  /** No enabled plugin owns its kind. */
  | 'unknownKind'
  /** The person chose to skip it. */
  | 'chosen'
  /** It is identical to the workspace's item. */
  | 'identical'
  /** A reference it needs was answered with "skip every item that needs it". */
  | 'missingDependency'
  /** The owning plugin's own checks refuse it (`problems`). */
  | 'problems'

/** One item's line in the plan. */
export interface TransferPackagePlanItem {
  /** Its index in the manifest — the row the ledger and the results name. */
  row: number
  /** `<kind>/<id>`, as the file names it. */
  key: string
  kind: string
  id: string
  name?: string
  slug?: string
  status: PackageItemStatus
  comparison: PackageItemComparison
  matchedBy?: 'id' | 'slug' | 'name'
  existing?: { id: string; name?: string; slug?: string }
  /** What will be done with it. */
  decision: PackageItemDecision
  /** The decisions it may take. */
  decisions: PackageItemDecision[]
  /** It differs from the workspace's item and the person has not chosen yet. */
  needsChoice: boolean
  verdict: TransferPackageVerdict
  /** The id it is written under, for a write. */
  targetId?: string
  /** A kept-both copy's new name and slug. */
  rename?: { name?: string; slug?: string }
  reason?: TransferPackageItemReason
  /** The owning plugin's objections, each a sentence; any one fails the item. */
  problems: string[]
}

/** A reference no item in the package or the workspace satisfies, and what the person chose for it. */
export interface TransferPackageReference {
  /** `<kind>/<id>`. */
  key: string
  kind: string
  id: string
  /** What one of the kind is called. */
  label: string
  /** A name for it, when the package carries it. */
  name?: string
  /** The items that name it, by key. */
  neededBy: string[]
  /** The package carries it, and the person chose not to import it. */
  inPackage: boolean
  choice: TransferPackageDependencyChoice | null
  /** What may be chosen for it. */
  choices: TransferPackageDependencyAction[]
  /** What it may be mapped to. */
  targets: TransferReferenceTarget[]
}

export type TransferPackageSummary = Record<TransferPackageVerdict, number> & { total: number }

/** What importing a package would do. */
export interface TransferPackagePlan {
  items: TransferPackagePlanItem[]
  /** References needing (or holding) a choice. */
  references: TransferPackageReference[]
  /** Kinds in the file no enabled plugin owns; their items are skipped. */
  unknownKinds: string[]
  /** The keys of the items that write, dependencies first. */
  order: string[]
  /** Item key → the id it has after the import; `''` for a dropped reference. */
  idMap: Record<string, string>
  summary: TransferPackageSummary
  /** What still blocks Apply, each a sentence. */
  blocking: string[]
  acknowledgementsRequired: TransferPackageWarningClass[]
}

export interface PlanTransferPackageInput {
  manifest: Pick<PackageManifest, 'items'>
  /** The kinds a package resource owns here — every other kind is unknown. */
  ownedKinds: ReadonlySet<string>
  /** What the workspace holds of every owned kind the package carries or names. */
  existing: readonly ExistingPackageItem[]
  /** What the workspace holds of the other kinds the items name. */
  references?: readonly TransferReferenceKind[]
  /** What a package kind is called, for a reference to one. */
  kindLabels?: Readonly<Record<string, string>>
  /** The person's decision per item key. */
  decisions?: Readonly<Record<string, PackageItemDecision>>
  /** The person's choice per reference key. */
  dependencyChoices?: Readonly<Record<string, TransferPackageDependencyChoice>>
  /** The objections each item's plugin raised, by item key. */
  problems?: Readonly<Record<string, readonly string[]>>
  /** A fresh id for a kept-both copy. Called once per such item, in manifest order. */
  newId: () => string
}

function caseless(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * The name a kept-both copy takes: `<name> (copy)`, then `(copy 2)`,
 * `(copy 3)`… until none of `taken` (compared caselessly).
 */
export function keepBothName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(caseless))
  const base = `${name.replace(/\s*\(copy(?: \d+)?\)$/, '').trim()} (copy)`
  if (!used.has(caseless(base))) return base
  for (let n = 2; ; n += 1) {
    const candidate = base.replace(/\(copy\)$/, `(copy ${n})`)
    if (!used.has(caseless(candidate))) return candidate
  }
}

/**
 * What a resource holds now, as matching reads it: each item's content
 * hashed with `contentHash`. A resource's `items` hook answers with this
 * over the same content `readItems` exports, so an item exported and
 * imported unchanged compares `identical`.
 */
export async function existingPackageItemsOf<T>(
  kind: string,
  contents: ReadonlyArray<{ id: string; name?: string; slug?: string; content: T }>,
): Promise<ExistingPackageItem[]> {
  const items: ExistingPackageItem[] = []
  for (const entry of contents) {
    items.push({
      kind,
      id: entry.id,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.slug ? { slug: entry.slug } : {}),
      contentHash: await contentHash(entry.content),
    })
  }
  return items
}

function emptySummary(): TransferPackageSummary {
  return { create: 0, replace: 0, keepBoth: 0, skip: 0, fail: 0, total: 0 }
}

const WRITES: ReadonlySet<PackageItemDecision> = new Set(['create', 'replace', 'keepBoth', 'merge'])

function choicesFor(inPackage: boolean): TransferPackageDependencyAction[] {
  return inPackage ? ['import', 'mapTo', 'dropReference', 'skipItem'] : ['mapTo', 'dropReference', 'skipItem']
}

/**
 * The plan (see the block header). Deterministic for the same input,
 * `newId` aside: decisions the person did not make are proposed, a
 * decision an item may not take falls back to the proposal, and a
 * reference choice that names nothing the workspace holds is no choice.
 */
export function planTransferPackage(input: PlanTransferPackageInput): TransferPackagePlan {
  const manifestItems = input.manifest.items
  const byKey = new Map(manifestItems.map((item) => [packageItemKey(item), item]))
  const known = manifestItems.filter((item) => input.ownedKinds.has(item.kind))
  const unknownKinds = [...new Set(manifestItems.filter((item) => !input.ownedKinds.has(item.kind)).map((item) => item.kind))]
  const matches = new Map(matchPackageItems({ items: known }, input.existing).map((match) => [packageItemKey(match.item), match]))
  const existingByKind = new Map<string, ExistingPackageItem[]>()
  for (const entry of input.existing) existingByKind.set(entry.kind, [...(existingByKind.get(entry.kind) ?? []), entry])
  const referenceKinds = new Map((input.references ?? []).map((kind) => [kind.kind, kind]))
  const labelOf = (kind: string) => referenceKinds.get(kind)?.label ?? input.kindLabels?.[kind] ?? kind

  // The decision each item starts from: the person's, when it is one the item may take.
  const decided = new Map<string, PackageItemDecision>()
  const forcedImport = new Set<string>()
  for (const item of known) {
    const key = packageItemKey(item)
    const match = matches.get(key)
    if (!match) continue
    const allowed = packageDecisionsFor(match)
    const chosen = input.decisions?.[key]
    decided.set(key, chosen && allowed.includes(chosen) ? chosen : proposePackageDecision(match).decision)
  }
  for (const [depKey, choice] of Object.entries(input.dependencyChoices ?? {})) {
    if (choice?.action !== 'import') continue
    const match = matches.get(depKey)
    if (match?.comparison === 'new' && decided.get(depKey) === 'skip') {
      decided.set(depKey, 'create')
      forcedImport.add(depKey)
    }
  }

  // Skipped for want of a reference the person chose to skip them over; grows until it settles.
  const skippedForDependency = new Set<string>()
  let references: TransferPackageReference[] = []
  let idMap: Record<string, string> = {}
  for (let pass = 0; pass <= known.length + 1; pass += 1) {
    const writes = (key: string) => WRITES.has(decided.get(key) ?? 'skip') && !skippedForDependency.has(key)
    // Ids first: every reference below is resolved against them.
    idMap = {}
    for (const item of known) {
      const key = packageItemKey(item)
      const match = matches.get(key)
      const decision = decided.get(key)
      if (!match) continue
      if (writes(key)) {
        if (decision === 'replace' || decision === 'merge') idMap[key] = match.existing?.id ?? item.$id
        else if (decision === 'create') idMap[key] = item.$id
      } else if (match.existing) {
        idMap[key] = match.existing.id
      }
    }
    // Kept-both ids are placeholders here; the real ones are minted once, below.
    for (const item of known) {
      const key = packageItemKey(item)
      if (writes(key) && decided.get(key) === 'keepBoth') idMap[key] = `\u0000${key}`
    }

    const open = new Map<string, TransferPackageReference>()
    for (const item of known) {
      const key = packageItemKey(item)
      if (!writes(key)) continue
      for (const dep of item.deps) {
        const depKey = packageItemKey(dep)
        if (depKey in idMap) continue
        const held = input.ownedKinds.has(dep.kind)
          ? (existingByKind.get(dep.kind) ?? []).some((entry) => entry.id === dep.id)
          : (referenceKinds.get(dep.kind)?.targets ?? []).some((target) => target.id === dep.id)
        if (held) continue
        const inPackage = byKey.has(depKey) && input.ownedKinds.has(dep.kind)
        const reference = open.get(depKey) ?? {
          key: depKey,
          kind: dep.kind,
          id: dep.id,
          label: labelOf(dep.kind),
          ...(byKey.get(depKey)?.name ? { name: byKey.get(depKey)?.name } : {}),
          neededBy: [],
          inPackage,
          choice: null,
          choices: choicesFor(inPackage),
          targets: input.ownedKinds.has(dep.kind)
            ? (existingByKind.get(dep.kind) ?? []).map((entry) => ({ id: entry.id, ...(entry.name ? { name: entry.name } : {}) }))
            : [...(referenceKinds.get(dep.kind)?.targets ?? [])],
        }
        if (!reference.neededBy.includes(key)) reference.neededBy.push(key)
        open.set(depKey, reference)
      }
    }
    // A reference the person forced the import of resolves once its item writes; it is listed so the choice shows.
    for (const depKey of forcedImport) {
      const item = byKey.get(depKey)
      if (!item || open.has(depKey)) continue
      const neededBy = known
        .filter((other) => writes(packageItemKey(other)) && other.deps.some((dep) => packageItemKey(dep) === depKey))
        .map(packageItemKey)
      open.set(depKey, {
        key: depKey,
        kind: item.kind,
        id: item.$id,
        label: labelOf(item.kind),
        ...(item.name ? { name: item.name } : {}),
        neededBy,
        inPackage: true,
        choice: { action: 'import' },
        choices: choicesFor(true),
        targets: (existingByKind.get(item.kind) ?? []).map((entry) => ({ id: entry.id, ...(entry.name ? { name: entry.name } : {}) })),
      })
    }

    let grew = false
    for (const reference of open.values()) {
      if (reference.choice) continue
      const choice = input.dependencyChoices?.[reference.key]
      if (!choice || !reference.choices.includes(choice.action)) continue
      if (choice.action === 'mapTo') {
        if (!reference.targets.some((target) => target.id === choice.id)) continue
        reference.choice = choice
        idMap[reference.key] = choice.id
      } else if (choice.action === 'dropReference') {
        reference.choice = choice
        idMap[reference.key] = ''
      } else if (choice.action === 'skipItem') {
        reference.choice = choice
        for (const key of reference.neededBy) {
          if (!skippedForDependency.has(key)) {
            skippedForDependency.add(key)
            grew = true
          }
        }
      }
    }
    references = [...open.values()]
    if (!grew) break
  }

  // Kept-both copies: a fresh id, a free slug and a free name, in manifest order.
  const renames = new Map<string, { name?: string; slug?: string }>()
  const takenSlugs = new Map<string, string[]>()
  const takenNames = new Map<string, string[]>()
  for (const [kind, entries] of existingByKind) {
    takenSlugs.set(kind, entries.flatMap((entry) => (entry.slug ? [entry.slug] : [])))
    takenNames.set(kind, entries.flatMap((entry) => (entry.name ? [entry.name] : [])))
  }
  for (const item of known) {
    const key = packageItemKey(item)
    if (idMap[key] !== `\u0000${key}`) continue
    idMap[key] = input.newId()
    const rename: { name?: string; slug?: string } = {}
    if (item.slug) {
      rename.slug = keepBothSlug(item.slug, takenSlugs.get(item.kind) ?? [])
      takenSlugs.set(item.kind, [...(takenSlugs.get(item.kind) ?? []), rename.slug])
    }
    if (item.name) {
      rename.name = keepBothName(item.name, takenNames.get(item.kind) ?? [])
      takenNames.set(item.kind, [...(takenNames.get(item.kind) ?? []), rename.name])
    }
    renames.set(key, rename)
  }

  const items: TransferPackagePlanItem[] = manifestItems.map((item, row) => {
    const key = packageItemKey(item)
    const base = {
      row,
      key,
      kind: item.kind,
      id: item.$id,
      ...(item.name ? { name: item.name } : {}),
      ...(item.slug ? { slug: item.slug } : {}),
    }
    const match = matches.get(key)
    if (!match) {
      return {
        ...base,
        status: 'new' as const,
        comparison: 'new' as const,
        decision: 'skip' as const,
        decisions: ['skip' as const],
        needsChoice: false,
        verdict: 'skip' as const,
        reason: 'unknownKind' as const,
        problems: [] as string[],
      }
    }
    const decision = decided.get(key) ?? 'skip'
    const chosen = input.decisions?.[key] !== undefined || forcedImport.has(key)
    const problems = [...(input.problems?.[key] ?? [])]
    const writing = WRITES.has(decision) && !skippedForDependency.has(key)
    const verdict: TransferPackageVerdict = !writing
      ? 'skip'
      : problems.length
        ? 'fail'
        : decision === 'merge'
          ? 'replace'
          : (decision as TransferPackageVerdict)
    const reason: TransferPackageItemReason | undefined = skippedForDependency.has(key)
      ? 'missingDependency'
      : verdict === 'fail'
        ? 'problems'
        : verdict === 'skip'
          ? match.comparison === 'identical' && !chosen
            ? 'identical'
            : 'chosen'
          : undefined
    return {
      ...base,
      status: match.status,
      comparison: match.comparison,
      ...(match.matchedBy ? { matchedBy: match.matchedBy } : {}),
      ...(match.existing
        ? {
            existing: {
              id: match.existing.id,
              ...(match.existing.name ? { name: match.existing.name } : {}),
              ...(match.existing.slug ? { slug: match.existing.slug } : {}),
            },
          }
        : {}),
      decision,
      decisions: packageDecisionsFor(match),
      needsChoice: match.comparison === 'differs' && !chosen,
      verdict,
      ...(writing ? { targetId: idMap[key] } : {}),
      ...(renames.has(key) && writing ? { rename: renames.get(key) } : {}),
      ...(reason ? { reason } : {}),
      problems,
    }
  })

  const summary = emptySummary()
  for (const item of items) {
    summary[item.verdict] += 1
    summary.total += 1
  }
  const blocking: string[] = []
  for (const item of items) {
    if (item.needsChoice) blocking.push(`Choose what happens to ${item.name ?? item.key}: it differs from the one you have.`)
  }
  for (const reference of references) {
    if (!reference.choice) {
      blocking.push(`Choose what happens to the ${reference.label.toLowerCase()} ${reference.name ?? reference.id}: ${reference.neededBy.length === 1 ? 'an item needs' : `${reference.neededBy.length} items need`} it, and this workspace has none by that id.`)
    }
  }
  const writing = items.filter((item) => item.verdict !== 'skip' && item.verdict !== 'fail')
  const order = packageDependencyOrder(
    writing.map((item) => byKey.get(item.key) as PackageManifestItem),
  ).order.map(packageItemKey)
  const acknowledgementsRequired: TransferPackageWarningClass[] = []
  if (summary.replace) acknowledgementsRequired.push('replace')
  if (references.some((reference) => reference.choice?.action === 'dropReference')) acknowledgementsRequired.push('dropReference')
  if (summary.fail) acknowledgementsRequired.push('failed')
  return { items, references, unknownKinds, order, idMap, summary, blocking, acknowledgementsRequired }
}

/** The warning classes a plan still needs acknowledged. */
export function missingPackageAcknowledgements(
  plan: Pick<TransferPackagePlan, 'acknowledgementsRequired'>,
  acknowledged: readonly string[],
): TransferPackageWarningClass[] {
  return plan.acknowledgementsRequired.filter((warning) => !acknowledged.includes(warning))
}

/** Whether a plan may be applied: nothing blocks, every warning is acknowledged, and something writes. */
export function canApplyTransferPackage(
  plan: Pick<TransferPackagePlan, 'acknowledgementsRequired' | 'blocking' | 'summary'>,
  acknowledged: readonly string[],
): boolean {
  const writes = plan.summary.create + plan.summary.replace + plan.summary.keepBoth
  return !plan.blocking.length && writes > 0 && !missingPackageAcknowledgements(plan, acknowledged).length
}

/** The id map as `remapIds` takes it. */
export function packageIdMap(idMap: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(idMap))
}

/**
 * A reference rewritten through an id map: the id it now has, `null` when
 * the person dropped it, or itself when nothing maps it (a reference the
 * workspace already satisfies). The helper every `remapIds` uses.
 */
export function remapPackageReference(
  idMap: ReadonlyMap<string, string>,
  kind: string,
  id: string | null | undefined,
): string | null {
  if (!id) return id ?? null
  const mapped = idMap.get(`${kind}/${id}`)
  if (mapped === undefined) return id
  return mapped === '' ? null : mapped
}
