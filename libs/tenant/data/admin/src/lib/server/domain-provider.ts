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
 * How a hostname gets served — the one seam the hosting vendor lives behind.
 *
 * ## The lock-in this removes
 *
 * Attaching a name was `POST https://api.vercel.com/...`, written out five
 * times across the console routes and this library. Every workspace subdomain
 * and every customer's custom domain therefore required a Vercel project and a
 * Vercel token, and a self-hosted install had no way to register a name at all
 * — it got `skipped` and a console that advertised a URL nothing resolved.
 * "Bring your own Firebase, run it on Docker" cannot be true while the way a
 * site becomes reachable is one vendor's API.
 *
 * So the vendor is a driver now. The three operations a name needs are the
 * whole contract, and an operator picks — or writes — the implementation:
 *
 * | provider   | for                                                       |
 * |------------|-----------------------------------------------------------|
 * | `vercel`   | Aglyn's own hosting, and anyone else on Vercel             |
 * | `wildcard` | a container behind a proxy with `*.example.com` DNS        |
 * | `webhook`  | anything else — Caddy, Traefik, cert-manager, a registrar  |
 * | `none`     | names are somebody else's job entirely                     |
 *
 * ## Why a webhook is the extension point and not a module path
 *
 * The obvious "supply your own layer" is a file path the app imports at boot.
 * It does not survive the product: both apps are bundled by Next, so a path
 * resolved at runtime is not in the bundle, and an operator running the
 * published image has no build step to add one to. A webhook needs no rebuild,
 * works from the shipped image, and is the same shape whether the operator's
 * DNS lives in Caddy's admin API, a Traefik provider, or a shell script behind
 * `nc`. The cost is one HTTP hop on an operation that already makes one.
 *
 * ## The contract every driver owes
 *
 * 1. **Never throw.** A caller creates orgs and renders cards with these
 *    results; an exception takes down an org creation over a DNS API. Return
 *    `failed` — or `skipped`, which is not a failure.
 * 2. **Idempotent.** `attach` on a name already attached is `already-exists`,
 *    which is success. Reconcile passes and create paths both run.
 * 3. **`skipped` means "not my job", not "it went wrong".** It is what an
 *    unconfigured driver returns, and callers treat it as neither success nor
 *    failure.
 * 4. **`unknown` status is not evidence of a problem.** {@link domainStateServes}
 *    returns true for it deliberately: a probe that could not answer must not
 *    strand every domain on a deployment whose provider has no status API.
 */

/**
 * Which deployment a name should reach.
 *
 * Two, because Aglyn runs two apps: the console at `app.<domain>` with its
 * per-workspace subdomains, and the tenant runtime that serves published
 * sites and every customer's own domain. On Vercel they are separate projects;
 * behind a proxy they are separate upstreams; for a webhook they are a field.
 */
export type DomainScope = 'console' | 'tenant'

export type DomainOutcome =
  | 'attached'
  | 'detached'
  | 'already-exists'
  | 'not-found'
  | 'skipped'
  | 'failed'

export interface DomainResult {
  outcome: DomainOutcome
  domain: string
  /** Why, when the outcome alone does not say it. Never user-facing prose. */
  detail?: string
}

export interface DomainAttachOptions {
  /**
   * Register the name as a REDIRECT to this bare hostname rather than serving
   * the app on it — how a renamed workspace keeps its old slug working.
   *
   * A driver that cannot express a redirect returns `skipped` rather than
   * attaching a serving name, because the two are not interchangeable: a
   * serving twin is a second live copy of the console on a name that was
   * supposed to forward.
   */
  redirectTo?: string
}

export type ProjectDomainState =
  | 'serving'
  | 'certificate-pending'
  | 'ownership-pending'
  | 'dns-misconfigured'
  | 'not-attached'
  | 'skipped'
  | 'unknown'

/** One challenge record a provider wants before it will serve the name. */
export interface ProjectDomainVerification {
  type: string
  domain: string
  value: string
  reason?: string
}

export interface ProjectDomainStatus {
  state: ProjectDomainState
  domain: string
  /** Present when `state` is `ownership-pending`; what to add at the registrar. */
  verification: ProjectDomainVerification[]
  /**
   * Records answering for this name that are not ours, as the provider sees
   * them. A non-empty list on an otherwise-serving domain is the shadowing
   * case: it resolves correctly some of the time.
   */
  conflicts: { type?: string; name?: string; value?: string }[]
  /** Why, when the state alone does not say it. */
  detail?: string
}

export interface DomainProvider {
  /** Stable id, logged and reported by `/api/health`. Never a display name. */
  readonly id: string
  /** Whether this deployment can actually register names for `scope`. */
  configured(scope: DomainScope): boolean
  attach(
    scope: DomainScope,
    domain: string,
    options?: DomainAttachOptions,
  ): Promise<DomainResult>
  detach(scope: DomainScope, domain: string): Promise<DomainResult>
  status(scope: DomainScope, domain: string): Promise<ProjectDomainStatus>
}

/**
 * Whether a probed state means visitors may be sent to the domain (AGL-2011).
 *
 * The ONE definition of "serving", because it has to be. The predicate lived
 * inline in `/api/domains/attach` and again in
 * `/api/admin/finish-domain-attachments`, and the sweeper's own comment says
 * why that is dangerous: a sweeper using a looser definition than the door it
 * completes for re-introduces the bug that door was fixed to avoid.
 *
 * `certificate-pending` is NOT serving (AGL-1996): the name is accepted and
 * routed but no certificate exists yet, so the destination answers with a TLS
 * error. `unknown` and `skipped` ARE, deliberately — a status probe that could
 * not answer is not evidence of a problem, and treating it as one would strand
 * every domain on a deployment whose provider has no status API to ask.
 */
