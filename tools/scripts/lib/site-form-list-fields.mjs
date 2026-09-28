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
 * The fields the Forms list queries, for plain Node scripts (AGL-3330).
 *
 * The script-side twin of `formListFields` and `newFormListFields` in
 * `libs/aglyn/src/lib/app-utils/forms.ts`. The NAME keys are not restated
 * here: they come from `./name-search-tokens.mjs`, the one script-side copy
 * of the platform's search keys. Only what is particular to a form lives
 * here — the search box's union of the name, slug and id prefixes, and the
 * explicit values a new form carries so its list can ask for them.
 *
 * Both sides answer `site-form-list-fields.fixtures.json`: the library's
 * `forms.spec.ts`, and `site-form-list-fields.test.mjs`
 * (`npm run test:site-form-list-fields`, which runs the backfill's `--self-test`
 * too).
 */
import { displayNameSearchFields, nameSearchTokens } from './name-search-tokens.mjs'

/**
 * `formListFields`: the name keys and the search box's tokens.
 *
 * @param {{ id: string, displayName?: unknown, slug?: unknown }} form
 * @returns {{ nameLower: string, nameTokens: string[], nameReversed: string, searchTokens: string[] }}
 */
export function formListFields(form) {
  const name = typeof form.displayName === 'string' ? form.displayName : ''
  const slugWords = (typeof form.slug === 'string' ? form.slug : '').replace(/-+/g, ' ')
  return {
    ...displayNameSearchFields(name),
    searchTokens: [
      ...new Set([
        ...nameSearchTokens(name),
        ...nameSearchTokens(slugWords),
        ...nameSearchTokens(form.id),
      ]),
    ],
  }
}

/**
 * `normalizeCampaignIds`: a stored membership as a clean list — deduped,
 * trimmed, non-strings dropped, at most twenty.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeCampaignIds(raw) {
  if (!Array.isArray(raw)) return []
  const seen = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.includes(id)) continue
    seen.push(id)
    if (seen.length >= 20) break
  }
  return seen
}

/**
 * `formCampaignFields`: the ids, and `inCampaign`, the boolean the list's
 * "In a campaign" filter asks.
 *
 * @param {unknown} selected
 */
export function formCampaignFields(selected) {
  const campaignIds = normalizeCampaignIds(selected)
  return { campaignIds, inCampaign: campaignIds.length > 0 }
}

/**
 * `newFormListFields`: what a form is CREATED with — its search keys,
 * `retired: false`, `routing.lead` as a boolean, `inCampaign`, and a null
 * for each counter except `leads` on a form that routes leads, which starts
 * at 0.
 *
 * @param {{ id: string, displayName?: unknown, slug?: unknown, routing?: Record<string, unknown> | null, campaignIds?: unknown }} form
 */
export function newFormListFields(form) {
  const routesLeads = form.routing?.lead === true
  return {
    ...formListFields(form),
    retired: false,
    routing: { ...(form.routing ?? {}), lead: routesLeads },
    inCampaign: formCampaignFields(form.campaignIds).inCampaign,
    stats: { submissions: null, leads: routesLeads ? 0 : null, lastSubmissionAtMs: null },
  }
}

/**
 * What `planFormListFields` stamps as `updatedAt` on a form with neither it
 * nor `createdAt`: a sentinel the backfill turns into the server's time.
 */
export const UPDATED_AT_FALLBACK = Symbol.for('aglyn.backfill.serverTimestamp')

/** The counters `/api/forms/submit` keeps, which a form carries as null until it counts one. */
export const FORM_LIST_COUNTERS = ['submissions', 'leads', 'lastSubmissionAtMs']

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/**
 * The list fields one stored document lacks, as a dotted-path patch, or why
 * it is left alone — what the backfill writes. Pure.
 *
 * Each value is what the document already means: `retired` is a truthy
 * `archivedAt`, a missing lead switch (or a routing that is no map) is off,
 * `inCampaign` is whether `campaignIds` names any campaign, a missing
 * `updatedAt` is the form's creation, and a counter nobody wrote is null. A
 * counter that holds a number is never touched — `recount-form-stats.mjs`
 * owns what the counters say, including the 0 a lead-routing form holds.
 *
 * @param {string} path the document path
 * @param {Record<string, any>} data the document
 * @returns {{ patch: Record<string, unknown>, reasons: string[] } | { skip: 'current' | 'not-a-form' }}
 */
export function planFormListFields(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'forms') {
    return { skip: 'not-a-form' }
  }
  const patch = {}
  const reasons = []
  const search = formListFields({ id: segments[3], displayName: data.displayName, slug: data.slug })
  for (const [key, value] of Object.entries(search)) {
    if (!same(data[key], value)) {
      patch[key] = value
      if (!reasons.includes('search')) reasons.push('search')
    }
  }
  const retired = Boolean(data.archivedAt)
  if (data.retired !== retired) {
    patch.retired = retired
    reasons.push('retired')
  }
  const routing = data.routing
  if (routing === undefined || routing === null || typeof routing !== 'object' || Array.isArray(routing)) {
    // No routing map at all — or a value that is not one, which a dotted
    // update cannot reach inside. The whole map, with the switch off.
    patch.routing = { lead: false }
    reasons.push('lead')
  } else if (typeof routing.lead !== 'boolean') {
    patch['routing.lead'] = routing.lead === true
    reasons.push('lead')
  }
  const { inCampaign } = formCampaignFields(data.campaignIds)
  if (data.inCampaign !== inCampaign) {
    patch.inCampaign = inCampaign
    reasons.push('campaign')
  }
  if (data.updatedAt === undefined || data.updatedAt === null) {
    // Updated is a range the list orders by, and a query never finds a
    // document missing the field it orders on. The form's own creation is
    // the last edit anyone can vouch for.
    patch.updatedAt = data.createdAt ?? UPDATED_AT_FALLBACK
    reasons.push('updated')
  }
  for (const counter of FORM_LIST_COUNTERS) {
    if (data.stats?.[counter] === undefined) {
      patch[`stats.${counter}`] = null
      if (!reasons.includes('counters')) reasons.push('counters')
    }
  }
  return reasons.length ? { patch, reasons } : { skip: 'current' }
}
