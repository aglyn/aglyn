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
'use client'

import {
  EMAIL_TOPICS_COLLECTION,
  mergeEmailTopics,
  normalizeEmailTopic,
  type EmailTopic,
} from '@aglyn/aglyn'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'

/**
 * How many stored topics one read fetches.
 *
 * A ceiling on the READ, not on the catalog. A preference page stops being a
 * preference page somewhere well before two hundred checkboxes, so an org that
 * reaches this has a different problem than a truncated list — and the read is
 * ordered, so what a merchant past it loses is the tail of the alphabet rather
 * than an arbitrary sample.
 */
const TOPIC_READ_CEILING = 200

/**
 * The org's email topic catalog, as both the console card and the composer's
 * picker read it.
 *
 * ONE hook for both surfaces, because they have to agree: a topic the composer
 * offers must be one the preference page can render, and a topic the card
 * archives must leave the picker. Two reads of the same collection with two
 * different merge rules is how the composer comes to send a campaign under a
 * topic nobody can unsubscribe from.
 *
 * ORG-scoped, following `lists` (AGL-254) — see `email-topics.ts` for why the
 * definitions are org-shared while the recipient's opt-outs are per site.
 *
 * Ordered by the server rather than capped and re-sorted here (AGL-2501,
 * AGL-2292). `name` is safe to order on because every writer of this
 * collection is the topics card, which refuses to save a nameless topic —
 * `orderBy` DROPS documents that lack the field rather than mis-sorting them,
 * so that claim is about the writers and not a preference.
 */
export function useOrgEmailTopics(hostId: string): {
  topics: EmailTopic[]
  /** `['orgs', orgId]`, or null until the org lookup settles. */
  scope: readonly [string, string] | null
} {
  const firestore = useFirestore()
  // The org lookup is async (AGL-1061): null until it settles, and null
  // forever for a host with no owning org.
  const { scope } = useOrgDataScope({ hostId })
  const { data: stored } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      scope
        ? query(
            collection(firestore, scope[0], scope[1], EMAIL_TOPICS_COLLECTION),
            orderBy('name'),
            limit(TOPIC_READ_CEILING),
          )
        : null,
    [firestore, scope],
    { idField: '$id' },
  )
  const topics = useMemo(
    () =>
      mergeEmailTopics(
        (stored ?? [])
          .map((doc) => normalizeEmailTopic(String(doc['$id'] ?? ''), doc))
          .filter((topic): topic is EmailTopic => !!topic),
      ),
    [stored],
  )
  return { topics, scope: scope as readonly [string, string] | null }
}
