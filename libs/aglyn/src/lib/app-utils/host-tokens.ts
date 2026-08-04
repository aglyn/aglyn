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
  subdomain?: string
  cname?: string
  /** Contact details a publisher template can reference (AGL-1022). */
  business?: {
    supportEmail?: string
    address?: string
    socialLinks?: Array<{ label?: string; url?: string }>
  }
  seo?: { entity?: { name?: string; logo?: string } }
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
  const subdomain = trimmed(host.subdomain)
  return subdomain ? `https://${subdomain}.aglyn.app` : undefined
}

function businessName(host: HostTokenSource): string | undefined {
  return trimmed(host.seo?.entity?.name) ?? trimmed(host.displayName)
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
    description: 'The site’s business or brand name.',
    resolve: businessName,
    whenEmpty: 'blank',
  },
  logo: {
    key: 'logo',
    type: 'image',
    label: 'Logo',
    description: 'The site’s logo image.',
    resolve: (host) =>
      trimmed(host.logoUrl) ?? trimmed(host.seo?.entity?.logo),
    // No image: the block is dropped and the business name carries the brand
    // instead, which is what the block was for.
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
  supportEmail: {
    key: 'supportEmail',
    type: 'email',
    label: 'Support email',
    description: 'Where visitors should write for help.',
    resolve: (host) => trimmed(host.business?.supportEmail),
    whenEmpty: 'omit-block',
  },
  address: {
    key: 'address',
    type: 'address',
    label: 'Postal address',
    description: 'The business’s postal address, as one block of text.',
    resolve: (host) => trimmed(host.business?.address),
    whenEmpty: 'omit-block',
  },
  socialLinks: {
    key: 'socialLinks',
    type: 'text',
    label: 'Social links',
    description: 'The site’s social profiles, as a list of labelled links.',
    // Rendered as text here so a token in copy degrades to something readable;
    // a renderer wanting real links reads `host.business.socialLinks` itself.
    resolve: (host) => {
      const links = host.business?.socialLinks ?? []
      const labels = links
        .map((link) => trimmed(link?.label) ?? trimmed(link?.url))
        .filter((label): label is string => Boolean(label))
      return labels.length ? labels.join(' · ') : undefined
    },
    whenEmpty: 'omit-block',
  },
}

/**
 * `{{host.key}}` — whitespace-tolerant, and deliberately NOT dotted beyond one
 * segment. `host.a.b` does not match, so there is no path syntax to abuse.
 */
export const HOST_TOKEN_PATTERN = /\{\{\s*host\.([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

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
  const definition = HOST_TOKENS[key]
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
    const definition = HOST_TOKENS[key]
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
    const definition = HOST_TOKENS[key]
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
