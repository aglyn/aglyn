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
 * WHO CLAIMS THE BYTES IN THE ARTIFACTS BUCKET (AGL-3080).
 *
 * Two scheduled jobs sweep the plugin-artifacts bucket. The reaper deletes
 * every object no stored version claims; the re-verifier re-runs the static
 * checker over the bytes and writes each verdict back. Both are the
 * PLATFORM's jobs — the bucket is platform infrastructure, the object path
 * is the loader's convention, the verifier is the trust lint, and the cron
 * that fires them is the console's. Both also had to read
 * `pluginVersions` and `marketplaceListings` to do it, which is a plugin's
 * storage reached around the plugin, from an `/api/admin` route.
 *
 * So the plugin answers WHAT IT STORES and the console decides what to do
 * about it. The sibling of `core.site-cache` with the direction reversed:
 * there the shell offers a capability down, here the owner of the documents
 * answers a question the shell cannot answer for itself.
 *
 * ## ⛔ AN ABSENT OR PARTIAL INVENTORY REFUSES THE RUN
 *
 * Decide the failure direction first — {@link PLUGIN_ARTIFACT_INVENTORY} and
 * `core.site-cache` look alike and fail opposite ways.
 *
 * Every object the reaper deletes is deleted precisely because nothing
 * claimed it, the bucket has no object versioning, and a claim that was
 * never read looks exactly like a claim that does not exist. An empty answer
 * is therefore the most dangerous answer this contract can give: read as
 * "nothing is claimed", it empties the bucket permanently.
 *
 * {@link pluginArtifactClaims} can never hand back an empty list that means
 * "could not read". It answers a discriminated result — a caller reading
 * `rows` on a refusal does not compile, which is the point — and nothing
 * registered, a throw, and a walk that hit the caller's own ceiling all
 * arrive as `outcome: 'refused'` with a sentence the run prints.
 *
 * ## `listingId`, and why the word is not minted fresh here
 *
 * The bucket's object path is `artifacts/{listingId}/{version}/{sha}.bundle`
 * and both the serving route and `planArtifactReap` already read it that
 * way. A second vocabulary for the same segment is the defect `e32405cb5`
 * removed from the capacity gates — two names for one thing, kept agreeing
 * by hand — so this contract uses the path's word. A future plugin that
 * stores artifacts inherits a noun that is not about it; renaming the
 * segment everywhere is the honest fix, and it is not this change.
 */

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/** A verdict written back onto a stored version by the re-verifier. */
export interface PluginArtifactVerdict {
  ok: boolean
  problems: unknown[]
  checks: unknown
  /** The exact bytes the verdict was computed over. */
  sha256: string
  verifierVersion: number
}

/** What keeps one object in the bucket alive. */
export interface PluginArtifactClaim {
  /** The object path's first segment — the owning record's id. */
  listingId: string
  /** The version string, the object path's second segment. */
  version: string
  /** The exact bytes claimed, the object path's third segment. */
  sha256: string
  /**
   * Whether the owning record still exists.
   *
   * FALSE is reported and never reaped: the platform does not cascade a
   * delete into subcollections and an install resolves a version by path, so
   * the bytes of a hard-deleted record are still being loaded by somebody.
   */
  ownerLive: boolean
}

/** A claim, plus everything the re-verifier needs to judge the bytes. */
export interface PluginArtifactVersion extends PluginArtifactClaim {
  /** A name for the run's report; falls back to the id. */
  ownerName: string
  /** The owner's review state as the report prints it, or `'unknown'`. */
  reviewStatus: string
  /** How many installs are on this version, for the regression report. */
  activeInstalls: number
  /** Where a human opens this version, or `''` when there is no page. */
  reviewLink: string
  /** The cached verdict, or `undefined` when nothing has checked these bytes. */
  storedVerdict?: unknown
  /** Origins the version's manifest declares it will reach. */
  declaredNetwork: readonly string[]
  /** What the manifest says it contributes, or `null` when it says nothing. */
  declaredContributions: unknown
  /**
   * Caches a fresh verdict on THIS version.
   *
   * A method on the row rather than a lookup on the source, because the row
   * is where the plugin already holds the document it read — asking it to
   * find the document again by id would be a second query per version, and
   * a version's document id and its `version` field are not guaranteed to be
   * the same string, so the second lookup could write to a sibling document
   * that nothing reads.
   *
   * MAY REJECT, and the caller treats that as a cache miss. The verdict is a
   * cache; the report a person reads has already been computed, and a sweep
   * that stopped at the first write failure would leave the rest of the
   * platform unchecked over one.
   */
  record(verdict: PluginArtifactVerdict): Promise<void>
}

