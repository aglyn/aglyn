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
'use client'

/**
 * Every field of `DynamicListRule`, with a control for each.
 *
 * ## Why the whole rule, and why in one place
 *
 * Every dimension the matcher reads has a control here, including the two
 * that are answered by a keyed lookup rather than by the person's own record
 * — engagement, and membership of another audience — and the combinator that
 * decides whether the filters are ANDed, ORed or inverted. Needing to
 * hand-write a stored structure to reach a shipped engine is a missing
 * picker, not a power-user affordance, which is the standard this form is
 * held to rather than a count of fields.
 *
 * One component rather than a form on the create card and a second on the edit
 * page: the two would drift, and the half that drifts is whichever the
 * merchant is not looking at. A rule authored at creation and the same rule
 * reopened for editing are the same questions.
 *
 * ## The draft is text, the value is a rule
 *
 * The controls hold what was TYPED — `vip, ` is a legitimate intermediate
 * state of a tag list, and a component that round-tripped every keystroke
 * through `normalizeDynamicListRule` would delete the comma the moment it was
 * typed. So the draft is strings, `draftToRule` is the one place it becomes a
 * rule, and the parent never sees anything else.
 *
 * ## Money is entered the way a merchant says it
 *
 * `ltvCentsAtLeast` is stored in cents. A field labeled for the stored unit
 * turns "customers who spent over 500" into customers who spent over five
 * dollars, silently, and the audience looks plausible either way. The control
 * takes whole currency units and this file owns the only multiplication.
 *
 * ## It reads the segments, and only when it is on screen
 *
 * The segment picker needs the org's saved segments, through
 * `useOrgContactSegments`. That listen belongs to this component so it opens
 * when a rule is actually being authored — the audiences section's cost is a
 * list of lists, and a segment read on arrival would be a read for a form
 * nobody has opened.
 */

import {
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_SOURCE_LABELS,
  DYNAMIC_LIST_CUSTOM_OPS,
  normalizeDynamicListRule,
  type ContactLifecycleStage,
  type ContactSource,
  type DynamicListCustomClause,
  type DynamicListCustomOp,
  type DynamicListDimensions,
  type DynamicListRule,
  type DynamicListSource,
} from '@aglyn/aglyn'
import {
  Autocomplete,
  Box,
  Button,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useHostCampaigns,
  useOrgMemberOptions,
} from '@aglyn/tenant-feature-instance'
import CampaignPicker from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import { useOrgCompanyOptions } from '../hooks/use-org-company-options'
import { useOrgContactFields } from '../hooks/use-org-contact-fields'
import { useOrgContactSegments } from '../hooks/use-org-contact-segments'
import { useOrgCrmViews } from '../hooks/use-org-crm-views'
import { useOrgLists } from '../hooks/use-org-lists'

/** How each silo reads on screen. */
const SOURCE_LABELS: Record<DynamicListSource, string> = {
  contacts: 'Contacts',
  leads: 'Leads',
  siteMembers: 'Site members',
  formSubmissions: 'Form submissions',
}

/** The same silos, lower-cased for the middle of a sentence. */
const SOURCE_PHRASES: Record<DynamicListSource, string> = {
  contacts: 'contacts',
  leads: 'leads',
  siteMembers: 'site members',
  formSubmissions: 'form submissions',
}

/** A day, in the same UTC calendar the rule's boundaries are stored against. */
const dayLabel = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * The rule, in sentences a merchant can read back to themselves.
 *
 * Every clause names a dimension that is actually SET, so a rule with four
 * dimensions reads as four clauses and a rule with one reads as one — an
 * explanation that also lists the fields a rule does not use is an explanation
 * the reader has to subtract from. Rendered live beside the controls, because
 * the question a filter form has to answer continuously is "who does this
 * describe", and a form of eleven boxes does not answer it on its own.
 */
/** Names for the ids a rule stores, so a clause can say "Customers", not a uid. */
export interface DynamicListRuleNames {
  /** List id → its name. */
  lists?: Record<string, string>
  /** Segment id → its name. */
  segments?: Record<string, string>
  /** Saved Contacts view id → its name. */
  views?: Record<string, string>
  /** Campaign id → its name. */
  campaigns?: Record<string, string>
  /** Team member uid → how they read on the roster. */
  members?: Record<string, string>
  /** Company id → its name. */
  companies?: Record<string, string>
  /** Custom field key → the definition's label. */
  fields?: Record<string, string>
}

/** An id, as its name when one is known and as itself when none is. */
const named = (id: string, names: Record<string, string> | undefined): string =>
  names?.[id] || id

/**
 * How each custom-field operator reads, as the verb of a clause.
 *
 * `neq` carries its lean in the sentence: the matcher requires a VALUE that
 * differs, so a merchant excluding one plan does not sweep in everyone whose
 * plan was never recorded — and a reader checking a paragraph against their
 * intent cannot be expected to know that from the word "not".
 */
const CUSTOM_OP_LABELS: Record<DynamicListCustomOp, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  gt: 'is more than',
  lt: 'is less than',
  set: 'is set',
  unset: 'is not set',
}

/** The operators that take no value — the clause is about presence. */
const PRESENCE_OPS: ReadonlySet<DynamicListCustomOp> = new Set(['set', 'unset'])

/** One custom clause as a sentence fragment: `Plan is enterprise`. */
const describeCustomClause = (
  clause: DynamicListCustomClause,
  names?: DynamicListRuleNames,
): string => {
  const field = named(clause.key, names?.fields)
  const verb = CUSTOM_OP_LABELS[clause.op]
  if (clause.op === 'set' || clause.op === 'unset') return `${field} ${verb}`
  const value = String(clause.value ?? '')
  return clause.op === 'neq'
    ? `${field} ${verb} ${value} (a blank does not count)`
    : `${field} ${verb} ${value}`
}

