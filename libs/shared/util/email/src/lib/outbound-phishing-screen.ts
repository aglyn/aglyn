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
 * THE OUTBOUND PHISHING SCREEN (AGL-3356).
 *
 * A fraud actor signed up, paid with a card that never met 3-D Secure, and
 * used a workspace to send two kinds of mail: a campaign of Booking.com-style
 * "guest feedback regarding your property" lures to hotels, and a workflow
 * that mailed "Poshmark Order — one of the items from your Seller Account has
 * finally sold", linking to `poshmark.id63835663.shop`.
 *
 * This module answers one question about a message a YOUNG workspace is
 * about to send: does its content carry a STRONG phishing signal? The caller
 * decides who is young and what happens to a positive answer — the answer is
 * a hold for staff review, never a drop.
 *
 * ## Conservative by construction
 *
 * A false positive costs a real merchant's first campaign a wait for a
 * human; a miss costs strangers their bank logins. Both are real, so only
 * three shapes hold, and each is one a legitimate merchant essentially never
 * produces:
 *
 * 1. **A lookalike link** — a link or reply address whose host carries a
 *    brand's name without being the brand's own domain: the brand as a label
 *    of an unrelated registrable domain (`poshmark.id63835663.shop`), hyphen-
 *    joined to one (`paypal-secure.com`, `secure-paypal.net`), the brand's
 *    real domain embedded in a longer host (`booking.com.guest-review.top`),
 *    or leetspeak for it (`paypa1.com`). Holds on its own.
 * 2. **A brand in the sender's display name** that is not the workspace's
 *    own name — mail that says it is FROM PayPal.
 * 3. **The three-part lure**: a brand named in the copy, AND credential or
 *    account-action phrasing ("verify your account", "has finally sold",
 *    "feedback regarding your property"), AND a link to a domain that is
 *    neither the brand's, nor the workspace's, nor a common social or maps
 *    link. Any two of the three are ordinary marketing — "our book is on
 *    Amazon", "sign in to your account", a link to the shop — and pass.
 *
 * Mentioning a brand, alone, never holds.
 *
 * ## The brand list is small on purpose
 *
 * The brands phishing kits most often wear, plus the two in the incident. A
 * brand is added when it has been seen impersonated, not because it is big:
 * every entry is a set of words that can now hold somebody's newsletter.
 * Each carries its REAL domains, so a link to the brand itself is never
 * suspicious, and host tokens chosen so a common word (`booking`, `apple`,
 * `outlook`) does not match an unrelated host by itself.
 *
 * Pure: no DNS, no store, no clock. Everything the caller knows about the
 * workspace arrives as input.
 *=========================================*/

/** One brand the screen recognizes. */
export interface PhishingScreenBrand {
  /** Stable id, as stored on a hold. */
  id: string
  /** How staff read it. */
  label: string
  /** Copy that names the brand — subject, body, sender. Case-insensitive. */
  mention: RegExp
  /**
   * Host labels that name the brand. Matched against each dot-separated
   * label of a link's host, whole or hyphen-joined, after leetspeak is
   * folded — never as a bare substring, which is how `amazonaws` or
   * `bookingengine` would read as a brand.
   */
  hostTokens: readonly string[]
  /**
   * Registrable domains the brand genuinely links from. The FIRST is its
   * primary domain, the one a kit embeds in a longer host.
   */
  officialDomains: readonly string[]
  /**
   * The brand's name is an ordinary word (`apple`, `amazon`), so a host
   * label names the brand only when it IS the word — `apple.example.top` —
   * and never hyphen-joined or leet-folded, which `apple-orchard-farm.com`
   * would otherwise be.
   */
  wordToken?: boolean
  /**
   * Whether `<brand>.<country code>` (and `<brand>.co.<cc>`) is the brand's
   * too — true for the marketplaces that run a site per country.
   */
  countryDomains?: boolean
  /**
   * Registrable domains the brand runs but where OTHER people's content lives —
   * the platform's own tenant apex, where every site is `<name>.<apex>`. A
   * host there never wears the brand as a disguise, so the lookalike rule
   * skips it; but it is not the brand's own domain either, so a link to a
   * neighbor's site still counts as "somewhere else" to the lure rules, and a
   * workspace hosted there does not own the brand by being hosted there.
   */
  hostedDomains?: readonly string[]
}

