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
 * Attach and detach names for the console (AGL-1136).
 *
 * Two layers. The bottom one — `attachProjectDomain` / `detachProjectDomain` —
 * takes a fully-qualified name and is what a custom **console** domain uses
 * (AGL-1373). The top one is the workspace-subdomain pair below, which is that
 * primitive with `{slug}.aglyn.com` built for it.
 *
 * The hosting vendor is no longer either of them. Registering a name goes
 * through `domain-provider.ts`, so the same workspace subdomain is created by
 * Vercel's API on Aglyn's own hosting, by a wildcard record on a Docker
 * install, or by whatever an operator put behind the webhook driver. What
 * stays here is everything that is Aglyn's own policy rather than a vendor's:
 * the slug arithmetic, the upload-CORS reconcile, and the three properties
 * below.
 *
 * AGL-1135 removed the `*.aglyn.com` wildcard, because it meant every
 * hostname under the domain served a real console sign-in page —
 * `billing-security-update.aglyn.com` returned 200 with a valid certificate.
 * Removing it made unregistered names 404, and made **registered** names
 * something that has to be registered: a slug only resolves if that exact
 * domain is attached.
 *
 * Nothing did that, so every workspace created after AGL-1135 had a subdomain
 * that 404s. AGL-1115 then made signup provision an org, which turned a latent
 * gap into one every new account hits.
 *
 * ## Three properties, in the order they matter
 *
 * 1. **It can never fail an org.** Every entry point swallows its errors and
 *    returns a verdict instead of throwing. The console is path-routed
 *    (`app.aglyn.com/{slug}`) and that is the canonical form, so a workspace
 *    with no subdomain is fully usable — while an org creation that rolled
 *    back because a DNS API was slow would not be.
 * 2. **Unconfigured is a no-op, not an error.** With no provider this reports
 *    `skipped`. A deployment that registers names some other way must not log
 *    an error per signup forever.
 * 3. **A rename ADDS without removing.** The old slug keeps a tombstone that
 *    308s to the new one (AGL-585/236), and a redirect can only run on a
 *    hostname that still resolves. Detaching the old domain would break the
 *    very redirect the tombstone exists to serve.
 */

import {
  domainProvider,
  redirectHostname,
  type DomainAttachOptions,
  type DomainOutcome,
  type DomainScope,
  type ProjectDomainStatus,
} from './domain-provider'
import {
  reconcileUploadCors,
  releaseUploadCors,
  type UploadCorsRelease,
  type UploadCorsVerdict,
} from './upload-cors-reconcile'

export {
  domainStateServes,
  redirectHostname,
  type ProjectDomainState,
  type ProjectDomainStatus,
  type ProjectDomainVerification,
} from './domain-provider'

export type WorkspaceDomainOutcome = DomainOutcome

export interface WorkspaceDomainResult {
  outcome: WorkspaceDomainOutcome
  domain: string
  detail?: string
  /**
   * Whether a browser at this name can complete a signed direct-to-GCS upload
   * (AGL-1452).
   *
   * Present only when the attach made the name a SERVING origin — a redirect
   * never becomes one. `permitted: false` carries the exact command a human
   * must run, so the gap is legible here rather than days later as a large
   * upload that fails behind a generic snackbar.
   */
  uploadCors?: UploadCorsVerdict | null
  /**
   * What a DETACH did about the origin the name leaves behind (AGL-1452).
   *
   * The attach half without this one only ever grows the allowlist. A stale
   * origin is a standing permission to complete a signed upload, held by a host
   * we no longer serve — and for a white-label console domain, one the customer
   * still controls.
   */
  uploadCorsRelease?: UploadCorsRelease | null
}

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

function domainFor(slug: string): string {
  return `${String(slug ?? '').trim().toLowerCase()}.${WORKSPACE_DOMAIN}`
}

export type ProjectDomainOptions = DomainAttachOptions

/**
 * Attach one fully-qualified name to the console.
 *
 * Idempotent by contract: a name already registered comes back as
 * `already-exists`, which is success — the reconcile script and the create
 * path can both run without coordinating.
 *
 * ⚠️ Tolerating `already-exists` is only safe while **every** name this
 * function is asked to attach is also claimed in Firestore. Without that, a
 * second org attaches a name someone else already holds, reads it as success,
 * and gets a console that looks healthy while its visitors are served — or
 * redirected — somewhere else. That is the AGL-743 shape, and
 * `console-domains.ts` is where the claim is kept in step.
 */
