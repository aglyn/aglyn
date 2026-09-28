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
 * `newFormListFields`: what a form is CREATED with — its search keys,
 * `retired: false`, `routing.lead` as a boolean and a null for each counter.
 *
 * @param {{ id: string, displayName?: unknown, slug?: unknown, routing?: Record<string, unknown> | null }} form
 */
export function newFormListFields(form) {
  return {
    ...formListFields(form),
    retired: false,
    routing: { ...(form.routing ?? {}), lead: form.routing?.lead === true },
    stats: { submissions: null, leads: null, lastSubmissionAtMs: null },
  }
}

/** The counters `/api/forms/submit` keeps, which a form carries as null until it counts one. */
export const FORM_LIST_COUNTERS = ['submissions', 'leads', 'lastSubmissionAtMs']

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/**
 * The list fields one stored document lacks, as a dotted-path patch, or why
 * it is left alone — what the backfill writes. Pure.
 *
 * Each value is what the document already means: `retired` is a truthy
 * `archivedAt`, a missing lead switch is off, and a counter nobody wrote is
 * null. A counter that holds a number is never touched.
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
  if (typeof data.routing?.lead !== 'boolean') {
    patch['routing.lead'] = data.routing?.lead === true
    reasons.push('lead')
  }
  for (const counter of FORM_LIST_COUNTERS) {
    if (data.stats?.[counter] === undefined) {
      patch[`stats.${counter}`] = null
      if (!reasons.includes('counters')) reasons.push('counters')
    }
  }
  return reasons.length ? { patch, reasons } : { skip: 'current' }
}
