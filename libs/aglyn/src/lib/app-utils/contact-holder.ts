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
 * WHICH HOLDER A CROSS-SITE READER SEES A CONTACT THROUGH (AGL-2630).
 *
 * A contact document carries one facet per holder, and every field but the
 * shared identity lives in one of them. A surface standing on a site reads
 * that site's group; a surface standing at the organization — the org-level
 * Contacts list, and the whole-collection export that writes the same file
 * — has no site to read as and needs one answer per row.
 *
 * In the library rather than in the CRM plugin because both of those
 * readers need it and one of them is an app: an app may not import a
 * feature plugin (AGL-2662).
 */

import { CONTACT_FACETS_FIELD } from './contacts'
import { CAPTURED_BY_HOST_FIELD } from './marketing-consent'
import {
  type ConsentGroup,
  consentGroupForHost,
  readConsentGroups,
  soloConsentGroup,
} from './consent-groups'

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
  const facets = record[CONTACT_FACETS_FIELD]
  const facetKeys =
    facets && typeof facets === 'object' && !Array.isArray(facets)
      ? Object.keys(facets as Record<string, unknown>)
      : []
  const raw = record[CAPTURED_BY_HOST_FIELD]
  const captured = Array.isArray(raw)
    ? raw.map((id) => String(id ?? '').trim()).filter(Boolean)
    : []
  for (const hostId of captured) {
    const group = consentGroupForHost(org, hostId)
    if (facetKeys.includes(group.groupId)) return group
  }
  for (const key of facetKeys) {
    const declared = readConsentGroups(org)[key]
    if (declared) {
      return {
        hostId: declared.hostIds[0],
        groupId: key,
        name: declared.name,
        hostIds: [...declared.hostIds],
        declared: true,
      }
    }
    return soloConsentGroup(key)
  }
  if (captured.length) return consentGroupForHost(org, captured[0])
  return NO_HOLDER_GROUP
}