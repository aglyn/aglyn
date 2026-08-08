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

import { unstable_cache } from 'next/cache'

/**
 * Cross-request caching for the tenant render path's Firestore reads
 * (AGL-1302, the caching half of AGL-1151).
 *
 * Every tenant SSR render fanned out to ~15–40 uncached Admin-SDK reads —
 * host resolution, org billing, screen + version, the layout chain, and the
 * whole compose bundle (components, variables, functions, datasets,
 * workflows, plugin installs). None of that data is per-visitor, and almost
 * all of it is identical across every path on a site, so a 50-route sweep
 * paid the same host-scoped reads 50 times over. Routine verification
 * traffic alone burned ~44K reads/day (87% of the free tier).
 *
 * This module is deliberately a THIN wrapper around `unstable_cache` rather
 * than a cache of its own, so invalidation stays Next's: entries are tagged
 * and the existing publish/revalidate path (`/api/revalidate`, AGL-1150)
 * busts them with `revalidateTag` the same moment it drops the page HTML.
 *
 * Ground rules encoded here, because `unstable_cache` enforces none of them:
 *
 * - VALUES ARE JSON. `unstable_cache` stores `JSON.stringify(result)`, so a
 *   cache HIT returns plain data while a MISS would return live objects —
 *   Firestore `Timestamp`s, most importantly, whose `.seconds` getter decays
 *   to `_seconds` across the round trip. Serving two shapes for the same
 *   read is how a schedule check works in testing and misfires in
 *   production, so `withRenderCache` normalizes the MISS through the same
 *   JSON round trip. Callers whose logic needs live `Timestamp` semantics
 *   must not cache that read (see the pending-`publishSchedule` guards at
 *   the call sites).
 *
 * - NEGATIVES ARE NOT CACHED unless a caller opts in via `store`. A
 *   transient miss (host not found, doc missing) cached for the TTL is a
 *   self-inflicted outage; the Firestore negative-cache class of bug is
 *   exactly this shape.
 *
 * - OUTSIDE NEXT (jest, scripts) there is no incremental cache and
 *   `unstable_cache` throws its `incrementalCache missing` invariant before
 *   running the callback. The wrapper catches precisely that and falls back
 *   to the uncached read, so shared-lib specs exercise the same code path
 *   they always did.
 *
 * - NEVER cache per-user reads through this. Everything cached here must be
 *   a pure function of published site data.
 */

/**
 * One tag per host covers every host-scoped cached doc — the host doc, the
 * compose bundle, plugin installs, the sitemap payload. The tenant
 * `/api/revalidate` route busts it on publish (alongside its existing
 * `revalidatePath` calls), so a publish is exactly as instant as AGL-1150
 * made it; the TTL is only the backstop for writes that never announce
 * themselves.
 */
export const tenantDataTag = (hostId: string): string => `tenant-data:${hostId}`

/**
 * The alias→hostId resolution is tagged separately because it is the one
 * cache keyed BEFORE the hostId is known. It only changes on subdomain
 * rename or custom-domain (dis)connect, never on publish.
 */
export const tenantHostAliasTag = (alias: string): string =>
  `tenant-host:${alias}`

/**
 * A value that must be RETURNED but not STORED (a negative result, or a doc
 * carrying a pending publish schedule). Thrown out of the cached callback so
 * `unstable_cache` never writes it, caught by the wrapper and unwrapped.
 */
class BypassStore extends Error {
  constructor(readonly value: unknown) {
    super('render-cache bypass')
    this.name = 'RenderCacheBypass'
  }
}

const isMissingIncrementalCache = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('incrementalCache missing')

/**
 * The same normalization the page props already go through (`JSON.parse(
 * JSON.stringify(...))` at every loader exit), applied at the cache boundary
 * so hits and misses hand back byte-identical shapes.
 */
export function toPlainJson<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export interface RenderCacheOptions<T> {
  /**
   * Cache key parts. The FIRST part must be unique per read helper — every
   * call funnels through the same callback source, and `unstable_cache` keys
   * on callback text + key parts, so the name prefix is what keeps
   * `getScreen` and `getComponents` from colliding.
   */
  key: readonly string[]
  /** TTL in seconds — the staleness backstop when no tag bust arrives. */
  revalidate: number
  /** Tags `revalidateTag` can bust — see `tenantDataTag`. */
  tags: readonly string[]
  /** The uncached read. Must resolve to JSON-serializable data. */
  read: () => Promise<T>
  /**
   * Return `false` to serve the value WITHOUT storing it. Negative results
   * and docs whose live `Timestamp` semantics matter (pending publish
   * schedules) belong here. `undefined` is never stored regardless.
   */
  store?: (value: T) => boolean
}

export async function withRenderCache<T>(
  options: RenderCacheOptions<T>,
): Promise<T> {
  const { key, revalidate, tags, read, store } = options
  const cached = unstable_cache(
    async () => {
      const value = toPlainJson(await read())
      if (value === undefined || (store && !store(value))) {
        throw new BypassStore(value)
      }
      return value
    },
    [...key],
    { revalidate, tags: [...tags] },
  )
  try {
    return await cached()
  } catch (error) {
    if (error instanceof BypassStore) return error.value as T
    // No Next server context (jest, one-off scripts): the invariant throws
    // before the callback runs, so reading directly is not a double read.
    if (isMissingIncrementalCache(error)) return toPlainJson(await read())
    throw error
  }
}