export async function attachProjectDomain(
  name: string,
  options: ProjectDomainOptions = {},
  scope: DomainScope = 'console',
): Promise<WorkspaceDomainResult> {
  const result = await domainProvider().attach(scope, name, options)
  if (result.outcome !== 'attached' && result.outcome !== 'already-exists') {
    return result
  }
  const redirect = options.redirectTo ? redirectHostname(options.redirectTo) : null
  return { ...result, ...(await uploadCorsFor(result.domain, redirect, scope)) }
}

/**
 * The upload-CORS verdict for a name this call just registered.
 *
 * Nothing for a REDIRECT: the browser is already at the redirect target before
 * it uploads, so that name is never an origin, and an entry for it would be
 * permission granted for nothing. Every unnecessary origin is one more site
 * that could spend a leaked signed URL.
 *
 * Nothing for a TENANT name either, for the same reason one step further out:
 * a published site is not a page that uploads. The signed direct-to-GCS path
 * has exactly one client — the console's media library, which mints at
 * `/api/media/upload-url` and `PUT`s the returned URL for files over 3 MB —
 * and that component ships only in the console bundle. The besigner reaches
 * media through a picker seam whose one implementation is also console-side,
 * and no tenant surface carries a file input at all. So a customer's
 * `shop.acme.com` issues no signed `PUT`, and an entry for it is permission
 * that buys nothing on a bucket where the signed URL IS the authorization —
 * held, for a white-label domain, by a host somebody else controls.
 *
 * The shape of the system says the same thing independently: a platform
 * subdomain with no custom domain is never registered at all, because the
 * wildcard already serves it. It has therefore never had a bucket entry. Were
 * tenant pages really uploading, every such site would already be failing on
 * large files, and none is.
 *
 * Console scope keeps the grant, and needs it: `app.<domain>` and every
 * workspace subdomain (`acme.<domain>`) serve the console itself, media
 * library included.
 *
 * ⚠️ The release side is deliberately NOT scoped to match — see
 * {@link uploadCorsReleaseFor}.
 *
 * Swallows its own failures for the same reason everything else in this file
 * does: a domain must not fail to attach because a storage API was slow.
 */
async function uploadCorsFor(
  domain: string,
  redirect: string | null,
  scope: DomainScope,
): Promise<{ uploadCors?: UploadCorsVerdict | null }> {
  if (redirect || scope !== 'console') return {}
  try {
    const verdict = await reconcileUploadCors(domain)
    // The key appears only when there is something to say. A deployment with
    // no media bucket configured — a fresh self-host install — has nothing,
    // and reporting `uploadCors: null` on every attach would be noise about a
    // feature the operator is not using.
    return verdict ? { uploadCors: verdict } : {}
  } catch (error) {
    console.error('[workspace-domains] upload CORS reconcile threw', domain, error)
    return {}
  }
}

/**
 * Reclaim the origin a just-detached name leaves on the bucket.
 *
 * Called unconditionally on a successful detach rather than only for names we
 * believe were serving: the redirect flag is the provider's state at ATTACH
 * time and a name can have been changed since, and `releaseUploadCors` is a
 * no-op for an origin that is not on the bucket anyway. Guessing wrong in the
 * other direction leaves the permission standing.
 *
 * Unconditional across SCOPE too, and that asymmetry with
 * {@link uploadCorsFor} is the point rather than an oversight. Attach stopped
 * granting to tenant names, but bucket state outlives a release: every tenant
 * origin an earlier build added is still on the allowlist, and this is the
 * only path that takes one back off. Narrowing release to console scope to
 * mirror the grant would strand exactly the entries the narrowing was meant to
 * be rid of. A release for a name that never held an entry costs one read and
 * reports `revoked` on an origin that was already absent.
 *
 * Swallows its own failures like everything else here — a domain must not fail
 * to detach because a storage API was slow — but reports them, because an
 * operator who has just removed a customer needs to see that their permission
 * outlived them.
 */
async function uploadCorsReleaseFor(
  domain: string,
): Promise<{ uploadCorsRelease?: UploadCorsRelease | null }> {
  try {
    const release = await releaseUploadCors(domain)
    return release ? { uploadCorsRelease: release } : {}
  } catch (error) {
    console.error('[workspace-domains] upload CORS release threw', domain, error)
    return {}
  }
}

/**
 * The command still owed after a set of attaches, or null when nothing is
 * (AGL-1452).
 *
 * One remedy rather than a list: every verdict names the same bucket and the
 * same command, and a caller that has to render five copies of it renders
 * none.
 */
