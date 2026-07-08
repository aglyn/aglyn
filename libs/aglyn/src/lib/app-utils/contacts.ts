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
 * Contacts CRM v1 (AGL-197): one contact per normalized email per host,
 * fed by the four existing capture silos (forms, members, orders,
 * bookings). Pure data module — the admin-SDK upsert lives in
 * `@aglyn/tenant-data-admin` (`upsertHostContact`) and the console reads
 * client-side under the host-admin rules.
 */

export type ContactSource = 'form' | 'member' | 'order' | 'booking'

export interface ContactInteraction {
  type: ContactSource
  /** Source doc id (formSubmissions/siteMembers/orders/bookings). */
  refId?: string
  /** Epoch millis — Timestamps don't serialize into arrays cleanly. */
  atMs: number
  summary?: string
}

/** `hosts/{hostId}/contacts/{contactId}` doc shape. */
export interface HostContact {
  /** Normalized (trimmed, lowercased) email — the dedupe key. */
  email: string
  name?: string
  sources: Partial<Record<ContactSource, true>>
  /** Newest-first, capped — the profile timeline. */
  interactions: ContactInteraction[]
  tags?: string[]
  notes?: string
}

/** Timeline cap: keeps the doc small; older interactions age out. */
export const CONTACT_INTERACTIONS_CAP = 50

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Normalized dedupe key, or null when the input isn't a usable email. */
export function normalizeContactEmail(input: unknown): string | null {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

/**
 * First usable email in a free-form form-submission fields map — forms
 * don't guarantee a canonical email field, so prefer keys that look like
 * email fields before falling back to any email-shaped value.
 */
export function extractEmailFromFields(
  fields: Record<string, unknown> | null | undefined,
): string | null {
  const entries = Object.entries(fields ?? {})
  const preferred = entries.find(([key]) => /email/i.test(key))
  const fromPreferred = normalizeContactEmail(preferred?.[1])
  if (fromPreferred) return fromPreferred
  for (const [, value] of entries) {
    const email = normalizeContactEmail(value)
    if (email) return email
  }
  return null
}

/**
 * Merges a new interaction into a contact: source flag set, interaction
 * prepended, timeline capped. Pure — the caller persists the result.
 */
export function mergeContactInteraction(
  existing: Pick<HostContact, 'sources' | 'interactions'> & {
    name?: string
  },
  update: { source: ContactSource; interaction: ContactInteraction; name?: string },
): Pick<HostContact, 'sources' | 'interactions'> & { name?: string } {
  return {
    // Existing names win — a later anonymous form shouldn't blank a name.
    name: existing.name || update.name,
    sources: { ...existing.sources, [update.source]: true as const },
    interactions: [update.interaction, ...(existing.interactions ?? [])].slice(
      0,
      CONTACT_INTERACTIONS_CAP,
    ),
  }
}

/** `hosts/{hostId}/contactSegments/{id}` — a saved audience filter. */
export interface ContactSegment {
  name: string
  /** Match contacts sharing at least one tag (empty = any). */
  tags?: string[]
  /** Match contacts with at least one of these sources (empty = any). */
  sources?: ContactSource[]
}

/** Segment matching (AGL-199): AND across filter kinds, OR within one. */
export function contactMatchesSegment(
  contact: Pick<HostContact, 'tags' | 'sources'>,
  segment: Pick<ContactSegment, 'tags' | 'sources'>,
): boolean {
  if (segment.tags?.length) {
    const contactTags = new Set(
      (contact.tags ?? []).map((tag) => tag.toLowerCase()),
    )
    if (!segment.tags.some((tag) => contactTags.has(tag.toLowerCase()))) {
      return false
    }
  }
  if (segment.sources?.length) {
    if (!segment.sources.some((source) => contact.sources?.[source])) {
      return false
    }
  }
  return true
}
