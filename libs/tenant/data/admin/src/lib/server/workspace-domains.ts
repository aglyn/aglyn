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
 * Attach and detach `{slug}.aglyn.com` on the console's Vercel project
 * (AGL-1136).
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

/**
 * Attach `{slug}.<workspace domain>` so the workspace subdomain resolves.
 *
 * Idempotent: Vercel answers `domain_already_in_use` when the domain is
 * already on the project, which is success for our purposes — the reconcile
 * script and the create path can both run without coordinating.
 */
export async function attachWorkspaceDomain(
  slug: string,
): Promise<WorkspaceDomainResult> {
  const domain = domainFor(slug)
  const settings = config()
  if (!settings || !slug) return { outcome: 'skipped', domain }
  try {
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${settings.projectId}/domains${query(settings.teamId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
        signal: deadline(),
      },
    )
    if (response.ok) return { outcome: 'attached', domain }
    const payload = await response.json().catch(() => null)
    const code = String(payload?.error?.code ?? '')
    if (code === 'domain_already_in_use' || response.status === 409) {
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

/**
 * Detach the domain, for org erasure.
 *
 * NOT called on rename: the previous slug keeps serving a 308 to the new one,
 * and a redirect needs a hostname that still resolves.
 */
export async function detachWorkspaceDomain(
  slug: string,
): Promise<WorkspaceDomainResult> {
  const domain = domainFor(slug)
  const settings = config()
  if (!settings || !slug) return { outcome: 'skipped', domain }
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
 * Whether the workspace-domain integration is configured at all.
 *
 * Exposed so a reconcile script can say "not configured" once instead of
 * reporting every workspace as skipped, which reads like a failure.
 */
export function workspaceDomainsConfigured(): boolean {
  return config() !== null
}
