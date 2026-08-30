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

/**
 * EMAIL TOPICS — the streams a recipient can leave one at a time.
 *
 * ## The gap this closes
 *
 * `docs/specs/email-competitive-gaps.md` §1f records the only row in that
 * table where every competitor has something and we have nothing: "Preference
 * center / subscription topics — unsubscribe is all-or-nothing per site".
 * A recipient who wanted the newsletter but not the sales mail had exactly one
 * lever, and pulling it took the newsletter too. The lever people reach for
 * when the only unsubscribe is total is "report spam", which is a complaint,
 * which is the sending domain's problem and therefore every tenant's.
 *
 * ## Scope: definitions are ORG-shared, opt-outs are PER-SITE
 *
 * The topic CATALOG lives at `orgs/{orgId}/emailTopics`, which is where
 * `lists` live (AGL-254) and for the same reason: a topic is authored
 * editorial content — a name and a sentence of description — that an agency
 * writes once and points several sites at. Following `lists` also means the
 * console surface that manages topics inherits a scoping question that has
 * already been answered, rather than inventing a second answer.
 *
 * A recipient's OPT-OUT is per site, at `hosts/{hostId}/topicOptOuts`. It sits
 * beside `hosts/{hostId}/suppressions`, which is per site, and it answers the
 * same shape of question one notch finer: the suppression says "nothing from
 * this site", the opt-out says "not this stream from this site". Two facts
 * about one person that live at different scopes would make "may I mail this
 * person about product updates" a question with two answers. It also keeps
 * the unauthenticated preference page honest — the signed link names a host
 * and nothing else, so a per-site read is exactly what the link authorizes.
 *
 * ## Why the defaults are code and not seeded documents
 *
 * Every tenant that exists today has an empty `emailTopics` collection. A
 * seeding migration would have to run against every org, would leave any org
 * created while it was mid-flight with none, and — like every backfill — is a
 * thing that gets written and then not run. So {@link DEFAULT_EMAIL_TOPICS} is
 * the floor of the catalog rather than its initial contents: it is present for
 * every org from the moment this ships, with no write anywhere, and a stored
 * document at the same id renames, re-describes or archives one. The catalog a
 * reader sees is {@link mergeEmailTopics} of the two.
 */

/** One subscribable stream. */
export interface EmailTopic {
  /**
   * The stored id. Rides in the unsubscribe link's `tid` and is covered by
   * its signature, so it is treated as persisted — rename the {@link name},
   * never the id.
   */
  id: string
  /** What the recipient sees on the preference page. */
  name: string
  /** One sentence of "what will I get", shown under the name. */
  description: string
  /**
   * Retired. An archived topic stays in the catalog for the send path and the
   * preference page's history, and is hidden from the composer's picker —
   * campaigns already sent under it must go on resolving, or their unsubscribe
   * links stop naming anything.
   */
  archived?: boolean
}

/** `orgs/{orgId}/emailTopics` — the catalog, org-shared like `lists`. */
export const EMAIL_TOPICS_COLLECTION = 'emailTopics'

/** `hosts/{hostId}/topicOptOuts/{emailKey}` — one document per recipient. */
export const TOPIC_OPT_OUTS_SUBCOLLECTION = 'topicOptOuts'

/**
 * The catalog every org has before anyone opens the console.
 *
 * Four, not twelve. A preference page whose value is "leave one stream without
 * leaving all of them" stops working the moment the list is long enough that
 * reading it is a chore, and a merchant who needs a fifth can add one. The ids
 * are the generic names an unsubscribing recipient can recognize without
 * knowing anything about the sender's internal vocabulary.
 */
export const DEFAULT_EMAIL_TOPICS: readonly EmailTopic[] = [
  {
    id: 'marketing',
    name: 'Promotions and offers',
    description: 'Sales, discounts and seasonal campaigns.',
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    description: 'Regular news and stories from us.',
  },
  {
    id: 'product-updates',
    name: 'Product updates',
    description: 'New products, restocks and changes to what we offer.',
  },
  {
    id: 'sales',
    name: 'Sales outreach',
    description: 'Messages from a person here about working together.',
  },
]

