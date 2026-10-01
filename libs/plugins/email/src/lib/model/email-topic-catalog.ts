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
  normalizeSubscriptionTopic,
  type SubscriptionTopic,
} from '@aglyn/aglyn/app-utils/subscription-topics'

/**
 * THE TOPIC CATALOG AN ORG AUTHORS — this plugin's storage.
 *
 * The streams themselves, what a recipient's opt-out means and how a send
 * honors it are the mail rail's (`app-utils/subscription-topics.ts`), and the
 * built-in streams are declared by the plugins that send under them. What an
 * org writes — a built-in renamed, re-described, archived or confirmed, and
 * the topics it adds of its own — is stored here, one document per topic, at
 * `orgs/{orgId}/emailTopics/{topicId}`, org-shared like `lists`. Another
 * plugin that needs an org's catalog asks the `subscriptionTopic` record
 * index this plugin publishes, never the collection.
 */

/** `orgs/{orgId}/emailTopics` — the catalog, org-shared like `lists`. */
export const EMAIL_TOPICS_COLLECTION = 'emailTopics'

/** The stored documents as topics, skipping any that is not one. */
export function emailTopicsFromDocs(
  docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> | undefined }>,
): SubscriptionTopic[] {
  return docs
    .map((doc) => normalizeSubscriptionTopic(doc.id, doc.data() ?? null))
    .filter((topic): topic is SubscriptionTopic => !!topic)
}
