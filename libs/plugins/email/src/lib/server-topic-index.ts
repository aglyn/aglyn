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

import {
  mergeSubscriptionTopics,
  type SubscriptionTopic,
} from '@aglyn/aglyn/app-utils/subscription-topics'
import {
  registerPluginRecordIndex,
  type PluginIndexedRecord,
  type PluginRecordIndex,
  type PluginRecordIndexScope,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from './constants/bundle-common'
import { EMAIL_TOPICS_COLLECTION, emailTopicsFromDocs } from './model/email-topic-catalog'

type Firestore = FirebaseFirestore.Firestore

/**
 * AN ORG'S TOPIC CATALOG, for a plugin that does not keep it.
 *
 * A plugin that sends under a stream sometimes has to ask what the org made of
 * it — whether the org's newsletter asks for a confirmation click, what it is
 * called now — and the catalog is this plugin's storage. So it is published as
 * the `subscriptionTopic` record index and read through the core's seam, never
 * through the collection.
 *
 * The records are the catalog a reader sees: the streams the plugins declare,
 * overlaid by what the org stored, plus the org's own topics — archived ones
 * included, because a message already sent under a retired stream must go on
 * resolving to it. Each record's facts:
 *
 *  - `description`: the sentence the preference page shows;
 *  - `archived`: retired from pickers and the preference page;
 *  - `doubleOptIn`: present only when the org decided it for this stream —
 *    absent means "whatever the site says" (`topicRequiresDoubleOptIn`).
 *
 * Scoped by the organization, or by a site, which resolves to its org.
 */

/** The record kind another plugin asks for. */
export const SUBSCRIPTION_TOPIC_RECORD_KIND = 'subscriptionTopic'

/**
 * An org's catalog: the declared floor overlaid by what the org stored. An
 * empty org id answers the floor alone. A failed read throws; the caller
 * decides whether the floor is a safe answer.
 */
export async function readOrgTopicCatalog(
  firestore: Firestore,
  orgId: string,
): Promise<SubscriptionTopic[]> {
  if (!orgId) return mergeSubscriptionTopics(null)
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(EMAIL_TOPICS_COLLECTION)
    .get()
  return mergeSubscriptionTopics(emailTopicsFromDocs(snapshot?.docs ?? []))
}

function recordOf(topic: SubscriptionTopic): PluginIndexedRecord {
  return {
    id: topic.id,
    name: topic.name,
    facts: {
      description: topic.description,
      archived: topic.archived === true,
      ...(typeof topic.doubleOptIn === 'boolean'
        ? { doubleOptIn: topic.doubleOptIn }
        : {}),
    },
  }
}

export function createSubscriptionTopicIndex(
  firestore: () => Firestore,
): PluginRecordIndex {
  const catalog = async (scope: PluginRecordIndexScope) => {
    const orgId =
      String(scope.orgId ?? '').trim() ||
      (scope.hostId ? ((await resolveOrgIdForHost(scope.hostId)) ?? '') : '')
    return readOrgTopicCatalog(firestore(), orgId)
  }
  return {
    async list(request) {
      const topics = await catalog(request)
      const limit = Math.max(0, Math.floor(request.limit))
      return {
        records: topics.slice(0, limit).map(recordOf),
        truncated: topics.length > limit,
      }
    },
    async get(request) {
      const topic = (await catalog(request)).find((one) => one.id === request.id)
      return topic ? recordOf(topic) : null
    },
  }
}

/** Publishes the index; the plugin's API registrars call it. */
export function registerSubscriptionTopicIndex(firestore: () => Firestore): void {
  registerPluginRecordIndex(
    SUBSCRIPTION_TOPIC_RECORD_KIND,
    createSubscriptionTopicIndex(firestore),
    { pluginId: BUNDLE_ID },
  )
}
