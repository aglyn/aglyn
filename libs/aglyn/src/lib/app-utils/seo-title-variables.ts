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
 * The variables a page title may be written in terms of, and how a written
 * title becomes a rendered one.
 *
 * ## Why this exists
 *
 * A title is verbatim (AGL-1341, and that rule is right — see `seo-title`), so
 * an author who wants the brand in a title TYPES it. Fifty screens on the
 * marketing site end in a literal ` | Aglyn`, which means the site name and
 * the character in front of it are stored fifty times, and changing either one
 * is fifty edits that nothing reminds you to make. `seo.separator` already
 * exists as a setting and every one of those titles ignores it.
 *
 * So a title may now be WRITTEN in terms of what it depends on:
 *
 * ```
 *   {{page.name}} {{site.separator}} {{site.name}}
 * ```
 *
 * and a site-name change is one edit in Host setup → SEO.
 *
 * ## ⛔ No rendered title changes because this shipped
 *
 * The whole feature is opt-in at the string level: a title with no `{{` in it
 * is returned unchanged, character for character, by the same code path that
 * returned it before. Nothing migrates the fifty existing titles — a migration
 * could not be output-preserving anyway, because ` | Aglyn` is not what
 * `{{site.separator}}{{site.name}}` resolves to on a host whose separator is
 * `-` and whose site title is the long form. They keep working as literals
 * until somebody decides otherwise, one at a time.
 *
 * `DEFAULT_TITLE_PATTERN` is held to the same standard: it is the composition
 * `resolveSeoTitle` already performed for a page with no authored title, said
 * in tokens instead of in code, and `seo-title.spec` pins that the two agree.
 *
 * ## The grammar is `{{…}}`, not `[…]`
 *
 * Because the platform already has one: the besigner's attribute fields, the
 * markdown blocks and the campaign editors all serialize `{{…}}` and the
 * people writing SEO titles are the same people who write those. A second
 * grammar for the same idea is a second thing to learn and a second parser to
 * keep in step.
 *
 * ## What is NOT a variable here
 *
 * Anything per-visitor or per-request. A `<title>` is rendered into a cached,
 * shared HTML document and read by crawlers, so a variable that resolved to
 * something about the reader would be wrong for everyone it was cached for.
 * These three are properties of the page and the site, both of which are the
 * same for everybody who asks for that URL.
 */

/** A variable's name, as it is written between the braces. */
export type SeoTitleVariableName = 'page.name' | 'site.name' | 'site.separator'

export interface SeoTitleVariableDefinition {
  name: SeoTitleVariableName
  /** What the insert menu calls it. */
  label: string
  /** One line under the label, saying where the value comes from. */
  description: string
}

/**
 * Every variable a title may use, in the order a picker should offer them —
 * which is the order they appear in the default pattern, so the menu reads as
 * the sentence it builds.
 */
export const SEO_TITLE_VARIABLES: readonly SeoTitleVariableDefinition[] = [
  {
    name: 'page.name',
    label: 'Page name',
    description: 'What this page is called — a screen’s display name.',
  },
  {
    name: 'site.separator',
    label: 'Separator',
    description: 'The character from Host setup → SEO that joins the two.',
  },
  {
    name: 'site.name',
    label: 'Site name',
    description: 'The site title from Host setup → SEO.',
  },
]

/**
 * The composition every untitled page gets when the site sets no pattern of
 * its own.
 *
 * This is `resolveSeoTitle`'s previous hard-coded composition, written out:
 * name, separator padded by a space on each side, site title. It is a constant
 * rather than a string built at the call site so that the setting's default,
 * the placeholder the editor shows and the value the renderer falls back to
 * are one thing.
 */
export const DEFAULT_TITLE_PATTERN = '{{page.name}} {{site.separator}} {{site.name}}'

/** The values the variables stand for, for one page of one site. */
export interface SeoTitleVariableValues {
  'page.name'?: string | null
  'site.name'?: string | null
  'site.separator'?: string | null
}

