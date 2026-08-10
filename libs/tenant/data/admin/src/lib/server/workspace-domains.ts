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
 * Attach and detach names on the console's Vercel project (AGL-1136).
 *
 * Two layers. The bottom one — `attachProjectDomain` / `detachProjectDomain` —
 * takes a fully-qualified name and is what a custom **console** domain uses
 * (AGL-1373). The top one is the workspace-subdomain pair below, which is that
 * primitive with `{slug}.aglyn.com` built for it. One implementation of the
 * Vercel call, one deadline, one never-throws contract; a second copy pointed
 * at the same project is how two copies of a constant drift apart, which is the
 * bug AGL-1135 was, one layer down.
 *
 * AGL-1135 removed the `*.aglyn.com` wildcard, because it meant every
 * hostname under the domain served a real console sign-in page —
 * `billing-security-update.aglyn.com` returned 200 with a valid certificate.
 * Removing it made unregistered names 404, and made **registered** names
 * something that has to be registered: a slug only resolves if that exact
 * domain is attached to the project.
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
 * 2. **Unconfigured is a no-op, not an error.** Without a token this reports
 *    `skipped`. Self-hosted deployments have no Vercel project at all, and
 *    they must not log an error per signup forever.
 * 3. **A rename ADDS without removing.** The old slug keeps a tombstone that
 *    308s to the new one (AGL-585/236), and a redirect can only run on a
 *    hostname that still resolves. Detaching the old domain would break the
 *    very redirect the tombstone exists to serve.
 */

export type WorkspaceDomainOutcome =
  | 'attached'
  | 'detached'
  | 'already-exists'
  | 'not-found'
  | 'skipped'
  | 'failed'

export interface WorkspaceDomainResult {
  outcome: WorkspaceDomainOutcome
  domain: string
  detail?: string
}

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

/**
 * Reuses `VERCEL_TOKEN` and `VERCEL_TEAM_ID`, which the tenant custom-domain
 * routes (`/api/domains/attach|detach`) already use, and adds exactly one new
 * name alongside their `VERCEL_TENANT_PROJECT_ID`. A second token variable for
 * the same token is how two copies of a constant drift apart — which is the
 * bug AGL-1135 was, one layer down.
 */
function config(): { token: string; projectId: string; teamId?: string } | null {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_CONSOLE_PROJECT_ID
  if (!token || !projectId) return null
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID }
}

function domainFor(slug: string): string {
  return `${String(slug ?? '').trim().toLowerCase()}.${WORKSPACE_DOMAIN}`
}

function query(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
}

/**
 * Ceiling on the Vercel call (AGL-1136).
 *
 * These are awaited now — org creation and rename wait for them — so an
 * unresponsive DNS API would otherwise hang the operation until the platform
 * killed the function, turning "the subdomain is not attached yet" into "the
 * workspace could not be created". The whole point of this call being
 * best-effort is that it can lose without taking anything with it, and a
 * promise with no timeout cannot lose.
 *
 * Five seconds is far beyond a normal response and far below any request
 * budget worth defending.
 */
const VERCEL_TIMEOUT_MS = 5000

