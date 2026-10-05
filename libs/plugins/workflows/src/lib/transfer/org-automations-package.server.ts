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
 * ORG AUTOMATIONS IN A WORKSPACE PACKAGE — the server half (AGL-3535).
 *
 * Written through `automations/manage`'s own writes
 * (`createOrgAutomationRecord`, `updateOrgAutomationRecord`,
 * `deleteOrgAutomationRecord`): its reader, its placement check, its cap,
 * its soft delete and its activity lines. The importer is held to that
 * door's rules too — an org-wide owner, admin or editor, in a workspace
 * running Workflows on a plan with org automations — so an import can do
 * nothing that door would refuse. A new automation lands switched off; a
 * replaced one keeps whether it was on.
 *=========================================*/

import { DECLARED_SUBSCRIPTION_TOPICS } from '@aglyn/aglyn/app-utils/subscription-topics'
import { existingPackageItemsOf, type ExistingPackageItem, type TransferReferenceKind, type TransferRowResult } from '@aglyn/aglyn/data-transfer'
import { isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import type {
  TransferApplyResult,
  TransferApplyWriter,
  TransferPackageItemContent,
  TransferPackageItemWrite,
  TransferPackageRevertResult,
  TransferPackageRevertStep,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { checkEntitlement, isOrgWideMember, planLabelGrantingFeature } from '@aglyn/aglyn/server'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getOrgDoc, logOrgActivity, resolveOrgMembership } from '@aglyn/tenant-data-admin/server/organizations'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  ORG_AUTOMATION_ACTIVITY_TARGET,
  ORG_AUTOMATIONS_COLLECTION,
  ORG_AUTOMATIONS_MAX,
  readOrgAutomation,
} from '../model/org-automations'
import {
  createOrgAutomationRecord,
  deleteOrgAutomationRecord,
  updateOrgAutomationRecord,
} from '../server/org-automations-routes'
import {
  ORG_AUTOMATION_REFERENCE_KINDS,
  ORG_AUTOMATIONS_TRANSFER_KEY,
  orgAutomationPackageContent,
  rawOrgAutomationContent,
  type OrgAutomationPackageContent,
} from './org-automations-package'

type Firestore = FirebaseFirestore.Firestore

export interface OrgAutomationsPackageDeps {
  firestore(): Firestore
  readOrg(orgId: string): Promise<Record<string, unknown> | null>
  memberOf(uid: string, orgId: string): Promise<Record<string, unknown> | null>
  logOrgActivity(orgId: string, uid: string, action: string, target: { id: string; name: string }): Promise<void>
}

function defaultDeps(): OrgAutomationsPackageDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore() as unknown as Firestore,
    readOrg: async (orgId) => ((await getOrgDoc(orgId)) as Record<string, unknown> | null) ?? null,
    memberOf: async (uid, orgId) => ((await resolveOrgMembership(uid, orgId))?.member as Record<string, unknown> | undefined) ?? null,
    logOrgActivity: (orgId, uid, action, target) =>
      logOrgActivity(orgId, { uid, email: null }, action, { type: ORG_AUTOMATION_ACTIVITY_TARGET, ...target }),
  }
}

const automationsOf = (firestore: Firestore, orgId: string) =>
  firestore.collection('orgs').doc(orgId).collection(ORG_AUTOMATIONS_COLLECTION)

/** Why `automations/manage` would refuse this importer, or `null` when it would not. */
async function importerRefusal(deps: OrgAutomationsPackageDeps, ctx: TransferResourceContext): Promise<string | null> {
  if (!ctx.actorUid) return 'Org automations are imported by a member of the organization.'
  const member = await deps.memberOf(ctx.actorUid, ctx.orgId)
  if (!member || !isOrgWideMember(member as never) || !['owner', 'admin', 'editor'].includes(String(member['role'] ?? ''))) {
    return 'Org automations are written by an organization owner, admin or editor.'
  }
  const org = await deps.readOrg(ctx.orgId)
  if (!org || !isPluginEnabled(org as never, BUNDLE_ID)) return 'Workflows is not on for this workspace.'
  if (!checkEntitlement(org as never, 'actions')) {
    return `Org automations need the ${planLabelGrantingFeature('actions') ?? 'Pro'} plan.`
  }
  return null
}