/** One AND-block, as clauses. The rule's own block and each branch share it. */
function describeDimensions(
  rule: DynamicListDimensions,
  names?: DynamicListRuleNames,
): string[] {
  const clauses: string[] = []
  if (rule.tags?.length) {
    clauses.push(`Tagged any of: ${rule.tags.join(', ')}.`)
  }
  if (rule.captureSources?.length) {
    clauses.push(
      `Captured by: ${rule.captureSources
        .map((source) => CONTACT_SOURCE_LABELS[source] ?? source)
        .join(', ')}.`,
    )
  }
  if (rule.formNames?.length) {
    clauses.push(`Submitted any of: ${rule.formNames.join(', ')}.`)
  }
  /*
   * The clause names the SILOS the dimension applies to, like every other
   * silo-specific clause here. A lead and a site member carry no campaign, so
   * the sentence has to say that the filter passes them through rather than
   * leaving a reader to conclude that a rule drawing from leads and naming a
   * campaign selects no leads.
   */
  if (rule.campaignIds?.length) {
    clauses.push(
      `Filed under any of these campaigns: ${rule.campaignIds
        .map((id) => named(id, names?.campaigns))
        .join(', ')} — contacts and form submissions only.`,
    )
  }
  if (rule.createdAfterMs !== undefined) {
    clauses.push(`Created on or after ${dayLabel(rule.createdAfterMs)}.`)
  }
  if (rule.createdBeforeMs !== undefined) {
    clauses.push(`Created before ${dayLabel(rule.createdBeforeMs)}.`)
  }
  const behavior = rule.behavior
  if (behavior?.ordersCountAtLeast !== undefined) {
    clauses.push(`At least ${behavior.ordersCountAtLeast} orders.`)
  }
  if (behavior?.ltvCentsAtLeast !== undefined) {
    clauses.push(`Spent at least ${behavior.ltvCentsAtLeast / 100}.`)
  }
  if (behavior?.lastPurchaseWithinDays !== undefined) {
    clauses.push(
      `Bought within the last ${behavior.lastPurchaseWithinDays} days.`,
    )
  }
  if (behavior?.noPurchaseForDays !== undefined) {
    clauses.push(`Has bought nothing for ${behavior.noPurchaseForDays} days.`)
  }
  /*
   * The quiet arms say "or never" out loud.
   *
   * The engine counts a person with no open on record as having not opened,
   * which is the opposite lean from `noPurchaseForDays` two clauses above —
   * and a reader checking a paragraph against their intent cannot be expected
   * to remember which dimension leans which way. So the sentence carries it.
   */
  const engagement = rule.engagement
  if (engagement?.openedWithinDays !== undefined) {
    clauses.push(
      `Opened one of your emails in the last ${engagement.openedWithinDays} days.`,
    )
  }
  if (engagement?.clickedWithinDays !== undefined) {
    clauses.push(
      `Clicked a link in one of your emails in the last ` +
        `${engagement.clickedWithinDays} days.`,
    )
  }
  if (engagement?.notOpenedForDays !== undefined) {
    clauses.push(
      `Has opened nothing for ${engagement.notOpenedForDays} days, or never ` +
        `opened anything.`,
    )
  }
  if (engagement?.notClickedForDays !== undefined) {
    clauses.push(
      `Has clicked nothing for ${engagement.notClickedForDays} days, or never ` +
        `clicked anything.`,
    )
  }
  if (rule.inListIds?.length) {
    clauses.push(
      `Already on: ${rule.inListIds
        .map((id) => named(id, names?.lists))
        .join(', ')}.`,
    )
  }
  if (rule.notInListIds?.length) {
    clauses.push(
      `Not on: ${rule.notInListIds
        .map((id) => named(id, names?.lists))
        .join(', ')}.`,
    )
  }
  /*
   * THE CRM DIMENSIONS (AGL-2603). Each names people, stages and companies
   * the way the pickers show them, never by id: a clause reading `uid-8f2a`
   * is a clause nobody can check against their intent. The custom clauses
   * are one sentence each, because each is its own condition and a reader
   * adding a second one has narrowed the audience by exactly one sentence.
   */
  if (rule.ownerUids?.length) {
    clauses.push(
      `Owned by: ${rule.ownerUids
        .map((uid) => named(uid, names?.members))
        .join(', ')}.`,
    )
  }
  if (rule.lifecycleStages?.length) {
    clauses.push(
      `In stage: ${rule.lifecycleStages
        .map((stage) => CONTACT_LIFECYCLE_STAGE_LABELS[stage] ?? stage)
        .join(', ')}.`,
    )
  }
  if (rule.companyIds?.length) {
    clauses.push(
      `At company: ${rule.companyIds
        .map((id) => named(id, names?.companies))
        .join(', ')}.`,
    )
  }
  /*
   * "One of your campaigns", against the engagement arms above that say
   * "one of your emails": those count every message this workspace sent the
   * address, this counts the campaigns the reading site's group sent — the
   * sentence is the only place a reader can tell the two windows apart.
   */
  if (rule.engagedWithinDays !== undefined) {
    clauses.push(
      `Opened or clicked one of your campaigns in the last ` +
        `${rule.engagedWithinDays} days.`,
    )
  }
  for (const clause of rule.custom ?? []) {
    clauses.push(`${describeCustomClause(clause, names)}.`)
  }
  return clauses
}

export function describeDynamicListRule(
  rule: DynamicListRule,
  names?: DynamicListRuleNames,
): string[] {
  const clauses: string[] = []
  clauses.push(
    rule.sources.length
      ? `Draws from ${rule.sources
          .map((source) => SOURCE_PHRASES[source] ?? source)
          .join(', ')}.`
      : 'Draws from nothing, so it matches nobody.',
  )
  if (rule.segmentId) {
    clauses.push(
      `Reuses saved segment ${named(rule.segmentId, names?.segments)}.`,
    )
  }
  if (rule.viewId) {
    clauses.push(`Reuses saved view ${named(rule.viewId, names?.views)}.`)
  }
  const own = describeDimensions(rule, names)
  if (rule.negate && own.length) {
    /*
     * A negated block is ONE clause, not a list of them.
     *
     * "Excludes anyone who is tagged vip. Excludes anyone who has spent over
     * 500." would read as two independent exclusions, and the rule is one:
     * it excludes people who are BOTH. Somebody checking a paragraph against
     * their intent would come away with the wrong audience.
     */
    clauses.push(
      `Excludes anyone matching all of: ${own
        .map((clause) => clause.replace(/\.$/, ''))
        .join('; ')}.`,
    )
  } else {
    clauses.push(...own)
  }
  /*
   * The OR branches are ONE clause covering all of them, not one clause each.
   *
   * A candidate has to satisfy at least one branch — so "at least one of"
   * printed once per branch would read as a separate requirement per branch,
   * which is the AND this operator exists to escape. The whole disjunction is
   * therefore rendered as a single sentence, with each branch's own filters
   * joined by "and" inside it.
   */
  const branches = (rule.any ?? [])
    .map((group) => {
      const inner = describeDimensions(group, names)
      if (!inner.length) return ''
      const joined = inner
        .map((clause) => clause.replace(/\.$/, '').toLowerCase())
        .join(' and ')
      return group.negate ? `not (${joined})` : joined
    })
    .filter(Boolean)
  if (branches.length) {
    clauses.push(`And at least one of these: ${branches.join('; or ')}.`)
  }
  return clauses
}

