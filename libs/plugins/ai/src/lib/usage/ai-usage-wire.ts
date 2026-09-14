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
