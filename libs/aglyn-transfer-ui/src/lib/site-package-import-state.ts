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
 * THE PACKAGE IMPORT'S DECISIONS — pure, so every rule is specced without
 * a screen (AGL-3534).
 *
 * A decision per item comes from, in order: the person's choice for that
 * item, the default they set for its kind of change (new, changed,
 * unchanged), and the plan's proposal. Every item's decision is sent, so
 * the server never falls back on a proposal the person did not see.
 *=========================================*/

import type {
  PackageDependency,
  PackageItemComparison,
  PackageItemDecision,
  PackageItemStatus,
} from '@aglyn/aglyn/data-transfer'

import type {
  SitePackageDecisions,
  SitePackageDependencyChoice,
  SitePackageMergeChoice,
  SitePackagePlan,
  SitePackagePlanAnswer,
  SitePackagePlanItem,
  SitePackageWarning,
} from './site-package-client'
import type { TransferAcknowledgementItem } from './transfer-acknowledgement-list.component'
import type { TransferChoiceOption } from './transfer-choice-select.component'
import type { TransferDiffChange } from './transfer-diff-table.component'
import { countOf } from './transfer-words'

type ChipColor = 'default' | 'success' | 'warning' | 'error' | 'info'

export const PACKAGE_STATUS_WORDS: Readonly<
  Record<PackageItemStatus, { label: string; color: ChipColor }>
> = {
  new: { label: 'New', color: 'success' },
  identical: { label: 'Already on this site', color: 'default' },
  differs: { label: 'Differs', color: 'warning' },
  missingDependency: { label: 'Needs something', color: 'error' },
}

export const PACKAGE_DECISION_WORDS: Readonly<
  Record<PackageItemDecision, { label: string; description: string }>
> = {
  create: { label: 'Add', description: 'Adds the file’s item to this site.' },
  replace: {
    label: 'Replace',
    description:
      'Writes the file’s copy over this site’s. Pages, layouts and emails get it as a new version.',
  },
  keepBoth: {
    label: 'Keep both',
    description:
      'Adds the file’s copy beside this site’s, under a new ID and address.',
  },
  skip: { label: 'Skip', description: 'Leaves this site’s item as it is.' },
  merge: {
    label: 'Merge',
    description:
      'Keeps this site’s values and fills in what it has not set; choose key by key.',
  },
}

/** The default a person sets for each kind of change. `''` is not chosen yet. */
export interface PackageBulkDefaults {
  new: PackageItemDecision | ''
  differs: PackageItemDecision | ''
  identical: PackageItemDecision | ''
}

/** New items are added and unchanged ones left; a changed item waits for the person. */
export const INITIAL_PACKAGE_BULK_DEFAULTS: PackageBulkDefaults = {
  new: 'create',
  differs: '',
  identical: 'skip',
}

/** The choices a default for one kind of change may take. */
export const PACKAGE_BULK_CHOICES: Readonly<
  Record<PackageItemComparison, readonly PackageItemDecision[]>
> = {
  new: ['create', 'skip'],
  differs: ['skip', 'replace', 'keepBoth'],
  identical: ['skip', 'replace', 'keepBoth'],
}

export function packageDecisionOptions(
  choices: readonly PackageItemDecision[],
): TransferChoiceOption<PackageItemDecision>[] {
  return choices.map((choice) => ({
    value: choice,
    label: PACKAGE_DECISION_WORDS[choice].label,
    description: PACKAGE_DECISION_WORDS[choice].description,
  }))
}

/** An item as a person names it. */
export function packageItemTitle(item: {
  name?: string
  slug?: string
  id: string
}): string {
  return item.name || item.slug || item.id
}

/**
 * The item's decision: the person's own, then the default for its kind of
 * change, then the plan's proposal — each only when the item may take it.
 * `null` when a changed item has neither a choice nor a default.
 */
export function effectivePackageDecision(
  item: SitePackagePlanItem,
  overrides: Readonly<Record<string, PackageItemDecision>>,
  bulk: PackageBulkDefaults,
): PackageItemDecision | null {
  const own = overrides[item.key]
  if (own && item.choices.includes(own)) return own
  const fallback = bulk[item.comparison]
  if (fallback && item.choices.includes(fallback)) return fallback
  if (item.comparison === 'differs') return null
  return item.proposed
}

/** Every item's decision, and the items still waiting for one. */
export function packageDecisions(
  plan: SitePackagePlan,
  overrides: Readonly<Record<string, PackageItemDecision>>,
  bulk: PackageBulkDefaults,
): { decisions: Record<string, PackageItemDecision>; undecided: string[] } {
  const decisions: Record<string, PackageItemDecision> = {}
  const undecided: string[] = []
  for (const item of plan.items) {
    const decision = effectivePackageDecision(item, overrides, bulk)
    if (decision) decisions[item.key] = decision
    else undecided.push(item.key)
  }
  return { decisions, undecided }
}

