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

import {
  isMediaQuarantineActive,
  MEDIA_QUARANTINE_REASON_LABELS,
  MEDIA_QUARANTINE_REASONS,
  type MediaQuarantineEntry,
  normalizeMediaQuarantine,
} from '@aglyn/aglyn/app-utils/media-quarantine'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/*
 * THE DENY-LIST TABLE ON STAFF → DISABLED FILES (AGL-3321) — an exception
 * to "every clause on the Firestore query", because its rows are not
 * documents.
 *
 * The deny list is ONE document, `mediaQuarantines/index`, whose `entries`
 * map holds every quarantine key; the CDN and the upload paths read that
 * document whole (with a short cache) on every request they refuse. A map's
 * entries cannot be queried, filtered or ordered by Firestore at all, so
 * there is no query to put a clause on and no written search field a query
 * could read — a token array on the index document would match the DOCUMENT,
 * which every entry shares.
 *
 * What makes the exception honest is that the read is the complete source:
 * the route reads the one document, which the quarantine write caps at
 * `MEDIA_QUARANTINE_MAX_ENTRIES` (it refuses the next new key with a 409
 * rather than grow past it), and answers the Filters panel and the search
 * over every entry it holds (`answerStaffCompleteList`) — never over the page
 * on screen. Splitting the entries into a document each would make them
 * queryable, and would also change what every refusing reader reads; that is
 * a change to the enforcement path, not to this table.
 */

/**
 * One entry of the deny list — the stored entry with its map key spread on
 * top. Everything but `key` is optional: entries written before a field
 * existed simply do not carry it, and those are the oldest rows, which is to
 * say the ones this table is for.
 */
export interface QuarantineRecord {
  key: string
  reason?: string | null
  message?: string | null
  /** Staff-only rationale. Rendered here and nowhere a customer can reach. */
  note?: string | null
  atMs?: number | null
  untilMs?: number | null
  actorUid?: string | null
  /** The copy an operator was looking at when they set it — often the only
   * breadcrumb from a hash key back to a file. */
  originScopeSegment?: string | null
  originMediaId?: string | null
}

/** Enforced now / expired with no write / unenforceable and unexplainable. */
export type DenyRowState = 'active' | 'expired' | 'malformed'

/** What kind of key a row holds, read from the key alone. */
export type ListedKeyKind = 'sha256' | 'legacy' | 'asset' | 'digest'

/**
 * What kind of key a deny-list ROW holds, read from the key alone.
 *
 * The lookup card gets `kind` from the server, which holds the media document
 * to compare against. A row has no document — the deny list is keys and
 * nothing else. So a digest's LENGTH is the only signal there is: 64 hex
 * characters is `contentSha256`, 16 is the legacy truncated digest, and
 * anything else is a digest whose provenance this list will not guess at.
 */
export function listedKeyKind(key: string): ListedKeyKind {
  if (key.startsWith('asset--')) return 'asset'
  if (!key.startsWith('hash--')) return 'digest'
  const digest = key.slice('hash--'.length)
  if (digest.length === 64) return 'sha256'
  if (digest.length === 16) return 'legacy'
  return 'digest'
}

export const LISTED_KIND_LABEL: Record<ListedKeyKind, string> = {
  sha256: 'sha256',
  legacy: 'legacy digest',
  asset: 'per-asset',
  digest: 'digest',
}

/** How each row state reads, on its chip and in the filter. */
export const ROW_STATE_LABEL: Record<DenyRowState, string> = {
  active: 'enforcing',
  expired: 'EXPIRED',
  malformed: 'UNREADABLE',
}

/**
 * Enforced, expired, or neither — decided against the server's own read time,
 * so the verdict is the verdict at the moment the list was read.
 * `normalizeMediaQuarantine` returns `null` for an entry whose reason nothing
 * recognises, and the readers refuse such an entry WHOLE — so it enforces
 * nothing while still consuming a slot.
 */
export function denyRowState(record: QuarantineRecord, nowMs: number): DenyRowState {
  const state = normalizeMediaQuarantine(record as Partial<MediaQuarantineEntry>, record.key)
  if (!state) return 'malformed'
  return isMediaQuarantineActive(state, nowMs) ? 'active' : 'expired'
}

/** One deny-list row as the list matches and renders it. */
export type DenyListRow = QuarantineRecord & {
  $id: string
  state: DenyRowState
  kind: ListedKeyKind
  reason: string
  note: string
  origin: string
}

export function denyListRow(record: QuarantineRecord, nowMs: number): DenyListRow {
  return {
    ...record,
    $id: record.key,
    state: denyRowState(record, nowMs),
    kind: listedKeyKind(record.key),
    reason: record.reason ?? '',
    note: record.note ?? '',
    origin: [record.originScopeSegment, record.originMediaId].filter(Boolean).join(' / '),
  }
}

/**
 * Oldest first — the table's whole job is surfacing what has been sitting
 * there, and an entry with no `atMs` predates the field, so it sorts ahead of
 * every dated one. Ties fall back to the key, so the order is total and a
 * page cursor names one position.
 */
export function compareDenyRows(a: QuarantineRecord, b: QuarantineRecord): number {
  const at = (record: QuarantineRecord) => (typeof record.atMs === 'number' ? record.atMs : 0)
  return at(a) - at(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

const PICKED = ['equals', 'doesNotEqual', 'isAnyOf'] as const
const TYPED = ['contains', 'doesNotContain', 'equals', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'] as const

/** What the deny-list panel filters by, matched over every entry. */
export const DENY_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'key', kind: 'text', path: 'key', operators: TYPED },
  { column: 'reason', kind: 'exact', path: 'reason', operators: PICKED },
  { column: 'state', kind: 'exact', path: 'state', operators: PICKED },
  { column: 'kind', kind: 'exact', path: 'kind', operators: PICKED },
  { column: 'note', kind: 'text', path: 'note', operators: TYPED },
]

export const DENY_FILTER_HEADERS: Readonly<Record<string, string>> = {
  key: 'Key',
  reason: 'Reason',
  state: 'State',
  kind: 'Key kind',
  note: 'Note',
}

export const DENY_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  reason: MEDIA_QUARANTINE_REASONS.map((code) => ({
    value: code,
    label: MEDIA_QUARANTINE_REASON_LABELS[code],
  })),
  state: (Object.keys(ROW_STATE_LABEL) as DenyRowState[]).map((state) => ({
    value: state,
    label: ROW_STATE_LABEL[state],
  })),
  kind: (Object.keys(LISTED_KIND_LABEL) as ListedKeyKind[]).map((kind) => ({
    value: kind,
    label: LISTED_KIND_LABEL[kind],
  })),
}

/** The search: the key, the reason, the note, or where it was set from. */
export const DENY_SEARCH_PATHS: readonly string[] = ['key', 'reason', 'note', 'origin']
