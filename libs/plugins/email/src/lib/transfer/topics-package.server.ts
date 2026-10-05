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
 * EMAIL TOPICS IN A WORKSPACE PACKAGE — the server half (AGL-3550).
 *
 * Written the way the topic's own page saves one: `emailTopicDocument`,
 * merged into `orgs/{orgId}/emailTopics/{topicId}` — the document
 * `writeEmailTopic` stores — so a built-in replaced by an import is an
 * override at the built-in's id, exactly as one renamed in the console is.
 * Only that document is ever written: no opt-out, no confirmation, nothing
 * under a site.
 *
 * Undo puts a replaced topic back. A topic the import added is retired
 * rather than deleted, for the reason the console has no delete: an email
 * sent under it in the meantime carries its id in an unsubscribe link, and
 * that link has to go on naming something.
 *=========================================*/

import {
  DECLARED_SUBSCRIPTION_TOPICS,
  mergeSubscriptionTopics,
} from '@aglyn/aglyn/app-utils/subscription-topics'
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
import { FieldValue } from 'firebase-admin/firestore'
import { EMAIL_TOPICS_COLLECTION, emailTopicDocument, emailTopicsFromDocs } from '../model/email-topic-catalog'
import {
  EMAIL_TOPICS_TRANSFER_KEY,
  emailTopicPackageContent,
  emailTopicPackageItem,
  emailTopicPackageProblems,
  type EmailTopicPackageContent,
} from './topics-package'

type Firestore = FirebaseFirestore.Firestore

export interface EmailTopicsPackageDeps {
  firestore(): Firestore
  /** What clears a field in a merged write (`FieldValue.delete()`). */
  deleteField(): unknown
}

function defaultDeps(): EmailTopicsPackageDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore() as unknown as Firestore,
    deleteField: () => FieldValue.delete(),
  }
}

const topicsOf = (firestore: Firestore, orgId: string) =>
  firestore.collection('orgs').doc(orgId).collection(EMAIL_TOPICS_COLLECTION)

const isBuiltIn = (id: string) => DECLARED_SUBSCRIPTION_TOPICS.some((topic) => topic.id === id)

/** The catalog as every reader sees it — the built-ins overlaid by what is stored, then the org's own. */
async function readAll(
  deps: EmailTopicsPackageDeps,
  orgId: string,
  ids?: readonly string[],
): Promise<Array<TransferPackageItemContent<EmailTopicPackageContent>>> {
  const stored = await topicsOf(deps.firestore(), orgId).get()
  const catalog = mergeSubscriptionTopics(emailTopicsFromDocs(stored.docs))
  const wanted = ids ? new Set(ids) : null
  return catalog.filter((topic) => !wanted || wanted.has(topic.id)).map(emailTopicPackageItem)
}

export function createEmailTopicsPackage(deps: EmailTopicsPackageDeps = defaultDeps()) {
  /** The complete statement of a topic, `null` confirmation cleared back to the site's setting. */
  const documentOf = (content: EmailTopicPackageContent) => emailTopicDocument(content, deps.deleteField())

  return {
    async items(ctx: TransferResourceContext): Promise<ExistingPackageItem[]> {
      return existingPackageItemsOf(EMAIL_TOPICS_TRANSFER_KEY, await readAll(deps, ctx.orgId))
    },

    async readItems(ctx: TransferResourceContext, ids: readonly string[]) {
      return readAll(deps, ctx.orgId, ids)
    },

    problems(_ctx: TransferResourceContext, write: TransferPackageItemWrite<EmailTopicPackageContent>) {
      const content = emailTopicPackageContent(write.content)
      return emailTopicPackageProblems({ ...content, name: write.rename?.name ?? content.name }, write.targetId)
    },

    async writeItems(
      ctx: TransferResourceContext,
      items: ReadonlyArray<TransferPackageItemWrite<EmailTopicPackageContent>>,
      writer: TransferApplyWriter,
    ): Promise<TransferApplyResult> {
      const firestore = deps.firestore()
      const topics = topicsOf(firestore, ctx.orgId)
      const results: TransferRowResult[] = []
      for (const write of items) {
        const before = await writer.alreadyApplied(write.row)
        if (before) {
          results.push(before)
          continue
        }
        const incoming = emailTopicPackageContent(write.content)
        const content = { ...incoming, name: write.rename?.name ?? incoming.name }
        const problems = emailTopicPackageProblems(content, write.targetId)
        let result: TransferRowResult
        if (problems.length) {
          result = { row: write.row, outcome: 'failed', message: problems.join(' ') }
        } else {
          const ref = topics.doc(write.targetId)
          result = await firestore.runTransaction(async (transaction): Promise<TransferRowResult> => {
            const current = await transaction.get(ref)
            // A built-in is in the catalog with no document at all, so it exists either way.
            const held = current.exists || isBuiltIn(write.targetId)
            if (write.decision === 'replace') {
              if (!held) return { row: write.row, outcome: 'failed', recordId: write.targetId, message: 'That topic no longer exists.' }
              transaction.set(ref, documentOf(content), { merge: true })
              return { row: write.row, outcome: 'updated', recordId: write.targetId }
            }
            if (held) {
              return { row: write.row, outcome: 'failed', recordId: write.targetId, message: 'A topic with this id already exists.' }
            }
            transaction.create(ref, documentOf(content))
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
      steps: ReadonlyArray<TransferPackageRevertStep<EmailTopicPackageContent>>,
    ): Promise<TransferPackageRevertResult> {
      const topics = topicsOf(deps.firestore(), ctx.orgId)
      const outcome: TransferPackageRevertResult = { done: [], refused: [] }
      for (const step of steps) {
        const ref = topics.doc(step.id)
        if (step.action === 'restore') {
          const previous = emailTopicPackageContent(step.content)
          const builtIn = DECLARED_SUBSCRIPTION_TOPICS.find((topic) => topic.id === step.id)
          const asDeclared =
            builtIn &&
            previous.name === builtIn.name &&
            previous.description === builtIn.description &&
            !previous.archived &&
            previous.doubleOptIn === null
          // A built-in nobody had changed held no document, and goes back to holding none.
          if (asDeclared) await ref.delete()
          else await ref.set(documentOf(previous), { merge: true })
          outcome.done.push(step.id)
          continue
        }
        const current = await ref.get()
        if (current.exists) await ref.set({ archived: true }, { merge: true })
        outcome.done.push(step.id)
      }
      return outcome
    },
  }
}
