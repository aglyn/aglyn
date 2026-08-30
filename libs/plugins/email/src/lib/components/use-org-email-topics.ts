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
import type { Firestore } from 'firebase/firestore'
import { collection, doc, limit, orderBy, query, setDoc } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'

/**
 * Write one topic's document — the ONE writer of the topic catalog.
 *
 * Two surfaces change a topic: its own page, which edits the name and the
 * description, and the list card's row menu, which retires and restores. They
 * write the same document and have to agree about its shape, so the write
 * lives here rather than once in each.
 *
 * ## Why it is a complete statement and not a patch
 *
 * `archived` is written on every save rather than only when it changes. A
 * merge that omitted it would leave a restored topic carrying `archived: true`
 * from an earlier save — which reads on screen as restored and behaves as
 * retired, because the composer's picker and the recipient's preference page
 * both read the stored flag.
 *
 * ## Why a built-in saves the same way
 *
 * `DEFAULT_EMAIL_TOPICS` is the FLOOR of the catalog, not its initial
 * contents: the four built-ins have no stored document until somebody changes
 * one. `setDoc` at the built-in's own id is what creates the override, so the
 * same call serves a custom topic and a built-in being retired for the first
 * time.
 */
export async function writeEmailTopic(
  firestore: Firestore,
  scope: readonly [string, string],
  topic: { id: string; name: string; description: string; archived: boolean },
): Promise<void> {
  await setDoc(
    doc(firestore, scope[0], scope[1], EMAIL_TOPICS_COLLECTION, topic.id),
    {
      name: topic.name,
      description: topic.description,
      archived: topic.archived,
    },
    { merge: true },
  )
}

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
