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
 * The deal drawer's values and the documents they become (AGL-2598), as pure
 * functions — the drawer holds strings the way inputs do, and this module is
 * the one place those strings turn into the typed fields a `CrmDeal` stores.
 * Kept out of the component so the translation can be tested without a
 * Firestore or a DOM, and so the contact card and the company card, which
 * open the same drawer with a link preselected, build a deal the same way.
 */

import {
  contactDisplayName,
  type CrmDeal,
  nameSearchKey,
  nameSearchToken,
} from '@aglyn/aglyn'
import {
  amountInputValue,
  dateInputMs,
  dateInputValue,
  DEFAULT_DEAL_CURRENCY,
  type DealDoc,
  openStages,
  parseAmountInput,
  type PipelineDoc,
} from './deal-board-model'

/** What the drawer edits — strings as the inputs hold them. */
export interface DealFormValues {
  title: string
  pipelineId: string
  stageId: string
  /** As typed: `1,250.00`; parsed at save. */
  amount: string
  currency: string
  /** `YYYY-MM-DD` from a date input, or empty. */
  expectedClose: string
  ownerUid: string
  contactId: string
  contactName: string
  companyId: string
  companyName: string
  notes: string
}

export const DEAL_TITLE_MAX = 120
export const DEAL_NOTES_MAX = 4000

/**
 * A blank form aimed at a pipeline's first open stage.
 *
 * `defaults` is how a contact's page or a company's page starts a deal
 * already linked to itself: the caller passes the ids and names it knows and
 * the drawer opens with those fields filled. Anything it does not pass stays
 * blank rather than being guessed.
 */
export function emptyDealForm(
  pipeline: Pick<PipelineDoc, '$id' | 'stages'> | null | undefined,
  defaults: Partial<DealFormValues> = {},
): DealFormValues {
  const firstOpen = openStages(pipeline)[0]
  return {
    title: '',
    pipelineId: pipeline?.$id ?? '',
    stageId: firstOpen?.id ?? '',
    amount: '',
    currency: DEFAULT_DEAL_CURRENCY,
    expectedClose: '',
    ownerUid: '',
    contactId: '',
    contactName: '',
    companyId: '',
    companyName: '',
    notes: '',
    ...defaults,
  }
}

/** The form an existing deal opens as. */
export function dealFormFromDoc(deal: DealDoc): DealFormValues {
  return {
    title: String(deal.title ?? ''),
    pipelineId: String(deal.pipelineId ?? ''),
    stageId: String(deal.stageId ?? ''),
    amount: amountInputValue(deal.amountCents),
    currency: String(deal.currency || DEFAULT_DEAL_CURRENCY).toLowerCase(),
    expectedClose: dateInputValue(deal.expectedCloseAtMs),
    ownerUid: String(deal.ownerUid ?? ''),
    contactId: String(deal.contactId ?? ''),
    contactName: String(deal.contactName ?? ''),
    companyId: String(deal.companyId ?? ''),
    companyName: String(deal.companyName ?? ''),
    notes: String(deal.notes ?? ''),
  }
}

/**
 * Why the form cannot be saved, or `null` when it can.
 *
 * A title is the one thing a deal needs — a card with no title is a card
 * nobody can find on the board. The amount is optional but, if typed, has to
 * parse: a deal saved with an amount the merchant typed and the model dropped
 * would forecast at zero without saying so. The stage is only checked on a
 * new deal, because an existing deal's stage is moved by the stage route and
 * is not this form's to write.
 */
export function dealFormProblem(
  values: DealFormValues,
  mode: 'create' | 'edit',
): string | null {
  if (!values.title.trim()) return 'A deal needs a title.'
  if (values.amount.trim() && parseAmountInput(values.amount) === null) {
    return 'The amount has to be a number of zero or more.'
  }
  if (values.expectedClose.trim() && dateInputMs(values.expectedClose) === null) {
    return 'The expected close has to be a date.'
  }
  if (mode === 'create' && (!values.pipelineId || !values.stageId)) {
    return 'Pick the stage the deal starts in.'
  }
  return null
}

/** What every deal write stamps besides the fields the form edits. */
export interface DealWriteContext {
  visibleTo: string[]
  hostId: string
  uid: string
  nowMs: number
}

/**
 * The optional fields, as the values to SET and the keys to CLEAR.
 *
 * Split rather than written as `null` because a deal's optional ids are
 * typed as absent-or-string, and the indexes on `contactId` and `companyId`
 * are what the contact and company pages query — a `null` there would be a
 * row those pages cannot see and a filter on "no contact" could not find
 * either. On a create the cleared keys are simply not written; on an edit
 * the component turns them into field deletes.
 */
