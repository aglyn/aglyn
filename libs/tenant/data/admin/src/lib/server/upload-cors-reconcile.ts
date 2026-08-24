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
 * Keep the media bucket's upload CORS in step with the names the console is
 * SERVED on (AGL-1452).
 *
 * ## Why this is automation rather than a checklist line
 *
 * GCS matches the CORS `origin` list as an exact string — no subtree form —
 * so every serving console name needs its own entry, and a missing one fails
 * only on files large enough to take the signed direct-to-GCS path, behind a
 * generic "try again" snackbar. Nothing about the symptom points at bucket
 * configuration, and nothing at attach time pointed at it either.
 *
 * That was already costing us, not merely threatening to. Driving real
 * preflights against `gs://aglyn-main.appspot.com` on 2026-08-20: of the
 * console project's seventeen attached names, exactly one —
 * `https://app.aglyn.com` — was permitted, while five names that serve the
 * console at 200 (`zgover.aglyn.com`, `test-org.aglyn.com`,
 * `aglyn-org.aglyn.com`, `sale-test.aglyn.com`, `zachary1748.aglyn.com`) were
 * refused. AGL-1452 recorded workspace subdomains as latent because none were
 * attached at the time; they are attached now.
 *
 * ## Serving names only
 *
 * A name attached as a REDIRECT never becomes a browser origin — the browser
 * is already at the redirect target before it uploads — so it needs no entry.
 * Measured: `console.aglyn.com` 308s and `app.aglyn.io` 307s to
 * `app.aglyn.com`, and neither is in the CORS list, and neither is broken.
 * `attachProjectDomain` therefore calls this only for a name it attached
 * WITHOUT a redirect.
 *
 * ## When it cannot
 *
 * The runtime service account may not hold `storage.buckets.update`. That is
 * a real and likely outcome, and the one thing this must not do about it is
 * be quiet: the verdict carries `permitted: false` and the exact ordered
 * read-modify-write command, so the failure is legible at attach time instead
 * of arriving days later as a broken upload. It never throws and never blocks
 * an attach — a domain must not fail to attach over a storage API.
 */

import {
  mergeUploadOrigins,
  permitsUploadOrigin,
  revokeUploadOrigins,
  uploadCorsRemedy,
  uploadOriginFor,
  type CorsRule,
} from '@aglyn/aglyn/server'

/**
 * The one origin a release must never take away.
 *
 * Configured rather than provisioned, so it will never appear in a detach —
 * but the guard is here rather than at the call site because the cost of
 * getting it wrong is every customer's large uploads at once, and a guard that
 * lives at the call site is a guard the next call site does not have.
 */
function platformOrigin(): string | null {
  return uploadOriginFor(
    process.env['NEXT_PUBLIC_CONSOLE_URL'] ?? 'app.aglyn.com',
  )
}

export interface UploadCorsVerdict {
  /** The origin a browser at this name will send. */
  origin: string
  /** Can a signed `PUT` from that origin complete, now that we are done? */
  permitted: boolean
  /** Origins this run added to the bucket. Empty when it was already covered. */
  added: string[]
  /** What a human must run, when we could not. Null when there is nothing owed. */
  remedy: string | null
  /** Which step failed, for a caller that wants to branch. */
  detail: string | null
}

/**
 * The bucket, behind a seam.
 *
 * Injectable so the merge and the failure paths are exercised without a
 * network — the reason AGL-1408 shipped broken is that the only leg nobody
 * could test cheaply was the only leg that mattered.
 */
export interface BucketCorsIO {
  bucket: string
  /** Null when the configuration could not be read at all. */
  read(): Promise<{ rules: CorsRule[]; metageneration: string } | null>
  /**
   * Write the merged configuration back, conditional on the metageneration
   * that was read — two attaches racing would otherwise clobber each other.
   */
  write(rules: CorsRule[], metageneration: string): Promise<void>
}

/** The live bucket, or null when this deployment has no media bucket configured. */
export function liveBucketCorsIO(): BucketCorsIO | null {
  const bucket = String(
    process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] ?? '',
  ).trim()
  if (!bucket) return null
  // Imported lazily, not at module scope. `firebase-admin.ts` builds a
  // Firebase app on load, and this module is imported by `workspace-domains`,
  // which had no Firebase dependency at all and must keep none — a domain
  // attach is an HTTP call to Vercel and nothing more.
  const handle = async () => {
    const { firebaseAdmin } = await import('./firebase-admin')
    return firebaseAdmin.app().storage().bucket(bucket)
  }
  return {
    bucket,
    read: async () => {
      const [metadata] = await (await handle()).getMetadata()
      return {
        rules: (metadata?.cors ?? []) as CorsRule[],
        metageneration: String(metadata?.metageneration ?? ''),
      }
    },
    write: async (rules, metageneration) => {
      await (await handle()).setMetadata(
        { cors: rules },
        metageneration ? { ifMetagenerationMatch: metageneration } : {},
      )
    },
  }
}

