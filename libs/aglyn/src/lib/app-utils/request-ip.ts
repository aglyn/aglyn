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
 * The ONE client-address reader (AGL-2014).
 *
 * Sits beside `request-geo.ts` and does the same job for a different signal:
 * read a fact about the caller off the request, vendor-neutrally, and return
 * nothing rather than a guess when it cannot.
 *
 * ## The failure this exists for
 *
 * Roughly twenty call sites read `x-forwarded-for` and took element `[0]` as
 * the visitor's address. That is correct only where the edge OVERWRITES the
 * header. A default self-host does not overwrite it: nginx's
 * `$proxy_add_x_forwarded_for` and the usual Traefik/Caddy chains APPEND, so a
 * caller who sends `X-Forwarded-For: 1.2.3.4` arrives at the app as
 * `1.2.3.4, <their real address>` and element `[0]` is whatever they typed.
 *
 * Every rate limiter in the product keys on that value, so on a default Docker
 * install it was a rate-limit bypass by header: change one character per
 * request and every limiter hands out a fresh budget. Nothing errors and
 * nothing is logged. The same value is stored as clickwrap evidence and shown
 * to an account owner in a new-device sign-in alert, where a forged address is
 * durable rather than merely a bypass.
 *
 * Binding the containers to loopback in `docker-compose.yml` forces traffic
 * through the operator's proxy. It does not help here: the proxy appending is
 * exactly the case that remains.
 *
 * ## Which hop is the client
 *
 * With N appending proxies in front, the last N entries of `x-forwarded-for`
 * were written by those proxies and are the only ones a caller cannot forge.
 * The outermost trusted proxy wrote the address IT saw — the real client — so
 * the client is the Nth entry counted from the RIGHT, and everything to its
 * left is caller-supplied text that must be ignored.
 *
 * The count is the configuration, because it is the only thing the app cannot
 * work out for itself. It is deliberately not an index: an operator running
 * one reverse proxy sets `1`, and never has to reason about which end of the
 * list they are counting from.
 *
 * ## The default, and why it is not the same everywhere
 *
 * The two candidate defaults fail in opposite directions. Trusting the
 * LEFTMOST hop keeps Aglyn's own cloud correct and leaves every self-host
 * spoofable. Trusting the RIGHTMOST keeps self-hosts correct and would be a
 * silent behavior change on Aglyn's own production.
 *
 * Neither has to be guessed, because the platform can be detected. Vercel sets
 * `VERCEL` in the runtime environment — the same signal `deployment-shape.ts`
 * already keys on — and it terminates every request at its own edge. So:
 *
 *  - **Platform detected** → platform mode. Read `x-vercel-forwarded-for`
 *    first: Vercel computes it and strips any inbound copy, so on a Vercel
 *    request it is the one address value a caller cannot influence. That is
 *    the same trust `request-geo.ts` already places in `x-vercel-ip-country`
 *    to run the sanctions gate, so it is not a new assumption. If it is
 *    absent, fall back to the LEFTMOST `x-forwarded-for` hop, which is
 *    precisely what every call site did before this module existed — so
 *    nothing on Aglyn's deployment can read differently than it did.
 *
 *  - **No platform detected** (a container, a bare Node process, a developer's
 *    machine) → one trusted proxy, so the RIGHTMOST hop. That is correct for
 *    both proxy styles at the depth the shipped `docker-compose.yml` describes:
 *    an overwriting proxy leaves a single entry, where rightmost and leftmost
 *    are the same value; an appending proxy leaves the real client last.
 *
 * An operator with more than one proxy in front sets the real number. Getting
 * that number too LOW names an intermediate proxy instead of the visitor,
 * which over-counts — several visitors share one bucket and the limiter
 * refuses sooner. Getting it too HIGH is the direction that matters, and it
 * cannot hand out a forged address here: a chain shorter than the configured
 * depth is clamped to its leftmost entry, and every entry of such a chain was
 * still written by a trusted proxy.
 *
 * ## What this will not do
 *
 * ⛔ It never invents an address. When nothing readable is present the answer
 * is `null` and the caller decides. Returning a placeholder like `'unknown'`
 * would put every anonymous caller in one rate-limit bucket, which is a denial
 * of service the limiter inflicts on itself.
 *
 * ⛔ No trusted-CIDR matching. A hop count answers the same question with
 * configuration an operator can actually get right, and a CIDR list that is
 * subtly wrong fails open in exactly the way this module exists to prevent.
 *
 * ⛔ Not for an edge bundle as written. `AGLYN_TRUSTED_PROXY_COUNT` is read
 * from `process.env` at call time, so it is a genuine runtime variable an
 * operator can change without rebuilding — unlike the geo header names, which
 * `apps/console/middleware.ts` drags into the edge bundle and which therefore
 * have to be mapped through `next.config.js` and fixed at build. Nothing
 * reads an address in middleware today. Anything that starts to must map the
 * variable through both `next.config.js` files first, or the edge will read
 * `undefined` and silently fall back to the default.
 */

