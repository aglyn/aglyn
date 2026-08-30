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
 * The rule model carries nine fields. The console offered four — sources,
 * tags, form names, created-after — so `segmentId`, `captureSources`,
 * `createdBeforeMs` and the entire `behavior` block were stored by the
 * matcher, evaluated by the materializer and indexed in Firestore while being
 * unreachable from any screen. Needing to hand-write a stored structure to
 * reach a shipped engine is a missing picker, not a power-user affordance.
 *
 * One component rather than a form on the create card and a second on the edit
 * page: the two would drift, and the half that drifts is whichever the
 * merchant is not looking at. A rule authored at creation and the same rule
 * reopened for editing are the same nine questions.
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
  CONTACT_SOURCE_LABELS,
  normalizeDynamicListRule,
  type ContactSource,
  type DynamicListRule,
  type DynamicListSource,
} from '@aglyn/aglyn'
import {
  Box,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOrgContactSegments } from '../hooks/use-org-contact-segments'

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
export function describeDynamicListRule(rule: DynamicListRule): string[] {
  const clauses: string[] = []
  clauses.push(
    rule.sources.length
      ? `Draws from ${rule.sources
          .map((source) => SOURCE_PHRASES[source] ?? source)
          .join(', ')}.`
      : 'Draws from nothing, so it matches nobody.',
  )
  if (rule.segmentId) clauses.push(`Reuses saved segment ${rule.segmentId}.`)
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
  return clauses
}

/** The rule as the controls hold it: what was typed, not what it means. */
export interface DynamicListRuleDraft {
  sources: DynamicListSource[]
  segmentId: string
  tags: string
  captureSources: ContactSource[]
  formNames: string
  /** `yyyy-mm-dd`, read as UTC — the same instant `Date.parse` gives it. */
  createdAfter: string
  createdBefore: string
  ordersCountAtLeast: string
  /** WHOLE currency units. `draftToRule` is the only place this becomes cents. */
  ltvAtLeast: string
  lastPurchaseWithinDays: string
  noPurchaseForDays: string
}

export const EMPTY_RULE_DRAFT: DynamicListRuleDraft = {
  sources: ['contacts'],
  segmentId: '',
  tags: '',
  captureSources: [],
  formNames: '',
  createdAfter: '',
  createdBefore: '',
  ordersCountAtLeast: '',
  ltvAtLeast: '',
  lastPurchaseWithinDays: '',
  noPurchaseForDays: '',
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

/** A stored rule, as the controls should show it. */
export function ruleToDraft(rule: DynamicListRule): DynamicListRuleDraft {
  const behavior = rule.behavior ?? {}
  return {
    sources: rule.sources ?? [],
    segmentId: rule.segmentId ?? '',
    tags: (rule.tags ?? []).join(', '),
    captureSources: rule.captureSources ?? [],
    formNames: (rule.formNames ?? []).join(', '),
    createdAfter: dayStamp(rule.createdAfterMs),
    createdBefore: dayStamp(rule.createdBeforeMs),
    ordersCountAtLeast:
      behavior.ordersCountAtLeast === undefined
        ? ''
        : String(behavior.ordersCountAtLeast),
    ltvAtLeast:
      behavior.ltvCentsAtLeast === undefined
        ? ''
        : String(behavior.ltvCentsAtLeast / 100),
    lastPurchaseWithinDays:
      behavior.lastPurchaseWithinDays === undefined
        ? ''
        : String(behavior.lastPurchaseWithinDays),
    noPurchaseForDays:
      behavior.noPurchaseForDays === undefined
        ? ''
        : String(behavior.noPurchaseForDays),
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

/** What the controls mean, coerced by the function the matcher reads through. */
export function draftToRule(draft: DynamicListRuleDraft): DynamicListRule {
  const ordersCountAtLeast = typedNumber(draft.ordersCountAtLeast)
  const ltv = typedNumber(draft.ltvAtLeast)
  const lastPurchaseWithinDays = typedNumber(draft.lastPurchaseWithinDays)
  const noPurchaseForDays = typedNumber(draft.noPurchaseForDays)
  const behavior = {
    ...(ordersCountAtLeast !== undefined ? { ordersCountAtLeast } : {}),
    // Whole units in, cents out — rounded, because a half-cent threshold is
    // not a quantity any order total can be compared against.
    ...(ltv !== undefined ? { ltvCentsAtLeast: Math.round(ltv * 100) } : {}),
    ...(lastPurchaseWithinDays !== undefined
      ? { lastPurchaseWithinDays }
      : {}),
    ...(noPurchaseForDays !== undefined ? { noPurchaseForDays } : {}),
  }
  const createdAfterMs = draft.createdAfter
    ? Date.parse(draft.createdAfter)
    : undefined
  const createdBeforeMs = draft.createdBefore
    ? Date.parse(draft.createdBefore)
    : undefined
  /*
   * Normalized on the way IN by the same function the materializer reads it
   * back through. A rule coerced on the way out but not on the way in is a
   * rule the console can display differently from the way it evaluates.
   */
  return normalizeDynamicListRule({
    sources: draft.sources,
    ...(draft.segmentId ? { segmentId: draft.segmentId } : {}),
    ...(splitRuleList(draft.tags).length
      ? { tags: splitRuleList(draft.tags) }
      : {}),
    ...(draft.captureSources.length
      ? { captureSources: draft.captureSources }
      : {}),
    ...(splitRuleList(draft.formNames).length
      ? { formNames: splitRuleList(draft.formNames) }
      : {}),
    ...(createdAfterMs !== undefined && Number.isFinite(createdAfterMs)
      ? { createdAfterMs }
      : {}),
    ...(createdBeforeMs !== undefined && Number.isFinite(createdBeforeMs)
      ? { createdBeforeMs }
      : {}),
    ...(Object.keys(behavior).length ? { behavior } : {}),
  })
}

export interface DynamicListRuleFieldsProps {
  /** `['orgs', orgId]` — the resolved org scope the caller already holds. */
  scope: readonly [string, string]
  draft: DynamicListRuleDraft
  onChange: (draft: DynamicListRuleDraft) => void
}

export function DynamicListRuleFields(props: DynamicListRuleFieldsProps) {
  const { scope, draft, onChange } = props
  const segmentDocs = useOrgContactSegments(scope)

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

  const set = <K extends keyof DynamicListRuleDraft>(
    key: K,
    value: DynamicListRuleDraft[K],
  ) => onChange({ ...draft, [key]: value })

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
        {describeDynamicListRule(draftToRule(draft)).map((clause) => (
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