/**
 * How the filters below combine.
 *
 * The three shapes this form authors, mapped onto the rule's two operators:
 * `all` is the plain AND block, `none` is that block with `negate`, and `any`
 * puts each filter into its own OR branch. A saved segment is outside all
 * three — it is resolved once from `segmentId` and always applies, which the
 * control says on screen rather than leaving to be discovered.
 */
export type DynamicListRuleMatch = 'all' | 'any' | 'none'

/** The rule as the controls hold it: what was typed, not what it means. */
export interface DynamicListRuleDraft {
  sources: DynamicListSource[]
  match: DynamicListRuleMatch
  segmentId: string
  /** A saved Contacts view's id, resolved by the sweep beside the segment (AGL-2617). */
  viewId: string
  tags: string
  captureSources: ContactSource[]
  formNames: string
  /** Campaign ids, from the site's own campaigns picker. */
  campaignIds: string[]
  /** `yyyy-mm-dd`, read as UTC — the same instant `Date.parse` gives it. */
  createdAfter: string
  createdBefore: string
  ordersCountAtLeast: string
  /** WHOLE currency units. `draftToRule` is the only place this becomes cents. */
  ltvAtLeast: string
  lastPurchaseWithinDays: string
  noPurchaseForDays: string
  openedWithinDays: string
  clickedWithinDays: string
  notOpenedForDays: string
  notClickedForDays: string
  inListIds: string[]
  notInListIds: string[]
  /*
   * THE CRM DIMENSIONS (AGL-2603), held as the rule holds them.
   *
   * These are picked, not typed — a uid from the roster, a stage from the
   * fixed list, a company from a search — so there is no free-text
   * intermediate state to preserve and the draft carries the ids. The custom
   * clauses carry the TYPED value: a number field's control hands back a
   * number and a checkbox's a boolean, so the value the sentences describe
   * and the value the matcher compares are the same value.
   */
  ownerUids: string[]
  lifecycleStages: ContactLifecycleStage[]
  companyIds: string[]
  custom: DynamicListCustomClause[]
  /**
   * The re-engagement window (AGL-2616), typed like the purchase windows
   * — days, as text, so an empty box is not a zero-day window.
   */
  engagedWithinDays: string
}

export const EMPTY_RULE_DRAFT: DynamicListRuleDraft = {
  sources: ['contacts'],
  match: 'all',
  segmentId: '',
  viewId: '',
  tags: '',
  captureSources: [],
  formNames: '',
  campaignIds: [],
  createdAfter: '',
  createdBefore: '',
  ordersCountAtLeast: '',
  ltvAtLeast: '',
  lastPurchaseWithinDays: '',
  noPurchaseForDays: '',
  openedWithinDays: '',
  clickedWithinDays: '',
  notOpenedForDays: '',
  notClickedForDays: '',
  inListIds: [],
  notInListIds: [],
  ownerUids: [],
  lifecycleStages: [],
  companyIds: [],
  custom: [],
  engagedWithinDays: '',
}

/** Comma-separated free text → the trimmed, non-empty values. */
export const splitRuleList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

/**
 * A day stamp for a date input, in UTC.
 *
 * `Date.parse('2026-01-01')` is UTC midnight, so reading the value back
 * through the local calendar would move the boundary by the reader's offset —
 * a rule saved in Los Angeles would reopen naming the previous day, and saving
 * it again would walk it backwards once per edit.
 */
const dayStamp = (ms: number | undefined): string =>
  ms === undefined || !Number.isFinite(ms) ? '' : dayLabel(ms)

/**
 * A stored rule, as the controls should show it.
 *
 * ⚠️ The three shapes {@link DynamicListRuleMatch} names are the shapes this
 * form AUTHORS. A rule written through the REST API can hold branches the
 * controls have no place for — a branch with its own `negate`, or top-level
 * filters alongside branches — and this reads such a rule back as the union
 * of every filter in it, in `any` mode. It is not a silent rewrite: the
 * sentences above the controls are computed from `draftToRule(draft)`, so
 * what a save would store is on screen before the reader saves it.
 */
export function ruleToDraft(rule: DynamicListRule): DynamicListRuleDraft {
  // Every filter the rule carries, wherever it carries it. The branches are
  // read for their VALUES; how they combined is answered by `match` below.
  const blocks = [rule, ...(rule.any ?? [])]
  const first = <T,>(read: (block: DynamicListDimensions) => T | undefined): T | undefined => {
    for (const block of blocks) {
      const value = read(block)
      if (value !== undefined) return value
    }
    return undefined
  }
  const list = (read: (block: DynamicListDimensions) => string[] | undefined): string[] => {
    const found = new Set<string>()
    for (const block of blocks) for (const entry of read(block) ?? []) found.add(entry)
    return [...found]
  }
  const number = (read: (block: DynamicListDimensions) => number | undefined): string => {
    const value = first(read)
    return value === undefined ? '' : String(value)
  }
  const ltvCents = first((block) => block.behavior?.ltvCentsAtLeast)
  return {
    sources: rule.sources ?? [],
    match: rule.any?.length ? 'any' : rule.negate ? 'none' : 'all',
    segmentId: rule.segmentId ?? '',
    viewId: rule.viewId ?? '',
    tags: list((block) => block.tags).join(', '),
    captureSources: list((block) => block.captureSources) as ContactSource[],
    formNames: list((block) => block.formNames).join(', '),
    campaignIds: list((block) => block.campaignIds),
    createdAfter: dayStamp(first((block) => block.createdAfterMs)),
    createdBefore: dayStamp(first((block) => block.createdBeforeMs)),
    ordersCountAtLeast: number((block) => block.behavior?.ordersCountAtLeast),
    ltvAtLeast: ltvCents === undefined ? '' : String(ltvCents / 100),
    lastPurchaseWithinDays: number(
      (block) => block.behavior?.lastPurchaseWithinDays,
    ),
    noPurchaseForDays: number((block) => block.behavior?.noPurchaseForDays),
    openedWithinDays: number((block) => block.engagement?.openedWithinDays),
    clickedWithinDays: number((block) => block.engagement?.clickedWithinDays),
    notOpenedForDays: number((block) => block.engagement?.notOpenedForDays),
    notClickedForDays: number((block) => block.engagement?.notClickedForDays),
    inListIds: list((block) => block.inListIds),
    notInListIds: list((block) => block.notInListIds),
    ownerUids: list((block) => block.ownerUids),
    lifecycleStages: list(
      (block) => block.lifecycleStages,
    ) as ContactLifecycleStage[],
    companyIds: list((block) => block.companyIds),
    engagedWithinDays: number((block) => block.engagedWithinDays),
    // Clauses are objects, so the string-set dedupe above cannot hold them;
    // two blocks carrying the same clause are one condition, keyed on its
    // whole shape.
    custom: (() => {
      const seen = new Map<string, DynamicListCustomClause>()
      for (const block of blocks) {
        for (const clause of block.custom ?? []) {
          seen.set(JSON.stringify(clause), clause)
        }
      }
      return [...seen.values()]
    })(),
  }
}