import type { HeaderReader } from './request-geo'

/** The environment variable naming how many proxies sit in front of the app. */
export const TRUSTED_PROXY_COUNT_VAR = 'AGLYN_TRUSTED_PROXY_COUNT'

/**
 * The trusted depth assumed when nothing is configured and no platform edge is
 * detected: one reverse proxy, which is the shape `docker-compose.yml` and the
 * self-hosting runbook describe.
 */
export const DEFAULT_TRUSTED_PROXY_COUNT = 1

/**
 * `null` means "a platform edge normalizes the header, trust what it presents".
 * A number is a literal count of proxies in front, and `0` means none — a
 * process reachable directly from the internet, where every forwarding header
 * is caller-supplied text and only the transport peer is a fact.
 */
export type TrustedProxyDepth = number | null

/**
 * The key fragment a control uses when it has no address and cannot simply
 * skip — and the decision every caller of {@link readClientIp} has to make.
 *
 * Most address-keyed controls in this codebase SKIP when the address is
 * `null`. A budget keyed on a placeholder is one budget shared by everybody,
 * so a deployment whose proxy names no caller would refuse password resets,
 * sign-ins, org creation and site creation for all of its users at once — a
 * denial of service the limiter inflicts on itself, and a worse outcome than
 * the control not running on a deployment that cannot identify anybody. Those
 * controls each have a second key — a uid, an email address, a site — that
 * still applies.
 *
 * The exception is a control whose job is COST rather than identity: the
 * unauthenticated beacons and the pre-auth REST budget bound how much
 * unauthenticated work a stranger can cause, they answer the same way whether
 * or not the limit bites, and they have no second key. Skipping those would
 * leave an unauthenticated Firestore writer unbounded on exactly the
 * misconfigured deployment that produced the missing address. They keep
 * counting, under this bucket, which costs telemetry rather than service.
 *
 * Spelled so it cannot be mistaken for an address, and reached only when NO
 * source produced one — not merely when `x-forwarded-for` was absent.
 */
export const NO_CLIENT_ADDRESS_BUCKET = 'no-address'

/** Node-style header records alongside a `Headers`-shaped reader. */
export type ClientIpHeaders =
  | HeaderReader
  | Record<string, string | string[] | undefined>

export interface ClientIpOptions {
  /**
   * Overrides the configured depth. Tests pass this; production code should
   * not, so an operator's configuration is the only thing that decides.
   */
  trustedProxyCount?: TrustedProxyDepth
  /**
   * The transport peer — `req.socket.remoteAddress` on a node-style handler.
   * Consulted last, and only because it is the one address the process knows
   * first-hand. Behind a proxy that sets no forwarding header at all it is the
   * proxy's own address, which is a single shared bucket rather than a
   * visitor; that is a misconfiguration the self-hosting docs name, not a
   * reading this module can improve on.
   */
  remoteAddress?: string | null
  /** Injectable for tests; defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

/**
 * An upper bound on a configured depth, so a typo cannot express a chain
 * nobody runs. Past this the value is treated as unset rather than obeyed.
 */
const MAX_TRUSTED_PROXIES = 32

/**
 * How many proxies to trust, from configuration or from the runtime.
 *
 * Read per call rather than frozen at module scope: this is a runtime
 * variable, and a module-scope snapshot would make it unchangeable without a
 * rebuild for no reason (see the edge-bundle note in the module comment).
 */
export function resolveTrustedProxyCount(
  env: Record<string, string | undefined> = process.env,
): TrustedProxyDepth {
  const raw = String(env[TRUSTED_PROXY_COUNT_VAR] ?? '').trim()
  if (raw) {
    // Whole, non-negative, and small. A junk value must not silently become a
    // depth: `NaN` would compare false everywhere and quietly read the
    // leftmost hop, which is the bypass this module exists to close.
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_TRUSTED_PROXIES) {
      return parsed
    }
  }
  // The platform's own edge. Detected, not guessed — and detected from the
  // runtime environment rather than from the presence of a `x-vercel-*`
  // header, which an operator's proxy could pass through from a caller.
  if (env['VERCEL']) return null
  return DEFAULT_TRUSTED_PROXY_COUNT
}