/**
 * The shape both listings answer with: trusted rows, or a refusal.
 *
 * ⛔ THE DISCRIMINANT IS A STRING, AND IT HAS TO BE. This repo compiles with
 * `strictNullChecks: false` (tsconfig.base.json), and TypeScript does not
 * narrow a BOOLEAN-literal discriminant under it — `if (!answer.complete)`
 * compiles to no narrowing at all, so `answer.reason` is an error and, worse,
 * `answer.rows` stays readable on the refusal branch. That is precisely the
 * misread this contract exists to make impossible, so the flag that carries
 * it is a word.
 */
export type PluginArtifactListing<T> =
  | {
      outcome: 'listed'
      rows: readonly T[]
      /** Documents read, for the run's report. */
      scanned: number
    }
  | {
      outcome: 'refused'
      /** Why the answer cannot be trusted, in the words the run prints. */
      reason: string
      /** How far the walk got before it stopped. */
      scanned: number
    }

export interface PluginArtifactInventorySource {
  /**
   * Every claim on the bucket, completely or not at all.
   *
   * Separate from {@link listVersions} so the reaper can read the two path
   * segments and the hash and leave the manifests on the server. It does not
   * change what is BILLED — storage charges per document either way — but a
   * version document carries its whole manifest, and a weekly sweep of every
   * version on the platform should not drag all of them across the wire.
   *
   * `maxScanned` is the CALLER's refusal threshold, not the walk's page
   * size: past it the answer must be `refused`, because a claim set this run
   * could not finish reading cannot be reaped against.
   */
  listClaims(options: {
    maxScanned: number
  }): Promise<PluginArtifactListing<PluginArtifactClaim>>
  /** Every stored version with what a re-verification needs to judge it. */
  listVersions(options: {
    maxScanned: number
  }): Promise<PluginArtifactListing<PluginArtifactVersion>>
}

/**
 * One implementation. Two would each answer about their own storage and the
 * reaper would delete what the other one claims — the exact mistake the
 * refusal shape exists to prevent, arriving by a different door.
 */
export const PLUGIN_ARTIFACT_INVENTORY =
  definePluginServiceContract<PluginArtifactInventorySource>(
    'core.plugin-artifact-inventory',
    { multiple: false },
  )

/** Installs the owner of the artifacts bucket's documents. */
export function registerPluginArtifactInventory(
  source: PluginArtifactInventorySource,
  options?: { pluginId?: string },
): void {
  if (
    typeof source?.listClaims !== 'function' ||
    typeof source?.listVersions !== 'function'
  ) {
    throw new Error(
      'a plugin artifact inventory needs listClaims and listVersions ' +
        'functions',
    )
  }
  registerPluginService(PLUGIN_ARTIFACT_INVENTORY, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Whether anything owns the artifacts bucket on this deployment. */
export function hasPluginArtifactInventory(): boolean {
  return Boolean(resolvePluginService(PLUGIN_ARTIFACT_INVENTORY))
}

/** The refusal both readers answer with when nothing owns the bucket. */
function unowned(): PluginArtifactListing<never> {
  console.error(
    '[artifact-inventory] nothing owns the artifacts bucket, so no run may ' +
      'conclude that an object is unclaimed. The owning plugin registers ' +
      'this on the consoleApi surface.',
  )
  return {
    outcome: 'refused',
    reason:
      'No plugin owns the stored artifacts on this deployment, so nothing ' +
      'can say which objects are still claimed.',
    scanned: 0,
  }
}

/** Guards one listing's answer. Never throws; never invents rows. */
async function trustedListing<T>(
  read: () => Promise<PluginArtifactListing<T>>,
): Promise<PluginArtifactListing<T>> {
  try {
    const result = await read()
    // A source that answered `listed` with no rows is a bug in the source,
    // and reaping on it would delete every object in the bucket. Refusing
    // costs a week; the alternative cannot be undone.
    if (result.outcome === 'listed' && !Array.isArray(result.rows)) {
      return {
        outcome: 'refused',
        reason: 'The artifact inventory returned no rows.',
        scanned: 0,
      }
    }
    return result
  } catch (error) {
    console.error('[artifact-inventory] listing failed', error)
    return {
      outcome: 'refused',
      reason: 'The artifact inventory could not be read.',
      scanned: 0,
    }
  }
}

/**
 * Every claim on the bucket, or why the answer cannot be trusted.
 *
 * NEVER THROWS and never answers an empty list that means "could not read" —
 * see the module docblock for what an empty list would cost.
 */
export async function pluginArtifactClaims(options: {
  maxScanned: number
}): Promise<PluginArtifactListing<PluginArtifactClaim>> {
  const source = resolvePluginService(PLUGIN_ARTIFACT_INVENTORY)
  if (!source) return unowned()
  return trustedListing(() => source.listClaims(options))
}

/** Every stored version with what a re-verification needs to judge it. */
export async function pluginArtifactVersions(options: {
  maxScanned: number
}): Promise<PluginArtifactListing<PluginArtifactVersion>> {
  const source = resolvePluginService(PLUGIN_ARTIFACT_INVENTORY)
  if (!source) return unowned()
  return trustedListing(() => source.listVersions(options))
}
