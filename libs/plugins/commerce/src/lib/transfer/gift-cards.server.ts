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

import * as Aglyn from '@aglyn/aglyn/server'
import {
  planTransferUndo,
  type BuildTransferPlanInput,
  type TransferChunk,
  type PlannedTransferRow,
  type TransferPlan,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoSnapshot,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type {
  PluginTransferResource,
  TransferApplyResult,
  TransferApplyWriter,
  TransferResourceContext,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin, getOrgForHost, logHostActivity, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { giftCardCodeOf, giftCardRedeemed } from '../model/commerce-gift-cards'
import {
  GIFT_CARD_ACTIVITY_TYPE,
  GiftCardIssueRefusal,
  giftCardActivityName,
  issueGiftCard,
  mintGiftCardCode,
} from '../server/gift-card-issue'
import {
  GIFT_CARD_MATCH_KEYS,
  GIFT_CARD_UNDO_FIELDS,
  canImportGiftCards,
  giftCardRecord,
  planGiftCardRows,
  planWithCreateRequired,
  readGiftCardConfirmation,
  type GiftCardPlannedRow,
  type StoredGiftCard,
} from './records-transfer'
import { readableRecords, type RecordsSpec } from './records.server'
import { ROW_BUDGET_MS, firestoreOf, hostRefOf, type Firestore } from './server-common'

/*
 * THE GIFT CARD IMPORT'S SERVER HALF (AGL-3551). A file issues cards; it
 * never writes a balance. The plan (`planGiftCardRows`) decides each card and
 * the total; this module makes the three promises the dry run states:
 *
 * - WHO: the workspace's owners and admins, and a site's admins
 *   (`canImportGiftCards`), on a plan that includes gift cards. The plan,
 *   the apply and the undo each ask again, server-side.
 * - HOW: each card through `issueGiftCard`, the Gift cards card's own issue
 *   path — so its amount is bounded, its code is created and never
 *   overwritten, its activity line is written — and only when the total the
 *   person typed on the Confirm step is the total the plan counted.
 * - UNDO: a card nobody has spent from is voided (zeroed, never deleted,
 *   AGL-1767). A card with a redemption, or a checkout holding part of it,
 *   is reported as a conflict and left as it is, whatever the decision says:
 *   that money has been spent, or is being spent, by a shopper.
 */

type Doc = Record<string, unknown>

/** A code that could be a card's: the document id `in` query refuses anything with a slash. */
const CARD_ID = /^[A-Z0-9][A-Z0-9_-]*$/

const GIFT_CARDS: RecordsSpec = {
  collection: (firestore, ctx) => hostRefOf(firestore, ctx).collection('giftCards'),
  record: (id, data) => giftCardRecord(id, data as StoredGiftCard),
  matchValues: (id) => ({ id, code: id }),
  // A card's code is its document id: a code is looked up by id. A value
  // that cannot be a code still asks one id no card holds, rather than an
  // empty `in`, which the store refuses.
  find: {
    code: (collection, values) => {
      const codes = values.map((value) => giftCardCodeOf(value)).filter((code) => CARD_ID.test(code))
      return collection.where(firebaseAdmin.firestore.FieldPath.documentId(), 'in', codes.length ? codes : ['-'])
    },
  },
}

/** Who may import gift cards, refused in a sentence. */
export const GIFT_CARD_IMPORT_ACCESS =
  'Only the workspace’s owners and admins, and the site’s admins, can import gift cards.'

interface GiftCardIssuer {
  hostId: string
  uid: string
  email: string | null
  ownerOrg: unknown
}

/** The member importing, checked for the role and the plan, or the refusal. */
async function issuerOf(ctx: TransferResourceContext): Promise<GiftCardIssuer> {
  const hostId = ctx.hostId
  if (!hostId) throw new TransferEngineError('invalid', 400, 'Gift cards belong to a site; name the site.')
  const uid = ctx.actorUid
  const membership = uid ? await resolveOrgMembership(uid, ctx.orgId) : null
  if (!uid || !canImportGiftCards(membership?.member, hostId)) {
    throw new TransferEngineError('forbidden', 403, GIFT_CARD_IMPORT_ACCESS)
  }
  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!Aglyn.checkEntitlement(owner?.org as never, 'giftCards')) {
    throw new TransferEngineError('forbidden', 402, 'Gift cards are not included on this plan.')
  }
  const email = (membership?.member as { email?: string } | undefined)?.email ?? null
  return { hostId, uid, email, ownerOrg: owner?.org }
}

/** The codes among `codes` that a card on the site already holds. */
async function takenCodes(firestore: Firestore, ctx: TransferResourceContext, codes: readonly string[]): Promise<Set<string>> {
  const collection = GIFT_CARDS.collection(firestore, ctx)
  const taken = new Set<string>()
  const ids = [...new Set(codes.filter((code) => CARD_ID.test(code)))]
  for (let at = 0; at < ids.length; at += 100) {
    for (const doc of await firestore.getAll(...ids.slice(at, at + 100).map((id) => collection.doc(id)))) {
      if (doc.exists) taken.add(doc.id)
    }
  }
  return taken
}

/**
 * The dry run: the core's plan with a Balance required of every card, made
 * into the cards it issues. The codes the file names are read once, so a
 * code another card holds — however the file spaced or cased it — is never
 * planned as a new card.
 */
export async function planGiftCards(ctx: TransferResourceContext, input: BuildTransferPlanInput): Promise<TransferPlan> {
  await issuerOf(ctx)
  const firestore = firestoreOf()
  const rows = input.rows.map((row) =>
    'code' in row.values ? { ...row, values: { ...row.values, code: giftCardCodeOf(row.values['code']) || null } } : row,
  )
  const taken = await takenCodes(
    firestore,
    ctx,
    rows.map((row) => String(row.values['code'] ?? '')),
  )
  return planGiftCardRows(planWithCreateRequired({ ...input, rows }, ['balance']), {
    confirmation: readGiftCardConfirmation(ctx.extras),
    mintCode: mintGiftCardCode,
    taken,
  })
}

/** Whether the card under `code` is the one this job's `row` issued: a retried chunk finds its own card. */
async function issuedByRow(firestore: Firestore, ctx: TransferResourceContext, code: string, row: number): Promise<boolean> {
  const doc = await GIFT_CARDS.collection(firestore, ctx).doc(code).get()
  return doc.exists && doc.get('importJobId') === ctx.jobId && doc.get('importRow') === row
}

/** Issues one chunk's cards, each through the Gift cards card's own issue path. */
export async function applyGiftCards(
  ctx: TransferResourceContext,
  chunk: TransferChunk<PlannedTransferRow>,
  writer: TransferApplyWriter,
): Promise<TransferApplyResult> {
  const issuer = await issuerOf(ctx)
  const confirmation = readGiftCardConfirmation(ctx.extras)
  const firestore = firestoreOf()
  const results: TransferRowResult[] = []
  const undo: TransferUndoEntry[] = []
  const refuse = async (row: number, message: string) => {
    const result: TransferRowResult = { row, outcome: 'failed', reason: 'refusedValue', message }
    results.push(result)
    await writer.markApplied(result)
  }
  for (const row of chunk.rows as GiftCardPlannedRow[]) {
    const earlier = await writer.alreadyApplied(row.index)
    if (earlier) {
      results.push(earlier)
      continue
    }
    if (writer.timeLeftMs() < ROW_BUDGET_MS) break
    const card = row.giftCard
    if (row.verdict !== 'create' || !card) {
      await refuse(row.index, 'A gift card import only issues new cards; it never changes one.')
      continue
    }
    if (card.problem) {
      await refuse(row.index, card.problem)
      continue
    }
    // The typed total, read again here: the plan's verdict is not enough.
    if (!card.confirmed || !confirmation || confirmation.totalCents !== card.totalCents) {
      await refuse(row.index, 'The total value was not confirmed, so no card was issued. Confirm the total and import again.')
      continue
    }
    try {
      await issueGiftCard({
        firestore,
        hostId: issuer.hostId,
        amountCents: card.amountCents,
        recipientEmail: card.recipientEmail,
        note: card.note,
        code: card.code,
        issuer: { uid: issuer.uid, email: issuer.email },
        email: confirmation.email,
        ownerOrg: issuer.ownerOrg,
        source: { importJobId: ctx.jobId ?? '', importRow: row.index },
      })
    } catch (error) {
      if (!(error instanceof GiftCardIssueRefusal)) throw error
      // A retry after the card landed and before its row was recorded.
      if (!(error.reason === 'taken' && (await issuedByRow(firestore, ctx, card.code, row.index)))) {
        await refuse(row.index, error.message)
        continue
      }
    }
    const issued = await GIFT_CARDS.collection(firestore, ctx).doc(card.code).get()
    const record = giftCardRecord(card.code, (issued.data() ?? {}) as StoredGiftCard)
    const result: TransferRowResult = { row: row.index, outcome: 'created', recordId: card.code }
    const entry: TransferUndoEntry = {
      row: row.index,
      recordId: card.code,
      action: 'created',
      written: Object.fromEntries(GIFT_CARD_UNDO_FIELDS.map((fieldId) => [fieldId, record[fieldId] ?? null])),
    }
    results.push(result)
    undo.push(entry)
    await writer.markApplied(result, entry)
  }
  return { results, undo }
}

/**
 * Undoes one chunk: each card voided — zeroed, never deleted — when nobody
 * has spent from it; a spent or held card is a conflict that stays as it is,
 * whatever the person decided, because a shopper holds that money.
 */
export async function revertGiftCards(ctx: TransferResourceContext, snapshot: TransferUndoSnapshot): Promise<TransferRevertResult> {
  const issuer = await issuerOf(ctx)
  const firestore = firestoreOf()
  const collection = GIFT_CARDS.collection(firestore, ctx)
  const done: TransferUndoStep[] = []
  const conflicts: TransferUndoStep[] = []
  for (const entry of [...snapshot.entries].reverse()) {
    const ref = collection.doc(entry.recordId)
    const step = await firestore.runTransaction(async (tx): Promise<TransferUndoStep> => {
      const doc = await tx.get(ref)
      if (!doc.exists) return { action: 'nothing', recordId: entry.recordId, why: 'gone' }
      const card = (doc.data() ?? {}) as StoredGiftCard & Doc
      if (Number(card.voidedAtMs) > 0) return { action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' }
      if (giftCardRedeemed(card)) {
        const planned = planTransferUndo(entry, giftCardRecord(entry.recordId, card))
        return {
          action: 'conflict',
          recordId: entry.recordId,
          fields: planned.action === 'conflict' ? planned.fields : ['balance'],
          values: {},
        }
      }
      tx.set(
        ref,
        { balanceCents: 0, voidedAtMs: Date.now(), voidedBy: issuer.uid, voidedByImportUndo: ctx.jobId ?? null },
        { merge: true },
      )
      return { action: 'delete', recordId: entry.recordId }
    })
    if (step.action === 'conflict') {
      conflicts.push(step)
      continue
    }
    if (step.action === 'delete') {
      await logHostActivity(
        issuer.hostId,
        { uid: issuer.uid, email: issuer.email },
        'Voided gift card: import undone',
        { type: GIFT_CARD_ACTIVITY_TYPE, id: entry.recordId, name: giftCardActivityName(entry.recordId) },
      )
    }
    done.push(step)
  }
  return { done, conflicts }
}

export const giftCardsTransfer: PluginTransferResource = {
  matchKeys: GIFT_CARD_MATCH_KEYS,
  ...readableRecords(GIFT_CARDS),
  plan: (ctx, input) => planGiftCards(ctx, input),
  apply: (ctx, chunk, writer) => applyGiftCards(ctx, chunk, writer),
  revert: (ctx, snapshot) => revertGiftCards(ctx, snapshot),
}
