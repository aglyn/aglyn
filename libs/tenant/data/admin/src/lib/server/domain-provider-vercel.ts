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
 * The Vercel driver — how Aglyn's own hosting registers a name.
 *
 * One implementation of the call, one deadline, one never-throws contract. It
 * was five copies before this file existed: `workspace-domains.ts`, three
 * console routes and `subdomain-redirect.ts` each held their own `fetch` to
 * `api.vercel.com`, which is how two copies of a constant drift apart — the
 * bug AGL-1135 was, one layer down.
 *
 * ## The two projects
 *
 * The console and the tenant runtime are separate Vercel projects, so the
 * scope picks the id. One token and one team serve both: a second variable for
 * the same token is the drift this file exists to prevent.
 */

import {
  abortedDetail,
  domainDeadline,
  domainStatus,
  normalizeHost,
  redirectHostname,
  type DomainAttachOptions,
  type DomainProvider,
  type DomainResult,
  type DomainScope,
  type ProjectDomainStatus,
} from './domain-provider'

/** Mirrors the app-level canonical redirect: revocable, method-preserving. */
const REDIRECT_STATUS_CODE = 307

interface VercelSettings {
  token: string
  projectId: string
  teamId?: string
}

function settingsFor(scope: DomainScope): VercelSettings | null {
  const token = process.env.VERCEL_TOKEN
  const projectId =
    scope === 'tenant'
      ? process.env.VERCEL_TENANT_PROJECT_ID
      : process.env.VERCEL_CONSOLE_PROJECT_ID
  if (!token || !projectId) return null
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID }
}

function query(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
}

function authHeaders(settings: VercelSettings): Record<string, string> {
  return { Authorization: `Bearer ${settings.token}` }
}

/**
 * Attach one fully-qualified name to the scope's project.
 *
 * Idempotent: Vercel answers `domain_already_in_use` when the name is already
 * on the project, which is success for our purposes — the reconcile script and
 * the create path can both run without coordinating.
 *
 * ⚠️ Tolerating `domain_already_in_use` is only safe while **every** name this
 * is asked to attach is also claimed in Firestore. Without that, a second org
 * attaches a name someone else already holds, reads `already-exists` as
 * success, and gets a console that looks healthy while its visitors are served
 * — or redirected — somewhere else. That is the AGL-743 shape, and
 * `console-domains.ts` is where the claim is kept in step.
 */
async function attach(
  scope: DomainScope,
  name: string,
  options: DomainAttachOptions = {},
): Promise<DomainResult> {
  const domain = normalizeHost(name)
  const settings = settingsFor(scope)
  if (!settings || !domain) return { outcome: 'skipped', domain }

  const redirect = options.redirectTo
    ? redirectHostname(options.redirectTo)
    : null
  if (options.redirectTo && !redirect) {
    console.error('[domain-provider:vercel] refusing a non-hostname redirect', options.redirectTo)
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
        headers: { ...authHeaders(settings), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: domainDeadline(),
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
    console.error('[domain-provider:vercel] attach failed', domain, code)
    return { outcome: 'failed', domain, detail: code || String(response.status) }
  } catch (error) {
    console.error('[domain-provider:vercel] attach threw', domain, error)
    return { outcome: 'failed', domain, detail: abortedDetail(error) }
  }
}

/** Point an already-attached name at `redirect`. Same never-throws contract. */
async function patchRedirect(
  settings: VercelSettings,
  domain: string,
  redirect: string,
): Promise<DomainResult> {
  try {
    const response = await fetch(
      `https://api.vercel.com/v9/projects/${settings.projectId}/domains/${encodeURIComponent(domain)}${query(settings.teamId)}`,
      {
        method: 'PATCH',
        headers: { ...authHeaders(settings), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect,
          redirectStatusCode: REDIRECT_STATUS_CODE,
        }),
        signal: domainDeadline(),
      },
    )
    if (response.ok) return { outcome: 'already-exists', domain }
    console.error('[domain-provider:vercel] redirect patch failed', domain, response.status)
    return { outcome: 'failed', domain, detail: String(response.status) }
  } catch (error) {
    console.error('[domain-provider:vercel] redirect patch threw', domain, error)
    return { outcome: 'failed', domain, detail: abortedDetail(error) }
  }
}

async function detach(
  scope: DomainScope,
  name: string,
): Promise<DomainResult> {
  const domain = normalizeHost(name)
  const settings = settingsFor(scope)
  if (!settings || !domain) return { outcome: 'skipped', domain }
  try {
    const response = await fetch(
      `https://api.vercel.com/v9/projects/${settings.projectId}/domains/${encodeURIComponent(domain)}${query(settings.teamId)}`,
      {
        method: 'DELETE',
        headers: authHeaders(settings),
        signal: domainDeadline(),
      },
    )
    if (response.ok) return { outcome: 'detached', domain }
    if (response.status === 404) return { outcome: 'not-found', domain }
    console.error('[domain-provider:vercel] detach failed', domain, response.status)
    return { outcome: 'failed', domain, detail: String(response.status) }
  } catch (error) {
    console.error('[domain-provider:vercel] detach threw', domain, error)
    return { outcome: 'failed', domain, detail: abortedDetail(error) }
  }
}

