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
  /**
   * The facet this row was flattened through — the viewing group under a
   * site, the person's primary holder at the org level (AGL-2630). A write
   * that edits the row goes back to the same facet, so a surface that has
   * only the flat record can still address the holder's own fields.
   */
  groupId: string
  /** Every site that has captured this person, sorted — the org-level "Known by". */
  capturedByHostIds: string[]
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
  /**
   * What linking this person to a company has to know — this holder's link,
   * the shared mirror and the other holders' ids — so the properties card
   * and the bulk bar can plan a link from the row without the document. Not
   * a display field: the mirror is an index every reader of the document
   * already holds, and nothing renders it.
   */
  companyLink: Aglyn.ContactCompanyLinkState
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

/**
 * The holder of nothing: the group a contact is flattened through when no
 * site has captured it and no facet exists — a row written by a path that
 * predates attribution, read at the org level (AGL-2630).
 *
 * An empty `groupId` reads an empty facet (`readContactFacet` answers the
 * empty facet for a key the map lacks) and REFUSES a write
 * (`contactFacetPath` throws on an empty holder), which is the right pair:
 * the row still shows its shared identity, and nothing edits a facet
 * nobody holds. Exported so a surface can test for it rather than for an
 * empty string.
 */
export const NO_HOLDER_GROUP: ConsentGroup = Object.freeze({
  hostId: '',
  groupId: '',
  name: null,
  hostIds: [],
  declared: false,
}) as ConsentGroup

/**
 * The group a CROSS-HOLDER reader flattens one contact through (AGL-2630).
 *
 * Under a site there is one answer for every row — the site's own group,
 * `consentGroupForHost` — and the reader never asks this. At the
 * organization level there is no viewing site, and a contact captured by
 * three sites has up to three facets; the org-wide member reading them all
 * needs ONE to show the row's profile, owner and stage under, and to write
 * an edit back to. This picks the person's PRIMARY holder: the first
 * capturing site, in capture order, whose group actually holds a facet;
 * then any facet at all, resolved back to its declared group or to the
 * site whose id it is keyed by; then the first capturing site even with no
 * facet yet (the facet is written on the first edit). A row nobody captured
 * and nobody wrote a facet for reads through {@link NO_HOLDER_GROUP}.
 *
 * Capture order rather than sorted order, deliberately: `capturedByHostIds`
 * is maintained by `arrayUnion`, so its first entry is the site that met
 * the person first, and that site's profile is the one a person reading
 * across brands would expect to see. `contactCaptureHostIds` sorts the same
 * array for RENDERING, where a stable order matters more than a first.
 */
export function contactPrimaryGroup(
  row: Record<string, unknown> | null | undefined,
  org: Record<string, unknown> | null | undefined,
): ConsentGroup {
  const record = row ?? {}
  const facets = record[Aglyn.CONTACT_FACETS_FIELD]
  const facetKeys =
    facets && typeof facets === 'object' && !Array.isArray(facets)
      ? Object.keys(facets as Record<string, unknown>)
      : []
  const raw = record[Aglyn.CAPTURED_BY_HOST_FIELD]
  const captured = Array.isArray(raw)
    ? raw.map((id) => String(id ?? '').trim()).filter(Boolean)
    : []
  for (const hostId of captured) {
    const group = Aglyn.consentGroupForHost(org, hostId)
    if (facetKeys.includes(group.groupId)) return group
  }
  for (const key of facetKeys) {
    const declared = Aglyn.readConsentGroups(org)[key]
    if (declared) {
      return {
        hostId: declared.hostIds[0],
        groupId: key,
        name: declared.name,
        hostIds: [...declared.hostIds],
        declared: true,
      }
    }
    return Aglyn.soloConsentGroup(key)
  }
  if (captured.length) return Aglyn.consentGroupForHost(org, captured[0])
  return NO_HOLDER_GROUP
}

/** A document off the wire, flattened through one group's facet. */
export function contactRecordFromDoc(
  row: Record<string, any>,
  group: ConsentGroup,
): ContactRecord {
  const facet = Aglyn.readContactFacet(row, group.groupId)
  return {
    $id: String(row['$id'] ?? ''),
    groupId: group.groupId,
    capturedByHostIds: Aglyn.contactCaptureHostIds(row),
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
    companyLink: Aglyn.readContactCompanyLink(row, group.groupId),
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