/**
 * The address Vercel computed for the caller.
 *
 * Vercel sets every `x-vercel-*` header itself and overwrites any inbound
 * copy, so on a Vercel request this is not caller-supplied. It is read only
 * in platform mode, so an operator's proxy forwarding a forged
 * `x-vercel-forwarded-for` reaches nothing.
 */
const PLATFORM_ADDRESS_HEADER = 'x-vercel-forwarded-for'

/** Wrap either header shape in the `Headers`-like reader the rest uses. */
function readerFor(headers: ClientIpHeaders): HeaderReader {
  if (typeof (headers as HeaderReader)?.get === 'function') {
    return headers as HeaderReader
  }
  const record = (headers ?? {}) as Record<string, string | string[] | undefined>
  const lowered: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    // A repeated header arrives as an array in node. Joining with `,` restores
    // the single-list form `Headers.get` would have produced, so the hop
    // arithmetic below counts the same entries either way.
    lowered[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value)
  }
  return { get: (name: string) => lowered[name.toLowerCase()] ?? null }
}

/** RFC 7239 says an unresolvable node is `unknown`; squid writes it too. */
const NOT_AN_ADDRESS = new Set(['unknown', 'null', 'undefined'])

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV6 = /^[0-9a-f:]+$/

/**
 * The one spelling of an address this module ever returns, or `null`.
 *
 * Normalization is not cosmetic. A rate-limit key is an exact string, so
 * `2001:DB8::1` and `2001:db8::1`, or the same address with and without a
 * source port, would be two budgets for one visitor — the bypass again, in
 * miniature.
 *
 *  - a port is dropped: it changes per connection,
 *  - `[…]` brackets and an IPv6 zone (`%eth0`) are dropped,
 *  - an IPv4-mapped IPv6 (`::ffff:1.2.3.4`) collapses to its IPv4 form, so a
 *    node socket address and a proxy's header value share one bucket,
 *  - anything that is not an address — `unknown`, RFC 7239's obfuscated
 *    `_hidden` identifiers, a hostname, a header some proxy passed through
 *    under this name — is `null` rather than a key.
 */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  let value = String(raw ?? '')
    .trim()
    .replace(/^"|"$/g, '')
    .trim()
    .toLowerCase()
  if (!value) return null
  // RFC 7239 obfuscated identifiers are deliberately not addresses.
  if (value.startsWith('_')) return null
  if (NOT_AN_ADDRESS.has(value)) return null

  if (value.startsWith('[')) {
    // `[2001:db8::1]:443` — brackets exist precisely to make the port
    // unambiguous, so this is the only form a port may be stripped from.
    const close = value.indexOf(']')
    if (close < 0) return null
    value = value.slice(1, close)
  } else if ((value.match(/:/g) ?? []).length === 1) {
    // Exactly one colon can only be `host:port`; a bare IPv6 has more.
    value = value.slice(0, value.indexOf(':'))
  }

  // A zone index identifies a local interface, not a caller.
  const zone = value.indexOf('%')
  if (zone >= 0) value = value.slice(0, zone)
  if (!value) return null

  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
  if (mapped) value = mapped[1]

  const v4 = IPV4.exec(value)
  if (v4) {
    // `999.1.1.1` matches the shape and is not an address. Leading zeros are
    // rejected with it: `010.0.0.1` and `10.0.0.1` are the same host to some
    // resolvers and two different rate-limit keys here.
    for (let i = 1; i <= 4; i += 1) {
      const octet = v4[i]
      if (octet.length > 1 && octet.startsWith('0')) return null
      if (Number(octet) > 255) return null
    }
    return value
  }
  // Loose on IPv6 by design: the job is to reject text that is not an address,
  // not to re-implement a parser. It must contain a colon to get here, so a
  // hostname or a stray token cannot pass.
  if (value.includes(':') && IPV6.test(value)) return value
  return null
}

