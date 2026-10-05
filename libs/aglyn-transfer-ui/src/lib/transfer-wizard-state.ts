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
 * THE IMPORT WIZARD'S STATE — every choice the person makes, and what blocks.
 *
 * The draft is everything the person decided, in one plain object: it is
 * sent to the server with each request and saved per job, so a reload
 * resumes on the step it left with every choice intact. The file itself is
 * never saved here; the server holds it under the job.
 *
 * Each step's gate is a pure function of the draft and what the server
 * said, so a spec can hold the rule without rendering a screen.
 *=========================================*/

import {
  createTransferPolicy,
  mappingIsUsable,
  mappingProblems,
  picklistChoiceProblems,
  proposePicklistChoice,
  startingTransferPolicy,
  transferPolicyProblems,
} from '@aglyn/aglyn/data-transfer'
import type {
  MappingProblems,
  PicklistValueChoice,
  TransferField,
  TransferLockedRule,
  TransferPolicy,
  TransferPolicyDefaults,
  TransferWarningClass,
} from '@aglyn/aglyn/data-transfer'

import type {
  TransferAmbiguity,
  TransferAnalysis,
  TransferDateOrder,
  TransferFileSettings,
  TransferLookupChoice,
  TransferReadChoices,
} from './transfer-client'

/** The eight built-in steps, in order. */
export type TransferWizardStepId =
  | 'upload'
  | 'mapping'
  | 'values'
  | 'matching'
  | 'conflicts'
  | 'dryRun'
  | 'apply'
  | 'results'

export const TRANSFER_WIZARD_STEPS: readonly {
  id: TransferWizardStepId
  label: string
}[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'mapping', label: 'Columns' },
  { id: 'values', label: 'Values' },
  { id: 'matching', label: 'Matching' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'dryRun', label: 'Review' },
  { id: 'apply', label: 'Import' },
  { id: 'results', label: 'Results' },
]

/** The person's policy: everything but the plugin's locked rules, which come from the resource. */
export type TransferWizardPolicy = Omit<TransferPolicy, 'locked'>

/** Everything the person decided (see the block header). */
export interface TransferWizardDraft {
  version: 1
  jobId: string | null
  /** The step on screen: a built-in id or a plugin step's id. */
  step: string
  fileName: string | null
  settings: TransferFileSettings | null
  mapping: Record<number, string>
  dateOrders: Record<string, TransferDateOrder>
  picklistChoices: Record<string, Record<string, PicklistValueChoice>>
  lookupChoices: Record<string, Record<string, TransferLookupChoice>>
  /** Match key field ids in priority order; `null` until the person changes the resource's default. */
  matchKeys: string[] | null
  policy: TransferWizardPolicy
  acknowledged: TransferWarningClass[]
  /** What plugin steps collected, by step id. */
  extras: Record<string, unknown>
}

/**
 * A fresh draft. `defaultPolicy` is the resource's starting point
 * (`TransferResourceInfo.defaultPolicy`): the Conflicts step opens on it.
 */
export function createTransferWizardDraft(
  defaultPolicy?: TransferPolicyDefaults,
): TransferWizardDraft {
  return {
    version: 1,
    jobId: null,
    step: 'upload',
    fileName: null,
    settings: null,
    mapping: {},
    dateOrders: {},
    picklistChoices: {},
    lookupChoices: {},
    matchKeys: null,
    policy: startingTransferPolicy(defaultPolicy),
    acknowledged: [],
    extras: {},
  }
}

/** The draft's choices as the client takes them. */
export function draftReadChoices(
  draft: TransferWizardDraft,
  defaultMatchKeys: readonly string[],
): TransferReadChoices {
  return {
    mapping: draft.mapping,
    dateOrders: draft.dateOrders,
    picklistChoices: draft.picklistChoices,
    lookupChoices: draft.lookupChoices,
    matchKeys: draft.matchKeys ?? [...defaultMatchKeys],
  }
}

/** The person's policy with the resource's locked rules. */
export function draftPolicy(
  draft: TransferWizardDraft,
  locked: readonly TransferLockedRule[],
): TransferPolicy {
  return createTransferPolicy({ ...draft.policy, locked })
}

/*------------------------------------------
 * Saving the draft
 *-----------------------------------------*/

/** Where drafts are kept between visits. */
export interface TransferWizardStorage {
  load(key: string): TransferWizardDraft | null
  save(key: string, draft: TransferWizardDraft): void
  clear(key: string): void
}

/** The key a job's draft is kept under. */
export function transferWizardStorageKey(
  resource: string,
  jobId: string,
): string {
  return `aglyn.transfer.import.${resource}.${jobId}`
}

