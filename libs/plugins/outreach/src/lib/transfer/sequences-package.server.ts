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
 * SEQUENCES IN A WORKSPACE PACKAGE — the server half (AGL-3535).
 *
 * Reads the workspace's sequences as package items and writes imported
 * ones through the editor's own save (`saveOutreachSequence`): the same
 * validator, the same placement rules (the site is the organization's,
 * the mailbox connected here and the importer's to send from, the
 * countries allowed), the same activity line — so an import can store
 * nothing the editor would refuse. A new sequence is a draft; a replaced
 * one keeps its status; undo deletes through the delete route's own rule
 * (a draft nobody was enrolled in) and restores through the save.
 *
 * The importer is resolved as the sequence routes resolve a caller: a
 * member of the organization, across all of it, holding Use Sequences, in
 * a workspace entitled to Sequences. Anything short of that is an
 * objection at the dry run, before anything is written.
 *=========================================*/

import { existingPackageItemsOf, type ExistingPackageItem } from '@aglyn/aglyn/data-transfer'
import type {
  TransferApplyResult,
  TransferApplyWriter,
  TransferPackageItemContent,
  TransferPackageItemWrite,
  TransferPackageRevertResult,
  TransferPackageRevertStep,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { TransferReferenceKind, TransferRowResult } from '@aglyn/aglyn/data-transfer'
import { checkEntitlement } from '@aglyn/aglyn/server'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'
import { defaultOutreachRouteDeps } from '../routes/register-routes'
import type { OutreachRouteDeps } from '../routes/route-deps'
import type { OutreachRouteCaller } from '../routes/route-gate'
import { removeOutreachSequence, saveOutreachSequence } from '../routes/sequence-routes'
import { readStoredOutreachMailbox, readStoredOutreachSequence } from '../storage/outreach-records'
import { outreachOrgCollection } from '../storage/outreach-records'
import {
  OUTREACH_MAILBOX_REFERENCE_KIND,
  OUTREACH_SEQUENCES_TRANSFER_KEY,
  outreachSequencePackageContent,
  type OutreachSequencePackageContent,
} from './sequences-package'

type Deps = Pick<OutreachRouteDeps, 'firestore' | 'now' | 'logOrgActivity' | 'gate'>

/** The importer as a sequence route would admit them, or why it would not. */
async function importer(deps: Deps, ctx: TransferResourceContext): Promise<OutreachRouteCaller | string> {
  if (!ctx.actorUid) return 'Sequences are imported by a member of the organization.'
  const membership = await deps.gate.resolveOrgPermissions(ctx.actorUid, { orgId: ctx.orgId })
  if (!membership.role || membership.orgId !== ctx.orgId) return 'You are not a member of that organization.'
  if (!membership.orgWide) return 'Sequences covers the whole organization, and your access is to particular sites.'
  if (membership.permissions[OUTREACH_USE_PERMISSION] !== true) return 'Your role does not include Use Sequences.'
  const org = (await deps.gate.readOrg(ctx.orgId)) ?? {}
  if (!checkEntitlement(org, 'outreach')) return "Sequences isn't available to this workspace yet."
  return { uid: ctx.actorUid, email: null, staff: false, orgId: ctx.orgId, org, isOrgAdmin: membership.isOwner }
}

/**
 * Sequences as package items — archived ones too, so one coming back under
 * its own id matches the archived sequence (which the save refuses to
 * change) rather than writing over it as new.
 */
async function readAll(deps: Deps, orgId: string, ids?: readonly string[]): Promise<Array<TransferPackageItemContent<OutreachSequencePackageContent>>> {
  const collection = outreachOrgCollection(deps.firestore(), orgId, 'sequences')
  const docs = ids
    ? (await Promise.all(ids.map((id) => collection.doc(id).get()))).filter((doc) => doc.exists)
    : (await collection.get()).docs
  const items: Array<TransferPackageItemContent<OutreachSequencePackageContent>> = []
  for (const doc of docs) {
    const stored = readStoredOutreachSequence(doc.id, doc.data())
    if (!stored) continue
    const content = outreachSequencePackageContent(stored)
    items.push({ kind: OUTREACH_SEQUENCES_TRANSFER_KEY, id: doc.id, name: content.name, content })
  }
  return items
}

/** The draft one item is saved as: its content, under a kept-both copy's new name. */
function draftOf(write: TransferPackageItemWrite<OutreachSequencePackageContent>): OutreachSequencePackageContent {
  return { ...write.content, name: write.rename?.name ?? write.content.name }
}

async function save(
  deps: Deps,
  caller: OutreachRouteCaller,
  write: TransferPackageItemWrite<OutreachSequencePackageContent>,
  judgeOnly: boolean,
) {
  return saveOutreachSequence(deps, caller, {
    sequenceId: write.decision === 'replace' ? write.targetId : null,
    ...(write.decision === 'replace' ? {} : { newId: write.targetId }),
    draft: draftOf(write),
    judgeOnly,
  })
}

export function createOutreachSequencesPackage(deps: Deps = defaultOutreachRouteDeps()) {
  return {
    async items(ctx: TransferResourceContext): Promise<ExistingPackageItem[]> {
      return existingPackageItemsOf(OUTREACH_SEQUENCES_TRANSFER_KEY, await readAll(deps, ctx.orgId))
    },

    async readItems(ctx: TransferResourceContext, ids: readonly string[]) {
      return readAll(deps, ctx.orgId, ids)
    },

    async problems(ctx: TransferResourceContext, write: TransferPackageItemWrite<OutreachSequencePackageContent>) {
      const caller = await importer(deps, ctx)
      if (typeof caller === 'string') return [caller]
      const judged = await save(deps, caller, write, true)
      if (judged.ok !== false) return []
      const errors = (judged.issues ?? []).filter((issue) => issue.severity === 'error').map((issue) => issue.message)
      return errors.length ? [...new Set(errors)] : [judged.message]
    },

    async referenceTargets(ctx: TransferResourceContext, kinds: readonly string[]): Promise<TransferReferenceKind[]> {
      if (!kinds.includes(OUTREACH_MAILBOX_REFERENCE_KIND)) return []
      const snapshot = await outreachOrgCollection(deps.firestore(), ctx.orgId, 'mailboxes').get()
      return [
        {
          kind: OUTREACH_MAILBOX_REFERENCE_KIND,
          label: 'Mailbox',
          targets: snapshot.docs.flatMap((doc) => {
            const mailbox = readStoredOutreachMailbox(doc.id, doc.data())
            return mailbox && mailbox.status !== 'disconnected' ? [{ id: doc.id, name: mailbox.email }] : []
          }),
        },
      ]
    },

    async writeItems(
      ctx: TransferResourceContext,
      items: ReadonlyArray<TransferPackageItemWrite<OutreachSequencePackageContent>>,
      writer: TransferApplyWriter,
    ): Promise<TransferApplyResult> {
      const caller = await importer(deps, ctx)
      const results: TransferRowResult[] = []
      for (const write of items) {
        const before = await writer.alreadyApplied(write.row)
        if (before) {
          results.push(before)
          continue
        }
        let result: TransferRowResult
        if (typeof caller === 'string') {
          result = { row: write.row, outcome: 'failed', message: caller }
        } else {
          const saved = await save(deps, caller, write, false)
          result =
            saved.ok === false
              ? { row: write.row, outcome: 'failed', recordId: write.targetId, message: saved.message }
              : { row: write.row, outcome: saved.created ? 'created' : 'updated', recordId: saved.sequence.id }
        }
        await writer.markApplied(result)
        results.push(result)
      }
      return { results, undo: [] }
    },

    async revertItems(
      ctx: TransferResourceContext,
      steps: ReadonlyArray<TransferPackageRevertStep<OutreachSequencePackageContent>>,
    ): Promise<TransferPackageRevertResult> {
      const caller = await importer(deps, ctx)
      const outcome: TransferPackageRevertResult = { done: [], refused: [] }
      for (const step of steps) {
        if (typeof caller === 'string') {
          outcome.refused.push({ id: step.id, reason: caller })
          continue
        }
        const done =
          step.action === 'delete'
            ? await removeOutreachSequence(deps, caller, step.id)
            : await saveOutreachSequence(deps, caller, { sequenceId: step.id, draft: outreachSequencePackageContent(step.content) })
        if (done.ok === false) outcome.refused.push({ id: step.id, reason: done.message })
        else outcome.done.push(step.id)
      }
      return outcome
    },
  }
}
