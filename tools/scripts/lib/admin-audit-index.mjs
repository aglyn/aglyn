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
 * The `adminAudit` row stamp, for the scripts that write or restamp rows
 * (AGL-3321).
 *
 * The one script-side statement of `withAdminAuditIndex`
 * (`libs/aglyn/src/lib/app-utils/admin-audit-index.ts`), which a plain Node
 * script cannot import. Its name tokens are the platform's, from
 * `name-search-tokens.mjs`, never a copy. The derivation is held to
 * `admin-audit-index.fixtures.json` from both sides: the library's
 * `admin-audit-index.spec.ts` asserts every worked example against the
 * TypeScript function, and `admin-audit-index.test.mjs` (run by
 * `backfill-admin-audit-index.mjs --self-test` too) asserts them against
 * these.
 *
 * The group and the kind are the parts that differ in kind. The library asks
 * the plugin activity REGISTRY, which a script cannot load; this asks the
 * fixture's `groups` and `accessActions`, a copy of what the registry and the
 * core read list hold. `apps/console/specs/admin-audit-action-groups.spec.ts`
 * loads every plugin and fails when the two disagree, so a plugin adding a
 * code, a prefix or a read action turns CI red until the fixture names it —
 * which is when the backfill has to be re-run over the rows written before.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nameSearchTokens } from './name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** The worked examples and the registry's copy, shared with the library's spec. */
export const ADMIN_AUDIT_INDEX_FIXTURES = JSON.parse(
  readFileSync(join(here, 'admin-audit-index.fixtures.json'), 'utf8'),
)

/** `ADMIN_AUDIT_SEARCHED_FIELDS`, in the order they claim the token budget. */
const SEARCHED_FIELDS = ['action', 'actorEmail', 'target', 'actorUid', 'scope', 'reason', 'note']
/** `ADMIN_AUDIT_SEARCH_TOKEN_LIMIT`. */
const SEARCH_TOKEN_LIMIT = 200
const SEPARATORS = /[^\p{L}\p{N}]+/gu

/**
 * `adminAuditSearchTokens`: each searched value tokenized as written and
 * split at its separators, capped.
 *
 * @param {Record<string, unknown>} entry
 * @returns {string[]}
 */
export function adminAuditSearchTokens(entry) {
  const tokens = new Set()
  for (const field of SEARCHED_FIELDS) {
    const value = entry?.[field]
    if (typeof value !== 'string' || !value.trim()) continue
    const words = [...nameSearchTokens(value), ...nameSearchTokens(value.replace(SEPARATORS, ' '))]
    for (const token of words) {
      tokens.add(token)
      if (tokens.size >= SEARCH_TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/**
 * `adminAuditActionGroup`, by the fixture's copy of the registry: a
 * registered code, then a registered prefix, then the action's leading
 * namespace — the order `pluginStaffAuditActionGroup` asks in.
 *
 * @param {unknown} action
 * @param {Array<{ id: string, codes: string[], prefixes: string[] }>} [groups]
 * @returns {string}
 */
export function adminAuditActionGroup(action, groups = ADMIN_AUDIT_INDEX_FIXTURES.groups) {
  const text = typeof action === 'string' ? action.trim() : ''
  if (!text) return ''
  for (const group of groups) {
    if (group.codes.includes(text)) return group.id
  }
  for (const group of groups) {
    if (group.prefixes.some((prefix) => text.startsWith(prefix))) return group.id
  }
  const dot = text.indexOf('.')
  return dot > 0 ? text.slice(0, dot) : text
}

/**
 * `adminAuditKind`, by the fixture's copy of the core read list and each
 * group's declared reads.
 *
 * @param {unknown} action
 * @returns {'access' | 'change'}
 */
export function adminAuditKind(action, fixtures = ADMIN_AUDIT_INDEX_FIXTURES) {
  if (typeof action !== 'string' || !action) return 'change'
  if (fixtures.accessActions.includes(action)) return 'access'
  return fixtures.groups.some((group) => group.accessActions.includes(action)) ? 'access' : 'change'
}

const segmentsOf = (target) =>
  typeof target === 'string' ? target.trim().split('/').filter(Boolean) : []

/**
 * `adminAuditTargetKind`: the target's first segment, up to a `:`.
 *
 * @param {unknown} target
 * @returns {string}
 */
export function adminAuditTargetKind(target) {
  const [first = ''] = segmentsOf(target)
  const colon = first.indexOf(':')
  return colon > 0 ? first.slice(0, colon) : first
}

/**
 * `adminAuditTargetHostId`: the id after a `hosts` segment, or null.
 *
 * @param {unknown} target
 * @returns {string | null}
 */
export function adminAuditTargetHostId(target) {
  const segments = segmentsOf(target)
  for (let at = 0; at < segments.length - 1; at += 2) {
    if (segments[at] === 'hosts') return segments[at + 1] || null
  }
  return null
}

/**
 * `adminAuditIndexFields`: every stamped field for one row, in the library's
 * key order.
 *
 * @param {Record<string, unknown>} entry
 */
export function adminAuditIndexFields(entry, fixtures = ADMIN_AUDIT_INDEX_FIXTURES) {
  return {
    actionGroup: adminAuditActionGroup(entry?.action, fixtures.groups),
    kind: adminAuditKind(entry?.action, fixtures),
    targetKind: adminAuditTargetKind(entry?.target),
    targetHostId: adminAuditTargetHostId(entry?.target),
    searchTokens: adminAuditSearchTokens(entry),
  }
}

/**
 * `withAdminAuditIndex`: the row as it is stored — what every script write
 * passes its data through.
 *
 * @param {Record<string, unknown>} entry
 */
export function stampAdminAuditIndex(entry) {
  return { ...entry, ...adminAuditIndexFields(entry) }
}
