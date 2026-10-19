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

/*
 * ONE-CLICK DNS, AS THE CONSOLE AND THE SERVER BOTH SPEAK IT (AGL-3963).
 *
 * Domain Connect is an open standard a DNS provider implements so a service
 * can ask it to write a fixed set of records into a customer's zone: the
 * service sends the customer to the provider with a SIGNED link naming one
 * of the service's published templates, the customer signs in there and
 * approves, and the provider writes the records and sends them back.
 *
 * Aglyn publishes two templates (`tools/domain-connect/`), and which one a
 * domain takes is decided by where the typed name sits in its zone:
 *
 * - the zone root or its `www.` — the APEX template, which writes the root's
 *   address and `www`'s CNAME together, so both names resolve and the other
 *   one is connected as the redirect twin;
 * - anything deeper — the SUBDOMAIN template, one CNAME on that name.
 *
 * Client-safe: the widget reads these shapes, and nothing here imports Node.
 */

/** Template service ids, as published under the `aglyn.com` provider id. */
export const DOMAIN_CONNECT_SERVICES = {
  /** `A @` and `CNAME www`: a zone root and its `www.` together. */
  apex: 'website',
  /** `CNAME` on the name applied, `hostRequired`. */
  subdomain: 'website-subdomain',
} as const

export type DomainConnectTemplate = keyof typeof DOMAIN_CONNECT_SERVICES

/**
 * Where a one-click session stands.
 *
 * - `started` — the owner was sent to the provider; nothing came back yet.
 * - `applied` — the provider sent them back without an error. Not proof: the
 *   spec says a returning browser can be altered, so DNS decides.
 * - `waiting` — applied, and the records do not resolve yet.
 * - `connected` — the records resolve and the domain is the site's.
 * - `cancelled` — the owner declined at the provider.
 * - `failed` — the provider refused, or the connect did (see `code`).
 * - `expired` — 48 hours passed without the records resolving.
 */
export const DOMAIN_CONNECT_STATUSES = [
  'started',
  'applied',
  'waiting',
  'connected',
  'cancelled',
  'failed',
  'expired',
] as const

export type DomainConnectStatus = (typeof DOMAIN_CONNECT_STATUSES)[number]

/** A status nothing advances from. */
export function isDomainConnectTerminal(status: DomainConnectStatus): boolean {
  return status === 'connected' || status === 'cancelled' || status === 'failed' || status === 'expired'
}

/** What `domain-connect/discover` answers. Never an error the page shows. */
export type DomainConnectDiscoverResponse =
  | { supported: false }
  | {
      supported: true
      /** The DNS provider's own name for itself, for the button. */
      providerName: string
    }

/** What `domain-connect/start` answers: where to send the owner. */
export interface DomainConnectStartResponse {
  /** The signed apply link at the DNS provider. */
  url: string
  /** The popup size the provider asked for. */
  width: number
  height: number
  /** The session's handle, which `domain-connect/finish` takes. */
  state: string
  providerName: string
}

/** What `domain-connect/finish` answers about a session. */
export interface DomainConnectFinishResponse {
  status: DomainConnectStatus
  /** Why a session failed or connected short of serving. A code, never prose. */
  code: string | null
  providerName: string
  domain: string
}

/**
 * The message the provider's return page hands back to the console window
 * that opened it, by `postMessage` to the opener and on a `BroadcastChannel`
 * of this name (the opener reference does not survive a provider page that
 * isolates itself). It carries no state: the window that hears it asks
 * `domain-connect/finish` with its own.
 */
export const DOMAIN_CONNECT_RETURN_CHANNEL = 'aglyn-domain-connect'

export interface DomainConnectReturnMessage {
  source: typeof DOMAIN_CONNECT_RETURN_CHANNEL
  outcome: 'applied' | 'cancelled' | 'failed'
}

/** Whether `value` is the return page's message. */
export function isDomainConnectReturnMessage(value: unknown): value is DomainConnectReturnMessage {
  const message = value as Partial<DomainConnectReturnMessage> | null
  return (
    !!message &&
    message.source === DOMAIN_CONNECT_RETURN_CHANNEL &&
    (message.outcome === 'applied' || message.outcome === 'cancelled' || message.outcome === 'failed')
  )
}

/**
 * Whether a typed value is complete enough to ask about: two or more labels,
 * the last one at least two letters. Saves a discovery per keystroke on
 * `exampl` and `example.c`.
 */
export function looksLikeFullDomain(value: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,63}$/.test(value.trim().toLowerCase())
}