/** Split a comma-separated forwarding header into its raw entries. */
function entriesOf(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * The entry a chain of `length` hops attributes to the client, at `depth`
 * trusted proxies.
 *
 * Clamped when the chain is SHORTER than configured. That happens when an
 * outer proxy overwrites rather than appends, and every entry of such a chain
 * was still written by a trusted proxy — so the leftmost is the honest answer
 * rather than a reason to refuse. It is not clamped at the other end: a chain
 * LONGER than configured is the attack shape, and the extra entries on the
 * left are exactly what must be ignored.
 */
function clientIndex(length: number, depth: number): number {
  return Math.max(0, length - depth)
}

/**
 * The `for=` values of an RFC 7239 `Forwarded` header, left to right.
 *
 * Comma-splitting is a simplification: a quoted `for=` value may in principle
 * contain a comma. No proxy in the wild emits one, and the alternative is a
 * full parameter parser for a header that is the third fallback here.
 */
function forwardedEntries(value: string | null): string[] {
  const out: string[] = []
  for (const element of entriesOf(value)) {
    for (const param of element.split(';')) {
      const [name, ...rest] = param.split('=')
      if (name.trim().toLowerCase() !== 'for') continue
      out.push(rest.join('=').trim())
      break
    }
  }
  return out
}

/**
 * The caller's address, or `null` when nothing readable identifies them.
 *
 * Sources in order, and the order is the security property: a reading that
 * depends on the trusted depth always wins, and the single-valued fallbacks
 * only apply when the chain reading produced nothing at all. A caller cannot
 * demote the reader to a weaker source, because a proxy that writes
 * `x-forwarded-for` writes it on every request — the fallbacks are reachable
 * only on a deployment whose proxy sets something else, or on none.
 *
 *  1. the platform edge's own value, in platform mode,
 *  2. `x-forwarded-for` at the trusted hop,
 *  3. `x-real-ip`, single-valued and written by the proxy,
 *  4. `Forwarded` (RFC 7239) at the trusted hop,
 *  5. the transport peer, when the caller supplied one.
 */
export function readClientIp(
  headers: ClientIpHeaders,
  options: ClientIpOptions = {},
): string | null {
  const reader = readerFor(headers)
  const depth =
    options.trustedProxyCount !== undefined
      ? options.trustedProxyCount
      : resolveTrustedProxyCount(options.env)

  if (depth === null) {
    const platform = normalizeClientIp(reader.get(PLATFORM_ADDRESS_HEADER))
    if (platform) return platform
  }

  // Depth 0 is "nothing is in front of me", so every forwarding header is
  // caller-supplied and none of them may be read. Skipping straight to the
  // peer is the whole point of offering the value.
  if (depth !== 0) {
    // In platform mode the edge presents one authoritative value, so the
    // leftmost entry is the client — which is also, exactly, what every call
    // site read before this module existed.
    const hops = depth === null ? 1 : depth

    const forwardedFor = entriesOf(reader.get('x-forwarded-for'))
    if (forwardedFor.length) {
      const index = depth === null ? 0 : clientIndex(forwardedFor.length, hops)
      // Deliberately does NOT slide to a neighbouring entry when the trusted
      // hop is unreadable. Letting content choose the position is how a
      // spoofer would push the reader back onto their own text; falling
      // through to the next SOURCE cannot be steered that way.
      const hop = normalizeClientIp(forwardedFor[index])
      if (hop) return hop
    }

    const real = normalizeClientIp(reader.get('x-real-ip'))
    if (real) return real

    const forwarded = forwardedEntries(reader.get('forwarded'))
    if (forwarded.length) {
      const index = depth === null ? 0 : clientIndex(forwarded.length, hops)
      const hop = normalizeClientIp(forwarded[index])
      if (hop) return hop
    }
  }

  return normalizeClientIp(options.remoteAddress)
}