/** Whether any issued certificate's names cover `domain`, wildcards included. */
function certificateCovers(cns: unknown, domain: string): boolean {
  if (!Array.isArray(cns)) return false
  const parent = domain.split('.').slice(1).join('.')
  return cns.some((name) => {
    const cn = normalizeHost(String(name ?? ''))
    return cn === domain || (cn.startsWith('*.') && cn.slice(2) === parent)
  })
}

/**
 * What a name is ACTUALLY doing on the project, right now.
 *
 * `attach` answers "did the POST succeed", which is a different question and a
 * much weaker one. A domain can be on the project and still serve nothing:
 * Vercel accepts the name, then withholds routing and the certificate until
 * ownership is proven (when the apex is registered to another Vercel account)
 * or until DNS actually points here. Both states return a successful POST.
 *
 * That is the gap this closes (AGL-1913): the site custom-domain wizard
 * reported `attached: true` off the POST alone, so "certificate is still
 * issuing" and "this will never work" rendered as the same green chip.
 *
 * Three reads, cheapest first, each of which can end the walk:
 *
 *  1. `GET /v9/projects/{project}/domains/{name}` — 404 means the name is not
 *     on this project at all, and `verified: false` means Vercel is holding it
 *     pending the `verification` challenge it returns alongside.
 *  2. `GET /v6/domains/{name}/config` — the platform's own DNS check.
 *     `misconfigured` is authoritative in a way our resolver check is not, and
 *     `conflicts` names the records answering for the domain that are NOT ours
 *     — the stale-A-record-shadowing-an-ALIAS case, reported rather than
 *     inferred.
 *  3. `GET /v5/certs?domain={name}` — whether a certificate covers the name
 *     yet. Only consulted once the first two are clean, and a FAILED cert read
 *     reports `serving` rather than inventing a problem: an unreachable certs
 *     API must never turn a healthy domain amber.
 */
async function status(
  scope: DomainScope,
  name: string,
): Promise<ProjectDomainStatus> {
  const domain = normalizeHost(name)
  const settings = settingsFor(scope)
  if (!settings || !domain) return domainStatus(domain, 'skipped')
  const headers = authHeaders(settings)
  const team = query(settings.teamId)

  try {
    const attached = await fetch(
      `https://api.vercel.com/v9/projects/${settings.projectId}/domains/${encodeURIComponent(domain)}${team}`,
      { headers, signal: domainDeadline() },
    )
    if (attached.status === 404) return domainStatus(domain, 'not-attached')
    if (!attached.ok) {
      return domainStatus(domain, 'unknown', { detail: String(attached.status) })
    }
    const payload = await attached.json().catch(() => null)
    if (payload?.verified === false) {
      return domainStatus(domain, 'ownership-pending', {
        verification: Array.isArray(payload?.verification)
          ? payload.verification
          : [],
      })
    }

    const configured = await fetch(
      `https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config${team}`,
      { headers, signal: domainDeadline() },
    )
    if (!configured.ok) {
      return domainStatus(domain, 'unknown', { detail: String(configured.status) })
    }
    const dns = await configured.json().catch(() => null)
    const conflicts = Array.isArray(dns?.conflicts) ? dns.conflicts : []
    if (dns?.misconfigured === true) {
      return domainStatus(domain, 'dns-misconfigured', { conflicts })
    }

    const certs = await fetch(
      `https://api.vercel.com/v5/certs?domain=${encodeURIComponent(domain)}${
        settings.teamId ? `&teamId=${encodeURIComponent(settings.teamId)}` : ''
      }`,
      { headers, signal: domainDeadline() },
    )
    // A certs read that did not answer must not turn a healthy domain amber.
    if (!certs.ok) return domainStatus(domain, 'serving', { conflicts })
    const issued = await certs.json().catch(() => null)
    const covered =
      Array.isArray(issued?.certs) &&
      issued.certs.some((cert: { cns?: unknown }) =>
        certificateCovers(cert?.cns, domain),
      )
    return domainStatus(domain, covered ? 'serving' : 'certificate-pending', {
      conflicts,
    })
  } catch (error) {
    console.error('[domain-provider:vercel] status threw', domain, error)
    return domainStatus(domain, 'unknown', { detail: abortedDetail(error) })
  }
}

export const VERCEL_DOMAIN_PROVIDER: DomainProvider = {
  id: 'vercel',
  configured: (scope) => settingsFor(scope) !== null,
  attach,
  detach,
  status,
}
