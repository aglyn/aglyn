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

import { orgOverrideReasonSummary } from '../org-override-reason'
import { describeStaffAudit } from '../activity-labels'
import { escapeCsvCell } from '../csv'

/*
 * THE ADMIN AUDIT LOG, AS THE STAFF PAGE PRINTS IT (AGL-3667).
 *
 * `/admin/audit` reads `adminAudit` from the browser and words each row with
 * `describeStaffAudit`. The staff apps read the same rows from
 * `/api/admin/audit-log`, which plans the same filters onto the same query and
 * sends each row worded the way the page words it, plus the compliance export
 * the page builds in the browser.
 */

/** How many rows one compliance export may carry (the page's own ceiling). */
export const AUDIT_EXPORT_CEILING = 5000

export interface AuditLogRow {
  $id: string
  /** The act, as a sentence. */
  action: string
  /** The stored action code. */
  code: string
  scope: string
  /** What it was done to, in words. */
  target: string
  tenantPool: string
  actorUid: string
  actorEmail: string
  at: string | null
  /** Why, when the writer recorded a reason. */
  why: string
  /** An override recorded before the reason was required says so. */
  whyMissing: boolean
}

type Stamp = { toDate?: () => Date; seconds?: number; _seconds?: number } | string | null | undefined

export const auditStampIso = (stamp: Stamp): string | null => {
  if (!stamp) return null
  if (typeof stamp === 'string') return Number.isNaN(Date.parse(stamp)) ? null : new Date(stamp).toISOString()
  if (typeof stamp.toDate === 'function') return stamp.toDate().toISOString()
  const seconds = stamp.seconds ?? stamp._seconds
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

const auditWhy = (entry: Record<string, unknown>): string | null =>
  orgOverrideReasonSummary(entry['reason'], entry['note']) ??
  (entry['reason'] ? [entry['reason'], entry['note']].filter(Boolean).join(' \u2014 ') : null)

export function auditLogRow(id: string, data: Record<string, unknown>): AuditLogRow {
  const described = describeStaffAudit({ ...data, $id: id } as never)
  const why = auditWhy(data)
  return {
    $id: id,
    action: described.action,
    code: String(data['action'] ?? ''),
    scope: String(data['scope'] ?? ''),
    target: described.target,
    tenantPool: String(data['targetTenantId'] ?? ''),
    actorUid: String(data['actorUid'] ?? ''),
    actorEmail: String(data['actorEmail'] ?? ''),
    at: auditStampIso(data['at'] as Stamp),
    why: why ?? '',
    whyMissing: !why && data['action'] === 'org.override',
  }
}

/** The compliance export: one row per entry, every cell escaped, before and after as JSON. */
export function auditLogCsv(entries: ReadonlyArray<Record<string, unknown>>): string {
  const escape = (value: unknown) =>
    escapeCsvCell(
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''),
      { numeric: typeof value === 'number' },
    )
  const table = [
    ['at', 'actorUid', 'actorEmail', 'action', 'scope', 'target', 'targetTenantId', 'reason', 'note', 'before', 'after'],
    ...entries.map((entry) => [
      auditStampIso(entry['at'] as Stamp) ?? '',
      entry['actorUid'],
      entry['actorEmail'] ?? '',
      entry['action'],
      entry['scope'] ?? '',
      entry['target'],
      entry['targetTenantId'] ?? '',
      entry['reason'] ?? '',
      entry['note'] ?? '',
      entry['before'],
      entry['after'],
    ]),
  ]
  return table.map((row) => row.map(escape).join(',')).join('\n')
}