/** A dependency that will exist nowhere after the import unless the person says how. */
export interface PackageDependencyPrompt {
  key: string
  kind: string
  id: string
  /** The package's item, when the file carries it and it is set to skip. */
  inPackage?: SitePackagePlanItem
  /** The items being written that name it. */
  neededBy: string[]
}

/**
 * The dependencies an import would leave pointing at nothing: those the file
 * carries but the person skipped (and the site does not hold), and those
 * neither the file nor the site holds — for items that are written.
 */
export function packageDependencyPrompts(
  plan: SitePackagePlan,
  decisions: Readonly<Record<string, PackageItemDecision>>,
): PackageDependencyPrompt[] {
  const byKey = new Map(plan.items.map((item) => [item.key, item]))
  const written = (key: string) => {
    const decision = decisions[key]
    return Boolean(decision) && decision !== 'skip'
  }
  const prompts = new Map<string, PackageDependencyPrompt>()
  const add = (dep: PackageDependency, by: string, inPackage?: SitePackagePlanItem) => {
    const key = `${dep.kind}/${dep.id}`
    const prompt = prompts.get(key) ?? {
      key,
      kind: dep.kind,
      id: dep.id,
      ...(inPackage ? { inPackage } : {}),
      neededBy: [],
    }
    if (!prompt.neededBy.includes(by)) prompt.neededBy.push(by)
    prompts.set(key, prompt)
  }
  for (const item of plan.items) {
    if (!written(item.key)) continue
    const missing = new Set(item.missing.map((dep) => `${dep.kind}/${dep.id}`))
    for (const dep of item.deps) {
      const key = `${dep.kind}/${dep.id}`
      if (missing.has(key)) {
        add(dep, item.key)
        continue
      }
      const packaged = byKey.get(key)
      if (packaged && !written(key) && !packaged.existing) add(dep, item.key, packaged)
    }
  }
  return [...prompts.values()]
}

/** What a prompt may be answered with. */
export type PackageDependencyAnswer = 'import' | 'mapTo' | 'drop' | 'keep'

export function packageDependencyOptions(
  prompt: PackageDependencyPrompt,
): TransferChoiceOption<PackageDependencyAnswer>[] {
  return [
    ...(prompt.inPackage
      ? [
          {
            value: 'import' as const,
            label: 'Import it from the file',
            description: 'Adds the file’s copy, though you set it to skip.',
          },
        ]
      : []),
    {
      value: 'mapTo',
      label: 'Use an item this site has',
      description: 'Points every reference at the item you pick.',
    },
    {
      value: 'drop',
      label: 'Remove the reference',
      description: 'The items that named it no longer do.',
    },
    {
      value: 'keep',
      label: 'Leave it pointing at nothing',
      description: 'Until an item with that ID exists on this site.',
    },
  ]
}

/** The answer in the person's words: what the select shows. */
export function packageDependencyAnswer(
  choice: SitePackageDependencyChoice | undefined,
): PackageDependencyAnswer | '' {
  if (!choice) return ''
  return typeof choice === 'object' ? 'mapTo' : choice
}

/** Why the dependency step cannot be left yet, one sentence each. */
export function packageDependencyProblems(
  prompts: readonly PackageDependencyPrompt[],
  choices: Readonly<Record<string, SitePackageDependencyChoice>>,
): string[] {
  const unanswered = prompts.filter((prompt) => !choices[prompt.key]).length
  const unmapped = prompts.filter((prompt) => {
    const choice = choices[prompt.key]
    return typeof choice === 'object' && !choice.mapTo
  }).length
  return [
    ...(unanswered
      ? [`Choose what to do about ${countOf(unanswered, 'missing item')}.`]
      : []),
    ...(unmapped
      ? [`Pick the item to use for ${countOf(unmapped, 'reference')}.`]
      : []),
  ]
}

/** The answers the import route takes: only those for prompts still open, complete ones only. */
export function packageDependencyChoices(
  prompts: readonly PackageDependencyPrompt[],
  choices: Readonly<Record<string, SitePackageDependencyChoice>>,
): Record<string, SitePackageDependencyChoice> {
  const out: Record<string, SitePackageDependencyChoice> = {}
  for (const prompt of prompts) {
    const choice = choices[prompt.key]
    if (!choice) continue
    if (typeof choice === 'object' && !choice.mapTo) continue
    out[prompt.key] = choice
  }
  return out
}

/*==========================================
 * DIFFS
 *=========================================*/

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A path as a person reads it: `version › nodes › text › props`. */
function pathLabel(path: readonly string[]): string {
  return path.length ? path.join(' › ') : 'Whole item'
}

/**
 * Every leaf that differs between the site's item and the file's, as
 * before → after rows: objects are walked key by key, a list or a value is
 * compared whole. At most `limit` rows; `more` counts the rest.
 */
