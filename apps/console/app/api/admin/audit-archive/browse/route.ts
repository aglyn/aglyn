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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * THE READER FOR THE 365-DAY AUDIT ARCHIVE (AGL-2324).
 *
 * The sibling route in this folder moves `adminAudit` rows older than 90 days
 * into `adminAudit-archive/{yyyy-MM}/{runId}.jsonl` in the media bucket and
 * then DELETES them from Firestore. `docs/DATA_RETENTION.md` advertises "90
 * days hot, then 365 days archived". Nothing in the product read the second
 * half: grep found the writer, the docs and the storage rules, and no reader
 * at all. A retention promise whose second half is reachable only by a human
 * with GCS console access is a promise about a filing cabinet nobody has the
 * key to — and the rows most likely to be in there are the low-frequency,
 * high-consequence ones the hot window evicts first.
 *
 * Two modes, both GET, both staff-gated:
 *
 *  - `?month=YYYY-MM` lists the objects archived for that month, with sizes
 *    and line counts, so "is there anything for March" has an answer.
 *  - `?month=YYYY-MM&file=<name>` parses one object back into audit rows in
 *    the same shape the hot log renders, so "what happened in March" has one.
 *
 * ## Why the parse happens here and not in the browser
 *
 * The objects live in the media bucket under a prefix the storage rules
 * deny to every client (`firebase-storage.rules` is deny-all by design), so
 * there is no client path to the bytes. Reading them therefore goes through
 * the Admin SDK behind the staff claim, exactly as the rest of
 * `/api/admin/*` does.
 *
 * ## Why the month is validated as a shape, not sanitized
 *
 * `month` and `file` both become path segments. An input like `../../orgs`
 * would otherwise walk out of the archive prefix and hand a staff member any
 * object in the media bucket — customer uploads included. Both are checked
 * against a strict pattern and REJECTED rather than stripped: stripping
 * `..` turns a hostile path into a plausible one and answers a question
 * nobody asked, and a 400 on a malformed month costs an operator one retype.
 */

const ARCHIVE_PREFIX = 'adminAudit-archive'

/** `2026-03`. Anchored — a partial match is what path traversal rides in on. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * `2026-08-19T04-00-00-000Z-1.jsonl`, as the writer mints it.
 *
 * Deliberately excludes `/` and `.` runs rather than allowing a general
 * filename: the writer's own naming is the only thing that should be
 * readable here, so anything else is a bug or an attack and both want the
 * same answer.
 */
const FILE_PATTERN = /^[A-Za-z0-9_-]+\.jsonl$/

/** Objects listed per month. Far above any real run; a ceiling, not a page. */
const MAX_FILES = 200

/**
 * Rows returned from one object.
 *
 * The writer batches 500 rows per file, so this holds a whole file in the
 * ordinary case and truncates visibly rather than silently in any other.
 */
const MAX_ROWS = 1000

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const month = String(query?.['month'] ?? '')
  const file = query?.['file'] == null ? '' : String(query['file'])
  if (!MONTH_PATTERN.test(month)) {
    return Response.json(
      { error: 'A month in YYYY-MM form is required.' },
      { status: 400 },
    )
  }
  if (file && !FILE_PATTERN.test(file)) {
    return Response.json({ error: 'Unknown archive object.' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    if (!file) {
      const [objects] = await bucket.getFiles({
        prefix: `${ARCHIVE_PREFIX}/${month}/`,
        maxResults: MAX_FILES,
      })
      const files = objects
        .map((object) => ({
          name: String(object.name).split('/').pop() ?? '',
          bytes: Number(object.metadata?.size ?? 0),
          archivedAt: object.metadata?.timeCreated ?? null,
        }))
        .filter((entry) => FILE_PATTERN.test(entry.name))
        // Newest run first, matching the hot log's ordering. The run id is an
        // ISO timestamp, so a lexical sort IS a chronological one.
        .sort((a, b) => b.name.localeCompare(a.name))
      return Response.json({ month, files }, { status: 200 })
    }

    const object = bucket.file(`${ARCHIVE_PREFIX}/${month}/${file}`)
    const [exists] = await object.exists()
    if (!exists) {
      return Response.json({ error: 'Unknown archive object.' }, { status: 404 })
    }
    const [contents] = await object.download()
    const lines = contents
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)

    /*
     * A LINE THAT WILL NOT PARSE IS REPORTED, NOT DROPPED.
     *
     * This is a compliance trail. Silently skipping a corrupt line answers
     * "what happened in March" with a shorter list and no indication that it
     * is shorter — the exact failure the hot log's 200-row window already
     * commits, one storage layer down.
     */
    let unreadable = 0
    const rows: Record<string, unknown>[] = []
    for (const line of lines.slice(0, MAX_ROWS)) {
      try {
        rows.push(JSON.parse(line) as Record<string, unknown>)
      } catch {
        unreadable += 1
      }
    }

    return Response.json(
      {
        month,
        file,
        rows,
        unreadable,
        truncated: lines.length > MAX_ROWS,
        total: lines.length,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[admin/audit-archive/browse]', error)
    return Response.json({ error: 'Archive lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