/**
 * A typed number, or nothing at all.
 *
 * An empty box is not zero. `Number('')` is `0`, and a rule normalizer that
 * accepts zero would turn every field the merchant left alone into an active
 * filter — `noPurchaseForDays: 0` matches nobody, so an untouched form would
 * quietly produce an empty audience.
 */
const typedNumber = (value: string): number | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * One filter of the draft, as the smallest block it can live in.
 *
 * `any` mode puts each of these in its own OR branch, so this list is what
 * decides how finely "any of these filters" is read: per CONTROL, which is
 * what a reader who just typed into eleven boxes means by "any of them". A
 * coarser split — the whole purchase-history block as one branch — would ask
 * them to satisfy three purchase conditions together to match the branch.
 */
function draftDimensions(draft: DynamicListRuleDraft): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []
  const tags = splitRuleList(draft.tags)
  if (tags.length) blocks.push({ tags })
  if (draft.captureSources.length) {
    blocks.push({ captureSources: draft.captureSources })
  }
  const formNames = splitRuleList(draft.formNames)
  if (formNames.length) blocks.push({ formNames })
  if (draft.campaignIds.length) blocks.push({ campaignIds: draft.campaignIds })
  const createdAfterMs = draft.createdAfter
    ? Date.parse(draft.createdAfter)
    : undefined
  if (createdAfterMs !== undefined && Number.isFinite(createdAfterMs)) {
    blocks.push({ createdAfterMs })
  }
  const createdBeforeMs = draft.createdBefore
    ? Date.parse(draft.createdBefore)
    : undefined
  if (createdBeforeMs !== undefined && Number.isFinite(createdBeforeMs)) {
    blocks.push({ createdBeforeMs })
  }
  const ordersCountAtLeast = typedNumber(draft.ordersCountAtLeast)
  if (ordersCountAtLeast !== undefined) {
    blocks.push({ behavior: { ordersCountAtLeast } })
  }
  // Whole units in, cents out — rounded, because a half-cent threshold is not
  // a quantity any order total can be compared against.
  const ltv = typedNumber(draft.ltvAtLeast)
  if (ltv !== undefined) {
    blocks.push({ behavior: { ltvCentsAtLeast: Math.round(ltv * 100) } })
  }
  const lastPurchaseWithinDays = typedNumber(draft.lastPurchaseWithinDays)
  if (lastPurchaseWithinDays !== undefined) {
    blocks.push({ behavior: { lastPurchaseWithinDays } })
  }
  const noPurchaseForDays = typedNumber(draft.noPurchaseForDays)
  if (noPurchaseForDays !== undefined) {
    blocks.push({ behavior: { noPurchaseForDays } })
  }
  const openedWithinDays = typedNumber(draft.openedWithinDays)
  if (openedWithinDays !== undefined) {
    blocks.push({ engagement: { openedWithinDays } })
  }
  const clickedWithinDays = typedNumber(draft.clickedWithinDays)
  if (clickedWithinDays !== undefined) {
    blocks.push({ engagement: { clickedWithinDays } })
  }
  const notOpenedForDays = typedNumber(draft.notOpenedForDays)
  if (notOpenedForDays !== undefined) {
    blocks.push({ engagement: { notOpenedForDays } })
  }
  const notClickedForDays = typedNumber(draft.notClickedForDays)
  if (notClickedForDays !== undefined) {
    blocks.push({ engagement: { notClickedForDays } })
  }
  if (draft.inListIds.length) blocks.push({ inListIds: draft.inListIds })
  if (draft.notInListIds.length) {
    blocks.push({ notInListIds: draft.notInListIds })
  }
  if (draft.ownerUids.length) blocks.push({ ownerUids: draft.ownerUids })
  if (draft.lifecycleStages.length) {
    blocks.push({ lifecycleStages: draft.lifecycleStages })
  }
  if (draft.companyIds.length) blocks.push({ companyIds: draft.companyIds })
  const engagedWithinDays = typedNumber(draft.engagedWithinDays)
  if (engagedWithinDays !== undefined) blocks.push({ engagedWithinDays })
  // One block PER CLAUSE, so that "any one of the filters below" reads each
  // condition row as a filter of its own — the same grain the purchase
  // figures get. `mergeDimensions` folds them back into one list for `all`.
  // An unfinished row (no value where one is compared) is dropped by the
  // normalizer at the end, so it is never a condition until it is one.
  for (const clause of draft.custom) blocks.push({ custom: [clause] })
  return blocks
}

/** The blocks merged into one AND-block, for `all` and `none`. */
function mergeDimensions(
  blocks: Record<string, unknown>[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const block of blocks) {
    for (const [key, value] of Object.entries(block)) {
      // `behavior` and `engagement` arrive one leaf at a time, so they are
      // merged at depth. A shallow assign would keep only the last leaf of
      // each and silently drop the other three. `custom` arrives one clause
      // at a time for the same reason and is concatenated for the same one.
      merged[key] =
        key === 'behavior' || key === 'engagement'
          ? { ...((merged[key] as object) ?? {}), ...(value as object) }
          : key === 'custom'
            ? [...((merged[key] as unknown[]) ?? []), ...(value as unknown[])]
            : value
    }
  }
  return merged
}