export const PHISHING_SCREEN_BRANDS: readonly PhishingScreenBrand[] = [
  {
    id: 'poshmark',
    label: 'Poshmark',
    mention: /\bposhmark\b/i,
    hostTokens: ['poshmark'],
    officialDomains: ['poshmark.com', 'posh.mk'],
  },
  {
    id: 'booking',
    label: 'Booking.com',
    // Never the bare word: "booking" is every hotel's and every salon's.
    mention: /\bbooking\.com\b/i,
    hostTokens: ['bookingcom', 'booking-com'],
    officialDomains: ['booking.com', 'bstatic.com'],
  },
  {
    id: 'airbnb',
    label: 'Airbnb',
    mention: /\bairbnb\b/i,
    hostTokens: ['airbnb'],
    officialDomains: ['airbnb.com', 'abnb.me', 'muscache.com'],
    countryDomains: true,
  },
  {
    id: 'paypal',
    label: 'PayPal',
    mention: /\bpay\s?pal\b/i,
    hostTokens: ['paypal'],
    officialDomains: ['paypal.com', 'paypal.me', 'paypalobjects.com'],
    countryDomains: true,
  },
  {
    id: 'amazon',
    label: 'Amazon',
    mention: /\bamazon\b/i,
    hostTokens: ['amazon', 'amzn'],
    wordToken: true,
    officialDomains: [
      'amazon.com',
      'amzn.to',
      'amzn.com',
      'amazonaws.com',
      'media-amazon.com',
      'ssl-images-amazon.com',
    ],
    countryDomains: true,
  },
  {
    id: 'apple',
    label: 'Apple',
    // The fruit is on every bakery's menu; the account is what gets phished.
    mention: /\bapple\s?(?:id|support|account)\b|\bicloud\b|\bitunes\b/i,
    hostTokens: ['apple', 'appleid', 'icloud', 'itunes'],
    wordToken: true,
    officialDomains: ['apple.com', 'icloud.com', 'apple.co', 'itunes.com', 'me.com', 'mzstatic.com'],
    countryDomains: true,
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    mention: /\bmicrosoft\b|\boffice\s?365\b|\bonedrive\b|\bsharepoint\b/i,
    hostTokens: ['microsoft', 'office365', 'onedrive', 'sharepoint', 'microsoftonline', 'msonline'],
    officialDomains: [
      'microsoft.com',
      'office.com',
      'office365.com',
      'live.com',
      'outlook.com',
      'microsoftonline.com',
      'sharepoint.com',
      'onedrive.com',
      '1drv.ms',
      'aka.ms',
    ],
  },
  {
    id: 'docusign',
    label: 'DocuSign',
    mention: /\bdocu\s?sign\b/i,
    hostTokens: ['docusign'],
    officialDomains: ['docusign.com', 'docusign.net'],
  },
  {
    id: 'netflix',
    label: 'Netflix',
    mention: /\bnetflix\b/i,
    hostTokens: ['netflix'],
    officialDomains: ['netflix.com', 'nflxext.com', 'nflximg.net'],
  },
  {
    id: 'wellsfargo',
    label: 'Wells Fargo',
    mention: /\bwells\s?fargo\b/i,
    hostTokens: ['wellsfargo', 'wells-fargo'],
    officialDomains: ['wellsfargo.com'],
  },
  {
    id: 'bankofamerica',
    label: 'Bank of America',
    mention: /\bbank\s+of\s+america\b/i,
    hostTokens: ['bankofamerica', 'bofa'],
    officialDomains: ['bankofamerica.com', 'bofa.com'],
  },
  {
    id: 'coinbase',
    label: 'Coinbase',
    mention: /\bcoinbase\b/i,
    hostTokens: ['coinbase'],
    officialDomains: ['coinbase.com'],
  },
  {
    id: 'usps',
    label: 'USPS',
    mention: /\busps\b/i,
    hostTokens: ['usps'],
    officialDomains: ['usps.com'],
  },
  {
    id: 'fedex',
    label: 'FedEx',
    mention: /\bfed\s?ex\b/i,
    hostTokens: ['fedex'],
    officialDomains: ['fedex.com'],
  },
  {
    id: 'dhl',
    label: 'DHL',
    mention: /\bdhl\b/i,
    hostTokens: ['dhl'],
    officialDomains: ['dhl.com'],
    countryDomains: true,
  },
  {
    // The platform itself (AGL-3365). A marketplace listing, a page or an
    // email that wears the platform's name — "Aglyn Support", a link to
    // `aglyn-billing.com`, "official Aglyn plugin" — is the one impersonation
    // every customer is primed to trust. The workspace named for it (the
    // platform's own org) owns it by name, as any brand's own workspace does.
    id: 'aglyn',
    label: 'Aglyn',
    mention: /\baglyn\b/i,
    hostTokens: ['aglyn'],
    officialDomains: ['aglyn.com', 'aglyn.io', 'aglyn.dev'],
    hostedDomains: ['aglyn.app'],
  },
]

