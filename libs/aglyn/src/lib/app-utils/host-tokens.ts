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

import { structuredAddressLine } from './business-profile'
import { siteProfileUrls, type HostSeoEntity } from './content-authors'
import { hostPublicOrigin } from './host-naming'
import { normalizeAreaServed } from './local-business'

/**
 * Host variables — publisher templates that fill themselves in (AGL-1022).
 *
 * A publisher writing an email template cannot reference the installing site,
 * so every install begins with the same chore: swap the placeholder logo, fix
 * the business name, correct the links. Miss one and the site sends an email
 * carrying someone else's branding.
 *
 * `host.*` gives artifacts a way to NAME the host instead of hard-coding it.
 * The author writes `{{host.businessName}}`; the installing site fills it in,
 * and it stays filled in when that site rebrands.
 *
 * ## The namespace IS the security boundary
 *
 * This is publisher-authored content resolving against tenant data, so the
 * registry is CLOSED and each token reads through a hand-written function
 * rather than a path into the document. That is the whole design: a token
 * cannot address `stripeAccountId`, or `memberRoles`, or anything else, because
 * there is no path syntax to express it — `host.` is followed by a key that
 * either appears in {@link HOST_TOKENS} or resolves to nothing at all. Adding a
 * token is a deliberate edit here, reviewable as a diff.
 *
 * A path-based registry ("allow `host.seo.title`") would have been shorter and
 * is the version to refuse: allowlisting prefixes is how a namespace grows a
 * hole, and the first `host.orgId` would be a data leak with a plausible commit
 * message.
 *
 * ## Resolve LATE
 *
 * At render and at send, never at install. Freezing values into the artifact
 * would make a rebrand stop propagating silently — the site would keep sending
 * last year's business name from a template nobody remembers is a template.
 *
 * ## Every token defines what "empty" does
 *
 * A site with no logo must produce something deliberate. Never an empty image,
 * and never the literal `{{host.logo}}` reaching a visitor — a leaked token is
 * the most embarrassing possible failure for a feature whose entire purpose is
 * to stop templates looking unfinished.
 */

/**
 * What a token yields, so a renderer knows how to place it and the authoring
 * surface can refuse it in the wrong slot.
 *
 * `text` is the only type safe to drop into arbitrary copy. The others carry a
 * shape a slot has to understand — an `image` in a paragraph is a URL sitting
 * in the middle of a sentence, which is exactly the "fails in a sent email"
 * outcome this typing exists to move to authoring time.
 */
export type HostTokenType = 'text' | 'url' | 'email' | 'image' | 'address'

/** What a renderer should do when a token resolves to nothing. */
export type HostTokenEmptyBehaviour =
  /** Render nothing in its place; the surrounding copy still makes sense. */
  | 'blank'
  /**
   * The block holding it should be dropped entirely. An `<img src="">` is a
   * broken-image icon in every mail client, which is worse than no logo.
   */
  | 'omit-block'

/** The site fields a token may read. A closed, explicit surface. */
export interface HostTokenSource {
  displayName?: string
  logoUrl?: string
  logoDarkUrl?: string
  subdomain?: string
  cname?: string
  /**
   * The one-block copies of the email and address, and the social links
   * (AGL-1022). Setup → Business profile writes the email and address to `seo.entity`
   * and mirrors them here (AGL-4136), so these are what a token reads when
   * the entity has none: a site saved before that, or by the native apps.
   */
  business?: {
    supportEmail?: string
    address?: string
    socialLinks?: Array<{ label?: string; url?: string }>
  }
  /**
   * The business's facts as Setup → Business profile and SEO → Local business store
   * them (AGL-4136): the name, slogan, phone, email, structured address, the
   * profiles it claims and the areas it serves.
   */
  seo?: {
    entity?: Pick<
      HostSeoEntity,
      | 'name'
      | 'logo'
      | 'slogan'
      | 'email'
      | 'telephone'
      | 'address'
      | 'sameAs'
      | 'areaServed'
    >
  }
}

export interface HostTokenDefinition {
  /** The key after `host.` */
  key: string
  type: HostTokenType
  label: string
  description: string
  /** Reads the value. Hand-written per token — never a path into the document. */
  resolve: (host: HostTokenSource) => string | undefined
  /**
   * A deliberate second choice when `resolve` finds nothing.
   *
   * Not a nicety: "fall back to the business name" is what turns a missing logo
   * from a hole in the page into a wordmark, which is what a careful designer
   * would have done by hand.
   */
  fallback?: (host: HostTokenSource) => string | undefined
  whenEmpty: HostTokenEmptyBehaviour
}