/** What the controls mean, coerced by the function the matcher reads through. */
export function draftToRule(draft: DynamicListRuleDraft): DynamicListRule {
  const blocks = draftDimensions(draft)
  /*
   * Normalized on the way IN by the same function the materializer reads it
   * back through. A rule coerced on the way out but not on the way in is a
   * rule the console can display differently from the way it evaluates.
   */
  return normalizeDynamicListRule({
    sources: draft.sources,
    ...(draft.segmentId ? { segmentId: draft.segmentId } : {}),
    ...(draft.viewId ? { viewId: draft.viewId } : {}),
    ...(draft.match === 'any'
      ? // Each filter its own branch. The top-level block stays empty, which
        // is no constraint — so the rule is `sources AND (one of these)`.
        { any: blocks }
      : {
          ...mergeDimensions(blocks),
          // `none` on an empty set of filters would be "exclude everyone
          // matching nothing", which excludes everyone. The flag is written
          // only when there is something to invert.
          ...(draft.match === 'none' && blocks.length ? { negate: true } : {}),
        }),
  })
}

export interface DynamicListRuleFieldsProps {
  /** `['orgs', orgId]` — the resolved org scope the caller already holds. */
  scope: readonly [string, string]
  /**
   * The site whose campaigns the campaign picker offers.
   *
   * A list is org-owned and its rule is materialized against ONE site's silos,
   * which is the same site whose campaigns a form or a screen can be filed
   * under. Offering the org's every campaign would offer ids the sweep can
   * never match, because the membership it reads was written by that site.
   */
  hostId: string
  draft: DynamicListRuleDraft
  onChange: (draft: DynamicListRuleDraft) => void
  /**
   * The audience being edited, when there is one.
   *
   * Kept out of its own list pickers. A rule that referred to the list it
   * fills would oscillate — see `dynamicListRuleWithoutListReference`, which
   * strips it at the sweep as well, because a rule outlives any one form.
   * Offering it here and stripping it there would show a merchant a filter
   * that quietly does nothing.
   */
  listId?: string
}