export function pendingUploadCorsRemedy(
  results: WorkspaceDomainResult[],
): string | null {
  return (
    results.find((result) => result.uploadCors && !result.uploadCors.permitted)
      ?.uploadCors?.remedy ?? null
  )
}

/** Detach one fully-qualified name from the console. */
export async function detachProjectDomain(
  name: string,
  scope: DomainScope = 'console',
): Promise<WorkspaceDomainResult> {
  const result = await domainProvider().detach(scope, name)
  // A name that was never registered has no origin of ours to reclaim.
  if (result.outcome !== 'detached') return result
  return { ...result, ...(await uploadCorsReleaseFor(result.domain)) }
}

/**
 * Attach `{slug}.<workspace domain>` so the workspace subdomain resolves.
 *
 * The `!slug` guard is not redundant with the one inside `attachProjectDomain`:
 * an empty slug still produces the well-formed `.aglyn.com`, and on the detach
 * side that is a request to delete the apex.
 */
export async function attachWorkspaceDomain(
  slug: string,
): Promise<WorkspaceDomainResult> {
  if (!slug) return { outcome: 'skipped', domain: domainFor(slug) }
  noteUnmanagedWorkspaceDomains()
  return attachProjectDomain(domainFor(slug))
}

/**
 * Has this instance already said that it does not manage workspace subdomains?
 *
 * Once per instance, not once per org: on a deployment that will never have
 * this integration the condition is permanent, and a line per workspace
 * creation is noise an operator learns to scroll past.
 */
let loggedUnmanagedDomains = false

/**
 * Say ONCE that `{slug}.<workspace domain>` is nobody's job on this deployment.
 *
 * `createOrg` awaits the attach and discards the result, which is fine when
 * the outcome is `attached` or `already-exists`. With no provider the outcome
 * is `skipped` and the org is still created, with the console going on to
 * advertise `{slug}.<workspace domain>` as the workspace URL. That address
 * resolves only if the operator independently runs wildcard DNS and a proxy
 * rule for it, and nothing in the product would otherwise tell them so: the
 * workspace simply has a URL that does not load.
 *
 * A log line rather than a refusal, because the operator's proxy is a
 * legitimate way to serve those names — `AGLYN_DOMAIN_PROVIDER=wildcard` is
 * how they say so — and failing org creation over a missing credential would
 * be far worse than the gap it closes.
 */
function noteUnmanagedWorkspaceDomains(): void {
  if (loggedUnmanagedDomains || workspaceDomainsConfigured()) return
  loggedUnmanagedDomains = true
  console.info(
    '[workspace-domains] no domain provider — workspace subdomains are not ' +
      'registered by this deployment. Point a wildcard DNS record for ' +
      `*.${WORKSPACE_DOMAIN} at your console, route it there, and set ` +
      'AGLYN_DOMAIN_PROVIDER=wildcard — or the workspace URL the console ' +
      'shows will not resolve.',
  )
}

/**
 * Detach the domain, for org erasure.
 *
 * NOT called on rename: the previous slug keeps serving a 308 to the new one,
 * and a redirect needs a hostname that still resolves.
 */
export async function detachWorkspaceDomain(
  slug: string,
): Promise<WorkspaceDomainResult> {
  if (!slug) return { outcome: 'skipped', domain: domainFor(slug) }
  return detachProjectDomain(domainFor(slug))
}

/**
 * Whether the workspace-domain integration is configured at all.
 *
 * Exposed so a reconcile script can say "not configured" once instead of
 * reporting every workspace as skipped, which reads like a failure.
 */
export function workspaceDomainsConfigured(): boolean {
  return domainProvider().configured('console')
}

/**
 * What a name is ACTUALLY doing, right now.
 *
 * `attachProjectDomain` answers "did the registration succeed", which is a
 * different question and a much weaker one. A domain can be registered and
 * still serve nothing — ownership unproven, DNS not yet pointed, certificate
 * not yet issued — and all three return a perfectly successful attach.
 *
 * That is the gap this closes (AGL-1913): the site custom-domain wizard
 * reported `attached: true` off the attach alone, so "certificate is still
 * issuing" and "this will never work" rendered as the same green chip, and the
 * only advice the docs could give was to press retry again.
 *
 * `scope` picks which app should be answering for the name — `tenant` for a
 * published site's custom domain, `console` for a workspace subdomain or a
 * white-label console domain. It was a raw project id before the provider
 * seam, which only ever meant anything to one vendor.
 */
export async function projectDomainStatus(
  name: string,
  options: { scope?: DomainScope } = {},
): Promise<ProjectDomainStatus> {
  return domainProvider().status(options.scope ?? 'console', name)
}