export function domainStateServes(state: ProjectDomainState): boolean {
  return (
    state !== 'not-attached' &&
    state !== 'ownership-pending' &&
    state !== 'dns-misconfigured' &&
    state !== 'certificate-pending'
  )
}

export function domainStatus(
  domain: string,
  state: ProjectDomainState,
  extra: Partial<ProjectDomainStatus> = {},
): ProjectDomainStatus {
  return { state, domain, verification: [], conflicts: [], ...extra }
}

const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export function normalizeHost(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/**
 * A redirect target reduced to a BARE HOSTNAME, or `null` if it is not one.
 *
 * Vercel rejects `https://aglyn.com` here with `bad_request`, whose message
 * reads "Unable to redirect to https://…, because that domain is not added to
 * the project" — it blames the target for being absent when the format was
 * wrong. That misreading is why AGL-1273's redirect shipped looking correct
 * and never once succeeded, and survived weeks before AGL-1365 caught it.
 *
 * Enforced at the seam rather than trusted per driver, so a webhook operator
 * receives the same shape Vercel demands and no driver has to re-derive it.
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

/**
 * Ceiling on any provider call (AGL-1136).
 *
 * These are awaited — org creation and rename wait for them — so an
 * unresponsive DNS API would otherwise hang the operation until the platform
 * killed the function, turning "the subdomain is not attached yet" into "the
 * workspace could not be created". The whole point of the call being
 * best-effort is that it can lose without taking anything with it, and a
 * promise with no timeout cannot lose.
 */
export const DOMAIN_PROVIDER_TIMEOUT_MS = 5000

/** `AbortSignal.timeout`, without assuming the runtime has it. */
export function domainDeadline(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(DOMAIN_PROVIDER_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/** Whether a rejection was our own deadline rather than the network's. */
export function abortedDetail(error: unknown): 'timeout' | 'network' {
  const name = (error as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

/**
 * The driver that registers nothing.
 *
 * Not an error state. A deployment can legitimately have names handled
 * entirely outside the product — a platform team's own DNS pipeline, or an
 * install that only ever uses path routing — and the correct behaviour there
 * is silence, not a failure logged on every signup forever.
 */
export const NO_DOMAIN_PROVIDER: DomainProvider = {
  id: 'none',
  configured: () => false,
  attach: async (_scope, domain) => ({ outcome: 'skipped', domain }),
  detach: async (_scope, domain) => ({ outcome: 'skipped', domain }),
  status: async (_scope, domain) => domainStatus(domain, 'skipped'),
}

export type DomainProviderId = 'vercel' | 'wildcard' | 'webhook' | 'none'

/**
 * The configured provider id, or `null` to let {@link domainProvider} infer it.
 *
 * An explicit value always wins, including `none` — an operator switching a
 * driver off while its credentials are still in the environment means it.
 */
function requestedProviderId(): DomainProviderId | null {
  const raw = String(process.env.AGLYN_DOMAIN_PROVIDER ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  if (
    raw === 'vercel' ||
    raw === 'wildcard' ||
    raw === 'webhook' ||
    raw === 'none'
  ) {
    return raw
  }
  console.error(
    `[domain-provider] unknown AGLYN_DOMAIN_PROVIDER "${raw}" — falling back ` +
      'to detection. Valid values: vercel, wildcard, webhook, none.',
  )
  return null
}

let cached: { key: string; provider: DomainProvider } | null = null

/**
 * The provider this deployment uses.
 *
 * ⚠️ Detection, when `AGLYN_DOMAIN_PROVIDER` is unset, deliberately only ever
 * selects `vercel` — never `wildcard`. Wildcard reports a name as SERVING
 * without checking anything, and inferring it from an apex an operator merely
 * configured would have the console advertise addresses that resolve nowhere
 * while showing a green chip. Claiming to serve a name is the operator's
 * assertion to make, so it takes their explicit setting.
 *
 * Memoized on the environment values it reads rather than once per process, so
 * a spec can change them between cases without a reset hook that production
 * would carry for nobody.
 */
export function domainProvider(): DomainProvider {
  const requested = requestedProviderId()
  const key = [
    requested ?? '',
    process.env.VERCEL_TOKEN ? '1' : '',
    process.env.AGLYN_DOMAIN_WEBHOOK_URL ?? '',
    process.env.AGLYN_DOMAIN_WILDCARD_SUFFIXES ?? '',
    process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? '',
    process.env.NEXT_PUBLIC_TENANT_APEX ?? '',
  ].join(' ')
  if (cached?.key === key) return cached.provider

  const provider = selectProvider(requested)
  cached = { key, provider }
  return provider
}

function selectProvider(requested: DomainProviderId | null): DomainProvider {
  // Required lazily so a deployment pays for only the driver it uses, and so
  // this module stays importable from an edge runtime that has no `fetch`
  // credentials of its own.
  switch (requested ?? (process.env.VERCEL_TOKEN ? 'vercel' : 'none')) {
    case 'vercel':
      return require('./domain-provider-vercel').VERCEL_DOMAIN_PROVIDER
    case 'wildcard':
      return require('./domain-provider-wildcard').wildcardDomainProvider()
    case 'webhook':
      return require('./domain-provider-webhook').webhookDomainProvider()
    default:
      return NO_DOMAIN_PROVIDER
  }
}
