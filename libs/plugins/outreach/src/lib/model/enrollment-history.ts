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

import type { OutreachClickMachineReason } from '../engine/click-tracking'
import { OUTREACH_OPEN_SOURCES, type OutreachOpenSource } from '../engine/open-source'
import type { OutreachOpenMachineReason } from '../engine/open-tracking'
import type {
  OutreachEnrollmentHistoryEntry,
  OutreachHistoryAction,
} from './outreach.types'

/**
 * ONE ROW OF AN ENROLLMENT'S HISTORY (AGL-3332), as stored and as read back.
 *
 * Client-safe, beside the other readers, because the click route and the
 * member-action route write these rows on the server and the detail view
 * reads them in the browser, and both must agree on the shape. Read a field
 * at a time: a row that names no time, or no kind this model knows, is
 * dropped rather than shown as something that happened.
 */

const MACHINE_REASONS: readonly OutreachClickMachineReason[] = ['agent', 'too_soon', 'method']
const OPEN_MACHINE_REASONS: readonly OutreachOpenMachineReason[] = [
  'agent',
  'too_soon',
  'method',
  'image_proxy',
  'privacy_proxy',
  'scanner',
]
const ACTIONS: readonly OutreachHistoryAction[] = ['pause', 'resume', 'stop', 'do_not_contact']

/** A click row as the click route writes it. */
export function outreachClickHistoryRow(input: {
  atMs: number
  url: string | null
  stepIndex: number
  human: boolean
  machineReason: OutreachClickMachineReason | null
}): Record<string, unknown> {
  return {
    kind: 'click',
    atMs: input.atMs,
    url: input.url,
    stepIndex: input.stepIndex,
    human: input.human,
    machineReason: input.human ? null : input.machineReason,
  }
}

/**
 * An open row as the short-link route writes it for a tracking image
 * (AGL-3395), with the evidence it was judged on (AGL-3488): the agent the
 * fetch sent, and the network it came from — never its address.
 */
export function outreachOpenHistoryRow(input: {
  atMs: number
  stepIndex: number
  human: boolean
  machineReason: OutreachOpenMachineReason | null
  userAgent?: string | null
  source?: OutreachOpenSource | null
}): Record<string, unknown> {
  return {
    kind: 'open',
    atMs: input.atMs,
    stepIndex: input.stepIndex,
    human: input.human,
    machineReason: input.human ? null : input.machineReason,
    userAgent: input.userAgent ?? null,
    source: input.source ?? null,
  }
}

/** A member's act as the action route writes it. */
export function outreachActionHistoryRow(input: {
  atMs: number
  action: OutreachHistoryAction
  byUid: string
  detail: string | null
}): Record<string, unknown> {
  const detail = typeof input.detail === 'string' ? input.detail.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
  return {
    kind: 'action',
    atMs: input.atMs,
    action: input.action,
    byUid: input.byUid,
    detail: detail || null,
  }
}

/**
 * A row id that sorts by time and cannot collide: two clicks in the same
 * millisecond — a scanner fetching every link at once — are two rows.
 */
export function outreachHistoryEntryId(atMs: number, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')
  return `${String(Math.max(0, Math.floor(atMs))).padStart(15, '0')}-${suffix}`
}

/** A stored history row in its model shape, or `null` for one nothing can be said about. */
export function readOutreachHistoryEntry(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachEnrollmentHistoryEntry | null {
  if (!data) return null
  const atMs = data['atMs']
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null
  if (data['kind'] === 'click') {
    const stepIndex = Number(data['stepIndex'])
    const human = data['human'] === true
    const reason = data['machineReason']
    return {
      id,
      kind: 'click',
      atMs,
      url: typeof data['url'] === 'string' && data['url'] ? data['url'] : null,
      stepIndex: Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0,
      human,
      machineReason: human
        ? null
        : (MACHINE_REASONS as readonly unknown[]).includes(reason)
          ? (reason as OutreachClickMachineReason)
          : null,
    }
  }
  if (data['kind'] === 'open') {
    const stepIndex = Number(data['stepIndex'])
    const human = data['human'] === true
    const reason = data['machineReason']
    return {
      id,
      kind: 'open',
      atMs,
      stepIndex: Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0,
      human,
      machineReason: human
        ? null
        : (OPEN_MACHINE_REASONS as readonly unknown[]).includes(reason)
          ? (reason as OutreachOpenMachineReason)
          : null,
      // Absent on every row from before AGL-3488, which recorded neither.
      userAgent: typeof data['userAgent'] === 'string' && data['userAgent'] ? data['userAgent'] : null,
      source: (OUTREACH_OPEN_SOURCES as readonly unknown[]).includes(data['source'])
        ? (data['source'] as OutreachOpenSource)
        : null,
    }
  }
  if (data['kind'] === 'action') {
    const action = data['action']
    if (!(ACTIONS as readonly unknown[]).includes(action)) return null
    return {
      id,
      kind: 'action',
      atMs,
      action: action as OutreachHistoryAction,
      byUid: typeof data['byUid'] === 'string' ? data['byUid'] : '',
      detail: typeof data['detail'] === 'string' && data['detail'] ? data['detail'] : null,
    }
  }
  return null
}
