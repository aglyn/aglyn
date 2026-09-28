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
 * Three shapes, one per requirement:
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
 *    common social or maps link. The same element, not the same page: a
 *    hotel that says "find us on Booking.com" in one place and "sign in" in
 *    another is two ordinary sentences.
 *
 * Pure: the caller hands over the composed node tree and the workspace's own
 * names and hosts, and decides what a hold does.
 *=========================================*/

import {
  isWorkspaceOwnBrand,
  linkHostsIn,
  isBrandsOwnDomain,
  lookalikeBrandForHost,
  PHISHING_LURE_PATTERNS,
  PHISHING_SCREEN_BRANDS,
  type PhishingScreenSignal,
  registrableDomain,
  isAnyOfficialBrandDomain,
  isCommonLinkDomain,
  squashScreenText,
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
 * counted only beside a brand in the SAME element. The email lure phrasing
 * counts too.
 */
const PAGE_ACTION_PATTERNS: readonly RegExp[] = [
  /\b(?:sign|log)[\s-]?in\b/i,
  /\bverify\b/i,
  /\bconfirm\s+(?:your|the)\b/i,
  /\bunlock\b/i,
  /\benter\s+your\b/i,
  /\b(?:view|review|open|download)\s+(?:the\s+|your\s+)?(?:shared\s+)?(?:file|document|invoice|statement)s?\b/i,
]

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

  // 3. A brand's call to action, in one element, on a page that links away.
  const foreign = linkHosts.find((host) => {
    if (isOwnHost(host)) return false
    const registrable = registrableDomain(host)
    return !isAnyOfficialBrandDomain(registrable) && !isCommonLinkDomain(registrable)
  })
  if (foreign) {
    const actions = [...PAGE_ACTION_PATTERNS, ...PHISHING_LURE_PATTERNS]
    const named = new Set<string>()
    for (const strings of nodeStrings) {
      const text = strings.join(' ')
      if (!text) continue
      const action = actions.map((pattern) => text.match(pattern)?.[0]).find(Boolean)
      if (!action) continue
      for (const brand of PHISHING_SCREEN_BRANDS) {
        if (named.has(brand.id)) continue
        if (brand.mention.test(text) && !isWorkspaceOwnBrand(brand, ownNames, ownRegistrables)) {
          named.add(brand.id)
          signals.push({ code: 'brand-action-page', brand: brand.id, action: action.slice(0, 80) })
        }
      }
    }
  }

  return { signals }
}