/** Trimmed, or `''` for anything that is not a live string. */
function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The separator a site uses when it has set none.
 *
 * An en dash, which is what `seo-title` has padded around since AGL-1341. It
 * lives here because `{{site.separator}}` has to resolve to the SAME character
 * the code composed with — a variable that stood for "the separator, unless
 * it is unset, in which case nothing" would silently change the title of every
 * untitled page on every site that never filled the field in.
 */
export const DEFAULT_TITLE_SEPARATOR = '\u2013'

/** The site's separator, defaulted the one way everything defaults it. */
export function seoSeparatorOrDefault(separator?: string | null): string {
  return clean(separator) || DEFAULT_TITLE_SEPARATOR
}

/**
 * Whether a written value uses any variable at all.
 *
 * The cheap gate in front of every path here: a title with no `{{` is returned
 * by identity, which is what makes "nothing renders differently" a property of
 * the code rather than a claim about the data.
 */
export function hasSeoTitleVariables(value?: string | null): boolean {
  return typeof value === 'string' && value.includes('{{')
}

/** Whether a name is one this catalog defines. */
export function isSeoTitleVariable(name: string): name is SeoTitleVariableName {
  return SEO_TITLE_VARIABLES.some((variable) => variable.name === name)
}

/**
 * `{{ name }}` — the whole token, and the name inside it with its padding
 * trimmed, so a human who typed a space after the braces is not punished for
 * it.
 */
const TOKEN = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g

interface Part {
  /** What renders here, once the variable is resolved. */
  text: string
  /** The variable this came from, if it came from one. */
  variable?: string
}

/** The written string as literal runs and variable slots, in order. */
function partsOf(source: string, values: SeoTitleVariableValues): Part[] {
  const parts: Part[] = []
  let at = 0
  TOKEN.lastIndex = 0
  for (let match = TOKEN.exec(source); match; match = TOKEN.exec(source)) {
    if (match.index > at) parts.push({ text: source.slice(at, match.index) })
    const name = match[1]
    parts.push({
      variable: name,
      // An unknown variable renders AS ITSELF — see the resolver's docblock.
      text: !isSeoTitleVariable(name)
        ? match[0]
        : name === 'site.separator'
          ? seoSeparatorOrDefault(values[name])
          : clean(values[name]),
    })
    at = match.index + match[0].length
  }
  if (at < source.length) parts.push({ text: source.slice(at) })
  return parts
}

/**
 * Resolve a written title into the one that is rendered.
 *
 * ## An unknown variable is left alone
 *
 * `{{page.subtitle}}` renders as itself, visibly, rather than as an empty gap.
 * A typo that vanished would produce a title that is silently missing a piece,
 * and the author's next look at the live page would show them a sentence that
 * merely reads a bit short. Leaving it visible is the version somebody
 * notices. The editor's picker and autocomplete are what keep it from
 * happening; this is what happens when they are bypassed.
 *
 * ## A separator needs something on BOTH sides
 *
 * This is `resolveSeoTitle`'s own rule (AGL-1341) and it survives the move into
 * a pattern, because it is the rule that stops `<title>` from beginning with a
 * dash on a page whose name is missing. A `{{site.separator}}` with nothing
 * rendered on one side of it is dropped, whatever order the pattern put the
 * pieces in — which is why the parts are walked rather than regex-substituted:
 * a substitution cannot see its neighbours.
 *
 * ## An empty variable takes its spacing with it
 *
 * Otherwise a site with no name set renders `Pricing  ` — the gap where the
 * missing piece was, and a trailing separator's worth of whitespace. Runs
 * collapse to one space and the result is trimmed.
 */
export function resolveSeoTitleVariables(
  written: string | null | undefined,
  values: SeoTitleVariableValues,
): string {
  const source = typeof written === 'string' ? written : ''
  if (!hasSeoTitleVariables(source)) return source

  const parts = partsOf(source, values)
  const rendered = parts.map((part) => part.text)
  // A separator survives only where something renders on each side of it.
  parts.forEach((part, index) => {
    if (part.variable !== 'site.separator') return
    const live = (from: number, to: number) =>
      rendered.slice(from, to).some((text) => text.trim())
    if (!live(0, index) || !live(index + 1, rendered.length)) rendered[index] = ''
  })

  return rendered.join('').replace(/\s{2,}/g, ' ').trim()
}