/**
 * The topic a campaign carries when its author picked none.
 *
 * Every campaign resolves to SOME topic, because a campaign with no topic
 * would mint an unsubscribe link the preference page cannot place — it could
 * offer the catalog but not say which entry this message was, which is the one
 * thing the recipient came to the page knowing.
 */
export const DEFAULT_CAMPAIGN_TOPIC_ID = 'marketing'

/**
 * Whether `value` may be a topic id.
 *
 * Two constraints, and the second is the load-bearing one. The id becomes a
 * Firestore path component, so it carries `isDocumentId`'s rules; and it
 * becomes a COLON-JOINED component of the unsubscribe link's signed subject,
 * so a colon inside it would let one signed subject be read as two different
 * parameter tuples. See `signatureMatches` in the email plugin's
 * `unsubscribe-link.ts` for what that ambiguity would buy.
 */
export function isEmailTopicId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    !value.includes('/') &&
    !value.includes(':') &&
    value !== '.' &&
    value !== '..' &&
    !/^__.*__$/.test(value)
  )
}

/** Coerces one stored document into a topic, or `null` if it is not one. */
export function normalizeEmailTopic(
  id: unknown,
  data: Record<string, unknown> | null | undefined,
): EmailTopic | null {
  if (!isEmailTopicId(id)) return null
  const name = String(data?.['name'] ?? '').trim()
  return {
    id,
    // A nameless stored document falls back to the id rather than rendering a
    // blank checkbox on the preference page. The console refuses to create
    // one; a restore or an API write is not bound by that.
    name: name || id,
    description: String(data?.['description'] ?? '').trim(),
    ...(data?.['archived'] === true ? { archived: true as const } : {}),
  }
}

/**
 * The catalog a reader sees: the built-in floor, overlaid by whatever the org
 * has stored, plus the org's own topics.
 *
 * Overlay rather than replace, so an org that adds one custom topic does not
 * thereby delete the four every one of its recipients has been unsubscribing
 * against. A built-in is removed by storing it `archived`, which is a
 * decision someone made rather than a side effect of making a different one.
 *
 * Sorted with the built-ins first in their declared order and custom topics
 * alphabetically after, so the preference page's checkbox order is stable
 * across renders and across sites.
 */
export function mergeEmailTopics(
  stored: readonly EmailTopic[] | null | undefined,
): EmailTopic[] {
  const overrides = new Map<string, EmailTopic>()
  for (const topic of stored ?? []) {
    if (isEmailTopicId(topic?.id)) overrides.set(topic.id, topic)
  }
  const builtIn = DEFAULT_EMAIL_TOPICS.map(
    (topic) => overrides.get(topic.id) ?? topic,
  )
  const custom = [...overrides.values()]
    .filter((topic) => !DEFAULT_EMAIL_TOPICS.some((it) => it.id === topic.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...builtIn, ...custom]
}

/**
 * The catalog minus retired topics — what a composer's picker and a
 * preference page's checkboxes offer.
 *
 * The send path deliberately does NOT filter through this: a scheduled
 * campaign whose topic was archived between scheduling and sending still
 * belongs to that topic, and re-pointing it at something else would attribute
 * the unsubscribes to the wrong stream.
 */
export function activeEmailTopics(
  topics: readonly EmailTopic[],
): EmailTopic[] {
  return topics.filter((topic) => !topic.archived)
}

/**
 * The topic a campaign belongs to, given what it stored and what the org
 * offers.
 *
 * Resolves an unknown or missing id to the default rather than to nothing: a
 * campaign sent before topics existed carries no `topicId`, and its
 * unsubscribe links are in inboxes right now. They must land on a preference
 * page that names A topic, not on one that says the message came from
 * nowhere.
 */
export function resolveCampaignTopic(
  topicId: string | null | undefined,
  topics: readonly EmailTopic[],
): EmailTopic {
  const found = topicId
    ? topics.find((topic) => topic.id === topicId)
    : undefined
  if (found) return found
  return (
    topics.find((topic) => topic.id === DEFAULT_CAMPAIGN_TOPIC_ID) ??
    topics[0] ?? {
      id: DEFAULT_CAMPAIGN_TOPIC_ID,
      name: 'Email',
      description: '',
    }
  )
}