/**
 * Drafts in the browser's local storage. Storage can be missing or refuse
 * (a private window, blocked site data); the wizard then simply does not
 * resume, and nothing else changes.
 */
export const browserTransferWizardStorage: TransferWizardStorage = {
  load(key) {
    try {
      const raw = globalThis.localStorage?.getItem(key)
      const parsed = raw ? (JSON.parse(raw) as TransferWizardDraft) : null
      return parsed?.version === 1 ? parsed : null
    } catch {
      return null
    }
  },
  save(key, draft) {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(draft))
    } catch {
      // Storage refused: the draft lives for this visit only.
    }
  },
  clear(key) {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {
      // Nothing was stored.
    }
  },
}

/** Drafts held in memory, for specs and for surfaces that must not write storage. */
export function memoryTransferWizardStorage(): TransferWizardStorage & {
  readonly drafts: Map<string, TransferWizardDraft>
} {
  const drafts = new Map<string, TransferWizardDraft>()
  return {
    drafts,
    load: (key) =>
      drafts.has(key)
        ? (JSON.parse(JSON.stringify(drafts.get(key))) as TransferWizardDraft)
        : null,
    save: (key, draft) =>
      void drafts.set(
        key,
        JSON.parse(JSON.stringify(draft)) as TransferWizardDraft,
      ),
    clear: (key) => void drafts.delete(key),
  }
}

/*------------------------------------------
 * What each step needs before Next
 *-----------------------------------------*/

/** The mapping's problems, and whether it can be used. */
export function mappingStepGate(
  mapping: Readonly<Record<number, string>>,
  fields: readonly TransferField[],
): { problems: MappingProblems; usable: boolean; mappedCount: number } {
  const problems = mappingProblems(mapping, fields)
  const mappedCount = Object.values(mapping).filter(Boolean).length
  return {
    problems,
    usable: mappingIsUsable(problems) && mappedCount > 0,
    mappedCount,
  }
}

/**
 * The choices proposed for every unmatched picklist value the person has
 * not decided yet. Proposals are shown and can be changed; none is applied
 * without being on screen first.
 */
export function proposeMissingPicklistChoices(
  analysis: Pick<TransferAnalysis, 'picklists'>,
  current: Readonly<Record<string, Record<string, PicklistValueChoice>>>,
): Record<string, Record<string, PicklistValueChoice>> {
  const next: Record<string, Record<string, PicklistValueChoice>> = {
    ...current,
  }
  for (const review of analysis.picklists ?? []) {
    const choices = { ...(next[review.fieldId] ?? {}) }
    for (const value of review.unmatched) {
      if (!choices[value.key])
        choices[value.key] = proposePicklistChoice(review.spec, value)
    }
    next[review.fieldId] = choices
  }
  return next
}

/** What blocks the values step, as sentences. */
export function valuesStepProblems(
  analysis: Pick<TransferAnalysis, 'picklists' | 'lookups' | 'derivations'>,
  draft: Pick<
    TransferWizardDraft,
    'picklistChoices' | 'lookupChoices' | 'dateOrders'
  >,
  fieldLabel: (fieldId: string) => string,
): string[] {
  const problems: string[] = []
  for (const review of analysis.picklists ?? []) {
    for (const problem of picklistChoiceProblems(
      review.spec,
      review.set,
      review.unmatched,
      draft.picklistChoices[review.fieldId] ?? {},
    )) {
      problems.push(`${fieldLabel(review.fieldId)}: ${problem}`)
    }
  }
  for (const summary of analysis.derivations ?? []) {
    if (summary.ambiguousDates > 0 && !draft.dateOrders[summary.fieldId]) {
      problems.push(
        `${fieldLabel(summary.fieldId)}: choose whether its dates are month first or day first.`,
      )
    }
  }
  for (const review of analysis.lookups ?? []) {
    for (const value of review.unresolved) {
      if (!draft.lookupChoices[review.fieldId]?.[value.key]) {
        problems.push(
          `${fieldLabel(review.fieldId)}: choose what to do with "${value.value}".`,
        )
      }
    }
  }
  return problems
}

/** What blocks the conflicts step, as sentences. */
export function conflictsStepProblems(
  policy: TransferPolicy,
  fields: readonly TransferField[],
  ambiguous: readonly TransferAmbiguity[],
): string[] {
  const problems = transferPolicyProblems(policy, fields)
  if (policy.record.onAmbiguous === 'ask') {
    const open = ambiguous.filter((entry) => {
      const row = policy.rows[entry.row]
      return !row?.recordId && !row?.action
    })
    if (open.length) {
      problems.push(
        `Choose a record, or another action, for ${open.length === 1 ? 'the row that matches' : `the ${open.length} rows that match`} more than one record.`,
      )
    }
  }
  return problems
}
