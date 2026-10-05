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
 * CAMPAIGNS IN A WORKSPACE PACKAGE — the server half (AGL-3535).
 *
 * The container is written with the fields the campaigns hub's create
 * drawer writes (its search fields, its placement), and each email the
 * way the campaign draft writer writes one (`createCampaignDraftWriter`):
 * `status: 'draft'`, sent as its site, naming a design that is a live
 * email screen there, and holding nothing a send needs a person to decide.
 * The scheduled processor only ever reads `status == 'scheduled'`, which no
 * import writes. One transaction per campaign: the container and its
 * drafts land together or not at all.
 *
 * Undo deletes an imported campaign only while every email in it is still
 * a draft; one that has started sending is the workspace's record of what
 * it sent, and stays.
 *=========================================*/

import { SCREEN_KIND_EMAIL } from '@aglyn/aglyn/app-utils/screen-route'
import {
  existingPackageItemsOf,
  type ExistingPackageItem,
  type TransferReferenceKind,
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
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '../model/campaign-container'
import { campaignContainerSearchFields, campaignSendSearchFields } from '../model/campaign-list-query'
import { campaignDraftEmailId } from '../server/campaign-manage'
import { campaignSendSiteStamp, orgCampaignSends, orgEmailCampaigns } from '../server/campaign-org-refs'
import {
  CAMPAIGN_REFERENCE_KINDS,
  CAMPAIGNS_TRANSFER_KEY,
  campaignPackageContent,
  draftableCampaignEmails,
  type CampaignPackageContent,
} from './campaigns-package'

type Firestore = FirebaseFirestore.Firestore

export interface CampaignsPackageDeps {
  firestore(): Firestore
  now(): number
}

function defaultDeps(): CampaignsPackageDeps {
  return { firestore: () => firebaseAdmin.app().firestore() as unknown as Firestore, now: Date.now }
}

/** The id of a campaign's `n`th imported email: the draft writer's for the first, numbered after it. */
function importedEmailId(campaignId: string, index: number): string {
  return index === 0 ? campaignDraftEmailId(campaignId) : `${campaignDraftEmailId(campaignId)}-${index + 1}`
}

/** The container's fields a person planned, as the create drawer stores them. */
function containerFields(content: CampaignPackageContent) {
  return {
    name: content.name,
    ...campaignContainerSearchFields(content.name),
    startAtMs: content.startAtMs,
    endAtMs: content.endAtMs,
    listIds: [...content.listIds],
    topicId: content.topicId,
    visibleTo: [...content.visibleTo],
    listUnsubscribe: content.listUnsubscribe,
  }
}

async function readAll(
  deps: CampaignsPackageDeps,
  orgId: string,
  ids?: readonly string[],
): Promise<Array<TransferPackageItemContent<CampaignPackageContent>>> {
  const firestore = deps.firestore()
  const containers = orgEmailCampaigns(firestore, orgId)
  const docs = ids
    ? (await Promise.all(ids.map((campaignId) => containers.doc(campaignId).get()))).filter((doc) => doc.exists)
    : (await containers.get()).docs
  const items: Array<TransferPackageItemContent<CampaignPackageContent>> = []
  for (const doc of docs) {
    if (doc.get('deletedAt')) continue
    const sends = await orgCampaignSends(firestore, orgId).where(CAMPAIGN_SEND_CONTAINER_FIELD, '==', doc.id).get()
    const emails = sends.docs
      .map((send) => send.data())
      .sort((a, b) => Number(a['createdAtMs'] ?? 0) - Number(b['createdAtMs'] ?? 0))
    const content = campaignPackageContent(doc.data(), emails)
    items.push({ kind: CAMPAIGNS_TRANSFER_KEY, id: doc.id, name: content.name, content })
  }
  return items
}

/** Why one campaign cannot be written as it stands, each a sentence. */
async function campaignProblems(firestore: Firestore, orgId: string, content: CampaignPackageContent): Promise<string[]> {
  const problems: string[] = []
  if (!content.name) problems.push('Name the campaign.')
  if (!content.visibleTo.length) problems.push('Choose the sites the campaign is placed on.')
  for (const email of draftableCampaignEmails(content)) {
    const host = await firestore.collection('hosts').doc(email.hostId).get()
    if (!host.exists || host.get('orgId') !== orgId) {
      problems.push(`“${email.subject || 'An email'}” sends as a site that is not in this organization.`)
      continue
    }
    const design = await host.ref.collection('screens').doc(email.templateScreenId).get()
    if (!design.exists || design.get('deletedAt') != null || design.get('kind') !== SCREEN_KIND_EMAIL) {
      problems.push(`“${email.subject || 'An email'}” sends an email design that site does not have.`)
    }
  }
  return problems
}

export function createCampaignsPackage(deps: CampaignsPackageDeps = defaultDeps()) {
  return {
    async items(ctx: TransferResourceContext): Promise<ExistingPackageItem[]> {
      return existingPackageItemsOf(CAMPAIGNS_TRANSFER_KEY, await readAll(deps, ctx.orgId))
    },

    async readItems(ctx: TransferResourceContext, ids: readonly string[]) {
      return readAll(deps, ctx.orgId, ids)
    },

    async problems(ctx: TransferResourceContext, write: TransferPackageItemWrite<CampaignPackageContent>) {
      const content = campaignPackageContent(write.content)
      return campaignProblems(deps.firestore(), ctx.orgId, { ...content, name: write.rename?.name ?? content.name })
    },

    async referenceTargets(ctx: TransferResourceContext, kinds: readonly string[]): Promise<TransferReferenceKind[]> {
      const firestore = deps.firestore()
      const org = firestore.collection('orgs').doc(ctx.orgId)
      const named = async (collection: string) =>
        (await org.collection(collection).get()).docs
          .filter((doc) => !doc.get('deletedAt'))
          .map((doc) => {
            const name = String(doc.get('name') ?? doc.get('label') ?? '').trim()
            return { id: doc.id, ...(name ? { name } : {}) }
          })
      const answers: TransferReferenceKind[] = []
      if (kinds.includes(CAMPAIGN_REFERENCE_KINDS.list)) {
        answers.push({ kind: CAMPAIGN_REFERENCE_KINDS.list, label: 'Email list', targets: await named('lists') })
      }
      if (kinds.includes(CAMPAIGN_REFERENCE_KINDS.topic)) {
        answers.push({ kind: CAMPAIGN_REFERENCE_KINDS.topic, label: 'Subscription topic', targets: await named('emailTopics') })
      }
      if (kinds.includes(CAMPAIGN_REFERENCE_KINDS.design)) {
        const hosts = await firestore.collection('hosts').where('orgId', '==', ctx.orgId).get()
        const targets: TransferReferenceKind['targets'] = []
        for (const host of hosts.docs) {
          const screens = await host.ref.collection('screens').where('kind', '==', SCREEN_KIND_EMAIL).get()
          for (const screen of screens.docs) {
            if (screen.get('deletedAt') != null) continue
            const title = String(screen.get('name') ?? screen.get('title') ?? screen.id)
            targets.push({ id: screen.id, name: `${title} (${String(host.get('name') ?? host.id)})` })
          }
        }
        answers.push({ kind: CAMPAIGN_REFERENCE_KINDS.design, label: 'Email design', targets })
      }
      return answers
    },

    async writeItems(
      ctx: TransferResourceContext,
      items: ReadonlyArray<TransferPackageItemWrite<CampaignPackageContent>>,
      writer: TransferApplyWriter,
    ): Promise<TransferApplyResult> {
      const firestore = deps.firestore()
      const actor = ctx.actorUid ?? ''
      const results: TransferRowResult[] = []
      for (const write of items) {
        const before = await writer.alreadyApplied(write.row)
        if (before) {
          results.push(before)
          continue
        }
        const incoming = campaignPackageContent(write.content)
        const content = { ...incoming, name: write.rename?.name ?? incoming.name }
        const problems = await campaignProblems(firestore, ctx.orgId, content)
        let result: TransferRowResult
        if (problems.length) {
          result = { row: write.row, outcome: 'failed', message: problems.join(' ') }
        } else {
          const nowMs = deps.now()
          const containerRef = orgEmailCampaigns(firestore, ctx.orgId).doc(write.targetId)
          result = await firestore.runTransaction(async (transaction): Promise<TransferRowResult> => {
            const current = await transaction.get(containerRef)
            if (write.decision === 'replace') {
              if (!current.exists || current.get('deletedAt')) {
                return { row: write.row, outcome: 'failed', recordId: write.targetId, message: 'That campaign no longer exists.' }
              }
              transaction.update(containerRef, containerFields(content))
              return { row: write.row, outcome: 'updated', recordId: write.targetId }
            }
            if (current.exists) {
              return { row: write.row, outcome: 'failed', recordId: write.targetId, message: 'A campaign with this id already exists.' }
            }
            transaction.create(containerRef, { ...containerFields(content), createdAtMs: nowMs, createdBy: actor })
            draftableCampaignEmails(content).forEach((email, index) => {
              transaction.create(orgCampaignSends(firestore, ctx.orgId).doc(importedEmailId(write.targetId, index)), {
                subject: email.subject,
                ...campaignSendSearchFields(email.subject),
                ...(email.preheader ? { preheader: email.preheader } : {}),
                templateScreenId: email.templateScreenId,
                ...(email.subjectVariants.length ? { subjectVariants: email.subjectVariants } : {}),
                ...(email.preheaderVariants.length ? { preheaderVariants: email.preheaderVariants } : {}),
                [CAMPAIGN_SEND_CONTAINER_FIELD]: write.targetId,
                ...campaignSendSiteStamp(email.hostId),
                status: 'draft',
                // Oldest first, as the package lists them, so a re-export reads them back in order.
                createdAtMs: nowMs + index,
                draftedAt: new Date(nowMs),
                draftedBy: actor,
              })
            })
            return { row: write.row, outcome: 'created', recordId: write.targetId }
          })
        }
        await writer.markApplied(result)
        results.push(result)
      }
      return { results, undo: [] }
    },

    async revertItems(
      ctx: TransferResourceContext,
      steps: ReadonlyArray<TransferPackageRevertStep<CampaignPackageContent>>,
    ): Promise<TransferPackageRevertResult> {
      const firestore = deps.firestore()
      const outcome: TransferPackageRevertResult = { done: [], refused: [] }
      for (const step of steps) {
        const containerRef = orgEmailCampaigns(firestore, ctx.orgId).doc(step.id)
        if (step.action === 'restore') {
          await containerRef.update(containerFields(campaignPackageContent(step.content)))
          outcome.done.push(step.id)
          continue
        }
        const sends = await orgCampaignSends(firestore, ctx.orgId).where(CAMPAIGN_SEND_CONTAINER_FIELD, '==', step.id).get()
        if (sends.docs.some((send) => send.get('status') !== 'draft')) {
          outcome.refused.push({ id: step.id, reason: 'An email in this campaign has been scheduled or sent since, so the campaign stays.' })
          continue
        }
        const batch = firestore.batch()
        for (const send of sends.docs) batch.delete(send.ref)
        batch.delete(containerRef)
        await batch.commit()
        outcome.done.push(step.id)
      }
      return outcome
    },
  }
}

