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
 * EMAIL TEMPLATES IN A WORKSPACE PACKAGE — the server half (AGL-3535).
 *
 * Written the way the template's duplicate writes a copy
 * (`email-template-duplicate.ts`): inside a transaction that holds the
 * listing's ceiling (`CRM_EMAIL_TEMPLATES_LIMIT`), scoped to its site's
 * token or the organization's, filed under the person importing — a
 * personal template becomes theirs. A replace rewrites what a person reads
 * (name, kind, visibility, subject, body, site) and keeps who wrote it.
 *=========================================*/

import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import {
  CRM_EMAIL_TEMPLATES_LIMIT,
  crmEmailTemplateIsListed,
  normalizeCrmEmailTemplate,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import { hostScopeToken, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  existingPackageItemsOf,
  type ExistingPackageItem,
  type TransferRowResult,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferApplyResult,
  TransferApplyWriter,
  TransferPackageItemContent,
  TransferPackageItemWrite,
  TransferPackageRevertResult,
  TransferPackageRevertStep,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  CRM_EMAIL_TEMPLATES_TRANSFER_KEY,
  crmEmailTemplatePackageContent,
  crmEmailTemplatePackageProblems,
  type CrmEmailTemplatePackageContent,
} from './email-templates-package'

type Firestore = FirebaseFirestore.Firestore

export interface CrmEmailTemplatesPackageDeps {
  firestore(): Firestore
  now(): number
}

function defaultDeps(): CrmEmailTemplatesPackageDeps {
  return { firestore: () => firebaseAdmin.app().firestore() as unknown as Firestore, now: Date.now }
}

const templatesOf = (firestore: Firestore, orgId: string) =>
  firestore.collection('orgs').doc(orgId).collection(CRM_COLLECTIONS.emailTemplates)

/** The fields a person reads, as stored: scoped to the site's token, or the organization's. */
function readableFields(content: CrmEmailTemplatePackageContent, actorUid: string, nowMs: number) {
  return {
    name: content.name,
    kind: content.kind,
    visibility: content.visibility,
    subject: content.kind === 'snippet' ? '' : content.subject,
    body: content.body,
    ...(content.visibility === 'personal' ? { ownerUid: actorUid } : {}),
    hostId: content.hostId,
    visibleTo: [content.hostId ? hostScopeToken(content.hostId) : ORG_SCOPE_TOKEN],
    updatedAtMs: nowMs,
    updatedAt: new Date(nowMs),
  }
}

async function readAll(
  deps: CrmEmailTemplatesPackageDeps,
  ctx: TransferResourceContext,
  ids?: readonly string[],
): Promise<Array<TransferPackageItemContent<CrmEmailTemplatePackageContent>>> {
  const collection = templatesOf(deps.firestore(), ctx.orgId)
  const docs = ids
    ? (await Promise.all(ids.map((id) => collection.doc(id).get()))).filter((doc) => doc.exists)
    : (await collection.get()).docs
  return docs.flatMap((doc) => {
    const template = normalizeCrmEmailTemplate(doc.data() as Record<string, unknown>)
    // A colleague's personal template is theirs; only the importer's own and the shared ones move.
    if (!crmEmailTemplateIsListed(template, ctx.actorUid)) return []
    const content = crmEmailTemplatePackageContent(template)
    return [{ kind: CRM_EMAIL_TEMPLATES_TRANSFER_KEY, id: doc.id, name: content.name, content }]
  })
}

export function createCrmEmailTemplatesPackage(deps: CrmEmailTemplatesPackageDeps = defaultDeps()) {
  return {
    async items(ctx: TransferResourceContext): Promise<ExistingPackageItem[]> {
      return existingPackageItemsOf(CRM_EMAIL_TEMPLATES_TRANSFER_KEY, await readAll(deps, ctx))
    },

    async readItems(ctx: TransferResourceContext, ids: readonly string[]) {
      return readAll(deps, ctx, ids)
    },

    async problems(ctx: TransferResourceContext, write: TransferPackageItemWrite<CrmEmailTemplatePackageContent>) {
      const problems = crmEmailTemplatePackageProblems({ ...write.content, name: write.rename?.name ?? write.content.name })
      if (write.decision !== 'replace') {
        const held = (await templatesOf(deps.firestore(), ctx.orgId).count().get()).data().count
        if (held >= CRM_EMAIL_TEMPLATES_LIMIT) {
          problems.push(`This workspace holds ${CRM_EMAIL_TEMPLATES_LIMIT} email templates — delete one to make room.`)
        }
      }
      return problems
    },

    async writeItems(
      ctx: TransferResourceContext,
      items: ReadonlyArray<TransferPackageItemWrite<CrmEmailTemplatePackageContent>>,
      writer: TransferApplyWriter,
    ): Promise<TransferApplyResult> {
      const firestore = deps.firestore()
      const templates = templatesOf(firestore, ctx.orgId)
      const actor = ctx.actorUid ?? ''
      const results: TransferRowResult[] = []
      for (const write of items) {
        const before = await writer.alreadyApplied(write.row)
        if (before) {
          results.push(before)
          continue
        }
        const content = crmEmailTemplatePackageContent({ ...write.content, name: write.rename?.name ?? write.content.name })
        const nowMs = deps.now()
        const result = await firestore.runTransaction(async (transaction): Promise<TransferRowResult> => {
          const ref = templates.doc(write.targetId)
          const current = await transaction.get(ref)
          if (write.decision === 'replace') {
            if (!current.exists) return { row: write.row, outcome: 'failed', recordId: write.targetId, message: 'That template no longer exists.' }
            transaction.update(ref, readableFields(content, actor, nowMs))
            return { row: write.row, outcome: 'updated', recordId: write.targetId }
          }
          const siblings = await transaction.get(templates.select('name'))
          if (siblings.size >= CRM_EMAIL_TEMPLATES_LIMIT) {
            return {
              row: write.row,
              outcome: 'failed',
              message: `This workspace holds ${CRM_EMAIL_TEMPLATES_LIMIT} email templates — delete one to make room.`,
            }
          }
          transaction.create(ref, {
            ...readableFields(content, actor, nowMs),
            createdByUid: actor,
            createdAtMs: nowMs,
            createdAt: new Date(nowMs),
          })
          return { row: write.row, outcome: 'created', recordId: write.targetId }
        })
        await writer.markApplied(result)
        results.push(result)
      }
      return { results, undo: [] }
    },

    async revertItems(
      ctx: TransferResourceContext,
      steps: ReadonlyArray<TransferPackageRevertStep<CrmEmailTemplatePackageContent>>,
    ): Promise<TransferPackageRevertResult> {
      const templates = templatesOf(deps.firestore(), ctx.orgId)
      const outcome: TransferPackageRevertResult = { done: [], refused: [] }
      for (const step of steps) {
        if (step.action === 'delete') await templates.doc(step.id).delete()
        else await templates.doc(step.id).update(readableFields(crmEmailTemplatePackageContent(step.content), ctx.actorUid ?? '', deps.now()))
        outcome.done.push(step.id)
      }
      return outcome
    },
  }
}