/**
 * Account-action and credential phrasing — the half of a lure that asks the
 * reader to DO something with an account. Only ever counted beside a brand
 * AND a foreign link; alone, several of these are ordinary transactional copy.
 */
export const PHISHING_LURE_PATTERNS: readonly RegExp[] = [
  /\bverify\s+your\s+(?:account|identity|information|details|payment|email)\b/i,
  /\bconfirm\s+your\s+(?:account|identity|details|payment|password|billing|information)\b/i,
  /\b(?:account|payment|card)\s+(?:has\s+been\s+|is\s+|was\s+)?(?:suspended|locked|limited|restricted|disabled|on\s+hold)\b/i,
  /\bunusual\s+(?:sign[-\s]?in|login|activity)\b/i,
  /\bupdate\s+your\s+(?:payment|billing|card|account)\s*(?:details|information|method)?\b/i,
  /\b(?:sign|log)\s?in\s+to\s+(?:your|view|confirm|claim|release)\b/i,
  /\b(?:has|have)\s+(?:finally\s+)?sold\b/i,
  /\bseller\s+account\b/i,
  /\b(?:guest|customer)\s+(?:complaint|review|feedback)\b/i,
  /\bfeedback\s+regarding\s+your\s+(?:property|listing|stay|booking|reservation)\b/i,
  /\b(?:document|invoice|agreement)s?\s+(?:is\s+|are\s+)?(?:ready|waiting|pending)\s+(?:for\s+)?(?:your\s+)?(?:review|signature|to\s+sign)\b/i,
  /\bpassword\s+(?:will\s+)?expire/i,
  /\bclaim\s+your\s+(?:refund|reward|prize|package|payment|funds)\b/i,
  /\b(?:delivery|shipment)\s+(?:failed|attempt|suspended|on\s+hold)\b/i,
  /\b(?:package|parcel)\s+(?:is\s+)?(?:on\s+hold|held|awaiting|undeliverable)\b/i,
  /\bsecurity\s+alert\b/i,
]

/**
 * Link targets a merchant's mail ordinarily carries that are not theirs:
 * social profiles, maps, review sites, video. Counted as neither foreign nor
 * suspicious in the three-part lure, so "leave us a review on Google" with a
 * brand named elsewhere does not become a hold. Never consulted by the
 * lookalike check, which holds on the host's own shape.
 */
const COMMON_LINK_DOMAINS: ReadonlySet<string> = new Set([
  'facebook.com',
  'fb.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'google.com',
  'goo.gl',
  'g.page',
  'yelp.com',
  'tripadvisor.com',
  'wa.me',
  'whatsapp.com',
])

/**
 * Two-label public suffixes, so `evil.co.uk` registers as `evil.co.uk` and
 * not as `co.uk`. Deliberately a short list of the ones mail actually
 * arrives from rather than the whole public suffix list: a suffix missing
 * here makes the registrable domain one label too short, which can only
 * widen what counts as "the same domain" for a link — never invent a brand
 * label that is not in the host.
 */
const TWO_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'co.jp', 'co.kr', 'co.in', 'co.za', 'co.il', 'co.id', 'co.th',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.hk', 'com.sg',
  'com.tw', 'com.my', 'com.ph', 'com.co', 'com.pe', 'com.sa', 'com.eg',
])

/** A signal the screen found. */
export type PhishingScreenSignal =
  | { code: 'lookalike-link'; brand: string; host: string }
  | { code: 'brand-sender'; brand: string; fromName: string }
  | { code: 'brand-lure-link'; brand: string; lure: string; host: string }
  /**
   * A published page asks for a password, a card number or a one-time code
   * in a field that is not one of the platform's own sign-in or checkout
   * elements (`hosted-page-screen.ts`). Strong.
   */
  | { code: 'credential-field'; field: 'password' | 'card' | 'otp'; label: string }
  /**
   * A published page names a brand that is not the workspace's beside a
   * sign-in, verify or payment call to action (`hosted-page-screen.ts`).
   * Soft.
   */
  | { code: 'brand-action-page'; brand: string; action: string }