export async function reconcileUploadCors(
  host: string,
  io: BucketCorsIO | null = liveBucketCorsIO(),
): Promise<UploadCorsVerdict | null> {
  const origin = uploadOriginFor(host)
  if (!origin || !io) return null

  const refused = (detail: string): UploadCorsVerdict => ({
    origin,
    permitted: false,
    added: [],
    remedy: uploadCorsRemedy(io.bucket, [origin]),
    detail,
  })

  let current: { rules: CorsRule[]; metageneration: string } | null
  try {
    current = await io.read()
  } catch (error) {
    console.error('[upload-cors] could not read bucket CORS', io.bucket, error)
    return refused('read-failed')
  }
  if (!current) return refused('read-failed')

  if (permitsUploadOrigin(current.rules, origin)) {
    return { origin, permitted: true, added: [], remedy: null, detail: null }
  }

  let merged: { rules: CorsRule[]; added: string[] }
  try {
    merged = mergeUploadOrigins(current.rules, [origin])
  } catch (error) {
    // `mergeUploadOrigins` throws only on a wildcard, which `uploadOriginFor`
    // has already ruled out — so reaching here means the invariant moved.
    console.error('[upload-cors] refused to build a policy', origin, error)
    return refused('merge-refused')
  }

  try {
    await io.write(merged.rules, current.metageneration)
  } catch (error) {
    console.error(
      '[upload-cors] could not write bucket CORS — large uploads from',
      origin,
      'will fail until a human runs the command in the verdict',
      error,
    )
    return refused('write-failed')
  }

  return {
    origin,
    permitted: true,
    added: merged.added,
    remedy: null,
    detail: null,
  }
}

/** What a detach did, or could not do, about the origin it left behind. */
export interface UploadCorsRelease {
  /** The origin the detached name used to send. */
  origin: string
  /** Is that origin gone from the bucket now? */
  revoked: boolean
  /** Why not, for a caller that wants to branch. Null when it is gone. */
  detail: string | null
}

/**
 * Take an origin back off the bucket when its name stops serving the console
 * (AGL-1452).
 *
 * The mirror of `reconcileUploadCors`, and the half that was missing: attaching
 * added an origin and detaching left it. That is a standing permission for a
 * host we no longer serve — and for a white-label customer domain, a host that
 * somebody else still controls, on a bucket where the signed URL IS the
 * authorization.
 *
 * Same three properties as the attach side. It never throws, never blocks a
 * detach, and reports what it could not do rather than going quiet: a domain
 * must not fail to detach because a storage API was slow, and the operator who
 * detached a customer must be able to see that the permission outlived them.
 *
 * Refuses the platform origin structurally, not by convention.
 */
export async function releaseUploadCors(
  host: string,
  io: BucketCorsIO | null = liveBucketCorsIO(),
): Promise<UploadCorsRelease | null> {
  const origin = uploadOriginFor(host)
  if (!origin || !io) return null
  if (origin === platformOrigin()) {
    return { origin, revoked: false, detail: 'platform-origin' }
  }

  let current: { rules: CorsRule[]; metageneration: string } | null
  try {
    current = await io.read()
  } catch (error) {
    console.error('[upload-cors] could not read bucket CORS', io.bucket, error)
    return { origin, revoked: false, detail: 'read-failed' }
  }
  if (!current) return { origin, revoked: false, detail: 'read-failed' }

  // Already gone is the success case, not a no-op to report as a failure: a
  // detach that runs twice must not read as a permission that would not go.
  if (!permitsUploadOrigin(current.rules, origin)) {
    return { origin, revoked: true, detail: null }
  }

  const { rules, removed } = revokeUploadOrigins(current.rules, [origin], {
    keep: [platformOrigin() ?? ''].filter(Boolean),
  })
  if (removed.length === 0) {
    return { origin, revoked: false, detail: 'refused' }
  }

  try {
    await io.write(rules, current.metageneration)
  } catch (error) {
    console.error(
      '[upload-cors] could not revoke bucket CORS —',
      origin,
      'keeps a standing permission to complete signed uploads; run',
      'npm run check:upload-cors -- --prune',
      error,
    )
    return { origin, revoked: false, detail: 'write-failed' }
  }
  return { origin, revoked: true, detail: null }
}
