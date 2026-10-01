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

/*==========================================
 * THE "YOU'RE LEAVING THIS SITE" NOTICE, CLIENT HALF (AGL-3452).
 *
 * Both phishing pages found on free sites on 2026-10-01 had one button, and it
 * went straight to an outside credential harvester: the site's address was
 * only the trusted-looking hop. So for a FREE workspace in its first 14 days,
 * a link to another domain goes through a notice on the site's own host
 * first, which names the destination in plain text and says the platform
 * does not operate it.
 *
 * The server decides whether a page is in that window and hands the page a
 * {@link LeavingNoticeConfig}; this module only applies it. Nothing here
 * reads the clock, so the server render and the hydrating client always
 * produce the same href.
 *
 * A leaf with no imports: it is on every published page through
 * `useLinkTarget`, and the hosts and signatures it needs arrive as data.
 *=========================================*/

/** The first path segment the notice owns on every site (a reserved slug). */
export const LEAVING_NOTICE_ROUTE_SEGMENT = '_aglyn'

/** Where the notice is served, on the site's own host. */
export const LEAVING_NOTICE_PATH = `/${LEAVING_NOTICE_ROUTE_SEGMENT}/leaving`

/** The query parameter carrying the destination. */
export const LEAVING_NOTICE_DESTINATION_PARAM = 'to'

/** The query parameter carrying the destination's signature. */
export const LEAVING_NOTICE_SIGNATURE_PARAM = 'sig'

/** What a page in its notice window carries, from the server. */
export interface LeavingNoticeConfig {
  /**
   * Epoch ms the window closes. For people and specs reading the payload:
   * nothing here compares it to a clock, because the page that carries this
   * config was rendered inside the window and its href has to match the
   * server's byte for byte.
   */
  until: number
  /**
   * The hosts a link may go to without the notice: the site's own subdomain
   * and custom domain, and the platform's own. An entry starting with `.` is
   * that domain AND every name under it.
   */
  hosts: readonly string[]
  /**
   * Destination (as {@link normalizeLeavingDestination} writes it) → its
   * signature, for every outside address the server found on this page. A
   * destination with none still goes through the notice, which refuses it.
   */
  sigs: Readonly<Record<string, string>>
}

/** The origin a site-relative href is resolved against to tell it apart. */
const SITE_RELATIVE_BASE = 'https://site-relative.invalid'
const SITE_RELATIVE_HOSTNAME = 'site-relative.invalid'

/**
 * The absolute http(s) address an href navigates to when it names another
 * host, or `null` for anything that stays on the page's own origin or is not
 * a navigation at all.
 *
 * Resolved the way a browser resolves it rather than pattern-matched, because
 * a pattern is exactly what a disguised link is built to get past: `//evil`
 * and `/\evil` are both protocol-relative to a browser while reading as
 * site paths to a `^/` test. `mailto:`, `tel:` and `sms:` hand off to another
 * app and are not navigations, so they answer `null` with every other scheme.
 *
 * The answer is the URL's `href` — lowercased host, default port dropped,
 * root path filled in — so the server that signs a destination and the
 * client that looks the signature up agree on one spelling.
 */
export function normalizeLeavingDestination(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed, SITE_RELATIVE_BASE)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || url.hostname === SITE_RELATIVE_HOSTNAME) return null
  return url.href
}

/**
 * Whether a hostname is one a link may reach without the notice: listed in
 * `hosts` (exactly, or under a `.domain` entry), or a development machine's
 * own `localhost`, which sends a visitor nowhere.
 */
export function isLeavingNoticeExempt(
  hostname: string,
  hosts: readonly string[],
): boolean {
  const name = String(hostname ?? '')
    .toLowerCase()
    .replace(/\.+$/, '')
  if (!name) return true
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  for (const entry of hosts) {
    if (entry.startsWith('.')) {
      if (name === entry.slice(1) || name.endsWith(entry)) return true
    } else if (name === entry) {
      return true
    }
  }
  return false
}

/**
 * The normalized destination of an href that leaves for a host outside
 * `hosts`, or `null` when the href stays, is not a navigation, or is exempt.
 */
export function leavingDestination(
  raw: unknown,
  hosts: readonly string[],
): string | null {
  const destination = normalizeLeavingDestination(raw)
  if (!destination) return null
  return isLeavingNoticeExempt(new URL(destination).hostname, hosts)
    ? null
    : destination
}

/** The notice's own address for a destination, signed when a signature is known. */
export function leavingNoticeHref(
  destination: string,
  signature?: string | null,
): string {
  const params = new URLSearchParams()
  params.set(LEAVING_NOTICE_DESTINATION_PARAM, destination)
  if (signature) params.set(LEAVING_NOTICE_SIGNATURE_PARAM, signature)
  return `${LEAVING_NOTICE_PATH}?${params.toString()}`
}

/**
 * The href a link should carry instead of `raw` — the notice for its
 * destination — or `undefined` to leave it as it is: no config (the site is
 * not in its window), a destination on an exempt host, or not a navigation.
 */
export function routeThroughLeavingNotice(
  raw: unknown,
  config: LeavingNoticeConfig | null | undefined,
): string | undefined {
  if (!config) return undefined
  const destination = leavingDestination(raw, config.hosts)
  if (!destination) return undefined
  return leavingNoticeHref(destination, config.sigs?.[destination])
}

/**
 * Points the anchor an event landed in at the notice, when it leaves.
 *
 * The catch-all for every link `useLinkTarget` never saw — Markdown and rich
 * text bodies, collection blocks, a plugin's own anchors. The href is
 * rewritten IN PLACE, before the browser acts on the event, so the visitor's
 * own gesture still decides how it opens: a modified click, a middle click
 * and "Open in new tab" all take the notice with them. Next's `Link` leaves
 * a non-local href to the browser, so the browser is what reads the change.
 *
 * Returns whether it rewrote anything.
 */
export function rerouteLeavingAnchor(
  target: EventTarget | null,
  config: LeavingNoticeConfig | null | undefined,
): boolean {
  if (!config || !target) return false
  const node = target as Node
  const element =
    node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null)
  const anchor = element?.closest?.('a[href], area[href]')
  if (!anchor) return false
  const rerouted = routeThroughLeavingNotice(anchor.getAttribute('href'), config)
  if (!rerouted) return false
  anchor.setAttribute('href', rerouted)
  return true
}

/**
 * Every gesture that can follow, open or copy a link, caught on the way
 * down so the href is the notice's before anything reads it.
 */
const LEAVING_NOTICE_EVENTS = [
  'pointerdown',
  'click',
  'auxclick',
  'contextmenu',
  'focusin',
] as const

/** Installs {@link rerouteLeavingAnchor} on a document; returns the uninstall. */
export function installLeavingNoticeInterceptor(
  doc: Document,
  config: LeavingNoticeConfig,
): () => void {
  const handler = (event: Event) => {
    rerouteLeavingAnchor(event.target, config)
  }
  for (const type of LEAVING_NOTICE_EVENTS) {
    doc.addEventListener(type, handler, true)
  }
  return () => {
    for (const type of LEAVING_NOTICE_EVENTS) {
      doc.removeEventListener(type, handler, true)
    }
  }
}
