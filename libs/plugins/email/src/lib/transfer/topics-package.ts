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
 * EMAIL TOPICS AS PACKAGE ITEMS (AGL-3550).
 *
 * A topic is a handful of words edited in place — its name, what a
 * recipient is told they get, whether it is retired, and whether joining
 * it needs a confirmation click — so it travels as a package item rather
 * than as records. What a person chose about a topic (an opt-out, a
 * pending confirmation) is theirs and per site, and never in a package.
 *
 * The catalog an item is read from is the one every reader sees
 * (`mergeSubscriptionTopics`): the built-in topics are in it whether or
 * not anybody changed one, so a campaign or an automation that names a
 * built-in always finds it, and a built-in exported unchanged imports as
 * the same.
 *
 * A topic names nothing. What names a topic — a campaign, an org
 * automation step — declares it as an `email.topics` dependency, so a
 * kept-both copy is what those items in the same package point at.
 *
 * Pure: the server half (`topics-package.server.ts`) reads and writes.
 *=========================================*/

import { isSubscriptionTopicId, type SubscriptionTopic } from '@aglyn/aglyn/app-utils/subscription-topics'
import type { PackageDependency } from '@aglyn/aglyn/data-transfer/package'

/** The resource key, and so the kind every topic item carries — the kind campaigns and automations already name. */
export const EMAIL_TOPICS_TRANSFER_KEY = 'email.topics'

/** A topic as a package carries it. */
export interface EmailTopicPackageContent {
  name: string
  description: string
  archived: boolean
  /** The topic's own confirmation setting, or `null` for "whatever the site says". */
  doubleOptIn: boolean | null
}

/** A topic's package content from the catalog, a stored document or an incoming item. */
export function emailTopicPackageContent(source: unknown): EmailTopicPackageContent {
  const raw = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
  return {
    name: typeof raw['name'] === 'string' ? raw['name'].trim() : '',
    description: typeof raw['description'] === 'string' ? raw['description'].trim() : '',
    archived: raw['archived'] === true,
    doubleOptIn: typeof raw['doubleOptIn'] === 'boolean' ? raw['doubleOptIn'] : null,
  }
}

/** A topic of the merged catalog as a package item. */
export function emailTopicPackageItem(topic: SubscriptionTopic) {
  const content = emailTopicPackageContent(topic)
  return { kind: EMAIL_TOPICS_TRANSFER_KEY, id: topic.id, name: content.name, content }
}

/** A topic names nothing another item could carry. */
export function emailTopicDependencies(): PackageDependency[] {
  return []
}

/** Nothing in a topic is a reference, so it travels as it is. */
export function remapEmailTopicIds(content: EmailTopicPackageContent): EmailTopicPackageContent {
  return content
}

/** Why one topic cannot be written under `id`, each a sentence. */
export function emailTopicPackageProblems(content: EmailTopicPackageContent, id: string): string[] {
  const problems: string[] = []
  if (!content.name) problems.push('Name the topic.')
  // The id is signed into every unsubscribe link the topic mints; one the send path refuses could never be sent under.
  if (!isSubscriptionTopicId(id)) problems.push('This topic’s id cannot be used in an unsubscribe link.')
  return problems
}

export const EMAIL_TOPIC_PACKAGE_RULES = [
  {
    id: 'no-subscriptions',
    label: 'Nobody is signed up',
    reason:
      'A package carries what a topic is called and what it promises, never who chose it. Importing one writes no subscription, asks nobody to confirm and sends no email.',
  },
  {
    id: 'choices-stay',
    label: 'Everyone’s choices stay as they are',
    reason:
      'Replacing a topic keeps its id, so every opt-out, confirmation and unsubscribe link already sent keeps pointing at it. Who left a topic, on which site, is never in a package and never changed by one.',
  },
  {
    id: 'retire',
    label: 'Undo retires a topic, never deletes it',
    reason:
      'An email sent under a topic carries its id in the unsubscribe link, so a topic is never removed. Undoing an import retires a topic it added, which takes it out of the composer and the preference page.',
  },
] as const