const trimmed = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

/**
 * The site's public URL.
 *
 * A custom domain wins when connected, because that is the address the site is
 * actually known by — a template linking to the aglyn.app subdomain of a site
 * with its own domain is technically correct and reads as a mistake.
 */
function siteUrl(host: HostTokenSource): string | undefined {
  const custom = trimmed(host.cname)
  if (custom) return `https://${custom.replace(/^https?:\/\//, '')}`
  // `hostPublicOrigin`, not a fourth hand-rolled apex (AGL-2195). The cname
  // branch stays here because this one strips a scheme the token source may
  // carry; the subdomain branch has no such difference and had none — it was
  // the same two lines with `aglyn.app` written in, so an operator's own apex
  // was honoured everywhere except in the tokens a template renders.
  return hostPublicOrigin({ subdomain: trimmed(host.subdomain) })
}

function businessName(host: HostTokenSource): string | undefined {
  return trimmed(host.seo?.entity?.name) ?? trimmed(host.displayName)
}

function logo(host: HostTokenSource): string | undefined {
  return trimmed(host.logoUrl) ?? trimmed(host.seo?.entity?.logo)
}

/**
 * A phone number as a `tel:` link (AGL-4136): everything but its digits and
 * a leading `+` removed, so `+1 (512) 555-0100` dials `tel:+15125550100`.
 * Nothing when the number holds no digit, so a Call button never links to a
 * bare `tel:`.
 */
export function telephoneHref(phone: unknown): string | undefined {
  const text = trimmed(phone)
  if (!text) return undefined
  const digits = text.replace(/\D+/g, '')
  if (!digits) return undefined
  return `tel:${text.startsWith('+') ? '+' : ''}${digits}`
}

/**
 * The social networks a page can link by name (AGL-4136), each with the
 * hostnames its profile addresses are served from. A hostname matches itself
 * and any subdomain of itself, so `www.` and `m.` addresses are the same
 * profile. X keeps `twitter.com`, because a link saved before the rename is
 * still the same account.
 */