export interface PhishingScreenInput {
  subject?: string | null
  /** The display name in front of the sending address. */
  fromName?: string | null
  /**
   * The ADDRESS the message leaves from (AGL-3362) — a `From:` domain is a
   * link the recipient never has to click, so its host is read by the
   * lookalike rule exactly like a link's: mail from `support@paypa1.com` is
   * the disguise whoever sends it. Not an own domain for the lure's "is this
   * elsewhere" test either way; it only ever adds a lookalike signal.
   */
  fromAddress?: string | null
  replyTo?: string | readonly string[] | null
  preheader?: string | null
  /**
   * Everything else the recipient reads or clicks: the body, the plain-text
   * part, a design's nodes serialized — any string. Links are found by
   * shape, so a JSON-encoded design is as readable here as HTML.
   */
  bodies?: readonly (string | null | undefined)[]
  /**
   * The workspace's own names — org, site, subdomain. A brand in one of them
   * is the workspace's own, and `brand-sender` / `brand-lure-link` do not
   * fire for it. The lookalike check does not consult names: a workspace
   * NAMED "Poshmark" linking to `poshmark.id63835663.shop` is the incident.
   */
  ownNames?: readonly (string | null | undefined)[]
  /**
   * The workspace's own hosts — its subdomain on the tenant apex, custom
   * domain, sending domain. A link to one of them, or below one, is never
   * the "somewhere else" of a lure. Matched by host, never by registrable
   * domain: every site's subdomain shares the tenant apex, and a link to a
   * NEIGHBOR's site is somewhere else.
   *
   * Not an exemption from the lookalike check. A host shaped like
   * `paypal-secure.com` is a lookalike whoever attached it, and a workspace
   * that attached it has attached the disguise.
   */
  ownDomains?: readonly (string | null | undefined)[]
}

export interface PhishingScreenVerdict {
  /** True when the message should be held for staff review. */
  hold: boolean
  signals: PhishingScreenSignal[]
}

/** The registrable domain of a host: `a.b.evil.co.uk` → `evil.co.uk`. */
export function registrableDomain(host: string): string {
  const labels = String(host ?? '')
    .toLowerCase()
    .replace(/\.+$/, '')
    .split('.')
    .filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return TWO_LABEL_SUFFIXES.has(lastTwo)
    ? labels.slice(-3).join('.')
    : lastTwo
}

/** `<label>.<suffix>` of a registrable domain, split once. */
function splitRegistrable(registrable: string): { label: string; suffix: string } {
  const dot = registrable.indexOf('.')
  return dot < 0
    ? { label: registrable, suffix: '' }
    : { label: registrable.slice(0, dot), suffix: registrable.slice(dot + 1) }
}

function isOfficialDomain(brand: PhishingScreenBrand, registrable: string): boolean {
  if (brand.officialDomains.includes(registrable)) return true
  if (!brand.countryDomains) return false
  const base = splitRegistrable(brand.officialDomains[0]).label
  const { label, suffix } = splitRegistrable(registrable)
  return label === base && (/^[a-z]{2}$/.test(suffix) || TWO_LABEL_SUFFIXES.has(suffix))
}

/**
 * Is the workspace the brand itself, by DOMAIN: one of its own domains is
 * one of the brand's official ones (Aglyn's site on aglyn.com linking to
 * its own account on a video or help-desk vendor). Deliberately not by name — a workspace can call itself
 * "Poshmark", but it cannot serve on poshmark.com.
 */
export function isBrandsOwnDomain(
  brand: PhishingScreenBrand,
  ownRegistrables: ReadonlySet<string>,
): boolean {
  return [...ownRegistrables].some((registrable) => isOfficialDomain(brand, registrable))
}

/** Every brand's real domains, for "is this link just the brand itself". */
function isAnyOfficialDomain(registrable: string): boolean {
  return PHISHING_SCREEN_BRANDS.some((brand) => isOfficialDomain(brand, registrable))
}

/** Leetspeak folded, so `paypa1` reads as `paypal`. */
function foldLeet(label: string): string {
  return label
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
}

/** Does one host label name the brand — whole, or hyphen-joined? */
function labelNamesBrand(label: string, token: string, wordToken: boolean): boolean {
  if (wordToken) return label === token
  for (const candidate of new Set([label, foldLeet(label)])) {
    if (candidate === token) return true
    const parts = candidate.split('-')
    // A hyphen-joined token (`booking-com`) spans parts, so it is matched
    // as a run of parts rather than one of them.
    const tokenParts = token.split('-')
    for (let at = 0; at + tokenParts.length <= parts.length; at += 1) {
      if (tokenParts.every((part, offset) => parts[at + offset] === part)) {
        return true
      }
    }
  }
  return false
}

/**
 * Video and audio platforms whose account subdomains and embed URLs a page
 * or email plays media from: `player.vimeo.com`, `www.youtube.com/embed/…`.
 * A video plugin's own hosts are the plugin's to declare, not listed here. Anyone may embed or link media from these, so a
 * host on one is never a lookalike, whatever name its subdomain carries.
 */
