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

// The decisions of the submission-scope backfill (AGL-3303), kept apart from
// the script that reads and writes so every one of them is pinned by
// `submission-scope-backfill.test.mjs`.
//
// The organization's Inbox reads every site's form submissions with ONE
// collection-group query on `orgId`, and addresses each row's site by
// `hostId`. The submit route stamps both from AGL-3303 on; a submission
// written before it carries neither and is in no organization's list. This
// stamps them from where the row already lives: `hostId` is the site in the
// row's path, and `orgId` is that site's org.
//
// Nothing else on a submission is read or written, and a row already carrying
// the right pair is left alone, so a second run plans nothing.

/** The two fields this backfill owns on a submission. */
export const SCOPE_FIELDS = ['orgId', 'hostId']

/** A usable id: a non-empty string, or `null`. */
function id(value) {
  return typeof value === 'string' && value ? value : null
}

/**
 * The org a site's submissions belong to.
 *
 * Asked of the two documents the submit route asks, in its order: the host
 * document's `orgId`, written only by the org APIs, then the `hostIndex`
 * mirror the plan gate resolves through. They agree in production. When both
 * name an org and the orgs DIFFER the site is refused rather than guessed —
 * a wrong stamp files a site's submissions into another organization's Inbox,
 * which is worse than leaving them in no organization's until a person looks.
 *
 * @returns `{ orgId }`, `{ refused: 'orgs-disagree', hostOrgId, indexOrgId }`
 *   or `{ skipped: 'no-org' }`.
 */
export function siteOrgId({ hostOrgId, indexOrgId }) {
  const host = id(hostOrgId)
  const index = id(indexOrgId)
  if (host && index && host !== index) {
    return { refused: 'orgs-disagree', hostOrgId: host, indexOrgId: index }
  }
  const orgId = host ?? index
  return orgId ? { orgId } : { skipped: 'no-org' }
}

/**
 * What one submission needs, or `null` when it already carries the pair.
 *
 * A row with a DIFFERENT value is corrected rather than skipped: the pair is
 * a fact about where the document lives, not something a person chose, so a
 * value that disagrees with the path is wrong by construction. `corrected`
 * says so, for the report.
 */
export function planSubmissionScope({ submission, hostId, orgId }) {
  const data = submission ?? {}
  if (data.orgId === orgId && data.hostId === hostId) return null
  const corrected =
    (id(data.orgId) !== null && data.orgId !== orgId) ||
    (id(data.hostId) !== null && data.hostId !== hostId)
  return { patch: { orgId, hostId }, corrected }
}

/**
 * One site's plan: the writes, and the counts the dry run reports.
 *
 * @param {{ hostId: string, orgId: string, submissions: Array<{ id: string, data: object }> }} input
 */
export function planSiteScope({ hostId, orgId, submissions }) {
  const writes = []
  let alreadyStamped = 0
  let corrected = 0
  for (const row of submissions) {
    const plan = planSubmissionScope({ submission: row.data, hostId, orgId })
    if (!plan) {
      alreadyStamped += 1
      continue
    }
    if (plan.corrected) corrected += 1
    writes.push({ id: row.id, patch: plan.patch, corrected: plan.corrected })
  }
  return { writes, read: submissions.length, alreadyStamped, corrected }
}

/**
 * Comments out, strings intact — a single left-to-right scan, so a `//`
 * inside a block comment or a `/*` inside a line comment cannot swallow the
 * text a precondition below exists to read.
 */
export function stripComments(source) {
  let out = ''
  let mode = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        i += 1
      } else if (char === '/' && next === '*') {
        mode = 'block'
        i += 1
      } else {
        if (char === "'" || char === '"' || char === '`') {
          mode = 'string'
          quote = char
        }
        out += char
      }
    } else if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
    } else if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code'
        i += 1
      } else if (char === '\n') out += char
    } else {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === quote) mode = 'code'
    }
  }
  return out
}

/**
 * Whether the submit route in this checkout stamps the pair on every add.
 *
 * Filling a field nothing maintains going forward is the report that reads as
 * success while the gap grows: every row after the run would be unstamped
 * again. So `--apply` is refused on a checkout whose route does not write
 * both, which is also the tell that the checkout is older than the change.
 */
export function routeStampsScope(routeSource) {
  const code = stripComments(routeSource)
  const add = code.match(
    /collection\('formSubmissions'\)\.add\(\{([\s\S]*?)\n\s*\}\)/,
  )
  if (!add) return false
  return /\borgId\b/.test(add[1]) && /(^|[\s,{])hostId\s*,/.test(add[1])
}

/**
 * Whether the rules in this checkout freeze the pair against the client.
 *
 * `hostId` and `orgId` decide whose Inbox lists a row; a stamp any editor
 * could rewrite would make this backfill's work undoable from a browser. The
 * catch-all's UPDATE list has to name the collection — that is what lets the
 * dedicated block narrow it — and the dedicated block has to allow `read`
 * alone.
 */
export function rulesFreezeScope(rulesSource) {
  const code = stripComments(rulesSource)
  // The host catch-all, by its own header, and its one UPDATE statement.
  const catchAll = code.split('match /{subcollection}/{document=**} {')[1] ?? ''
  const update =
    catchAll
      .split(';')
      .find((statement) => /\ballow update\b/.test(statement)) ?? ''
  const list = update.match(/subcollection in \[([^\]]*)\]/)
  const excluded = Boolean(list && /'formSubmissions'/.test(list[1]))
  const narrowed =
    /match \/formSubmissions\/\{submissionId\} \{\s*allow update:[^;]*hasOnly\(\['read'\]\)/.test(
      code,
    )
  return excluded && narrowed
}
