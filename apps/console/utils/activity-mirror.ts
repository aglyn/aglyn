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
 * One event, one row, in a feed that reads BOTH logs (AGL-3660).
 *
 * Several writers file a site event twice on purpose: once in the site's own
 * log (`hosts/{hostId}/activity`) so the site's page shows it, and once in
 * the organization's (`orgs/{orgId}/activity`) so the org's own feed lists
 * it — an AI job's outputs (`logAiJobOutput`), a duplicated resource, a
 * workflow change, a privacy erasure. Each copy is right in the log it lives
 * in. A reader that unions the two logs — the staff user page's
 * collection-group read, the org-wide merge on the team and staff org pages
 * — read both copies and showed every such event twice, once with the site
 * as Where and once with "Organization".
 *
 * The copies are the same act: same code, same target, same actor, written
 * one after the other by one call, so they land within a second of each
 * other. The org copy is the one dropped, because the site is the more
 * precise answer to Where. An org row with no site twin in what was read —
 * an invite, a role change, an output of a job nobody was present for, which
 * only the org log holds — is kept: nothing here removes an event, only its
 * second copy.
 *
 * Not a filter. Every clause and the search are already on the query; this
 * collapses rows the query correctly returned twice.
 */

/** The fields a mirrored pair agrees on, as a reader flattened them. */
export interface MirrorCandidate {
  $id: string
  /** `hosts/{id}` or `orgs/{id}`; an id is unique only within one log. */
  scopePath?: string
  scopeType: 'host' | 'org' | 'unknown'
  action?: string
  target?: Record<string, unknown> | null
  actorId?: string | null
  createdAt: { seconds: number } | null
}

/** Copies written by one call land this close together, in seconds. */
export const MIRROR_WINDOW_SECONDS = 1

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** What both copies of one event share; time is matched separately. */
function mirrorKey(entry: MirrorCandidate): string | null {
  if (!entry.action || !entry.actorId) return null
  const target = entry.target ?? {}
  return JSON.stringify([
    entry.action,
    entry.actorId,
    text(target['type']),
    text(target['id']),
    text(target['name']),
    text(target['versionId']),
  ])
}

/**
 * The org rows in `entries` that are the second copy of a site row also in
 * `entries`, as `${scopeType}:${$id}` — each site row excuses at most one org
 * row, so two genuinely separate org events never hide behind one site row.
 */
export function mirroredOrgCopies(entries: readonly MirrorCandidate[]): Set<string> {
  const hosts = new Map<string, Array<{ seconds: number; used: boolean }>>()
  for (const entry of entries) {
    if (entry.scopeType !== 'host' || !entry.createdAt) continue
    const key = mirrorKey(entry)
    if (!key) continue
    const list = hosts.get(key) ?? []
    list.push({ seconds: entry.createdAt.seconds, used: false })
    hosts.set(key, list)
  }
  const dropped = new Set<string>()
  if (!hosts.size) return dropped
  for (const entry of entries) {
    if (entry.scopeType !== 'org' || !entry.createdAt) continue
    const key = mirrorKey(entry)
    const candidates = key ? hosts.get(key) : undefined
    if (!candidates) continue
    const seconds = entry.createdAt.seconds
    let best: { seconds: number; used: boolean } | null = null
    for (const candidate of candidates) {
      if (candidate.used) continue
      const distance = Math.abs(candidate.seconds - seconds)
      if (distance > MIRROR_WINDOW_SECONDS) continue
      if (!best || distance < Math.abs(best.seconds - seconds)) best = candidate
    }
    if (!best) continue
    best.used = true
    dropped.add(mirrorId(entry))
  }
  return dropped
}

/** An entry's identity across both logs: an id is unique only within one. */
export function mirrorId(entry: Pick<MirrorCandidate, 'scopePath' | 'scopeType' | '$id'>): string {
  return `${entry.scopePath ?? entry.scopeType}:${entry.$id}`
}

/** `entries` without the org copies of site rows among them. */
export function withoutMirroredCopies<T extends MirrorCandidate>(entries: readonly T[]): T[] {
  const dropped = mirroredOrgCopies(entries)
  return dropped.size ? entries.filter((entry) => !dropped.has(mirrorId(entry))) : [...entries]
}
