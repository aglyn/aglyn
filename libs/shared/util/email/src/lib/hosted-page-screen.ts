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
 * THE HOSTED PAGE SCREEN (AGL-3362).
 *
 * The outbound phishing screen, read over a PUBLISHED PAGE instead of an
 * email: the same brand list, the same lookalike logic, the same tiers
 * (`signalsThatHold`). A fraud actor who could not mail a lure could still
 * host one, and the incident's sibling site published a page at the
 * document-share path `/reviewfile`.
 *
 * Five shapes:
 *
 * 1. **A lookalike link or embed** (`lookalike-link`, STRONG) — any `href`,
 *    `src`, form action or URL in the page's authored content whose host
 *    wears a brand without being the brand's domain.
 * 2. **A credential field** (`credential-field`, STRONG) — a field the
 *    merchant AUTHORED that asks for a password, a card number or a
 *    one-time code: its type, its autocomplete token, or its label,
 *    placeholder or name. The platform's own sign-in, account and checkout
 *    elements render their inputs in code, not in stored props, so they are
 *    never read as a field here — which is exactly the sanctioned/unsanctioned
 *    line: what the platform collects through its own components is
 *    Aglyn's to protect, and what a page's author collects in a form of
 *    their own is not something a site may ask a stranger for.
 * 3. **A brand's call to action** (`brand-action-page`, SOFT) — one element
 *    whose text names a brand that is not the workspace's AND asks the reader
 *    to sign in, verify, confirm or open a document, on a page that links
 *    somewhere that is neither the workspace's, nor a brand's own, nor a
 *    common social or maps link.
 * 4. **A brand's lure, page-wide** (`brand-lure-page`, SOFT, AGL-3447) — the
 *    same brand and link anywhere on the page, beside an account or
 *    document-share LURE anywhere on it ("Secure Document Access Portal"), or
 *    a call to action that leaves the site worded as an action ("Continue to
 *    Document"). The 2026-10-01 phishing page put Proofpoint's name in its
 *    body, the lure in its heading and the action on its button: three
 *    elements, none of which shape 3 reads on its own. What it does not count page-wide is
 *    a bare "sign in" that stays on the site — a hotel that says "find us on
 *    Booking.com" in one place and has a member sign-in in another is two
 *    ordinary sentences.
 * 5. **A call to action that leaves, beside a lure** (`offsite-action-page`,
 *    SOFT, AGL-3447) — the page's only call to action, or one worded as an
 *    account or document action, sends visitors to a host that is not the
 *    site's own, a listed brand's or a common link, on a page that carries an
 *    account or document-share lure. No brand needed: a "Secure Document
 *    Access Portal" whose one button leaves for the kit is the shape whatever
 *    name it wears.
 *
 * Shapes 3-5 are soft, so they hold only for a workspace in its first
 * fortnight (`signalsThatHold`); an established workspace's page is held by
 * shapes 1 and 2 alone.
 *
 * The same reading applies to a site REDIRECT ({@link screenSiteRedirect}):
 * a rule that sends a path off the site is a page whose one call to action
 * fires on arrival, and its path is the only text it has.
 *
 * Pure: the caller hands over the composed node tree and the workspace's own
 * names and hosts, and decides what a hold does.
 *=========================================*/

import {
  ACCOUNT_LURE_PATTERNS,
  DOCUMENT_SHARE_LURE_PATTERNS,
  isWorkspaceOwnBrand,
  linkHostsIn,
  isBrandsOwnDomain,
  lookalikeBrandForHost,
  PHISHING_LURE_PATTERNS,
  PHISHING_SCREEN_BRANDS,
  type PhishingScreenBrand,
  type PhishingScreenSignal,
  registrableDomain,
  isAnyOfficialBrandDomain,
  isCommonLinkDomain,
  squashScreenText,
  visibleTextOf,
} from './outbound-phishing-screen'

export interface HostedPageScreenInput {
  /**
   * The page as it will be served — the composed tree, or any object that
   * holds nodes (`{ componentId, props }`) at any depth. Walked, never
   * trusted to have one shape: a screen, a layout's chrome, a grafted
   * component and a form all arrive together.
   */
  nodes: unknown
  /** The workspace's own names, as `screenOutboundEmail` reads them. */
  ownNames?: readonly (string | null | undefined)[]
  /** The workspace's own hosts — a link to one is never "elsewhere". */
  ownDomains?: readonly (string | null | undefined)[]
}

export interface HostedPageScreenVerdict {
  signals: PhishingScreenSignal[]
}

/** A node as the walk finds it. */
interface WalkedNode {
  componentId: string
  props: Record<string, unknown>
}

/** The most a page's text is read to, so a huge page costs a bounded scan. */
const MAX_PAGE_TEXT = 2_000_000
/** The most nodes the walk visits. */
const MAX_NODES = 20_000

/** Props that describe a field the author defined, rather than content. */
const FIELD_PROP_KEYS = ['fieldType', 'fieldName', 'inputType', 'autoComplete', 'autocomplete']

/** Autocomplete tokens (WHATWG) that name a credential. */
const CREDENTIAL_AUTOCOMPLETE: Record<string, 'password' | 'card' | 'otp'> = {
  'current-password': 'password',
  'new-password': 'password',
  'cc-number': 'card',
  'cc-csc': 'card',
  'cc-exp': 'card',
  'one-time-code': 'otp',
}

/** Field wording that asks for a credential, by kind. */
const CREDENTIAL_LABELS: ReadonlyArray<{ field: 'password' | 'card' | 'otp'; pattern: RegExp }> = [
  { field: 'password', pattern: /\bpass\s?(?:word|code|phrase)s?\b|\bpasswd\b|\bpin\s*(?:code|number)?\s*$/i },
  {
    field: 'card',
    pattern:
      /\b(?:credit|debit)\s*card\b|\bcard\s*(?:number|no\.?|#)|\bcardnumber\b|\bcvv2?\b|\bcvc\b|\bcard\s*security\s*code\b|\bcard\s*expir/i,
  },
  {
    field: 'otp',
    pattern:
      /\bone[-\s]?time\s*(?:pass\s?code|password|code|pin)\b|\botp\b|\bverification\s*code\b|\b2fa\b|\btwo[-\s]?factor\b|\bauthenticat(?:ion|or)\s*code\b|\bsms\s*code\b/i,
  },
]

/** Raw HTML an author placed that holds a credential input. */
const HTML_CREDENTIAL_INPUTS: ReadonlyArray<{ field: 'password' | 'card' | 'otp'; pattern: RegExp }> = [
  { field: 'password', pattern: /<input\b[^>]*\btype\s*=\s*["']?password/i },
  { field: 'password', pattern: /<input\b[^>]*\b(?:name|autocomplete)\s*=\s*["']?(?:pass(?:word|wd)?|current-password|new-password)\b/i },
  { field: 'card', pattern: /<input\b[^>]*\b(?:name|autocomplete)\s*=\s*["']?(?:card_?number|cc-number|cc-csc|cvv|cvc)\b/i },
  { field: 'otp', pattern: /<input\b[^>]*\b(?:name|autocomplete)\s*=\s*["']?(?:otp|one-time-code|verification_?code)\b/i },
]

/**
 * What an element asks its reader to DO with an account or a document —
 * counted beside a brand in the SAME element, or on a call to action that
 * leaves the site. The email lure phrasing counts too.
 */
const PAGE_ACTION_PATTERNS: readonly RegExp[] = [
  /\b(?:sign|log)[\s-]?in\b/i,
  /\bverify\b/i,
  /\bconfirm\s+(?:your|the)\b/i,
  /\bunlock\b/i,
  /\benter\s+your\b/i,
  /\b(?:view|review|open|download|access)\s+(?:the\s+|your\s+)?(?:shared\s+|secure\s+)?(?:file|document|invoice|statement)s?\b/i,
  /\b(?:continue|proceed)\s+to\s+(?:the\s+|your\s+)?(?:document|file|account|sign[\s-]?in|log[\s-]?in)s?\b/i,
]

/**
 * The lures a page is read for as a WHOLE (AGL-3447): account and
 * document-share wording. Not the marketplace, booking and parcel lures,
 * which a hotel's "guest reviews" and a shop's delivery page carry every day
 * and which still count in one element beside a brand.
 */
const PAGE_LURE_PATTERNS: readonly RegExp[] = [...ACCOUNT_LURE_PATTERNS, ...DOCUMENT_SHARE_LURE_PATTERNS]

/**
 * A component that renders a call to action — a button or a link, however a
 * plugin names it (`muiButton`, `muiScreenLink`, `muiLinkBox`). It is one
 * when it carries a target: an `href`, or a `screenId` on the site itself.
 */
const CALL_TO_ACTION_COMPONENT = /button|fab|cta|link/i

/** The props a call to action's visible words live in; the first found wins. */
const CALL_TO_ACTION_LABEL_KEYS = ['children', 'label', 'text', 'title', 'html']

/** URLs in page text, so prose is read for a brand or a lure without them. */
const PROSE_URL_PATTERN = /(?:https?:)?\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi

/** One call to action: what it says, and the host it leaves for (null: it stays). */
interface CallToAction {
  label: string
  host: string | null
}

/** Every node in the tree, breadth-first in document order, bounded. */
function walkNodes(root: unknown): WalkedNode[] {
  const found: WalkedNode[] = []
  const seen = new Set<unknown>()
  const stack: unknown[] = [root]
  for (let head = 0; head < stack.length && found.length < MAX_NODES; head += 1) {
    const value = stack[head]
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const record = value as Record<string, unknown>
    if (typeof record['componentId'] === 'string') {
      const props = record['props']
      found.push({
        componentId: record['componentId'] as string,
        props: props && typeof props === 'object' ? (props as Record<string, unknown>) : {},
      })
    }
    for (const child of Array.isArray(value) ? value : Object.values(record)) {
      if (child && typeof child === 'object') stack.push(child)
    }
  }
  return found
}

/** Every string a node's props hold, one level of arrays and objects deep. */
function propStrings(props: Record<string, unknown>, skip: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (typeof value === 'string') out.push(value)
    else if (depth < 3 && value && typeof value === 'object') {
      for (const entry of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
        visit(entry, depth + 1)
      }
    }
  }
  for (const [key, value] of Object.entries(props)) {
    if (key === 'sx' || skip.has(key)) continue
    visit(value, 0)
  }
  return out
}

/** Does this node describe a field its author defined? */
function isAuthoredField(node: WalkedNode): boolean {
  if (/field|input/i.test(node.componentId)) return true
  return FIELD_PROP_KEYS.some((key) => node.props[key] !== undefined)
}

/** The credential a field asks for, or null. */
function credentialOf(node: WalkedNode): { field: 'password' | 'card' | 'otp'; label: string } | null {
  const text = (key: string) => (typeof node.props[key] === 'string' ? (node.props[key] as string) : '')
  const type = [text('fieldType'), text('type'), text('inputType')].join(' ').toLowerCase()
  const label = text('label') || text('placeholder') || text('fieldName') || text('name')
  if (/\bpassword\b/.test(type)) return { field: 'password', label: label || 'password' }
  const autocomplete = (text('autoComplete') || text('autocomplete')).toLowerCase().trim()
  const byToken = CREDENTIAL_AUTOCOMPLETE[autocomplete]
  if (byToken) return { field: byToken, label: label || autocomplete }
  const wording = [text('label'), text('placeholder'), text('fieldName'), text('name'), text('helperText')]
    .filter(Boolean)
    .join(' ')
  for (const { field, pattern } of CREDENTIAL_LABELS) {
    if (pattern.test(wording)) return { field, label: (label || wording).slice(0, 80) }
  }
  return null
}

/**
 * The credential an input asks for, read from the two attributes that decide
 * it in the browser — its `type` and its `autocomplete` token — or null.
 * For code that builds inputs rather than storing them as page props: the
 * marketplace verifier reads a plugin bundle's `{ type: 'password' }` and
 * `setAttribute('autocomplete', 'cc-number')` with this (AGL-3362).
 */
export function credentialForInputAttribute(
  attribute: string,
  value: string,
): 'password' | 'card' | 'otp' | null {
  const name = String(attribute ?? '').toLowerCase()
  const token = String(value ?? '').trim().toLowerCase()
  if ((name === 'type' || name === 'inputtype') && token === 'password') return 'password'
  if (name === 'autocomplete') return CREDENTIAL_AUTOCOMPLETE[token] ?? null
  return null
}

/** The credential a piece of raw HTML asks for in an input of its own, or null. */
export function credentialInHtml(html: string): 'password' | 'card' | 'otp' | null {
  const text = String(html ?? '')
  if (!text.includes('<')) return null
  return HTML_CREDENTIAL_INPUTS.find(({ pattern }) => pattern.test(text))?.field ?? null
}

/**
 * Does a submitted field's NAME ask for a credential — a password, a card
 * number or security code, a one-time code? The same wording the page
 * screen holds a field for, read over a name as a form posts it
 * (`card_number`, `cardNumber`, `one-time-code`).
 *
 * For the one path that does not pass a publish: a public form endpoint
 * takes whatever field names a request carries, so a page the screen never
 * saw (third-party code, a hand-built request) could still post a password
 * to it. The endpoint drops such a field rather than store it.
 */
export function isCredentialFieldName(name: string): boolean {
  const words = String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]]+/g, ' ')
    .trim()
  if (!words) return false
  if (CREDENTIAL_AUTOCOMPLETE[words.toLowerCase().replace(/\s+/g, '-')]) return true
  if (/^(?:pass|pwd|ccnum|cc\s?num|cc\s?number|cvv2?|cvc|csc)$/i.test(words)) return true
  return CREDENTIAL_LABELS.some(({ pattern }) => pattern.test(words))
}

/** URLs a page carries in a form Links-by-shape would miss: `//host/…`. */
function protocolRelativeUrls(strings: readonly string[]): string {
  return strings
    .filter((value) => /^\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(value.trim()))
    .map((value) => `https:${value.trim()}`)
    .join('\n')
}

/**
 * Screen one page as it will be served. The caller applies the tiers with
 * `signalsThatHold` and decides what a hold does.
 */
export function screenHostedPage(input: HostedPageScreenInput): HostedPageScreenVerdict {
  const signals: PhishingScreenSignal[] = []
  const nodes = walkNodes(input.nodes)
  const ownNames = squashScreenText((input.ownNames ?? []).filter(Boolean).join(' '))
  const ownHosts = (input.ownDomains ?? [])
    .map((domain) => String(domain ?? '').trim().toLowerCase().replace(/\.+$/, ''))
    .filter((domain) => domain.includes('.'))
  const ownRegistrables = new Set(ownHosts.map(registrableDomain))
  const isOwnHost = (host: string) => ownHosts.some((own) => host === own || host.endsWith(`.${own}`))

  const nodeStrings = nodes.map((node) => propStrings(node.props))
  let pageText = nodeStrings.map((strings) => strings.join('\n')).join('\n')
  pageText = `${pageText}\n${protocolRelativeUrls(nodeStrings.flat())}`.slice(0, MAX_PAGE_TEXT)

  // 1. A lookalike host anywhere the page links, embeds or posts to.
  const linkHosts = linkHostsIn(pageText)
  for (const host of linkHosts) {
    const brand = lookalikeBrandForHost(host)
    if (brand && !isBrandsOwnDomain(brand, ownRegistrables)) {
      signals.push({ code: 'lookalike-link', brand: brand.id, host })
    }
  }

  // 2. A credential field the page's author defined.
  const credentialSeen = new Set<string>()
  const noteCredential = (field: 'password' | 'card' | 'otp', label: string) => {
    if (credentialSeen.has(field)) return
    credentialSeen.add(field)
    signals.push({ code: 'credential-field', field, label: label.slice(0, 80) })
  }
  nodes.forEach((node, index) => {
    if (isAuthoredField(node)) {
      const credential = credentialOf(node)
      if (credential) noteCredential(credential.field, credential.label)
    }
    for (const html of nodeStrings[index]) {
      if (!html.includes('<')) continue
      for (const { field, pattern } of HTML_CREDENTIAL_INPUTS) {
        if (pattern.test(html)) noteCredential(field, 'an input in the page’s own HTML')
      }
    }
  })

  const isElsewhere = (host: string) => {
    if (isOwnHost(host)) return false
    const registrable = registrableDomain(host)
    return !isAnyOfficialBrandDomain(registrable) && !isCommonLinkDomain(registrable)
  }
  const foreign = linkHosts.find(isElsewhere)
  const actions = [...PAGE_ACTION_PATTERNS, ...PHISHING_LURE_PATTERNS]
  const named = new Set<string>()
  const isOthersBrand = (brand: PhishingScreenBrand) =>
    !named.has(brand.id) && !isWorkspaceOwnBrand(brand, ownNames, ownRegistrables)

  // 3. A brand's call to action, in one element, on a page that links away.
  if (foreign) {
    for (const strings of nodeStrings) {
      const text = proseOf(strings.join(' '))
      if (!text) continue
      const action = firstMatch(actions, text)
      if (!action) continue
      for (const brand of PHISHING_SCREEN_BRANDS) {
        if (isOthersBrand(brand) && brand.mention.test(text)) {
          named.add(brand.id)
          signals.push({ code: 'brand-action-page', brand: brand.id, action: action.slice(0, 80) })
        }
      }
    }
  }

  const prose = proseOf(pageText)
  const pageLure = firstMatch(PAGE_LURE_PATTERNS, prose)
  const ctas = callsToAction(nodes)
  const leaving = ctas.filter((cta): cta is CallToAction & { host: string } =>
    Boolean(cta.host && isElsewhere(cta.host)),
  )
  const wordedLeaving = leaving.find((cta) => firstMatch(actions, cta.label))

  // 4. A brand's lure, read over the page as a whole, on a page that links away.
  const brandLure = pageLure ?? (wordedLeaving ? firstMatch(actions, wordedLeaving.label) : undefined)
  if (foreign && brandLure) {
    const host = (wordedLeaving ?? leaving[0])?.host ?? foreign
    for (const brand of PHISHING_SCREEN_BRANDS) {
      if (isOthersBrand(brand) && brand.mention.test(prose)) {
        named.add(brand.id)
        signals.push({ code: 'brand-lure-page', brand: brand.id, lure: brandLure.slice(0, 120), host })
      }
    }
  }

  // 5. The page's call to action leaves the site, beside a lure. Its only
  //    one, or the one worded as an account or document action.
  const primary = wordedLeaving ?? (ctas.length === 1 ? leaving[0] : undefined)
  if (primary && pageLure) {
    signals.push({
      code: 'offsite-action-page',
      action: (primary.label || primary.host).slice(0, 80),
      lure: pageLure.slice(0, 120),
      host: primary.host,
    })
  }

  return { signals }
}

/**
 * What a visitor reads in page text: its markup taken out the way the email
 * screen takes it out ({@link visibleTextOf}), so a custom HTML block or a
 * rich-text prop cannot split a brand or a lure letter by letter with tags
 * (AGL-3453), and its bare URLs taken out too. Links are still read from
 * the raw text, where an href lives.
 */
function proseOf(text: string): string {
  return visibleTextOf(text).replace(PROSE_URL_PATTERN, ' ').replace(/\s+/g, ' ').trim()
}

/** The first pattern's match in the text, or undefined. */
function firstMatch(patterns: readonly RegExp[], text: string): string | undefined {
  if (!text) return undefined
  for (const pattern of patterns) {
    const found = text.match(pattern)?.[0]
    if (found) return found
  }
  return undefined
}

/** The words a call to action shows, from its label prop, markup taken out. */
function callToActionLabel(props: Record<string, unknown>): string {
  for (const key of CALL_TO_ACTION_LABEL_KEYS) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) {
      return visibleTextOf(value).split('\n')[0]
    }
  }
  return ''
}

/**
 * Every call to action on the page: each button or link that carries a
 * target. A `screenId` is a page of the site and takes precedence over an
 * `href`, as the button renders it; a relative, `mailto:` or `tel:` href has
 * no web host and stays too.
 */
function callsToAction(nodes: readonly WalkedNode[]): CallToAction[] {
  const found: CallToAction[] = []
  for (const node of nodes) {
    if (!CALL_TO_ACTION_COMPONENT.test(node.componentId)) continue
    const screenId = typeof node.props['screenId'] === 'string' ? node.props['screenId'].trim() : ''
    const href = typeof node.props['href'] === 'string' ? node.props['href'].trim() : ''
    if (!screenId && !href) continue
    const absolute = href.startsWith('//') ? `https:${href}` : href
    found.push({
      label: callToActionLabel(node.props),
      host: screenId ? null : (linkHostsIn(absolute)[0] ?? null),
    })
  }
  return found
}

export interface SiteRedirectScreenInput {
  /** The path the rule answers — `/secure-document` — or its pattern. */
  source: string
  /** Where it sends the visitor, after any `$n` substitution. */
  destination: string
  /** The workspace's own names, as `screenHostedPage` reads them. */
  ownNames?: readonly (string | null | undefined)[]
  /** The workspace's own hosts — a redirect to one never leaves. */
  ownDomains?: readonly (string | null | undefined)[]
}

/**
 * Screen one site redirect (AGL-3447): a rule that sends a path off the site
 * is a call to action that fires on arrival, so it is read with the page's
 * rules over the one text it has, its path.
 *
 * - `lookalike-link` (STRONG) — the destination wears a brand it is not.
 * - `offsite-redirect` (SOFT) — the destination is not the site's own, a
 *   listed brand's or a common link, and the path reads as an account or
 *   document-share lure (`/secure-document-access`).
 * - `brand-lure-link` (SOFT) — the same, and the path names a brand that is
 *   not the workspace's (`/paypal-verify-your-account`), the email screen's
 *   three-part lure.
 *
 * The caller applies the tiers with `signalsThatHold`, with the workspace's
 * age, and decides what a hold does.
 */
export function screenSiteRedirect(input: SiteRedirectScreenInput): HostedPageScreenVerdict {
  const signals: PhishingScreenSignal[] = []
  const destination = String(input.destination ?? '').trim()
  const hosts = linkHostsIn(destination.startsWith('//') ? `https:${destination}` : destination)
  if (!hosts.length) return { signals }
  const ownNames = squashScreenText((input.ownNames ?? []).filter(Boolean).join(' '))
  const ownHosts = (input.ownDomains ?? [])
    .map((domain) => String(domain ?? '').trim().toLowerCase().replace(/\.+$/, ''))
    .filter((domain) => domain.includes('.'))
  const ownRegistrables = new Set(ownHosts.map(registrableDomain))

  for (const host of hosts) {
    const brand = lookalikeBrandForHost(host)
    if (brand && !isBrandsOwnDomain(brand, ownRegistrables)) {
      signals.push({ code: 'lookalike-link', brand: brand.id, host })
    }
  }

  // The first host is where the browser goes; the rest is a userinfo disguise.
  const host = hosts[0]
  const registrable = registrableDomain(host)
  const leaves =
    !ownHosts.some((own) => host === own || host.endsWith(`.${own}`)) &&
    !isAnyOfficialBrandDomain(registrable) &&
    !isCommonLinkDomain(registrable)
  if (!leaves) return { signals }

  const source = String(input.source ?? '').trim()
  const words = pathWords(source)
  const lure = firstMatch(PAGE_LURE_PATTERNS, words)
  if (lure) {
    signals.push({ code: 'offsite-redirect', source: source.slice(0, 120), lure: lure.slice(0, 120), host })
  }
  const anyLure = lure ?? firstMatch(PHISHING_LURE_PATTERNS, words)
  if (anyLure) {
    const brand = PHISHING_SCREEN_BRANDS.find(
      (candidate) =>
        candidate.mention.test(words) && !isWorkspaceOwnBrand(candidate, ownNames, ownRegistrables),
    )
    if (brand) {
      signals.push({ code: 'brand-lure-link', brand: brand.id, lure: anyLure.slice(0, 120), host })
    }
  }
  return { signals }
}

/** A path read as words: `/secure-document_access` → `secure document access`. */
function pathWords(path: string): string {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // A malformed escape is read as typed.
  }
  return decoded.replace(/[^a-z0-9]+/gi, ' ').trim()
}