export function DynamicListRuleFields(props: DynamicListRuleFieldsProps) {
  const { scope, hostId, draft, onChange, listId } = props
  const segmentDocs = useOrgContactSegments(scope)
  const viewDocs = useOrgCrmViews(scope)
  const listDocs = useOrgLists(scope)
  /*
   * The site's campaigns, read because this form is on screen.
   *
   * `enabled` is off by default on the hook for the surfaces that render a
   * picker beside fields a reader came for; here the picker IS one of the
   * fields the reader came for, and the same reasoning that opens the segment
   * listen opens this one.
   */
  const siteCampaigns = useHostCampaigns(hostId, { enabled: true })
  /*
   * THE CRM PICKERS' OPTIONS (AGL-2603), read because this form is on screen
   * — the same bargain the segments and the campaigns get, one section up.
   *
   * The team comes through the members route rather than the collection, so
   * a collaborator scoped to one site can still assign an owner; the field
   * definitions are one bounded read; the companies are a SEARCH and read
   * nothing until something is typed.
   */
  const team = useOrgMemberOptions(scope[1], { enabled: true })
  const fieldDefinitions = useOrgContactFields(scope)
  const [companySearch, setCompanySearch] = useState('')
  const companies = useOrgCompanyOptions({
    scope,
    search: companySearch,
    selectedIds: draft.companyIds,
  })

  /*
   * The saved segment the rule already names, even when the picker's window
   * does not reach it.
   *
   * A `Select` whose value is not among its options renders empty and warns,
   * so a rule pointing at the fifty-first segment would reopen looking as
   * though it named none — and saving from that screen would erase the
   * reference. The id is offered as its own option instead.
   */
  const segments = useMemo(() => {
    const rows = segmentDocs
    if (!draft.segmentId || rows.some((row) => row.$id === draft.segmentId)) {
      return rows
    }
    return [{ $id: draft.segmentId, name: draft.segmentId }, ...rows]
  }, [segmentDocs, draft.segmentId])
  /*
   * The saved VIEW the rule already names, kept the way the segment is
   * (AGL-2617) — and for one more reason: the picker lists only views that
   * translate whole, so a view edited past that after the rule named it
   * would vanish from its own picker, and saving from that screen would
   * erase the reference. Shown as its id, the sweep's refusal is at least
   * visible.
   */
  const crmViews = useMemo(() => {
    const rows = viewDocs
    if (!draft.viewId || rows.some((row) => row.$id === draft.viewId)) {
      return rows
    }
    return [{ $id: draft.viewId, name: draft.viewId }, ...rows]
  }, [viewDocs, draft.viewId])

  /** Every audience except the one being edited — see the prop's note. */
  const lists = useMemo(
    () => listDocs.filter((row) => row.$id !== listId),
    [listDocs, listId],
  )

  /** Ids the pickers can show, so a clause names an audience rather than a uid. */
  const names = useMemo(
    () => ({
      lists: Object.fromEntries(
        listDocs.map((row) => [row.$id, row.name ?? row.$id]),
      ),
      segments: Object.fromEntries(
        segments.map((row) => [row.$id, row.name ?? row.$id]),
      ),
      views: Object.fromEntries(crmViews.map((row) => [row.$id, row.name])),
      campaigns: Object.fromEntries(
        siteCampaigns.options.map((option) => [option.value, option.label]),
      ),
      members: Object.fromEntries(
        team.options.map((option) => [option.uid, option.label]),
      ),
      companies: companies.names,
      fields: Object.fromEntries(
        fieldDefinitions.fields.map((field) => [field.key, field.label]),
      ),
    }),
    [
      listDocs,
      segments,
      crmViews,
      siteCampaigns.options,
      team.options,
      companies.names,
      fieldDefinitions.fields,
    ],
  )

  /*
   * A stored owner the roster no longer lists, and a stored field key no
   * definition names, are offered as their own option — the segment picker's
   * discipline, for the same reason: a `Select` whose value is not among its
   * options renders empty, and a rule saved from that screen would lose the
   * clause it was opened with. A team member who left still owns the
   * contacts they were assigned until somebody reassigns them, and a retired
   * field still holds every value written under it.
   */
  const ownerOptions = useMemo(() => {
    const known = new Set(team.options.map((option) => option.uid))
    return [
      ...draft.ownerUids
        .filter((uid) => !known.has(uid))
        .map((uid) => ({ uid, label: uid })),
      ...team.options,
    ]
  }, [team.options, draft.ownerUids])
  const fieldOptions = useMemo(() => {
    const known = new Set(fieldDefinitions.fields.map((field) => field.key))
    return [
      ...draft.custom
        .filter((clause) => !known.has(clause.key))
        .map((clause) => ({ key: clause.key, label: clause.key }))
        .filter(
          (entry, index, all) =>
            all.findIndex((other) => other.key === entry.key) === index,
        ),
      ...fieldDefinitions.fields.map(({ key, label }) => ({ key, label })),
    ]
  }, [fieldDefinitions.fields, draft.custom])
  /** The definition a clause's key names, when the org still has one. */
  const definitionFor = (key: string) =>
    fieldDefinitions.fields.find((field) => field.key === key)

  const set = <K extends keyof DynamicListRuleDraft>(
    key: K,
    value: DynamicListRuleDraft[K],
  ) => onChange({ ...draft, [key]: value })

  /*
   * THE CUSTOM-FIELD ROWS. A new row names the first definition with an
   * empty value, so it is on screen and NOT yet a filter — `draftDimensions`
   * hands it to the normalizer, which drops a valued operator with no value
   * until the reader types one. Changing the field clears the value, because
   * a value typed for a number field is not a value for the select that
   * replaced it; changing the operator to a presence test removes it, so the
   * stored clause carries no value the sentence does not read.
   */
  const addClause = () => {
    const first = fieldOptions[0]
    if (!first) return
    set('custom', [...draft.custom, { key: first.key, op: 'eq', value: '' }])
  }
  const updateClause = (index: number, patch: Partial<DynamicListCustomClause>) =>
    set(
      'custom',
      draft.custom.map((clause, at) => {
        if (at !== index) return clause
        const next = { ...clause, ...patch }
        if (PRESENCE_OPS.has(next.op)) delete next.value
        return next
      }),
    )
  const removeClause = (index: number) =>
    set(
      'custom',
      draft.custom.filter((_, at) => at !== index),
    )

  /** A multi-select hands back a string when only one option is chosen. */
  const asArray = <T extends string,>(value: unknown): T[] =>
    typeof value === 'string' ? [value as T] : ((value as T[]) ?? [])

  const contactsOnly = draft.sources.includes('contacts')

  return (
    <Stack spacing={1.5}>
      {/*
        The filters, read back as sentences, above the controls that set them.
        A merchant cannot check eleven boxes against their intent; they can
        check one paragraph. It sits ABOVE the fields on purpose — the reader's
        question is "who is this", and the answer should not be below the fold
        of the form that produced it.
       */}
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
        }}
      >
        <Typography variant="overline" color="text.secondary">
          {'This audience'}
        </Typography>
        {describeDynamicListRule(draftToRule(draft), names).map((clause) => (
          <Typography key={clause} variant="body2">
            {clause}
          </Typography>
        ))}
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="People from"
          value={draft.sources}
          onChange={(event) =>
            set('sources', asArray<DynamicListSource>(event.target.value))
          }
          slotProps={{ select: { multiple: true } }}
          sx={{ minWidth: 220 }}
        >
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        {/*
          The combinator, beside the source picker rather than buried below
          the filters it governs. It changes what every control under it
          means, and a reader who found it after filling the form in would
          have been answering a different question the whole time.
         */}
        <TextField
          select
          size="small"
          label="Match"
          value={draft.match}
          onChange={(event) =>
            set('match', event.target.value as DynamicListRuleMatch)
          }
          helperText="A saved segment always applies"
          sx={{ minWidth: 210 }}
        >
          <MenuItem value="all">{'All of the filters below'}</MenuItem>
          <MenuItem value="any">{'Any one of the filters below'}</MenuItem>
          <MenuItem value="none">{'Nobody matching all of them'}</MenuItem>
        </TextField>
        <TextField
          type="date"
          size="small"
          label="Created after"
          value={draft.createdAfter}
          onChange={(event) => set('createdAfter', event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 170 }}
        />
        <TextField
          type="date"
          size="small"
          label="Created before"
          value={draft.createdBefore}
          onChange={(event) => set('createdBefore', event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 170 }}
        />
        <TextField
          size="small"
          label="Submitted form"
          placeholder="Contact us"
          helperText="Form submissions only"
          value={draft.formNames}
          onChange={(event) => set('formNames', event.target.value)}
          sx={{ minWidth: 180 }}
        />
        {/*
          The campaign filter sits with the cross-silo controls rather than
          under Contacts, because it reads on a form submission too — the
          submission carries the campaigns its form was filed under at the
          moment it arrived.

          The SHARED picker, the one a form's page and a screen's page assign
          with. A merchant who filed three forms under the spring push should
          pick the campaign here from the same control and the same list of
          names they filed them with; a second select over the same ids is how
          one stored field comes to be presented two ways.
         */}
        <Box sx={{ minWidth: 240, flexGrow: 1, maxWidth: 360 }}>
          <CampaignPicker
            options={siteCampaigns.options}
            value={draft.campaignIds}
            onChange={(next) => set('campaignIds', next)}
            label="In campaign"
            helperText="Contacts and form submissions filed under any campaign picked. Being in a campaign is not consent to be emailed."
            empty={siteCampaigns.ready && !siteCampaigns.options.length}
            emptyText="This site has no campaigns yet. Create one from Marketing to build an audience from it."
          />
        </Box>
      </Stack>

      <Divider />
      <Typography variant="overline" color="text.secondary">
        {'Contacts'}
      </Typography>
      {/*
        Named rather than merely disabled when contacts are not a source. A
        control that vanishes and a control that does nothing look the same to
        somebody who has not read the matcher — and these dimensions are
        SKIPPED for the other silos rather than failed, so a rule can carry
        them while drawing from leads as well.
       */}
      {contactsOnly ? null : (
        <Typography variant="caption" color="text.secondary">
          {'These apply only to people drawn from Contacts. The rule does not ' +
            'draw from Contacts, so they select nobody on their own — the ' +
            'other sources are matched without them.'}
        </Typography>
      )}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Saved segment"
          value={draft.segmentId}
          onChange={(event) => set('segmentId', event.target.value)}
          helperText="Reuses that segment's tags and sources"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{'None'}</MenuItem>
          {segments.map((segment) => (
            <MenuItem key={segment.$id} value={segment.$id}>
              {segment.name ?? segment.$id}
            </MenuItem>
          ))}
        </TextField>
        {/*
          A saved Contacts view as an audience (AGL-2617), beside the
          segment: its filters — owner, stage, company, tags, sources,
          dates, purchases and custom fields — always apply, the way a
          segment's do. Only views the sweep can honor are offered.
         */}
        <TextField
          select
          size="small"
          label="Saved view"
          value={draft.viewId}
          onChange={(event) => set('viewId', event.target.value)}
          helperText="Reuses that Contacts view's filters"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{'None'}</MenuItem>
          {crmViews.map((view) => (
            <MenuItem key={view.$id} value={view.$id}>
              {view.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Tagged"
          placeholder="vip, wholesale"
          value={draft.tags}
          onChange={(event) => set('tags', event.target.value)}
          sx={{ minWidth: 180 }}
        />
        <TextField
          select
          size="small"
          label="Captured by"
          value={draft.captureSources}
          onChange={(event) =>
            set('captureSources', asArray<ContactSource>(event.target.value))
          }
          slotProps={{ select: { multiple: true } }}
          helperText="How the contact reached you"
          sx={{ minWidth: 200 }}
        >
          {Object.entries(CONTACT_SOURCE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {/*
        THE CRM DIMENSIONS (AGL-2603), under Contacts because that is the only
        silo that carries them. Each is PICKED rather than typed — a person
        from the roster, a stage from the fixed list, a company from a search
        — so the rule stores ids and the sentences above read them back as
        names. An absent value matches none of them: "owned by Ada" is not
        satisfied by a contact nobody owns, and the helper text says so where
        a reader would otherwise assume the blank was included.
       */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Owned by"
          value={draft.ownerUids}
          onChange={(event) => set('ownerUids', asArray<string>(event.target.value))}
          slotProps={{
            select: {
              multiple: true,
              renderValue: (selected) =>
                (selected as string[])
                  .map((uid) => named(uid, names.members))
                  .join(', '),
            },
          }}
          error={Boolean(team.error)}
          helperText={team.error ?? 'Any of these team members. Unowned contacts are left out.'}
          sx={{ minWidth: 220 }}
        >
          {ownerOptions.map((option) => (
            <MenuItem key={option.uid} value={option.uid}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Lifecycle stage"
          value={draft.lifecycleStages}
          onChange={(event) =>
            set(
              'lifecycleStages',
              asArray<ContactLifecycleStage>(event.target.value),
            )
          }
          slotProps={{
            select: {
              multiple: true,
              renderValue: (selected) =>
                (selected as ContactLifecycleStage[])
                  .map((stage) => CONTACT_LIFECYCLE_STAGE_LABELS[stage] ?? stage)
                  .join(', '),
            },
          }}
          helperText="Any of these stages"
          sx={{ minWidth: 200 }}
        >
          {CONTACT_LIFECYCLE_STAGES.map((stage) => (
            <MenuItem key={stage} value={stage}>
              {CONTACT_LIFECYCLE_STAGE_LABELS[stage]}
            </MenuItem>
          ))}
        </TextField>
        {/*
          A SEARCH, not a list: the org's companies are the collection that
          outgrows any dropdown, so nothing is read until something is typed
          and the hook answers one screen of prefix matches. The chips keep
          their names through the hook's own memory of every id it has seen,
          which is what lets a rule reopened months later still say "Acme".
         */}
        <Autocomplete
          multiple
          size="small"
          options={companies.hits}
          value={draft.companyIds.map((id) => ({
            id,
            label: companies.names[id] ?? id,
          }))}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
          // The query already narrowed the hits; a second, client-side
          // filter on the label would hide a match whose stored name differs
          // from its search key.
          filterOptions={(options) => options}
          inputValue={companySearch}
          onInputChange={(_event, value, reason) => {
            if (reason !== 'reset') setCompanySearch(value)
          }}
          onChange={(_event, value) =>
            set(
              'companyIds',
              value.map((option) => option.id),
            )
          }
          loading={companies.searching}
          noOptionsText={
            companySearch ? 'No company by that name' : 'Type to search companies'
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="At company"
              helperText="Any of these companies"
            />
          )}
          sx={{ minWidth: 260, flexGrow: 1, maxWidth: 420 }}
        />
        {/*
          THE RE-ENGAGEMENT WINDOW (AGL-2616), beside the other facet reads
          rather than under "Email engagement" below: that section reads the
          address-level rollup — every message this workspace sent the
          person — and this reads the stamp the delivery webhook wrote on
          THIS site's contact for THIS site's campaigns. A contact never
          stamped is left out, the lean every CRM dimension takes, and the
          helper says so.
         */}
        <TextField
          type="number"
          size="small"
          label="Engaged with a campaign within (days)"
          helperText="Opened or clicked one of your campaigns. Never engaged is left out."
          value={draft.engagedWithinDays}
          onChange={(event) => set('engagedWithinDays', event.target.value)}
          sx={{ minWidth: 280 }}
        />
      </Stack>
      {/*
        One row per condition, and every row must hold — a second condition
        NARROWS, which is what a second box means everywhere else on this
        form; the OR is the "any one of the filters" mode above, where each
        row becomes a branch of its own. The value control is typed by the
        field's definition, so a number field hands the matcher a number and
        a choice field offers its own options, and a presence test asks for
        no value at all.
       */}
      {draft.custom.map((clause, index) => {
        const definition = definitionFor(clause.key)
        const valueText = String(clause.value ?? '')
        return (
          <Stack
            key={index}
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}
          >
            <TextField
              select
              size="small"
              label="Field"
              value={clause.key}
              onChange={(event) =>
                updateClause(index, { key: event.target.value, value: '' })
              }
              sx={{ minWidth: 180 }}
            >
              {fieldOptions.map((option) => (
                <MenuItem key={option.key} value={option.key}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Condition"
              value={clause.op}
              onChange={(event) =>
                updateClause(index, {
                  op: event.target.value as DynamicListCustomOp,
                })
              }
              sx={{ minWidth: 160 }}
            >
              {DYNAMIC_LIST_CUSTOM_OPS.map((op) => (
                <MenuItem key={op} value={op}>
                  {CUSTOM_OP_LABELS[op]}
                </MenuItem>
              ))}
            </TextField>
            {PRESENCE_OPS.has(clause.op) ? null : definition?.type === 'select' ? (
              <TextField
                select
                size="small"
                label="Value"
                value={valueText}
                onChange={(event) =>
                  updateClause(index, { value: event.target.value })
                }
                sx={{ minWidth: 180 }}
              >
                {(definition.options ?? []).map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
            ) : definition?.type === 'checkbox' ? (
              <TextField
                select
                size="small"
                label="Value"
                value={
                  clause.value === true
                    ? 'true'
                    : clause.value === false
                      ? 'false'
                      : ''
                }
                onChange={(event) =>
                  updateClause(index, { value: event.target.value === 'true' })
                }
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="true">{'Checked'}</MenuItem>
                <MenuItem value="false">{'Not checked'}</MenuItem>
              </TextField>
            ) : definition?.type === 'number' ? (
              <TextField
                type="number"
                size="small"
                label="Value"
                value={valueText}
                onChange={(event) => {
                  // A number field stores a NUMBER, so the matcher compares
                  // 10 with 9 and not "10" with "9"; half-typed text stays
                  // text until it parses, rather than becoming NaN.
                  const text = event.target.value
                  const parsed = Number(text)
                  updateClause(index, {
                    value: text.trim() !== '' && Number.isFinite(parsed) ? parsed : text,
                  })
                }}
                sx={{ minWidth: 140 }}
              />
            ) : (
              <TextField
                type={definition?.type === 'date' ? 'date' : 'text'}
                size="small"
                label="Value"
                value={valueText}
                onChange={(event) =>
                  updateClause(index, { value: event.target.value })
                }
                slotProps={
                  definition?.type === 'date'
                    ? { inputLabel: { shrink: true } }
                    : undefined
                }
                sx={{ minWidth: 180 }}
              />
            )}
            <Button size="small" onClick={() => removeClause(index)}>
              {'Remove'}
            </Button>
          </Stack>
        )
      })}
      <Box>
        <Button
          size="small"
          variant="outlined"
          disabled={!fieldOptions.length}
          onClick={addClause}
        >
          {'Add a field condition'}
        </Button>
        {fieldDefinitions.ready && !fieldDefinitions.fields.length ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            {'This workspace has no custom contact fields yet. Define them ' +
              'under CRM → Fields to filter on them here.'}
          </Typography>
        ) : null}
      </Box>

      <Typography variant="overline" color="text.secondary">
        {'Purchase history'}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          type="number"
          size="small"
          label="Orders at least"
          value={draft.ordersCountAtLeast}
          onChange={(event) => set('ordersCountAtLeast', event.target.value)}
          sx={{ minWidth: 160 }}
        />
        <TextField
          type="number"
          size="small"
          label="Spent at least"
          helperText="Lifetime, in your store's currency"
          value={draft.ltvAtLeast}
          onChange={(event) => set('ltvAtLeast', event.target.value)}
          sx={{ minWidth: 190 }}
        />
        <TextField
          type="number"
          size="small"
          label="Bought within (days)"
          value={draft.lastPurchaseWithinDays}
          onChange={(event) =>
            set('lastPurchaseWithinDays', event.target.value)
          }
          sx={{ minWidth: 190 }}
        />
        <TextField
          type="number"
          size="small"
          label="Nothing bought for (days)"
          helperText="Lapsed customers — never bought is not lapsed"
          value={draft.noPurchaseForDays}
          onChange={(event) => set('noPurchaseForDays', event.target.value)}
          sx={{ minWidth: 220 }}
        />
      </Stack>

      <Divider />
      <Typography variant="overline" color="text.secondary">
        {'Email engagement'}
      </Typography>
      {/*
        The two quiet fields carry their lean in the helper text, not only in
        the sentences above. They read the OPPOSITE way from "Nothing bought
        for", one section up — somebody who never opened anything counts as
        not having opened, where somebody who never bought is not lapsed — and
        a form that put two opposite defaults next to each other without
        saying so is a form that produces the wrong audience quietly.
       */}
      <Typography variant="caption" color="text.secondary">
        {'Opens and clicks across every email this workspace has sent the ' +
          'person. Clicks are the stronger signal: mail apps that preload ' +
          'images record an open the reader never made.'}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          type="number"
          size="small"
          label="Opened within (days)"
          value={draft.openedWithinDays}
          onChange={(event) => set('openedWithinDays', event.target.value)}
          sx={{ minWidth: 190 }}
        />
        <TextField
          type="number"
          size="small"
          label="Clicked within (days)"
          value={draft.clickedWithinDays}
          onChange={(event) => set('clickedWithinDays', event.target.value)}
          sx={{ minWidth: 190 }}
        />
        <TextField
          type="number"
          size="small"
          label="Nothing opened for (days)"
          helperText="Never opened counts"
          value={draft.notOpenedForDays}
          onChange={(event) => set('notOpenedForDays', event.target.value)}
          sx={{ minWidth: 210 }}
        />
        <TextField
          type="number"
          size="small"
          label="Nothing clicked for (days)"
          helperText="Never clicked counts"
          value={draft.notClickedForDays}
          onChange={(event) => set('notClickedForDays', event.target.value)}
          sx={{ minWidth: 210 }}
        />
      </Stack>

      <Divider />
      <Typography variant="overline" color="text.secondary">
        {'Other audiences'}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Already on"
          value={draft.inListIds}
          onChange={(event) => set('inListIds', asArray<string>(event.target.value))}
          slotProps={{ select: { multiple: true } }}
          helperText="Members of every audience picked"
          sx={{ minWidth: 220 }}
        >
          {lists.map((row) => (
            <MenuItem key={row.$id} value={row.$id}>
              {row.name ?? row.$id}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Not on"
          value={draft.notInListIds}
          onChange={(event) =>
            set('notInListIds', asArray<string>(event.target.value))
          }
          slotProps={{ select: { multiple: true } }}
          helperText="Excludes members of any audience picked"
          sx={{ minWidth: 220 }}
        >
          {lists.map((row) => (
            <MenuItem key={row.$id} value={row.$id}>
              {row.name ?? row.$id}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  )
}
DynamicListRuleFields.displayName = 'DynamicListRuleFields'

/**
 * A draft seeded from a rule that arrives after the form does.
 *
 * The edit page mounts before its list document lands, so the controls are
 * built from an empty rule and filled in once. Seeding ONCE per subject is the
 * whole point: the document is a live listen, and re-seeding on every snapshot
 * would overwrite whatever the reader had typed each time anything on the list
 * changed — including the snapshot the reader's own save produces.
 */
export function useRuleDraft(
  rule: DynamicListRule | undefined,
  resetKey: string,
): [DynamicListRuleDraft, (draft: DynamicListRuleDraft) => void] {
  const [draft, setDraft] = useState<DynamicListRuleDraft>(EMPTY_RULE_DRAFT)
  const seededFor = useRef('')
  useEffect(() => {
    if (!rule || seededFor.current === resetKey) return
    seededFor.current = resetKey
    setDraft(ruleToDraft(rule))
  }, [rule, resetKey])
  return [draft, setDraft]
}

export default DynamicListRuleFields
