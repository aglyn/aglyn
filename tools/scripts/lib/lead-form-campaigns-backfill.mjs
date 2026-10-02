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

// The decisions of the lead form-campaign backfill (AGL-3458), pure so they
// are pinned by `lead-form-campaigns-backfill.test.mjs`. The script reads,
// prints and writes; everything it decides is decided here.
//
// A lead a form filed belongs to the campaigns that form is filed under:
// `addHostLeadOutcome` unions the capture surface's `campaignIds` into the
// lead and restamps `scopedCampaignIds` — the Leads list's Campaign filter —
// in the same write. A lead filed before it did holds neither, so its
// Campaigns card and the Campaign filter show nothing for it. This plans the
// same union over every lead whose `sources` name a form (`form:{formId}`),
// from the campaigns those forms are filed under now.
//
// Only ever ADDS. A campaign the lead holds is kept, whatever put it there,
// and a campaign its form no longer holds is not taken away: a person who was
// filed under a campaign stays filed under it.

/** `FORM_LEAD_SOURCE_PREFIX`, restated: a `.mjs` under tools/ cannot import the TypeScript that owns it. */
export const FORM_LEAD_SOURCE_PREFIX = 'form:'

/** `CONTAINER_MEMBERSHIP_CAP`, restated. */
export const CONTAINER_MEMBERSHIP_CAP = 20

/** `SCOPED_SEARCH_JOIN`, restated. */
export const SCOPED_SEARCH_JOIN = '~'

/** `containerMembershipField('campaign')`. */
export const CAMPAIGNS_FIELD = 'campaignIds'

/** The field the Leads list's Campaign filter queries. */
export const SCOPED_CAMPAIGNS_FIELD = 'scopedCampaignIds'

/** `normalizeContainerIds`, restated: trimmed strings, deduplicated, in order, capped. */
export function normalizeContainerIds(raw) {
  if (!Array.isArray(raw)) return []
  const seen = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.includes(id)) continue
    seen.push(id)
    if (seen.length >= CONTAINER_MEMBERSHIP_CAP) break
  }
  return seen
}

/** `formIdsOfLeadSources`, restated: the form ids a lead's `sources` name, in order. */
export function formIdsOfLeadSources(sources) {
  if (!Array.isArray(sources)) return []
  const ids = []
  for (const source of sources) {
    if (typeof source !== 'string' || !source.startsWith(FORM_LEAD_SOURCE_PREFIX)) continue
    const id = source.slice(FORM_LEAD_SOURCE_PREFIX.length).trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** `scopedSearchTokens`, restated: every scope the lead is visible to, joined to every campaign. */
export function scopedSearchTokens(visibleTo, tokens) {
  if (!Array.isArray(visibleTo)) return []
  const scopes = [...new Set(visibleTo.filter((entry) => typeof entry === 'string' && entry.length > 0))]
  const words = [...new Set(tokens.filter((token) => typeof token === 'string' && token))]
  const scoped = []
  for (const scope of scopes) {
    for (const word of words) scoped.push(`${scope}${SCOPED_SEARCH_JOIN}${word}`)
  }
  return scoped
}

/**
 * What one lead is missing, or `null` when it already holds every campaign
 * its forms are filed under and every scoped key those campaigns imply.
 *
 * @param lead the lead document's data
 * @param formCampaigns `Map<formId, string[]>` — the campaigns each form in
 *   the lead's org is filed under; a form absent from the map (deleted, or in
 *   no campaign) contributes nothing
 * @returns `{ campaignIds: string[], scopedCampaignIds: string[] } | null` —
 *   the ids and keys to ADD, never the whole list, so the write is an
 *   `arrayUnion` that cannot drop a campaign a live door files meanwhile
 */
export function planLeadFormCampaigns(lead, formCampaigns) {
  if (!lead) return null
  const held = normalizeContainerIds(lead[CAMPAIGNS_FIELD])
  const fromForms = formIdsOfLeadSources(lead.sources).flatMap((formId) => formCampaigns.get(formId) ?? [])
  // The union a capture writes, held to the same cap every reader applies:
  // what the lead holds first, so the cap never pushes one of those out.
  const union = normalizeContainerIds([...held, ...fromForms])
  const addCampaigns = union.filter((id) => !held.includes(id))
  const storedScoped = Array.isArray(lead[SCOPED_CAMPAIGNS_FIELD]) ? lead[SCOPED_CAMPAIGNS_FIELD] : []
  const addScoped = scopedSearchTokens(lead.visibleTo, union).filter((token) => !storedScoped.includes(token))
  if (!addCampaigns.length && !addScoped.length) return null
  return { campaignIds: addCampaigns, scopedCampaignIds: addScoped }
}
