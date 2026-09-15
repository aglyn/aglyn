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

// By their own entry points rather than the barrel: the route that serves
// this shape imports it on the server, where the whole library is dead weight.
import {
  topAiUsageKinds,
  type AiUsageByUserMonth,
} from '../model/ai-usage-by-user'
import {
  AI_ALLOTMENT_WARN_SHARE,
  type AiAllotmentMode,
  type AiCreditAllotmentScope,
} from '../model/ai-allotments'
import { csvCell } from '@aglyn/aglyn/app-utils/csv-import'

/**
 * What `/api/ai/usage` answers (AGL-2928), shared by the route and the
 * console surfaces that read it — the Usage table, the roster column, the
 * site collaborators card and the member card. Dependency-free on purpose:
 * the route imports the Admin SDK and a client component may not.
 */

/** Header naming the row count the export undertook to send. */
export const AI_USAGE_EXPORT_ROWS_HEADER = 'X-Aglyn-Export-Rows'

/** A row as a customer sees it — credits and a share, never `estCostUsd`. */
export interface OrgAiUsageRowWire {
  uid: string
  /** The roster's name — display name, else email, else the uid. */
  name: string
  email: string | null
  role: string | null
  credits: number
  /** Of the workspace's measured spend for the month, in `[0, 1]`. */
  share: number
  requests: number
  refusals: number
  byKind: Record<string, number>
  byHost: Record<string, number>
  /** Credits on the site the request named, when it named one. */
  hostCredits?: number
}

export interface OrgAiUsageTableWire {
  month: string
  /** The months a reader may ask for, newest first. */
  months: string[]
  /** The workspace's own credits for the month — the pool the shares are of. */
  orgCredits: number
  rows: OrgAiUsageRowWire[]
}

/** One person's month, as the member card reads it. */
export interface UserAiUsageMonthWire {
  month: string
  credits: number
  share: number
  requests: number
  refusals: number
  byKind: Record<string, number>
  byHost: Record<string, number>
}

export interface UserAiUsageWire {
  uid: string
  /** Newest first. */
  months: UserAiUsageMonthWire[]
}

/** The roster's month, joined and shared, projected onto the wire. */
export function toAiUsageWireRow(
  row: AiUsageByUserMonth & {
    name: string
    email: string | null
    role: string | null
    share: number
  },
  hostId: string,
): OrgAiUsageRowWire {
  const wire: OrgAiUsageRowWire = {
    uid: row.uid,
    name: row.name,
    email: row.email,
    role: row.role,
    credits: row.credits,
    share: row.share,
    requests: row.requests,
    refusals: row.refusals,
    byKind: row.byKind,
    byHost: row.byHost,
  }
  if (hostId) wire.hostCredits = row.byHost[hostId] ?? 0
  return wire
}

/** The CSV's columns, in order. */
export const AI_USAGE_CSV_HEADER = [
  'Member',
  'Email',
  'Role',
  'Credits',
  'Share',
  'Requests',
  'Refusals',
  'Top kinds',
  'Sites',
] as const

/** A share as the table and the file print it: one decimal of a percent. */
export function formatAiUsageShare(share: number): string {
  return `${Math.round(share * 1000) / 10}%`
}

export function aiUsageCsvLine(row: OrgAiUsageRowWire): string {
  const kinds = topAiUsageKinds(row.byKind, 3)
    .map((entry) => `${entry.kind} ${entry.credits}`)
    .join('; ')
  const sites = Object.entries(row.byHost)
    .sort((a, b) => b[1] - a[1])
    .map(([hostId, credits]) => `${hostId} ${credits}`)
    .join('; ')
  return [
    row.name,
    row.email ?? '',
    row.role ?? '',
    row.credits,
    formatAiUsageShare(row.share),
    row.requests,
    row.refusals,
    kinds,
    sites,
  ]
    .map(csvCell)
    .join(',')
}