const SOCIAL_NETWORK_HOSTS = {
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  x: ['x.com', 'twitter.com'],
  linkedin: ['linkedin.com'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
} as const

export type HostSocialNetwork = keyof typeof SOCIAL_NETWORK_HOSTS

/**
 * The site's profile on one network: the first of the profiles it claims
 * (`siteProfileUrls`, the entity's `sameAs` and then Setup → Business profile's
 * social links, https only) served from that network's hostname. Matched by
 * HOSTNAME rather than by the link's label, because the label is free text
 * and the address is what a visitor is sent to.
 */
export function siteSocialProfileUrl(
  host: HostTokenSource | null | undefined,
  network: HostSocialNetwork,
): string | undefined {
  const hosts: readonly string[] = SOCIAL_NETWORK_HOSTS[network]
  for (const value of siteProfileUrls(host)) {
    let hostname: string
    try {
      hostname = new URL(value).hostname.toLowerCase()
    } catch {
      continue
    }
    if (hosts.some((name) => hostname === name || hostname.endsWith(`.${name}`))) {
      return value
    }
  }
  return undefined
}

/** The areas served, as SEO → Local business stores and the structured data publishes them. */
function areasServed(host: HostTokenSource): string[] {
  return normalizeAreaServed(host.seo?.entity?.areaServed)
}

/** One social network's profile link as a token: a URL, dropped where the site has none. */
function socialToken(
  network: HostSocialNetwork,
  key: string,
  name: string,
): HostTokenDefinition {
  return {
    key,
    type: 'url',
    label: `${name} link`,
    description: `The address of the site’s ${name} profile, from Setup → Business profile.`,
    resolve: (host) => siteSocialProfileUrl(host, network),
    whenEmpty: 'omit-block',
  }
}

/**
 * The closed registry.
 *
 * Ordered as an author would look for them. Every entry is reachable from a
 * field a site can actually set — a token that can never resolve is worse than
 * an absent one, because it teaches people the feature does not work.
 */
export const HOST_TOKENS: Record<string, HostTokenDefinition> = {
  businessName: {
    key: 'businessName',
    type: 'text',
    label: 'Business name',
    description:
      'The business name from Setup → Business profile, or the site’s name when none is set.',
    resolve: businessName,
    whenEmpty: 'blank',
  },
  slogan: {
    key: 'slogan',
    type: 'text',
    label: 'Slogan',
    description: 'A short line about the business, from Setup → Business profile.',
    resolve: (host) => trimmed(host.seo?.entity?.slogan),
    whenEmpty: 'blank',
  },
  logo: {
    key: 'logo',
    type: 'image',
    label: 'Logo',
    description: 'The site’s logo image.',
    resolve: logo,
    // No image: the block is dropped and the business name carries the brand
    // instead, which is what the block was for.
    whenEmpty: 'omit-block',
  },
  logoDark: {
    key: 'logoDark',
    type: 'image',
    label: 'Logo for dark backgrounds',
    description:
      'The logo to show on a dark background. The site’s logo when it has no dark one.',
    // The pair a header toggles by color scheme (AGL-4119): a site with one
    // logo shows it in both schemes, and one with none shows neither.
    resolve: (host) => trimmed(host.logoDarkUrl) ?? logo(host),
    whenEmpty: 'omit-block',
  },
  url: {
    key: 'url',
    type: 'url',
    label: 'Site address',
    description: 'The site’s public URL — its custom domain when connected.',
    resolve: siteUrl,
    whenEmpty: 'blank',
  },
  phone: {
    key: 'phone',
    type: 'text',
    label: 'Phone',
    description: 'The business’s phone number, as entered on Setup → Business profile.',
    resolve: (host) => trimmed(host.seo?.entity?.telephone),
    whenEmpty: 'omit-block',
  },
  phoneLink: {
    key: 'phoneLink',
    type: 'url',
    label: 'Phone link',
    description:
      'The phone number as a tel: link, for a Call button’s link. Dropped when the site has no phone.',
    resolve: (host) => telephoneHref(host.seo?.entity?.telephone),
    whenEmpty: 'omit-block',
  },
  /*
    The key keeps its old name, because pages and emails already say
    `{{host.supportEmail}}`. What it reads is the site's one email (AGL-4136):
    the one Setup → Business profile saves to the entity, else the one-block copy a
    site saved before that.
  */
  supportEmail: {
    key: 'supportEmail',
    type: 'email',
    label: 'Email',
    description: 'The email address visitors write to, from Setup → Business profile.',
    resolve: (host) => siteContactEmail(host) ?? undefined,
    whenEmpty: 'omit-block',
  },
  address: {
    key: 'address',
    type: 'address',
    label: 'Postal address',
    description:
      'The business’s postal address from Setup → Business profile, as one block of text.',
    // The structured address, formatted the one way it is formatted
    // everywhere (AGL-4136), else the one-block copy as it was typed —
    // line breaks kept, because a document prints it a line per line.
    resolve: (host) =>
      trimmed(structuredAddressLine(host.seo?.entity?.address)) ??
      trimmed(host.business?.address),
    whenEmpty: 'omit-block',
  },
  mainArea: {
    key: 'mainArea',
    type: 'text',
    label: 'Main area',
    description:
      'The first area served, by its place name: San Antonio, for “San Antonio, TX”. From SEO → Local business.',
    // The text before the first comma, so the token reads in a sentence —
    // "across San Antonio and surrounding areas" — and a page that already
    // says the place name can switch to it without a visible change.
    resolve: (host) => trimmed(areasServed(host)[0]?.split(',')[0]),
    whenEmpty: 'blank',
  },
  areasServed: {
    key: 'areasServed',
    type: 'text',
    label: 'Areas served',
    description:
      'Every area served, in order, separated by commas. From SEO → Local business.',
    resolve: (host) => trimmed(areasServed(host).join(', ')),
    whenEmpty: 'blank',
  },
  socialLinks: {
    key: 'socialLinks',
    type: 'text',
    label: 'Social links',
    description: 'The site’s social profiles, as a list of labeled links.',
    // Rendered as text here so a token in copy degrades to something readable;
    // a link to one profile is that network's own token below (AGL-4136).
    resolve: (host) => {
      const links = host.business?.socialLinks ?? []
      const labels = links
        .map((link) => trimmed(link?.label) ?? trimmed(link?.url))
        .filter((label): label is string => Boolean(label))
      return labels.length ? labels.join(' · ') : undefined
    },
    whenEmpty: 'omit-block',
  },
  /*
    One link per common network (AGL-4136), so a page's social icons link
    the site's own profiles from Setup → Business profile instead of a hand-made
    variable per network.
  */
  facebookUrl: socialToken('facebook', 'facebookUrl', 'Facebook'),
  instagramUrl: socialToken('instagram', 'instagramUrl', 'Instagram'),
  xUrl: socialToken('x', 'xUrl', 'X'),
  linkedinUrl: socialToken('linkedin', 'linkedinUrl', 'LinkedIn'),
  youtubeUrl: socialToken('youtube', 'youtubeUrl', 'YouTube'),
  tiktokUrl: socialToken('tiktok', 'tiktokUrl', 'TikTok'),
}

/**
 * The registry's entry for `key`, or undefined when it declares none.
 *
 * An OWN entry only. `HOST_TOKENS` is an object literal, so a bare index also
 * finds the `Object.prototype` members — `constructor`, `toString`, `valueOf` —
 * and every one of those names matches {@link HOST_TOKEN_PATTERN}. Read that
 * way, `{{host.constructor}}` answers the `Object` function where a definition
 * belongs, and calling its `resolve` throws in the middle of a render. A name
 * the registry does not declare resolves to nothing, whatever the name is.
 */
export function hostTokenDefinition(
  key: string,
): HostTokenDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(HOST_TOKENS, key)
    ? HOST_TOKENS[key]
    : undefined
}

