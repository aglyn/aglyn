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

import * as Aglyn from '@aglyn/aglyn'
import type {
  AglynPostalAddress,
  ConsentGroup,
  ContactInteraction,
  ContactLifecycleStage,
  ContactSource,
} from '@aglyn/aglyn'

/**
 * One contact, as the VIEWING GROUP may see it (AGL-2596).
 *
 * A contact document is shared by every site in the org, and almost nothing
 * on it is legitimately shared: the notes, tags, timeline, profile and
 * commercial figures are the holder's own records and live in that holder's
 * facet. This is the row after the facet read — flat, so the list, the
 * record page and the export can render fields by name without any of them
 * reaching into `facets.{groupId}` for itself. One projection rather than a
 * facet read at every field is what keeps a surface from ever showing
 * another holder's records: there is no field on this shape that came from
 * the top of the document except the two that ARE shared, the address and
 * the canonical name.
 */
export interface ContactRecord {
  $id: string
  /** The shared identity and the dedupe key. */
  email: string
  /** What THIS holder sees — their own override, or the canonical name. */
  name: string
  /** The canonical name: the identity of last resort, shared by every holder. */
  canonicalName: string
  /** This holder's own name for the person, when they have set one. */
  nameOverride: string
  sources: Partial<Record<ContactSource, true>>
  /** This holder's timeline, narrowed to the sites the group covers. */
  interactions: ContactInteraction[]
  tags: string[]
  notes: string
  campaignIds: string[]
  ltvCents: number
  ordersCount: number
  phone: string
  jobTitle: string
  companyName: string
  companyId: string
  address: AglynPostalAddress | null
  /** This holder's custom field values, keyed by definition key (AGL-2601). */
  custom?: Record<string, Aglyn.ContactCustomValue>
  ownerUid: string
  /** Empty when the holder has not placed the person in the funnel. */
  lifecycleStage: ContactLifecycleStage | ''
  /**
   * When the person last opened or clicked one of this holder's campaigns
   * (AGL-2616), or `null` when they never have since the stamp shipped.
   */
  lastEmailEngagementAtMs: number | null
  createdAt?: unknown
  updatedAt?: unknown
}

/** A document off the wire, flattened through one group's facet. */
export function contactRecordFromDoc(
  row: Record<string, any>,
  group: ConsentGroup,
): ContactRecord {
  const facet = Aglyn.readContactFacet(row, group.groupId)
  return {
    $id: String(row['$id'] ?? ''),
    email: typeof row['email'] === 'string' ? row['email'] : '',
    name: Aglyn.contactDisplayName(row, group.groupId),
    canonicalName: typeof row['name'] === 'string' ? row['name'] : '',
    nameOverride: facet.name ?? '',
    sources: facet.sources,
    interactions: Aglyn.interactionsForGroup(facet.interactions, group.hostIds),
    tags: facet.tags ?? [],
    notes: facet.notes ?? '',
    campaignIds: Aglyn.readContactCampaignIds(row, group.groupId),
    ltvCents: facet.ltvCents ?? 0,
    ordersCount: facet.ordersCount ?? 0,
    phone: facet.phone ?? '',
    jobTitle: facet.jobTitle ?? '',
    companyName: facet.companyName ?? '',
    companyId: facet.companyId ?? '',
    address: facet.address ?? null,
    custom: facet.custom ?? {},
    ownerUid: facet.ownerUid ?? '',
    lifecycleStage: Aglyn.isContactLifecycleStage(facet.lifecycleStage)
      ? facet.lifecycleStage
      : '',
    lastEmailEngagementAtMs:
      typeof facet.lastEmailEngagementAtMs === 'number' &&
      Number.isFinite(facet.lastEmailEngagementAtMs) &&
      facet.lastEmailEngagementAtMs > 0
        ? facet.lastEmailEngagementAtMs
        : null,
    createdAt: row['createdAt'],
    updatedAt: row['updatedAt'],
  }
}

/**
 * Tags as typed — comma-separated — into the shape the facet stores:
 * lower-cased, trimmed, deduplicated and capped, so a tag typed on the
 * record page and one typed in the create drawer are the same tag to the
 * segment filter that matches on them.
 */
export function parseContactTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((tag) => tag.trim().toLowerCase().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20),
    ),
  ]
}