export const MEDIA_EMBED_HOSTS: ReadonlySet<string> = new Set([
  'vimeo.com', 'vimeocdn.com', 'youtube.com', 'youtu.be',
  'youtube-nocookie.com', 'ytimg.com', 'loom.com', 'vidyard.com', 'brightcove.net',
  'brightcove.com', 'jwplayer.com', 'jwpcdn.com', 'mux.com', 'cloudflarestream.com',
  'videodelivery.net', 'dailymotion.com', 'twitch.tv', 'spotify.com', 'soundcloud.com',
  'podbean.com', 'buzzsprout.com', 'simplecast.com', 'transistor.fm', 'anchor.fm',
])

/** The brand a host impersonates, or null. */
export function lookalikeBrandForHost(host: string): PhishingScreenBrand | null {
  const normalized = String(host ?? '').toLowerCase().replace(/\.+$/, '')
  if (!normalized.includes('.')) return null
  const registrable = registrableDomain(normalized)
  if (MEDIA_EMBED_HOSTS.has(registrable)) return null
  for (const brand of PHISHING_SCREEN_BRANDS) {
    if (isOfficialDomain(brand, registrable)) continue
    if (brand.hostedDomains?.includes(registrable)) continue
    const labels = normalized.split('.')
    if (
      labels.some((label) =>
        brand.hostTokens.some((token) => labelNamesBrand(label, token, brand.wordToken === true)),
      )
    ) {
      return brand
    }
    // The brand's primary domain embedded in a longer, different one:
    // `booking.com.guest-review.top`, `paypal.com-secure.net`. Only the
    // primary: a short secondary (`me.com`, `aka.ms`) would match too much.
    const primary = brand.officialDomains[0]
    if (
      normalized.startsWith(`${primary}.`) ||
      normalized.startsWith(`${primary}-`) ||
      normalized.includes(`.${primary}.`) ||
      normalized.includes(`.${primary}-`)
    ) {
      return brand
    }
  }
  return null
}