/**
 * `{{host.key}}` — whitespace-tolerant, and deliberately NOT dotted beyond one
 * segment. `host.a.b` does not match, so there is no path syntax to abuse.
 */
export const HOST_TOKEN_PATTERN = /\{\{\s*host\.([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

/**
 * Whether a value is exactly one image token, like `{{host.logo}}`: what a
 * picture's `src` may be when it is the installing site's own logo. It becomes
 * that site's stored value at render, so it names nothing of the publisher's.
 */
export function isHostImageToken(value: string): boolean {
  const keys = hostTokensIn(value)
  return (
    keys.length === 1 &&
    value.replace(HOST_TOKEN_PATTERN, '').trim() === '' &&
    hostTokenDefinition(keys[0])?.type === 'image'
  )
}

/** Every `host.*` token in a string, in order, including unknown ones. */
export function hostTokensIn(text: string): string[] {
  if (typeof text !== 'string' || !text.includes('{{')) return []
  const keys: string[] = []
  for (const match of text.matchAll(HOST_TOKEN_PATTERN)) keys.push(match[1])
  return keys
}

/** The resolved value of one token, or undefined when the site has none. */
export function resolveHostToken(
  key: string,
  host: HostTokenSource | null | undefined,
): string | undefined {
  const definition = hostTokenDefinition(key)
  if (!definition || !host) return undefined
  return definition.resolve(host) ?? definition.fallback?.(host)
}

/**
 * Replaces every `host.*` token with the installing site's value.
 *
 * An unresolved token — unknown key, or a site that has not set the field —
 * renders EMPTY, never the literal. Leaking `{{host.logo}}` into a sent email
 * is the failure this feature exists to prevent, so it cannot be the fallback
 * for the feature's own gaps. The authoring-time check
 * ({@link validateHostTokens}) is where a typo is meant to be caught, while the
 * writer can still fix it.
 */
export function resolveHostTokens(
  text: string,
  host: HostTokenSource | null | undefined,
): string {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  return text.replace(HOST_TOKEN_PATTERN, (_token, key) =>
    resolveHostToken(String(key), host) ?? '',
  )
}

export interface HostTokenIssue {
  key: string
  /**
   * `unknown` — no such token; it will render empty.
   * `wrong-slot` — the token's type cannot be placed here.
   */
  kind: 'unknown' | 'wrong-slot'
  message: string
}

/**
 * Authoring-time check: catch a token before it reaches a visitor.
 *
 * The two things worth failing on are a typo (which would silently render
 * nothing) and a type mismatch (an image URL dropped into a sentence). Both are
 * invisible at authoring time without this and obvious afterwards, which is the
 * wrong way round for something that ends up in a sent email.
 *
 * `allow` names the types this slot can take. Omit it for free text, where only
 * `text` and the string-ish types make sense.
 */
export function validateHostTokens(
  text: string,
  options?: { allow?: readonly HostTokenType[] },
): HostTokenIssue[] {
  const allow = options?.allow ?? ['text', 'url', 'email', 'address']
  const issues: HostTokenIssue[] = []
  const seen = new Set<string>()
  for (const key of hostTokensIn(text)) {
    if (seen.has(key)) continue
    seen.add(key)
    const definition = hostTokenDefinition(key)
    if (!definition) {
      issues.push({
        key,
        kind: 'unknown',
        message:
          `There is no host variable called "${key}". It will render as ` +
          'nothing. Available: ' +
          Object.keys(HOST_TOKENS).join(', ') +
          '.',
      })
      continue
    }
    if (!allow.includes(definition.type)) {
      issues.push({
        key,
        kind: 'wrong-slot',
        message:
          `"${definition.label}" is ${
            definition.type === 'image' ? 'an image' : `a ${definition.type}`
          }, so it cannot go here. Put it in a slot that takes ` +
          `${definition.type === 'image' ? 'an image' : `a ${definition.type}`}.`,
      })
    }
  }
  return issues
}

/**
 * Whether a block containing these tokens should be dropped for this site.
 *
 * The other half of "every token needs a defined empty behaviour": a logo block
 * on a site with no logo should not render an empty image, and the renderer
 * cannot know that from the resolved string alone — `''` is both "no value" and
 * "a value that happens to be empty". Asking here keeps the rule with the
 * token definition rather than spread across the surfaces that render it.
 */
export function shouldOmitBlock(
  text: string,
  host: HostTokenSource | null | undefined,
): boolean {
  for (const key of hostTokensIn(text)) {
    const definition = hostTokenDefinition(key)
    if (!definition || definition.whenEmpty !== 'omit-block') continue
    if (!resolveHostToken(key, host)) return true
  }
  return false
}

/**
 * Every token with its resolved value for one site, for an authoring picker
 * that shows what each will actually produce here.
 *
 * A picker listing token names alone makes the author guess; showing the value
 * this site would render is what turns "is it businessName or business_name"
 * into a question nobody has to ask.
 */
export function describeHostTokens(
  host: HostTokenSource | null | undefined,
): Array<HostTokenDefinition & { token: string; value?: string; set: boolean }> {
  return Object.values(HOST_TOKENS).map((definition) => {
    const value = resolveHostToken(definition.key, host)
    return {
      ...definition,
      token: `{{host.${definition.key}}}`,
      value,
      set: Boolean(value),
    }
  })
}

/**
 * The `host.*` values as a merge-token map, for surfaces that already have a
 * token substituter of their own.
 *
 * This is how EMAIL gets host variables without the email library depending on
 * this one: `substituteMergeTokens` already matches `{{a.b}}`, so a caller
 * spreads this into the merge map it was passing anyway. One registry, two
 * surfaces, no second substitution engine to drift.
 *
 * Every registered token appears, INCLUDING the ones this site has not set —
 * as `''`. Omitting them would leave `{{host.supportEmail}}` for the generic
 * catch-all to blank, which works today and works by accident: the moment a
 * surface without that catch-all uses this map, the literal token ships.
 */
export function hostTokenMerge(
  host: HostTokenSource | null | undefined,
): Record<string, string> {
  const merge: Record<string, string> = {}
  for (const key of Object.keys(HOST_TOKENS)) {
    merge[`host.${key}`] = resolveHostToken(key, host) ?? ''
  }
  return merge
}

/**
 * The email address a visitor writes to the business at: the one Setup →
 * Business saves (`seo.entity.email`), else the one-block copy a site saved
 * before that (`business.supportEmail`). Null when the site has neither. One
 * answer for every place that names it: the `{{host.supportEmail}}` token
 * and so the email footer, the waiver consent, the quote and invoice PDFs,
 * the Reply-To of the quote email (AGL-4097), and the address a refused form
 * or sign-up offers instead (AGL-4136). Trimmed, not validated; a caller
 * putting it in a header checks it is an address.
 */
export function siteContactEmail(
  host:
    | {
        seo?: { entity?: { email?: unknown } | null } | null
        business?: { supportEmail?: unknown } | null
      }
    | null
    | undefined,
): string | null {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 320) : '')
  return text(host?.seo?.entity?.email) || text(host?.business?.supportEmail) || null
}

/**
 * Resolves `host.*` tokens across every string prop of a normalized node map.
 *
 * Mirrors `resolveNodesBindings` deliberately — same shallow-copy discipline,
 * same string-props-only rule — so a screen and an email resolve the same token
 * to the same value. The issue's warning is the reason: two resolvers drift,
 * and then the same token means different things depending on where an author
 * typed it.
 *
 * Returns the input untouched when the site has nothing to substitute, so a
 * binding-free tree costs one `Object.entries`.
 */
export function resolveNodesHostTokens<T extends Record<string, any>>(
  nodes: T,
  host: HostTokenSource | null | undefined,
): T {
  if (!nodes) return nodes
  let changed = false
  const next: Record<string, any> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const props = node?.props
    if (!props) {
      next[id] = node
      continue
    }
    let nodeChanged = false
    const nextProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string' && value.includes('{{')) {
        const resolved = resolveHostTokens(value, host)
        nextProps[key] = resolved
        if (resolved !== value) nodeChanged = true
      } else {
        nextProps[key] = value
      }
    }
    next[id] = nodeChanged ? { ...node, props: nextProps } : node
    changed = changed || nodeChanged
  }
  return (changed ? next : nodes) as T
}