function optionalFields(values: DealFormValues): {
  set: Record<string, string | number>
  clear: string[]
} {
  const set: Record<string, string | number> = {}
  const clear: string[] = []
  const put = (key: string, value: string | number | null) => {
    if (value === null || value === '') clear.push(key)
    else set[key] = value
  }
  put('amountCents', parseAmountInput(values.amount))
  put('expectedCloseAtMs', dateInputMs(values.expectedClose))
  put('ownerUid', values.ownerUid.trim())
  put('contactId', values.contactId.trim())
  put('contactName', values.contactId.trim() ? values.contactName.trim() : '')
  put('companyId', values.companyId.trim())
  put('companyName', values.companyId.trim() ? values.companyName.trim() : '')
  put('notes', values.notes.trim().slice(0, DEAL_NOTES_MAX))
  return { set, clear }
}

/**
 * The document a new deal is created as. Open, in the chosen stage, with
 * the stage clock started now so "days in stage" counts from creation.
 */
export function dealDocumentFromForm(
  values: DealFormValues,
  context: DealWriteContext,
): Record<string, unknown> {
  const title = values.title.trim().slice(0, DEAL_TITLE_MAX)
  const { set } = optionalFields(values)
  return {
    title,
    titleLower: nameSearchKey(title),
    pipelineId: values.pipelineId,
    stageId: values.stageId,
    status: 'open' satisfies CrmDeal['status'],
    currency: String(values.currency || DEFAULT_DEAL_CURRENCY).toLowerCase(),
    stageChangedAtMs: context.nowMs,
    ...set,
    visibleTo: context.visibleTo,
    hostId: context.hostId,
    createdByUid: context.uid,
    createdAt: new Date(context.nowMs),
    updatedAt: new Date(context.nowMs),
  }
}

/**
 * The patch an edit writes. Never the stage, the status or the scope: the
 * stage goes through the server route so the automations hear it, and the
 * scope is changed only by an org-wide member on purpose.
 */
export function dealPatchFromForm(
  values: DealFormValues,
  nowMs: number,
): { set: Record<string, unknown>; clear: string[] } {
  const title = values.title.trim().slice(0, DEAL_TITLE_MAX)
  const { set, clear } = optionalFields(values)
  return {
    set: {
      title,
      titleLower: nameSearchKey(title),
      currency: String(values.currency || DEFAULT_DEAL_CURRENCY).toLowerCase(),
      ...set,
      updatedAt: new Date(nowMs),
    },
    clear,
  }
}

/** A contact as the picker offers it. */
export interface ContactChoice {
  id: string
  name: string
  email: string
}

/**
 * The contacts a typed query matches, from a window of recent contact rows,
 * in the list's own grammar.
 *
 * In memory rather than by query because the contacts collection has no
 * composite index over `visibleTo` with `nameLower` or `email`, and a
 * scoped list can carry only one array clause — so the picker reads the
 * newest rows the viewer may see (bounded, ordered) and matches here. The
 * match is what the list's search does: the normalized query as a prefix of
 * the email, or as a prefix of any word of the name (`nameTokens` holds
 * every word prefix a write produced; `nameLower` covers rows written before
 * the tokens existed). The holder's own name for the person wins over the
 * canonical one, as everywhere else.
 */
export function contactChoicesFor(
  queryText: string,
  rows: readonly Record<string, unknown>[],
  /**
   * The holder each row is named through: one group for every row under a
   * site, or a resolver per row at the organization level (AGL-2630), where
   * each contact reads through its own primary holder.
   */
  groupId: string | ((row: Record<string, unknown>) => string),
  max = 8,
): ContactChoice[] {
  const key = nameSearchKey(queryText)
  const token = nameSearchToken(queryText)
  const choices: ContactChoice[] = []
  for (const row of rows) {
    const email = String(row['email'] ?? '').toLowerCase()
    const name = contactDisplayName(
      row,
      typeof groupId === 'function' ? groupId(row) : groupId,
    )
    const nameLower = nameSearchKey(name)
    const tokens = Array.isArray(row['nameTokens'])
      ? (row['nameTokens'] as unknown[]).map(String)
      : []
    const matches =
      !key ||
      email.startsWith(key) ||
      nameLower.startsWith(key) ||
      nameLower.includes(` ${key}`) ||
      (token ? tokens.includes(token) : false)
    if (!matches) continue
    choices.push({ id: String(row['$id'] ?? ''), name, email })
    if (choices.length >= max) break
  }
  return choices
}
