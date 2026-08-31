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
 * The wildcard driver — a container behind a proxy that already answers for
 * `*.example.com`.
 *
 * This is the ordinary Docker shape and the reason the seam exists. An
 * operator points one wildcard DNS record at their proxy, gets one wildcard
 * certificate, and every workspace subdomain and every platform site subdomain
 * resolves the moment it is created. There is no API to call because there is
 * nothing to register: the name already works.
 *
 * So `attach` here is an assertion, not an action. That is exactly why the
 * provider is never inferred — reporting a name as serving without checking is
 * only honest when a human has said "my proxy answers for that whole apex",
 * and `AGLYN_DOMAIN_PROVIDER=wildcard` is where they say it.
 *
 * ## What it will not claim
 *
 * A name OUTSIDE the configured suffixes — a customer's own `shop.acme.com` —
 * is not covered by anyone's wildcard. This driver has no way to add it and no
 * way to see it, so it says so: `skipped` on attach, `unknown` on status. It
 * never reports such a name as serving on the strength of a suffix it does not
 * match, and it never reports it as broken either, because an operator who
 * added a vhost by hand has a working domain this cannot see. Operators who
 * want custom domains registered automatically use the `webhook` driver, which
 * can reach their proxy's own API.
 */

import {
  domainStatus,
  normalizeHost,
  type DomainAttachOptions,
  type DomainProvider,
  type DomainResult,
  type DomainScope,
  type ProjectDomainStatus,
} from './domain-provider'

/**
 * The apexes the operator's DNS and certificate already cover.
 *
 * Falls back to the two the product itself hands out — the console's workspace
 * domain and the tenant apex — because those are the names Aglyn generates and
 * therefore the ones an operator choosing this driver is choosing it FOR. A
 * deployment serving more than those, or serving them under different names
 * per scope, lists them explicitly.
 *
 * ⛔ NO hardcoded apex behind those two. Elsewhere in the product an unset
 * `NEXT_PUBLIC_TENANT_DOMAIN` may default to Aglyn's own name, because the
 * consequence is a visibly wrong URL the operator corrects on their first
 * click. Here the consequence is different in kind: this driver ASSERTS that
 * the names it covers are being served, so a default would have an operator's
 * install report `serving` for `*.aglyn.com` — a domain they do not own,
 * cannot serve, and never named. An empty list covers nothing, which is the
 * only honest answer when nobody has said what the proxy answers for.
 */
function wildcardSuffixes(): string[] {
  const configured = String(process.env.AGLYN_DOMAIN_WILDCARD_SUFFIXES ?? '')
    .split(',')
    .map((entry) => normalizeHost(entry).replace(/^\*\./, ''))
    .filter(Boolean)
  if (configured.length) return configured
  return [
    normalizeHost(process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? ''),
    normalizeHost(process.env.NEXT_PUBLIC_TENANT_DOMAIN ?? ''),
  ].filter(Boolean)
}

/**
 * Whether `domain` is a name the operator's wildcard actually answers for.
 *
 * A wildcard record covers ONE label. `*.example.com` serves `a.example.com`
 * and does not serve `a.b.example.com` — nor `example.com` itself — and a
 * certificate issued for `*.example.com` covers exactly the same set. Matching
 * on "ends with the suffix" would report both of those as serving, which for
 * the deeper name is a TLS error the operator sees before we do.
 */
export function wildcardCovers(domain: string, suffixes: string[]): boolean {
  const host = normalizeHost(domain)
  if (!host) return false
  return suffixes.some((suffix) => {
    if (!suffix || !host.endsWith(`.${suffix}`)) return false
    const label = host.slice(0, host.length - suffix.length - 1)
    return label.length > 0 && !label.includes('.')
  })
}

function uncoveredDetail(suffixes: string[]): string {
  return (
    'outside the wildcard' + (suffixes.length ? ` (${suffixes.join(', ')})` : '')
  )
}

export function wildcardDomainProvider(): DomainProvider {
  const attach = async (
    _scope: DomainScope,
    name: string,
    options: DomainAttachOptions = {},
  ): Promise<DomainResult> => {
    const domain = normalizeHost(name)
    const suffixes = wildcardSuffixes()
    if (!domain) return { outcome: 'skipped', domain }
    if (!wildcardCovers(domain, suffixes)) {
      return { outcome: 'skipped', domain, detail: uncoveredDetail(suffixes) }
    }
    /*
     * A redirect request is satisfied here without an edge rule, because the
     * app already serves one. The renamed workspace's old slug still resolves
     * under the wildcard, and the canonical redirect in the app 308s it to the
     * new one — which is the behaviour the edge rule was imitating. Reporting
     * `attached` is therefore true rather than convenient.
     */
    void options.redirectTo
    return { outcome: 'attached', domain }
  }

  return {
    id: 'wildcard',
    // Always, for the names it covers. There is no credential to be missing:
    // the operator's assertion IS the configuration.
    configured: () => true,
    attach,
    detach: async (_scope, name) => {
      const domain = normalizeHost(name)
      const suffixes = wildcardSuffixes()
      if (!domain) return { outcome: 'skipped', domain }
      /*
       * Nothing to remove, and that is the honest answer rather than a
       * comfortable one: a wildcard cannot un-serve one of its names, so a
       * detached workspace subdomain keeps resolving until the app itself
       * stops recognizing the slug. `not-found` says the entry this was asked
       * to delete does not exist, which is exactly the case.
       */
      if (!wildcardCovers(domain, suffixes)) {
        return { outcome: 'skipped', domain, detail: uncoveredDetail(suffixes) }
      }
      return { outcome: 'not-found', domain }
    },
    status: async (_scope, name): Promise<ProjectDomainStatus> => {
      const domain = normalizeHost(name)
      const suffixes = wildcardSuffixes()
      if (!domain) return domainStatus(domain, 'skipped')
      if (wildcardCovers(domain, suffixes)) {
        return domainStatus(domain, 'serving')
      }
      // Not `not-attached`: this driver cannot see a custom domain either way,
      // and `unknown` is the state that means "no evidence", which callers
      // already treat as non-blocking.
      return domainStatus(domain, 'unknown', { detail: uncoveredDetail(suffixes) })
    },
  }
}
