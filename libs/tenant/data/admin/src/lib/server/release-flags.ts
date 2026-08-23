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
  filterPluginsByReleaseFlags,
  isReleaseFlagKey,
  isReleaseFlagOnForOrg,
  parseOrgReleaseFlagOverrides,
  parseReleaseFlagValue,
  RELEASE_FLAGS,
  resolveEffectivePlan,
  type OrgPlan,
  type OrgReleaseFlagOverrides,
  type ReleaseFlagKey,
  type ReleaseFlagValue,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'

/**
 * Server-side release-flag verdicts (AGL-422): the tenant loader and the
 * API dispatchers subtract flagged-off plugins, so the server needs the
 * same Remote Config values the console client activates. The admin SDK
 * template read is cached with a short TTL — flag flips propagate within
 * a minute without a per-request round trip.
 *
 * Fail-open to the REGISTRY DEFAULTS (not "all on"): environments without
 * Remote Config (emulator e2e, local dev) behave exactly like an
 * unpublished template does on the client, so verdicts agree across
 * surfaces.
 */

const TTL_MS = 60_000

let cache:
  | { at: number; values: Record<ReleaseFlagKey, ReleaseFlagValue> }
  | undefined
let pending:
  | Promise<Record<ReleaseFlagKey, ReleaseFlagValue>>
  | undefined

const registryDefaults = (): Record<ReleaseFlagKey, ReleaseFlagValue> =>
  Object.fromEntries(
    RELEASE_FLAGS.map((definition) => [
      definition.key,
      { enabled: definition.defaultEnabled },
    ]),
  ) as Record<ReleaseFlagKey, ReleaseFlagValue>

export async function getServerReleaseFlagValues(): Promise<
  Record<ReleaseFlagKey, ReleaseFlagValue>
> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values
  if (!pending) {
    pending = (async () => {
      const values = registryDefaults()
      try {
        const template = await firebaseAdmin.app().remoteConfig().getTemplate()
        for (const definition of RELEASE_FLAGS) {
          const parameter = template.parameters[definition.key]
          const defaultValue = parameter?.defaultValue
          const raw =
            defaultValue && 'value' in defaultValue
              ? defaultValue.value
              : undefined
          values[definition.key] = parseReleaseFlagValue(
            raw,
            definition.defaultEnabled,
          )
        }
      } catch {
        // No Remote Config here (emulator/local) — registry defaults gate.
      }
      cache = { at: Date.now(), values }
      return values
    })().finally(() => {
      pending = undefined
    })
  }
  return pending
}

/**
 * Per-org release-flag overrides (AGL-1635), read off `orgs/{orgId}`.
 *
 * Cached on the same TTL as the template read above, and for the same
 * reason: these are consulted on every published page render and every API
 * dispatch, so an uncached read would add a Firestore round trip to the hot
 * path. A grant therefore takes up to a minute to land, matching how long a
 * flag flip already takes — one propagation story, not two.
 *
 * Keyed by orgId because a subject may be a uid or a hostId, and only an
 * org can carry overrides. Failure is silent and yields `{}`: a missing org
 * doc or a denied read must gate exactly as "no override set", never as an
 * error that takes a published page down.
 */
/**
 * What one org read answers about release flags: the staff overrides, and
 * the org's EFFECTIVE plan for tier targeting (AGL-2486).
 *
 * `plan` is null when the read did not produce an org document — missing,
 * denied, or no Firestore at all. Deliberately not `'free'`: an org whose
 * doc could not be read has an UNKNOWN tier, and
 * `resolveEffectivePlan(undefined)` answers `'free'`, which would hand a
 * Free-targeted flag to every org the read failed for. The two cases have to
 * stay distinguishable at the boundary, because the evaluator treats an
 * unknown plan as a refusal and a known `'free'` as a match.
 */
interface OrgReleaseFlagTargeting {
  overrides: OrgReleaseFlagOverrides
  plan: OrgPlan | null
}

const orgCache = new Map<string, { at: number; targeting: OrgReleaseFlagTargeting }>()

/**
 * Both halves of the per-org answer from ONE cached document read.
 *
 * Sharing the read is the point: `plan` and `releaseFlags` live on the same
 * org document, this runs on every published page render and every API
 * dispatch, and fetching the tier separately would have doubled the hot-path
 * Firestore traffic to learn something already in hand.
 */
