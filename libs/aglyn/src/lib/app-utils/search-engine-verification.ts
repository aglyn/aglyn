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
 * Search engine ownership verification by HTML meta tag (AGL-3399).
 *
 * ## Why this exists
 *
 * Google Search Console and Bing Webmaster Tools each offer three ways to
 * prove a site is yours: a DNS record, an uploaded file, or a meta tag in the
 * home page's head. A site on a platform subdomain has no DNS of its own and
 * no way to upload a file to the origin root, so the meta tag is the only
 * method it can use — and until this existed there was nowhere to put one.
 *
 * ## What is stored, and what is emitted
 *
 * The tools hand out a whole tag —
 * `<meta name="google-site-verification" content="…" />` — and most people
 * paste exactly that. Only the `content` value is stored
 * (`host.seo.verification`), so the tenant always writes the tag itself and
 * never echoes markup a person pasted.
 *
 * The token is validated at BOTH ends with the same pattern: in the console,
 * so a bad paste is refused at the field, and again in the tenant before it
 * reaches the head, so a value that got into the document some other way is
 * dropped rather than rendered.
 *
 * Deliberately NOT re-exported from the `@aglyn/aglyn` root barrel: that
 * barrel is part of the published-page and realm bundles, and the tenant
 * layout and the console settings card each import this by path.
 */

/** The engines a site can verify with. */
export type SearchEngineVerificationEngine = 'google' | 'bing'

/** `host.seo.verification`, one token per engine. */
export type SearchEngineVerification = Partial<
  Record<SearchEngineVerificationEngine, string>
>

/** The `<meta name>` each engine looks for. */
export const SEARCH_ENGINE_VERIFICATION_META_NAMES: Readonly<
  Record<SearchEngineVerificationEngine, string>
> = {
  google: 'google-site-verification',
  bing: 'msvalidate.01',
}

/** What each engine is called on screen. */
export const SEARCH_ENGINE_VERIFICATION_LABELS: Readonly<
  Record<SearchEngineVerificationEngine, string>
> = {
  google: 'Google Search Console',
  bing: 'Bing Webmaster Tools',
}

/**
 * A verification token: letters, digits, `-` and `_`, at most 128.
 *
 * Google's tokens are URL-safe base64 (about 43 characters) and Bing's are 32
 * hex digits; both fit, and nothing that could close an attribute does.
 */
export const SEARCH_ENGINE_VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Engines in the order their tags are emitted. */
const ENGINES: readonly SearchEngineVerificationEngine[] = ['google', 'bing']

/** One attribute of a pasted tag, quoted either way or not at all. */
const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`,
    'i',
  ).exec(tag)
  if (!match) return undefined
  return (match[1] ?? match[2] ?? match[3] ?? '').trim()
}

/** What a paste into a verification field reads as. */
export interface ParsedVerificationInput {
  /** The token — the `content` value of a pasted tag, or the paste itself. */
  token: string
  /** The `name` of a pasted tag, lower-cased; absent for a bare token. */
  metaName?: string
}

/**
 * Reads a paste as either a bare token or the whole tag the tools hand out.
 *
 * A paste that looks like markup (it has a `<` or a `content=`) is read as a
 * tag and yields its `content` value, `''` when it has none. Anything else is
 * the token itself, trimmed. Never validates — see
 * {@link searchEngineVerificationError}.
 */
export function parseSearchEngineVerificationInput(
  input: unknown,
): ParsedVerificationInput {
  if (typeof input !== 'string') return { token: '' }
  const trimmed = input.trim()
  if (!trimmed.includes('<') && !/\bcontent\s*=/i.test(trimmed)) {
    return { token: trimmed }
  }
  const metaName = attribute(trimmed, 'name')?.toLowerCase()
  return {
    token: attribute(trimmed, 'content') ?? '',
    ...(metaName ? { metaName } : {}),
  }
}

/** The token a paste stores as: the tag's `content`, or the trimmed paste. */
export function extractSearchEngineVerificationToken(input: unknown): string {
  return parseSearchEngineVerificationInput(input).token
}

/** Whether `value` is a token the tenant will emit. */
export function isSearchEngineVerificationToken(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    SEARCH_ENGINE_VERIFICATION_TOKEN_PATTERN.test(value)
  )
}

/**
 * The field error for a paste into `engine`'s field, or `undefined` when it
 * is empty or reads as a valid token.
 *
 * A tag for the OTHER engine is named as such: a Bing tag pasted into the
 * Google field holds a perfectly well-formed token, and storing it would make
 * Search Console's Verify fail with nothing on this side saying why.
 */
export function searchEngineVerificationError(
  engine: SearchEngineVerificationEngine,
  input: unknown,
): string | undefined {
  if (input == null || (typeof input === 'string' && !input.trim())) {
    return undefined
  }
  const { token, metaName } = parseSearchEngineVerificationInput(input)
  if (metaName && metaName !== SEARCH_ENGINE_VERIFICATION_META_NAMES[engine]) {
    const other = ENGINES.find(
      (candidate) =>
        SEARCH_ENGINE_VERIFICATION_META_NAMES[candidate] === metaName,
    )
    return other
      ? `That tag is for ${SEARCH_ENGINE_VERIFICATION_LABELS[other]} — paste it in that field instead`
      : `That tag isn’t a ${SEARCH_ENGINE_VERIFICATION_LABELS[engine]} verification tag`
  }
  if (!isSearchEngineVerificationToken(token)) {
    return (
      'Paste the verification code, or the whole meta tag — the code is ' +
      'letters, numbers, - and _ only'
    )
  }
  return undefined
}

/** One `<meta>` a published page emits. */
export interface SearchEngineVerificationMeta {
  name: string
  content: string
}

/**
 * The verification `<meta>` tags a published page emits: one per engine
 * whose stored token passes the pattern, none for anything unset or invalid.
 */
export function searchEngineVerificationMeta(
  verification: unknown,
): SearchEngineVerificationMeta[] {
  if (!verification || typeof verification !== 'object') return []
  const stored = verification as Record<string, unknown>
  const tags: SearchEngineVerificationMeta[] = []
  for (const engine of ENGINES) {
    const token = stored[engine]
    if (isSearchEngineVerificationToken(token)) {
      tags.push({
        name: SEARCH_ENGINE_VERIFICATION_META_NAMES[engine],
        content: token,
      })
    }
  }
  return tags
}