export function packageJsonDiff(
  before: unknown,
  after: unknown,
  limit = 200,
): { changes: TransferDiffChange[]; more: number } {
  const changes: TransferDiffChange[] = []
  let more = 0
  const walk = (left: unknown, right: unknown, path: string[]) => {
    if (same(left, right)) return
    if (isPlain(left) && isPlain(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      for (const key of keys) walk(left[key], right[key], [...path, key])
      return
    }
    if (changes.length >= limit) {
      more += 1
      return
    }
    changes.push({
      key: path.join('/') || '$',
      label: pathLabel(path),
      before: left,
      after: right,
    })
  }
  walk(before, after, [])
  return { changes, more }
}

/** One top-level key of a merged item: both values and the default. */
export interface PackageMergeKey {
  key: string
  site: unknown
  file: unknown
  /** What a merge does when the person does not say: the site's value wins when it has one. */
  merged: SitePackageMergeChoice
}

const blank = (value: unknown) =>
  value === undefined || value === null || value === ''

/** The keys of a merged item that differ, each with what a merge would keep. */
export function packageMergeKeys(site: unknown, file: unknown): PackageMergeKey[] {
  const left = isPlain(site) ? site : {}
  const right = isPlain(file) ? file : {}
  return Object.keys(right)
    .sort()
    .filter((key) => right[key] !== undefined && !same(left[key], right[key]))
    .map((key) => ({
      key,
      site: left[key],
      file: right[key],
      merged: blank(left[key]) ? 'package' : 'site',
    }))
}

/*==========================================
 * RECORDS
 *=========================================*/

/** One record of an item's list: a document with its own `$id`. */
export type PackageRecord = Record<string, unknown> & { $id: string }

const isRecord = (value: unknown): value is PackageRecord =>
  isPlain(value) && typeof value['$id'] === 'string' && value['$id'] !== ''

/**
 * The key of an item that holds its records — a dataset's `records`, a
 * collection's `entries` — found by shape rather than by kind, so the kit
 * names no kind a plugin declares: the one list, on either side, whose
 * every element is a document with its own `$id`. The other side holds a
 * list there too, or nothing. `null` when no key qualifies, or when more
 * than one does and neither can be read as the item's records.
 */
export function packageRecordField(...contents: readonly unknown[]): string | null {
  const docs = contents.filter(isPlain)
  const found = new Set<string>()
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) found.add(key)
    }
  }
  const fields = [...found].filter((key) =>
    docs.every((doc) => {
      const value = doc[key]
      return value === undefined || value === null || (Array.isArray(value) && value.every(isRecord))
    }),
  )
  return fields.length === 1 ? (fields[0] as string) : null
}

export type PackageRecordStatus = 'added' | 'removed' | 'changed'

/** One record that differs between the site and the file. */
export interface PackageRecordRow {
  id: string
  status: PackageRecordStatus
  /** The site's copy; `null` for a record only the file holds. */
  site: PackageRecord | null
  /** The file's copy; `null` for a record only the site holds. */
  file: PackageRecord | null
  /** The fields whose values differ, for a changed record. */
  changed: readonly string[]
}

export interface PackageRecordDiff {
  /** The file's added and changed records in its order, then the site's removed ones. */
  rows: PackageRecordRow[]
  /** Every field the rows hold, `$id` aside, in the order they first appear. */
  fields: string[]
  counts: Record<PackageRecordStatus | 'same', number>
}

const recordsOf = (value: unknown): PackageRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : []

/**
 * Two lists of records, matched by `$id`: what the file adds, what it no
 * longer holds, and, for a record on both sides, each field whose value
 * differs. A record the import would leave as it is counts as `same` and
 * has no row.
 */
export function packageRecordDiff(site: unknown, file: unknown): PackageRecordDiff {
  const theirs = new Map(recordsOf(site).map((record) => [record.$id, record]))
  const ours = recordsOf(file)
  const seen = new Set<string>()
  const rows: PackageRecordRow[] = []
  const counts = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const record of ours) {
    if (seen.has(record.$id)) continue
    seen.add(record.$id)
    const existing = theirs.get(record.$id)
    if (!existing) {
      counts.added += 1
      rows.push({ id: record.$id, status: 'added', site: null, file: record, changed: [] })
      continue
    }
    const keys = [...new Set([...Object.keys(existing), ...Object.keys(record)])].filter((key) => key !== '$id')
    const changed = keys.filter((key) => !same(existing[key], record[key]))
    if (!changed.length) {
      counts.same += 1
      continue
    }
    counts.changed += 1
    rows.push({ id: record.$id, status: 'changed', site: existing, file: record, changed })
  }
  for (const [id, record] of theirs) {
    if (seen.has(id)) continue
    counts.removed += 1
    rows.push({ id, status: 'removed', site: record, file: null, changed: [] })
  }
  const fields: string[] = []
  const listed = new Set<string>(['$id'])
  for (const row of rows) {
    for (const record of [row.file, row.site]) {
      for (const key of Object.keys(record ?? {})) {
        if (listed.has(key)) continue
        listed.add(key)
        fields.push(key)
      }
    }
  }
  return { rows, fields, counts }
}