async function readAll(
  deps: OrgAutomationsPackageDeps,
  orgId: string,
  ids?: readonly string[],
): Promise<Array<TransferPackageItemContent<OrgAutomationPackageContent>>> {
  const collection = automationsOf(deps.firestore(), orgId)
  const docs = ids
    ? (await Promise.all(ids.map((id) => collection.doc(id).get()))).filter((doc) => doc.exists)
    : (await collection.where('deletedAt', '==', null).get()).docs
  return docs.flatMap((doc) => {
    if (doc.get('deletedAt')) return []
    const content = orgAutomationPackageContent(doc.data())
    return content ? [{ kind: ORG_AUTOMATIONS_TRANSFER_KEY, id: doc.id, name: content.name, content }] : []
  })
}

/** The fields one write stores: the content, read by the route's reader, switched on only if it already was. */
function fieldsOf(content: OrgAutomationPackageContent, name: string, enabled: boolean) {
  return readOrgAutomation({ ...content, name, enabled })
}

export function createOrgAutomationsPackage(deps: OrgAutomationsPackageDeps = defaultDeps()) {
  /** Whether the automation is on now; a new one is off. */
  const enabledNow = async (orgId: string, id: string) =>
    (await automationsOf(deps.firestore(), orgId).doc(id).get()).get('enabled') === true

  return {
    async items(ctx: TransferResourceContext): Promise<ExistingPackageItem[]> {
      return existingPackageItemsOf(ORG_AUTOMATIONS_TRANSFER_KEY, await readAll(deps, ctx.orgId))
    },

    async readItems(ctx: TransferResourceContext, ids: readonly string[]) {
      return readAll(deps, ctx.orgId, ids)
    },

    async problems(ctx: TransferResourceContext, write: TransferPackageItemWrite<OrgAutomationPackageContent>) {
      const refusal = await importerRefusal(deps, ctx)
      if (refusal) return [refusal]
      const content = rawOrgAutomationContent(write.content)
      const read = fieldsOf(content, write.rename?.name ?? content.name, false)
      if (read.ok === false) return [read.problem]
      const problems: string[] = []
      if (write.decision !== 'replace') {
        const collection = automationsOf(deps.firestore(), ctx.orgId)
        if ((await collection.doc(write.targetId).get()).exists) {
          problems.push('An automation with this id was deleted from this workspace, so it cannot come back under it.')
        }
        const live = (await collection.where('deletedAt', '==', null).count().get()).data().count
        if (live >= ORG_AUTOMATIONS_MAX) {
          problems.push(`An organization holds at most ${ORG_AUTOMATIONS_MAX} org automations — delete one you no longer use first.`)
        }
      }
      return problems
    },

    async referenceTargets(ctx: TransferResourceContext, kinds: readonly string[]): Promise<TransferReferenceKind[]> {
      const org = deps.firestore().collection('orgs').doc(ctx.orgId)
      const named = async (collection: string, field: string) =>
        (await org.collection(collection).get()).docs
          .filter((doc) => !doc.get('deletedAt'))
          .map((doc) => {
            const name = String(doc.get(field) ?? doc.get('label') ?? '').trim()
            return { id: doc.id, ...(name ? { name } : {}) }
          })
      const answers: TransferReferenceKind[] = []
      if (kinds.includes(ORG_AUTOMATION_REFERENCE_KINDS.list)) {
        answers.push({ kind: ORG_AUTOMATION_REFERENCE_KINDS.list, label: 'Email list', targets: await named('lists', 'name') })
      }
      if (kinds.includes(ORG_AUTOMATION_REFERENCE_KINDS.topic)) {
        // Asked only when the email plugin, which owns the topic catalog and answers `email.topics`
        // (AGL-3550), is not running here — and without it the catalog is the built-ins the plugins declare.
        const targets = DECLARED_SUBSCRIPTION_TOPICS.map((topic) => ({ id: topic.id, name: topic.name }))
        answers.push({ kind: ORG_AUTOMATION_REFERENCE_KINDS.topic, label: 'Subscription topic', targets })
      }
      if (kinds.includes(ORG_AUTOMATION_REFERENCE_KINDS.member)) {
        answers.push({ kind: ORG_AUTOMATION_REFERENCE_KINDS.member, label: 'Member', targets: await named('members', 'email') })
      }
      if (kinds.includes(ORG_AUTOMATION_REFERENCE_KINDS.dataset)) {
        answers.push({ kind: ORG_AUTOMATION_REFERENCE_KINDS.dataset, label: 'Dataset', targets: await named('datasets', 'name') })
      }
      return answers
    },

    async writeItems(
      ctx: TransferResourceContext,
      items: ReadonlyArray<TransferPackageItemWrite<OrgAutomationPackageContent>>,
      writer: TransferApplyWriter,
    ): Promise<TransferApplyResult> {
      const refusal = await importerRefusal(deps, ctx)
      const firestore = deps.firestore()
      const results: TransferRowResult[] = []
      for (const write of items) {
        const before = await writer.alreadyApplied(write.row)
        if (before) {
          results.push(before)
          continue
        }
        const content = rawOrgAutomationContent(write.content)
        const name = write.rename?.name ?? content.name
        const replacing = write.decision === 'replace'
        const read = fieldsOf(content, name, replacing ? await enabledNow(ctx.orgId, write.targetId) : false)
        let result: TransferRowResult
        if (refusal) result = { row: write.row, outcome: 'failed', message: refusal }
        else if (read.ok === false) result = { row: write.row, outcome: 'failed', message: read.problem }
        else {
          const input = { orgId: ctx.orgId, id: write.targetId, fields: read.value, actorUid: ctx.actorUid ?? '' }
          const written = replacing ? await updateOrgAutomationRecord(firestore, input) : await createOrgAutomationRecord(firestore, input)
          if (written.ok === false) result = { row: write.row, outcome: 'failed', recordId: write.targetId, message: written.error }
          else {
            await deps.logOrgActivity(ctx.orgId, ctx.actorUid ?? '', replacing ? 'Edited an org automation' : 'Created an org automation', {
              id: written.id,
              name: read.value.name,
            })
            result = { row: write.row, outcome: replacing ? 'updated' : 'created', recordId: written.id }
          }
        }
        await writer.markApplied(result)
        results.push(result)
      }
      return { results, undo: [] }
    },

    async revertItems(
      ctx: TransferResourceContext,
      steps: ReadonlyArray<TransferPackageRevertStep<OrgAutomationPackageContent>>,
    ): Promise<TransferPackageRevertResult> {
      const firestore = deps.firestore()
      const outcome: TransferPackageRevertResult = { done: [], refused: [] }
      for (const step of steps) {
        if (step.action === 'delete') {
          const deleted = await deleteOrgAutomationRecord(firestore, { orgId: ctx.orgId, id: step.id, actorUid: ctx.actorUid ?? '' })
          if (deleted && !deleted.again) {
            await deps.logOrgActivity(ctx.orgId, ctx.actorUid ?? '', 'Deleted an org automation', { id: step.id, name: deleted.name })
          }
          outcome.done.push(step.id)
          continue
        }
        const content = rawOrgAutomationContent(step.content)
        const read = fieldsOf(content, content.name, await enabledNow(ctx.orgId, step.id))
        if (read.ok === false) {
          outcome.refused.push({ id: step.id, reason: read.problem })
          continue
        }
        const written = await updateOrgAutomationRecord(firestore, { orgId: ctx.orgId, id: step.id, fields: read.value, actorUid: ctx.actorUid ?? '' })
        if (written.ok === false) outcome.refused.push({ id: step.id, reason: written.error })
        else outcome.done.push(step.id)
      }
      return outcome
    },
  }
}