/**
 * The few entity forms a phishing kit uses to keep a URL away from a naive
 * scanner (`&#46;` for a dot, `&amp;` inside a query). Decoded before links
 * are read; everything else is left alone.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
}

function safeCodePoint(value: number): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : ''
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s"'<>()\\[\]{}]+/gi

/** The hosts every link in the text points at, lowercased. */
export function linkHostsIn(text: string): string[] {
  const hosts = new Set<string>()
  for (const match of decodeEntities(String(text ?? '')).match(URL_PATTERN) ?? []) {
    let rest = match.replace(/^https?:\/\//i, '')
    rest = rest.split(/[/?#]/)[0]
    // `https://paypal.com@evil.top/` resolves to evil.top — and the part
    // before the `@` is exactly the disguise, so it is kept as a host too.
    const at = rest.lastIndexOf('@')
    const disguise = at >= 0 ? rest.slice(0, at) : ''
    rest = at >= 0 ? rest.slice(at + 1) : rest
    for (const candidate of [rest, disguise]) {
      const host = candidate.replace(/:\d+$/, '').replace(/\.+$/, '').toLowerCase()
      // A merge tag inside a URL is not a host anybody can visit yet.
      if (host && host.includes('.') && !host.includes('{') && !host.includes('%7b')) {
        hosts.add(host)
      }
    }
  }
  return [...hosts]
}

const ADDRESS_HOST_PATTERN = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi

/** The host of every email address in the text — a reply-to, a `mailto:`. */
function addressHostsIn(text: string): string[] {
  const hosts = new Set<string>()
  for (const match of decodeEntities(String(text ?? '')).matchAll(ADDRESS_HOST_PATTERN)) {
    hosts.add(match[1].toLowerCase().replace(/\.+$/, ''))
  }
  return [...hosts]
}

/** Lowercased alphanumerics only, so "Wells-Fargo Advisors" contains `wellsfargo`. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Is this brand the workspace's own, by name or by a domain it holds? */
function isOwnBrand(
  brand: PhishingScreenBrand,
  ownNames: string,
  ownRegistrables: ReadonlySet<string>,
): boolean {
  const labels = [brand.id, squash(brand.label), ...brand.hostTokens.map(squash)]
  if (labels.some((label) => label && ownNames.includes(label))) return true
  return [...ownRegistrables].some((registrable) => isOfficialDomain(brand, registrable))
}

/*
 * The same judgements, for the other surfaces that read content with this
 * screen's data (`hosted-page-screen.ts`). Exported under these names rather
 * than copied, so a page and an email can never disagree about what a
 * brand's own domain is or whose brand a name is.
 */

/** `squash`: lowercased alphanumerics, the form own-name matching reads. */
export const squashScreenText = squash
/** Is this brand the workspace's own, by name (squashed) or by a domain it holds? */
export const isWorkspaceOwnBrand = isOwnBrand
/** Is this registrable domain one of any listed brand's own? */
export const isAnyOfficialBrandDomain = isAnyOfficialDomain
/** Is this registrable domain a social, maps or review link merchants ordinarily carry? */
export function isCommonLinkDomain(registrable: string): boolean {
  return COMMON_LINK_DOMAINS.has(registrable)
}

/**
 * Screen one outbound message. See the module header for what holds and why.
 */
export function screenOutboundEmail(input: PhishingScreenInput): PhishingScreenVerdict {
  const signals: PhishingScreenSignal[] = []
  const ownNames = squash((input.ownNames ?? []).filter(Boolean).join(' '))
  const ownHosts = (input.ownDomains ?? [])
    .map((domain) => String(domain ?? '').trim().toLowerCase().replace(/\.+$/, ''))
    .filter((domain) => domain.includes('.'))
  const ownRegistrables = new Set(ownHosts.map(registrableDomain))
  const isOwnHost = (host: string) =>
    ownHosts.some((own) => host === own || host.endsWith(`.${own}`))

  const copy = [input.subject, input.preheader, ...(input.bodies ?? [])]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
  const decodedCopy = decodeEntities(copy)
  const replyTo = Array.isArray(input.replyTo)
    ? input.replyTo.join(' ')
    : String(input.replyTo ?? '')
  const linkHosts = linkHostsIn(copy)

  // 1. A lookalike host, anywhere a recipient could click, write back, or
  //    read as the sender.
  const seenLookalike = new Set<string>()
  const fromAddress = String(input.fromAddress ?? '')
  for (const host of [...linkHosts, ...addressHostsIn(`${copy}\n${replyTo}\n${fromAddress}`)]) {
    if (seenLookalike.has(host)) continue
    const brand = lookalikeBrandForHost(host)
    if (brand && !isBrandsOwnDomain(brand, ownRegistrables)) {
      seenLookalike.add(host)
      signals.push({ code: 'lookalike-link', brand: brand.id, host })
    }
  }

  // 2. A brand in the sender's display name that is not the workspace's.
  const fromName = String(input.fromName ?? '').trim()
  if (fromName) {
    for (const brand of PHISHING_SCREEN_BRANDS) {
      if (brand.mention.test(fromName) && !isOwnBrand(brand, ownNames, ownRegistrables)) {
        signals.push({ code: 'brand-sender', brand: brand.id, fromName: fromName.slice(0, 120) })
      }
    }
  }

  // 3. Brand + lure + a link to somewhere that is nobody's we know.
  const lure = PHISHING_LURE_PATTERNS.map((pattern) => decodedCopy.match(pattern)?.[0])
    .find(Boolean)
  if (lure) {
    const foreign = linkHosts.find((host) => {
      if (isOwnHost(host)) return false
      const registrable = registrableDomain(host)
      return !isAnyOfficialDomain(registrable) && !COMMON_LINK_DOMAINS.has(registrable)
    })
    if (foreign) {
      const namedInCopy = `${decodedCopy}\n${fromName}`
      for (const brand of PHISHING_SCREEN_BRANDS) {
        if (brand.mention.test(namedInCopy) && !isOwnBrand(brand, ownNames, ownRegistrables)) {
          signals.push({
            code: 'brand-lure-link',
            brand: brand.id,
            lure: lure.slice(0, 120),
            host: foreign,
          })
          break
        }
      }
    }
  }

  return { hold: signals.length > 0, signals }
}

/** The brand's label for a stored id, for the staff surface. */
export function phishingScreenBrandLabel(id: string): string {
  return PHISHING_SCREEN_BRANDS.find((brand) => brand.id === id)?.label ?? id
}

/** One line per signal, in words staff read on the review row. */
export function describePhishingScreenSignals(
  signals: readonly PhishingScreenSignal[],
): string[] {
  return signals.map((signal) => {
    const brand = 'brand' in signal ? phishingScreenBrandLabel(signal.brand) : ''
    switch (signal.code) {
      case 'lookalike-link':
        return `Links to ${signal.host}, which wears the ${brand} name but is not ${brand}'s domain.`
      case 'brand-sender':
        return `Sends as "${signal.fromName}", naming ${brand}, which is not this workspace.`
      case 'brand-lure-link':
        return `Names ${brand}, asks the reader to act ("${signal.lure}"), and links to ${signal.host}.`
      case 'credential-field':
        return `Asks for a ${
          signal.field === 'card' ? 'card number' : signal.field === 'otp' ? 'one-time code' : 'password'
        } in its own field ("${signal.label}"), outside the platform's sign-in and checkout elements.`
      case 'brand-action-page':
        return `Names ${brand} beside a call to action ("${signal.action}"), and this workspace is not ${brand}.`
      default:
        return 'Phishing signal.'
    }
  })
}

/*==========================================
 * RISK TIERS: who a signal holds for (AGL-3356, widened to every surface).
 *
 * The screen above finds signals; this decides which of them hold, the same
 * way on every surface that asks — an email at the send seam, a campaign
 * before it is claimed, a page at publish, a subdomain at creation.
 *
 * - STRONG: a lookalike host. A link to `poshmark.id63835663.shop` or
 *   `paypa1.com` is a disguise whoever wears it and however old the
 *   workspace is, so it holds for EVERY workspace, on every message and
 *   page, transactional mail included. A merchant has no ordinary reason to
 *   link to a host shaped like somebody else's brand.
 * - SOFT: a brand in the sender name, the three-part lure, a brand's name
 *   beside a sign-in or payment call to action on a page. Each is shaped
 *   like phishing but also like a clumsy legitimate message, so they hold
 *   only for a workspace in its first {@link OUTBOUND_REVIEW_YOUNG_DAYS}
 *   days — the incident's window — and NEVER for mail the recipient's own
 *   act made owed ({@link OutboundScreenPolicy.owed}).
 *
 * A credential-harvest page (a password, card or one-time-code field that
 * is not one of the platform's own sign-in or checkout elements) is STRONG:
 * see `hosted-page-screen.ts`.
 *=========================================*/

/** A workspace younger than this many days has the soft rules applied. */
export const OUTBOUND_REVIEW_YOUNG_DAYS = 14

/** Which tier a signal belongs to. */
export type PhishingSignalTier = 'strong' | 'soft'

/** The signal codes that hold for every workspace. */
export const STRONG_PHISHING_SIGNAL_CODES: ReadonlySet<string> = new Set([
  'lookalike-link',
  'credential-field',
])

/**
 * Hosts that give each customer an account subdomain named after the
 * customer: `acme.zendesk.com` is Acme's own help desk. A brand's name there is usually the brand itself, so a
 * lookalike on one of these is SOFT — held for a young workspace, never a
 * takedown of an established one's page or mail. A lookalike on any other
 * host (`poshmark.id63835663.shop`) stays STRONG.
 */
export const ACCOUNT_SUBDOMAIN_HOSTS: ReadonlySet<string> = new Set([
  'vimeo.com', 'vimeocdn.com', 'zendesk.com', 'freshdesk.com',
  'helpscoutdocs.com', 'intercom.help', 'statuspage.io', 'atlassian.net', 'myshopify.com',
  'squarespace.com', 'wixsite.com', 'webflow.io', 'hubspotpagebuilder.com', 'substack.com',
  'typeform.com', 'calendly.com', 'gitbook.io', 'readme.io', 'notion.site', 'github.io',
  'cloudfront.net', 'kajabi.com', 'thinkific.com', 'teachable.com', 'mailchimpsites.com',
])

export function phishingSignalTier(signal: { code: string; host?: string }): PhishingSignalTier {
  if (!STRONG_PHISHING_SIGNAL_CODES.has(signal?.code)) return 'soft'
  if (
    signal.code === 'lookalike-link' &&
    typeof signal.host === 'string' &&
    ACCOUNT_SUBDOMAIN_HOSTS.has(registrableDomain(signal.host))
  ) {
    return 'soft'
  }
  return 'strong'
}

/** Is a workspace of this age (days, `null` = unreadable) screened by the soft rules? */
export function isYoungWorkspaceAge(ageDays: number | null | undefined): boolean {
  return typeof ageDays === 'number' && Number.isFinite(ageDays) && ageDays < OUTBOUND_REVIEW_YOUNG_DAYS
}

export interface OutboundScreenPolicy {
  /**
   * The workspace's age in days, or `null` when its creation date cannot be
   * read — an org that predates the field, which is an EXISTING customer and
   * is not young.
   */
  ageDays: number | null
  /**
   * The recipient's own act made this message owed: a receipt for their
   * order, a confirmation of their booking, a reset of their password. The
   * soft rules never hold it. The lookalike rule still does — a receipt that
   * links to a Poshmark lookalike is the disguise, not the receipt.
   */
  owed?: boolean
}

/** The signals that HOLD under the tiers, for this workspace and message. */
export function signalsThatHold<T extends { code: string; host?: string }>(
  signals: readonly T[],
  policy: OutboundScreenPolicy,
): T[] {
  const soft = isYoungWorkspaceAge(policy.ageDays) && !policy.owed
  return signals.filter((signal) => phishingSignalTier(signal) === 'strong' || soft)
}

/**
 * The same brand, lookalike and tier logic applied to a HOST NAME a workspace
 * asks for — a subdomain on the tenant apex, or a custom domain it attaches.
 *
 * Words a brand's impersonator hyphen-joins to its name. A subdomain that
 * joins a brand's word to one of these (`booking-review`, `apple-support`,
 * `amazon-account`) is the incident's shape even where the brand's word is
 * an ordinary one — which the lookalike rule alone deliberately lets pass,
 * so a salon can be `tanyas-booking` and a bakery `apple-pie-co`.
 */
export const BRAND_IMPERSONATION_WORDS: ReadonlySet<string> = new Set([
  'account', 'accounts', 'auth', 'billing', 'help', 'helpdesk', 'id', 'login',
  'logon', 'order', 'orders', 'pay', 'payment', 'payments', 'refund', 'resolution',
  'review', 'reviews', 'secure', 'security', 'seller', 'service', 'signin',
  'support', 'update', 'verify', 'verification', 'wallet',
])

/**
 * The brand a requested subdomain label wears, or null.
 *
 * Refused for EVERY workspace, at creation and at rename — the tier is
 * strong, because nothing is lost by asking a real bakery to pick
 * `apple-pie-co` instead of `apple-support`, and a brand's name on our apex
 * is a disguise that outlives every later screen. Two shapes:
 *
 * 1. the label is a lookalike host label ({@link lookalikeBrandForHost} on
 *    `<label>.<apex>`): `poshmark`, `paypal-secure`, `paypa1`, `appleid`;
 * 2. a brand's word hyphen-joined to an impersonation word
 *    ({@link BRAND_IMPERSONATION_WORDS}): `booking-review`, `apple-support`.
 */
export function brandForSubdomainLabel(
  label: string,
  apex = 'example.invalid',
): PhishingScreenBrand | null {
  const normalized = String(label ?? '').trim().toLowerCase()
  if (!normalized) return null
  const byHost = lookalikeBrandForHost(`${normalized}.${apex}`)
  if (byHost) return byHost
  const parts = foldLeet(normalized).split('-').filter(Boolean)
  if (parts.length < 2 || !parts.some((part) => BRAND_IMPERSONATION_WORDS.has(part))) {
    return null
  }
  for (const brand of PHISHING_SCREEN_BRANDS) {
    const words = [brand.id, ...brand.hostTokens].filter((word) => !word.includes('-'))
    if (parts.some((part) => words.includes(part))) return brand
  }
  return null
}

/**
 * The platform's own entry in {@link PHISHING_SCREEN_BRANDS} (AGL-3365). A
 * workspace owns every other brand by carrying its name or domain; the
 * platform's is owned only by the platform's staff, because a workspace NAMED
 * for the platform is the cheapest disguise there is.
 */
export const PLATFORM_PHISHING_BRAND_ID = 'aglyn'

/** The platform's brand entry. */
export function platformPhishingBrand(): PhishingScreenBrand {
  return PHISHING_SCREEN_BRANDS.find((brand) => brand.id === PLATFORM_PHISHING_BRAND_ID) as PhishingScreenBrand
}

/**
 * Words that make a name claim to SPEAK FOR a brand rather than mention it:
 * "PayPal Support", "Aglyn Official", "Apple ID Security Team".
 */
const OFFICIAL_CLAIM_PATTERN =
  /\b(?:official|staff|team|verified|certified|support|helpdesk|admin|administrator|security|billing|trust|safety|compliance|core|headquarters|hq)\b/i

/**
 * The brand a display NAME claims to speak for (AGL-3365), or null.
 *
 * For names a stranger reads as an identity — a marketplace publisher, a
 * listing's title — rather than copy. A name that merely mentions a brand
 * ("Sync for PayPal", "Bookings for Airbnb hosts") passes: that is how an
 * integration is named. A name that pairs the brand with a claim of
 * officialness ("PayPal Support", "Aglyn Official Plugins") is the disguise.
 */
export function brandClaimedByName(name: string): PhishingScreenBrand | null {
  const text = String(name ?? '')
  if (!text.trim() || !OFFICIAL_CLAIM_PATTERN.test(text)) return null
  return PHISHING_SCREEN_BRANDS.find((brand) => brand.mention.test(text)) ?? null
}