/*==========================================
 * REVIEW
 *=========================================*/

/** Items by decision, in the order the review reads them. */
export function packageDecisionCounts(
  decisions: Readonly<Record<string, PackageItemDecision>>,
): Array<{ decision: PackageItemDecision; count: number }> {
  const order: PackageItemDecision[] = ['create', 'replace', 'keepBoth', 'merge', 'skip']
  const counts = new Map<PackageItemDecision, number>()
  for (const decision of Object.values(decisions)) {
    counts.set(decision, (counts.get(decision) ?? 0) + 1)
  }
  return order
    .filter((decision) => counts.get(decision))
    .map((decision) => ({ decision, count: counts.get(decision) as number }))
}

const WARNING_WORDS: Readonly<
  Record<SitePackageWarning['code'], { title: string; description: string }>
> = {
  droppedReference: {
    title: 'References removed',
    description: 'These items named something this site does not hold; the reference is taken out.',
  },
  mappedReference: {
    title: 'References pointed at this site’s items',
    description: 'These items now name the item you picked instead.',
  },
  danglingReference: {
    title: 'References that point at nothing',
    description: 'These items name something this site does not hold, until it does.',
  },
}

/**
 * What the person acknowledges before Import: what is overwritten (kept
 * for undo), each class of reference warning, and — told, not asked — the
 * items this site cannot read.
 */
export function packageAcknowledgements(
  answer: Pick<SitePackagePlanAnswer, 'warnings' | 'warningsTotal' | 'unknownKinds' | 'notSent'>,
  decisions: Readonly<Record<string, PackageItemDecision>>,
  titleOf: (key: string) => string,
): TransferAcknowledgementItem[] {
  const items: TransferAcknowledgementItem[] = []
  const overwritten = Object.entries(decisions).filter(
    ([, decision]) => decision === 'replace' || decision === 'merge',
  )
  if (overwritten.length) {
    items.push({
      id: 'overwrite',
      title: 'Items written over',
      description:
        'This site’s copy is replaced or merged into. What it held is kept, and you can undo the import for seven days.',
      count: overwritten.length,
      samples: overwritten.slice(0, 5).map(([key]) => titleOf(key)),
      required: true,
    })
  }
  const byCode = new Map<SitePackageWarning['code'], SitePackageWarning[]>()
  for (const warning of answer.warnings) {
    byCode.set(warning.code, [...(byCode.get(warning.code) ?? []), warning])
  }
  for (const [code, warnings] of byCode) {
    items.push({
      id: code,
      title: WARNING_WORDS[code].title,
      description: WARNING_WORDS[code].description,
      count: warnings.length,
      samples: warnings
        .slice(0, 5)
        .map((warning) => `${titleOf(warning.item)} → ${warning.dependency}`),
      required: true,
    })
  }
  if (answer.warningsTotal > answer.warnings.length) {
    items.push({
      id: 'moreWarnings',
      title: 'More reference warnings',
      description: 'The list above shows the first of them.',
      count: answer.warningsTotal - answer.warnings.length,
      samples: [],
      required: true,
    })
  }
  if (answer.unknownKinds.length) {
    items.push({
      id: 'unknownKinds',
      title: 'Items this site cannot read',
      description: 'Switch on the plugin that keeps them to import them. They are left out.',
      count: answer.unknownKinds.length,
      samples: answer.unknownKinds.slice(0, 5),
      required: false,
    })
  }
  if (answer.notSent.length) {
    items.push({
      id: 'notSent',
      title: 'Emails this platform does not send',
      description: 'They are left out.',
      count: answer.notSent.length,
      samples: answer.notSent.slice(0, 5),
      required: false,
    })
  }
  return items
}

/** Everything decided, as the import route takes it. */
export function packageDecided(
  decisions: Readonly<Record<string, PackageItemDecision>>,
  prompts: readonly PackageDependencyPrompt[],
  dependencyChoices: Readonly<Record<string, SitePackageDependencyChoice>>,
  mergeChoices: Readonly<Record<string, Record<string, SitePackageMergeChoice>>>,
): SitePackageDecisions {
  return {
    decisions: { ...decisions },
    dependencyChoices: packageDependencyChoices(prompts, dependencyChoices),
    mergeChoices: Object.fromEntries(
      Object.entries(mergeChoices).filter(
        ([key, choices]) => decisions[key] === 'merge' && Object.keys(choices).length,
      ),
    ),
  }
}
