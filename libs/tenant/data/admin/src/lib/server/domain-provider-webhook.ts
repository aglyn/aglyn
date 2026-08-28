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
 * The webhook driver — the layer an operator supplies.
 *
 * Aglyn asks one endpoint the three questions in the provider contract and
 * takes its word for the answer. What is on the other side is entirely the
 * operator's business: Caddy's admin API, a Traefik dynamic-config file, a
 * cert-manager `Certificate`, a registrar's API, or twenty lines of shell.
 *
 * This is the extension point rather than a module path the app imports,
 * because a module path does not survive the product. Both apps are bundled by
 * Next, so a path resolved at runtime is not in the bundle, and an operator
 * running the published image has no build step in which to add one. A webhook
 * needs no rebuild and works from the shipped image unchanged.
 *
 * ## The wire format
 *
 * `POST $AGLYN_DOMAIN_WEBHOOK_URL`, `Content-Type: application/json`, and
 * `Authorization: Bearer $AGLYN_DOMAIN_WEBHOOK_TOKEN` when that is set:
 *
 * ```json
 * { "action": "attach", "scope": "tenant", "domain": "shop.acme.com",
 *   "redirectTo": "acme.com" }
 * ```
 *
 * `action` is `attach`, `detach` or `status`. `scope` says which app should
 * answer for the name — `console` for the admin app and its workspace
 * subdomains, `tenant` for published sites. `redirectTo` appears only when the
 * name should forward rather than serve, and is always a bare hostname.
 *
 * Answer `200` with either an outcome:
 *
 * ```json
 * { "outcome": "attached", "detail": "added to caddy" }
 * ```
 *
 * or, for `status`, a state:
 *
 * ```json
 * { "state": "ownership-pending",
 *   "verification": [{ "type": "TXT", "domain": "_acme-challenge.shop.acme.com",
 *                      "value": "…" }] }
 * ```
 *
 * ## What Aglyn does with a bad answer
 *
 * An unrecognized `outcome` is `failed` and an unrecognized `state` is
 * `unknown`, both logged with what arrived. A typo must not read as success —
 * an endpoint that answers `{"outcome":"attach"}` has registered nothing, and
 * accepting it would leave a workspace advertising a URL that resolves
 * nowhere.
 *
 * ⚠️ Send this to a service on your own network. The request carries the
 * bearer token and the names of your customers' domains, and the reply decides
 * whether the console tells someone their site is live.
 */

import {
  abortedDetail,
  domainDeadline,
  domainStatus,
  normalizeHost,
  redirectHostname,
  type DomainAttachOptions,
  type DomainOutcome,
  type DomainProvider,
  type DomainResult,
  type DomainScope,
  type ProjectDomainState,
  type ProjectDomainStatus,
} from './domain-provider'

const OUTCOMES: readonly DomainOutcome[] = [
  'attached',
  'detached',
  'already-exists',
  'not-found',
  'skipped',
  'failed',
]

const STATES: readonly ProjectDomainState[] = [
  'serving',
  'certificate-pending',
  'ownership-pending',
  'dns-misconfigured',
  'not-attached',
  'skipped',
  'unknown',
]

interface WebhookSettings {
  url: string
  token?: string
}

function settings(): WebhookSettings | null {
  const url = String(process.env.AGLYN_DOMAIN_WEBHOOK_URL ?? '').trim()
  if (!url) return null
  return { url, token: process.env.AGLYN_DOMAIN_WEBHOOK_TOKEN?.trim() || undefined }
}

async function call(
  config: WebhookSettings,
  action: 'attach' | 'detach' | 'status',
  scope: DomainScope,
  domain: string,
  redirectTo?: string,
): Promise<{ ok: boolean; body: Record<string, unknown> | null; detail: string }> {
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        action,
        scope,
        domain,
        ...(redirectTo ? { redirectTo } : {}),
      }),
      signal: domainDeadline(),
    })
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null
    if (!response.ok) {
      console.error(
        `[domain-provider:webhook] ${action} answered ${response.status}`,
        domain,
      )
      return { ok: false, body, detail: String(response.status) }
    }
    return { ok: true, body, detail: '' }
  } catch (error) {
    console.error(`[domain-provider:webhook] ${action} threw`, domain, error)
    return { ok: false, body: null, detail: abortedDetail(error) }
  }
}

/** The endpoint's `detail`, kept short — it reaches operator-facing logs. */
function detailFrom(body: Record<string, unknown> | null): string | undefined {
  const raw = body?.['detail']
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().slice(0, 200)
  return trimmed || undefined
}

function recordList(
  value: unknown,
): { type?: string; name?: string; value?: string }[] {
  return Array.isArray(value) ? (value as { type?: string }[]) : []
}

export function webhookDomainProvider(): DomainProvider {
  const act = async (
    action: 'attach' | 'detach',
    scope: DomainScope,
    name: string,
    options: DomainAttachOptions = {},
  ): Promise<DomainResult> => {
    const domain = normalizeHost(name)
    const config = settings()
    if (!config || !domain) return { outcome: 'skipped', domain }

    // Normalized before the wire, so an operator's endpoint receives the same
    // bare hostname Vercel demands and no two drivers disagree on the shape.
    const redirect = options.redirectTo
      ? redirectHostname(options.redirectTo)
      : null
    if (options.redirectTo && !redirect) {
      console.error(
        '[domain-provider:webhook] refusing a non-hostname redirect',
        options.redirectTo,
      )
      return { outcome: 'failed', domain, detail: 'invalid-redirect' }
    }

    const { ok, body, detail } = await call(
      config,
      action,
      scope,
      domain,
      redirect ?? undefined,
    )
    if (!ok) return { outcome: 'failed', domain, detail: detail || 'webhook' }

    const outcome = body?.['outcome']
    if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as DomainOutcome)) {
      console.error(
        `[domain-provider:webhook] ${action} returned an unknown outcome`,
        domain,
        outcome,
      )
      return { outcome: 'failed', domain, detail: 'bad-outcome' }
    }
    return {
      outcome: outcome as DomainOutcome,
      domain,
      ...(detailFrom(body) ? { detail: detailFrom(body) } : {}),
    }
  }

  return {
    id: 'webhook',
    configured: () => settings() !== null,
    attach: (scope, name, options) => act('attach', scope, name, options),
    detach: (scope, name) => act('detach', scope, name),
    status: async (scope, name): Promise<ProjectDomainStatus> => {
      const domain = normalizeHost(name)
      const config = settings()
      if (!config || !domain) return domainStatus(domain, 'skipped')

      const { ok, body, detail } = await call(config, 'status', scope, domain)
      // Not `not-attached`: an endpoint that did not answer is not evidence
      // that the name is missing, and reporting one as the other would strand
      // every live domain the moment the operator's service restarted.
      if (!ok) return domainStatus(domain, 'unknown', { detail: detail || 'webhook' })

      const state = body?.['state']
      if (
        typeof state !== 'string' ||
        !STATES.includes(state as ProjectDomainState)
      ) {
        console.error(
          '[domain-provider:webhook] status returned an unknown state',
          domain,
          state,
        )
        return domainStatus(domain, 'unknown', { detail: 'bad-state' })
      }
      return domainStatus(domain, state as ProjectDomainState, {
        verification: recordList(body?.['verification']) as never,
        conflicts: recordList(body?.['conflicts']),
        ...(detailFrom(body) ? { detail: detailFrom(body) } : {}),
      })
    },
  }
}