/** `AbortSignal.timeout`, without assuming the runtime has it. */
function deadline(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(VERCEL_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/** Mirrors the app-level canonical redirect: revocable, method-preserving. */
const REDIRECT_STATUS_CODE = 307

const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

function normalizeHost(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/**
 * Vercel's `redirect` field takes a **BARE HOSTNAME, not a URL**.
 *
 * `https://aglyn.com` is rejected with the error `bad_request`, whose message
 * reads "Unable to redirect to https://…, because that domain is not added to
 * the project" — it blames the target for being absent when the format was
 * wrong, which is the misreading that hid the bug. That
 * misreading is why AGL-1273's redirect shipped looking correct and never once
 * succeeded, and survived for weeks before AGL-1365 caught it.
 *
 * So the shape is enforced here rather than trusted at each call site: a
 * scheme-prefixed or path-bearing value is reduced to its host, and anything
 * that is not then a plausible hostname returns `null` so the caller can refuse
 * rather than send a request that cannot work.
 */
export function redirectHostname(target: string): string | null {
  const raw = normalizeHost(target)
  if (!raw) return null
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '')
  return HOSTNAME_PATTERN.test(host) ? host : null
}

export interface ProjectDomainOptions {
  /**
   * Register the name as a per-domain REDIRECT to this host instead of serving
   * the app on it. Passed through `redirectHostname`, so a URL is accepted from
   * a caller and never sent to Vercel.
   */
  redirectTo?: string
}

/**
 * Attach one fully-qualified name to the console project.
 *
 * Idempotent: Vercel answers `domain_already_in_use` when the name is already
 * on the project, which is success for our purposes — the reconcile script and
 * the create path can both run without coordinating.
 *
 * ⚠️ Tolerating `domain_already_in_use` is only safe while **every** name this
 * function is asked to attach is also claimed in Firestore. Without that, a
 * second org attaches a name someone else already holds, reads
 * `already-exists` as success, and gets a console that looks healthy while its
 * visitors are served — or redirected — somewhere else. That is the AGL-743
 * shape, and `console-domains.ts` is where the claim is kept in step.
 */
export async function attachProjectDomain(
  name: string,
  options: ProjectDomainOptions = {},
): Promise<WorkspaceDomainResult> {
  const domain = normalizeHost(name)
  const settings = config()
  if (!settings || !domain) return { outcome: 'skipped', domain }

  const redirect = options.redirectTo
    ? redirectHostname(options.redirectTo)
    : null
  if (options.redirectTo && !redirect) {
    console.error('[workspace-domains] refusing a non-hostname redirect', options.redirectTo)
    return { outcome: 'failed', domain, detail: 'invalid-redirect' }
  }
  const body = redirect
    ? { name: domain, redirect, redirectStatusCode: REDIRECT_STATUS_CODE }
    : { name: domain }

  try {
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${settings.projectId}/domains${query(settings.teamId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: deadline(),
      },
    )
    if (response.ok) return { outcome: 'attached', domain }
    const payload = await response.json().catch(() => null)
    const code = String(payload?.error?.code ?? '')
    if (code === 'domain_already_in_use' || response.status === 409) {
      // An entry that already exists still has to CARRY the redirect, or the
      // twin quietly serves the console instead of forwarding to the primary.
      if (redirect) return patchRedirect(settings, domain, redirect)
      return { outcome: 'already-exists', domain }
    }
    // Logged, never thrown — see property 1 above.
    console.error('[workspace-domains] attach failed', domain, code)
    return { outcome: 'failed', domain, detail: code || String(response.status) }
  } catch (error) {
    // Includes the abort above: a timeout is reported as a failure like any
    // other, because to every caller it is one.
    const aborted = (error as { name?: string })?.name === 'TimeoutError' ||
      (error as { name?: string })?.name === 'AbortError'
    console.error('[workspace-domains] attach threw', domain, error)
    return { outcome: 'failed', domain, detail: aborted ? 'timeout' : 'network' }
  }
}

/** Point an already-attached name at `redirect`. Same never-throws contract. */
async function patchRedirect(
  settings: { token: string; projectId: string; teamId?: string },
  domain: string,
  redirect: string,
): Promise<WorkspaceDomainResult> {
  try {
    const response = await fetch(
      `https://api.vercel.com/v9/projects/${settings.projectId}/domains/${encodeURIComponent(domain)}${query(settings.teamId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          redirect,
          redirectStatusCode: REDIRECT_STATUS_CODE,
        }),
        signal: deadline(),
      },
    )
    if (response.ok) return { outcome: 'already-exists', domain }
    console.error('[workspace-domains] redirect patch failed', domain, response.status)
    return { outcome: 'failed', domain, detail: String(response.status) }
  } catch (error) {
    console.error('[workspace-domains] redirect patch threw', domain, error)
    return { outcome: 'failed', domain, detail: 'network' }
  }
}

/** Detach one fully-qualified name from the console project. */
export async function detachProjectDomain(
  name: string,
): Promise<WorkspaceDomainResult> {
  const domain = normalizeHost(name)
  const settings = config()
  if (!settings || !domain) return { outcome: 'skipped', domain }
  try {
    const response = await fetch(
      `https://api.vercel.com/v9/projects/${settings.projectId}/domains/${encodeURIComponent(domain)}${query(settings.teamId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${settings.token}` },
        signal: deadline(),
      },
    )
    if (response.ok) return { outcome: 'detached', domain }
    if (response.status === 404) return { outcome: 'not-found', domain }
    console.error('[workspace-domains] detach failed', domain, response.status)
    return { outcome: 'failed', domain, detail: String(response.status) }
  } catch (error) {
    console.error('[workspace-domains] detach threw', domain, error)
    return { outcome: 'failed', domain, detail: 'network' }
  }
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
  return attachProjectDomain(domainFor(slug))
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
  return config() !== null
}