/**
 * THE USAGE STRIP'S ENVELOPE (AGL-2942): what every AI door adds to the
 * answer it already sends — the chat door's `done` event, the copy
 * assistant's JSON, a job's create response, and each door's quota refusal —
 * so the strip in the panel and the generation dialogs updates with no read
 * of its own.
 *
 * Credits only. `pool` is the workspace's month against its band; `mine` is
 * the caller's own month, measured against the allotment that binds them
 * when one does — for a site allotment, the site's month, because that is
 * the line the next request meets.
 */
export type AiUsageMeterState = 'ok' | 'warn' | 'capped'

export interface AiUsageMeterWire {
  month: string
  pool: { used: number; limit: number | null }
  mine: {
    used: number
    limit: number | null
    mode: AiAllotmentMode | null
    scope: AiCreditAllotmentScope | null
  }
  /** Credits the exchange this envelope answers cost; `null` when no model ran. */
  last: number | null
  /** True when the envelope rides a refusal. */
  refused: boolean
  state: AiUsageMeterState
  /** The model that answered, as the catalog names it. */
  model: { id: string; label: string; auto: boolean } | null
}

/**
 * `capped` when a hard allotment is spent or the request was refused, `warn`
 * from 80% of the allotment that binds or of the pool, `ok` otherwise.
 */
export function aiUsageMeterState(
  meter: Pick<AiUsageMeterWire, 'pool' | 'mine' | 'refused'>,
): AiUsageMeterState {
  const { mine, pool } = meter
  if (meter.refused) return 'capped'
  if (mine.limit !== null && mine.mode === 'hard' && mine.used >= mine.limit) return 'capped'
  const past = (used: number, limit: number | null) =>
    limit !== null && limit > 0 && used >= limit * AI_ALLOTMENT_WARN_SHARE
  return past(mine.used, mine.limit) || past(pool.used, pool.limit) ? 'warn' : 'ok'
}

/**
 * What `/api/ai/allotments` answers (AGL-2942): the allotments a reader may
 * see, each with what its subject drew this month, and the roster, sites
 * and models the editors pick from. Credits only.
 */
export interface AiAllotmentRowWire {
  subject: string
  scope: 'member' | 'collab' | 'host' | 'org'
  uid: string | null
  hostId: string | null
  credits: number | null
  mode: AiAllotmentMode
  models: string[] | null
  /** Credits the subject drew this month — the figure the gate measures. */
  used: number
}

export interface AiAllotmentsMemberWire {
  uid: string
  name: string
  email: string | null
  role: string | null
  /** False for a site collaborator, whose allotments are per site. */
  orgWide: boolean
  /** Credits this month, every site. */
  credits: number
  /** Credits this month by site. */
  byHost: Record<string, number>
}

export interface AiAllotmentsHostWire {
  hostId: string
  name: string
  /** The site's credits this month, everyone on it. */
  credits: number
}

export interface AiAllotmentsWire {
  /** The org the answer is about — resolved from the site when only one was named. */
  orgId: string
  month: string
  pool: { used: number; limit: number | null }
  allotments: AiAllotmentRowWire[]
  members: AiAllotmentsMemberWire[]
  hosts: AiAllotmentsHostWire[]
  /** The catalog models this deployment serves, for an allowlist. */
  models: Array<{ id: string; label: string; tier: string }>
  /** Whether the plan lets the workspace restrict models org-wide. */
  restrictionAvailable: boolean
  canEdit: {
    /** Members, sites and the restriction: `billing.manage`. */
    billing: boolean
    /** Collaborators on the site asked about: `billing.manage`, or its admin. */
    collaborators: boolean
  }
  /** Who is reading, so an editor can refuse to offer a self-raise. */
  callerUid: string
}

/** `2026-09` as a reader says it, on the UTC calendar the key is cut from. */
export function aiUsageMonthLabel(month: string): string {
  const [year, monthOfYear] = month.split('-').map(Number)
  if (!year || !monthOfYear) return month
  try {
    return new Date(Date.UTC(year, monthOfYear - 1, 1)).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  } catch {
    return month
  }
}