export async function getOrgReleaseFlagTargeting(
  orgId: string | null | undefined,
): Promise<OrgReleaseFlagTargeting> {
  if (!orgId) return { overrides: {}, plan: null }
  const hit = orgCache.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.targeting
  const targeting: OrgReleaseFlagTargeting = { overrides: {}, plan: null }
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()
    const data = snapshot.data()
    targeting.overrides = parseOrgReleaseFlagOverrides(data?.['releaseFlags'])
    // Only when a document actually came back. `snapshot.data()` is undefined
    // for a missing doc, and `resolveEffectivePlan` would read that as Free.
    if (data) targeting.plan = resolveEffectivePlan(data as any)
  } catch {
    // No Firestore here, or the doc is unreadable — inherit, never fail.
  }
  orgCache.set(orgId, { at: Date.now(), targeting })
  return targeting
}

export async function getOrgReleaseFlagOverrides(
  orgId: string | null | undefined,
): Promise<OrgReleaseFlagOverrides> {
  return (await getOrgReleaseFlagTargeting(orgId)).overrides
}

/**
 * The verdict for ONE flag and ONE org, overrides applied (AGL-1635).
 *
 * The surfaces that gate a single flag server-side — the tenant admin bar
 * slot, edit-context redemption, edit-access minting — resolve through here
 * rather than reading `getServerReleaseFlagValues()` and calling
 * `isReleaseFlagOn` themselves, so a per-org grant reaches all of them at
 * once. A gate that kept the old two-step would silently ignore overrides,
 * which is the failure this issue exists to fix.
 */
export async function isServerReleaseFlagOnForOrg(
  flagKey: ReleaseFlagKey,
  orgId: string | null | undefined,
): Promise<boolean> {
  const [values, targeting] = await Promise.all([
    getServerReleaseFlagValues(),
    getOrgReleaseFlagTargeting(orgId),
  ])
  return isReleaseFlagOnForOrg(
    flagKey,
    values[flagKey],
    orgId ?? null,
    targeting.overrides,
    targeting.plan,
  )
}

/** Test seam: drops both caches so a spec can change a verdict. */
export function __resetReleaseFlagCaches(): void {
  cache = undefined
  orgCache.clear()
}

/**
 * The server half of the plugin release gate (AGL-422): subtracts
 * flagged-off first-party plugins from an effective set. The staff bypass is
 * only paid for when something was actually subtracted AND the request
 * carries a bearer token — the common all-flags-on path never verifies.
 *
 * `orgId` is the ONLY subject: it selects the per-org overrides (AGL-1635)
 * and it is the rollout bucket. AGL-1635 took a separate `subjectId` here
 * because callers fell back to a hostId when the org lookup missed, and a
 * hostId must never be read as an org id. AGL-1656 removed that fallback
 * instead of accommodating it — a hostId and an orgId hash to different
 * buckets, so a mid-rollout flag could land the published site and the
 * console on opposite sides of the same percentage for the same workspace.
 * With one subject the two cannot disagree by construction, and there is no
 * longer a parameter through which a non-org subject could be reintroduced.
 */
export async function filterEnabledPluginsByReleaseFlags(
  pluginIds: readonly string[],
  options: {
    /**
     * The org this request belongs to: rollout bucket AND override key.
     * Null when no org could be resolved — a subject-less request gets the
     * fully-enabled flags only, never a partial rollout.
     */
    orgId?: string | null
    /** Raw Authorization header, when the caller has one (API dispatch). */
    authorization?: string | null
  },
): Promise<string[]> {
  const [values, targeting] = await Promise.all([
    getServerReleaseFlagValues(),
    getOrgReleaseFlagTargeting(options.orgId),
  ])
  const isFlagOn = (flagKey: string): boolean =>
    isReleaseFlagKey(flagKey)
      ? isReleaseFlagOnForOrg(
          flagKey,
          values[flagKey],
          options.orgId ?? null,
          targeting.overrides,
          targeting.plan,
        )
      : true
  const filtered = filterPluginsByReleaseFlags(pluginIds, isFlagOn)
  if (filtered.length === pluginIds.length) return filtered

  const authorization = options.authorization ?? ''
  if (authorization.startsWith('Bearer ')) {
    try {
      const decoded = await firebaseAdmin
        .app()
        .auth()
        .verifyIdToken(authorization.slice('Bearer '.length))
      if (decoded['staff'] === true) return [...pluginIds]
    } catch {
      // Invalid token — gate as anonymous.
    }
  }
  return filtered
}
