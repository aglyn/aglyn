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
 * Template placeholders in copy (AGL-3827): a slot a template or a model's
 * own scaffolding left where words belong, which a visitor would read exactly
 * as written. A live About page shipped two testimonials whose quote and name
 * were `{{1}}` and `{{2}}`, the repeated-item slots of a section written once.
 *
 * What counts as a placeholder, and what does not:
 *
 *  - `{{1}}`, `{{ 2 }}`: a repeated item's slot (`ai-repeated-items.ts`). No
 *    binding token is a number, so one left in copy filled nothing.
 *  - `{{name}}`, `{{Customer name}}`, `{{客户}}`: anything in double braces
 *    that is not a binding the platform fills. A scoped binding, such as
 *    `{{item.title}}`, `{{entry.url}}`, `{{prop.heading}}` or
 *    `{{contact.firstName}}`, and an id token, `{{var:…}}` or `{{fn:…(…)}}`,
 *    are the platform's own and are left to the checks that own them. A bare
 *    `{{name}}` would bind a site variable of that name, and a generator is
 *    shown none, so in a generated page it is a slot; an email's step owns
 *    its merge tokens, bare spellings included (`ai-job-email-step.ts`).
 *  - `[[Customer name]]`, `${name}`: a template's slot in another syntax.
 *  - `<Your business name>`, `<placeholder>`: words in angle brackets that are
 *    no HTML tag. Several words whose first is not a tag name, or one word a
 *    slot is named by. `Press <Enter>`, `x < y`, `<3` and markup are copy.
 *
 * NOT a placeholder: a fact the brief never gave, in single square brackets,
 * such as `[Office phone number]`. That is the honest marker rule 14 asks for
 * instead of an invented fact, and each draft's note lists them for the
 * member to fill (AGL-3056). Nor `[sic]`, a Markdown link, a price, or Lorem
 * ipsum, which rule 14's filler check already refuses.
 *
 * Pure text in, tokens out: no tree, no palette, so any check may read it.
 */

export type AiPlaceholderKind = 'repeat-slot' | 'template-token' | 'double-bracket' | 'template-literal' | 'angle-slot'

export interface AiPlaceholderToken {
  kind: AiPlaceholderKind
  /** The token as the copy spells it. */
  token: string
}

export interface AiPlaceholderOptions {
  /** The text is markup (an HTML or CSS field), where angle brackets are syntax. */
  markup?: boolean
  /** The output's own step owns its bare merge tokens, as an email's does. */
  mergeTokens?: boolean
}

/** Anything in double braces, on one line. */
const MUSTACHE = /\{\{\s*([^{}\n]{0,80}?)\s*\}\}/g
const REPEAT_SLOT = /^\d+$/
/** `{{var:id}}` and `{{fn:name(args)}}`, the binding grammar's id tokens (`binding-tokens.ts`). */
const ID_TOKEN = /^(?:var|fn):/
/** A scoped binding: `item.title`, `entry.cover.url`, `contact.firstName`. */
const SCOPED_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/
/** A legacy `{{name}}` token's name (`NAME_TOKEN_PATTERN`). */
const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/
const DOUBLE_BRACKET = /\[\[\s*[^[\]\n]{1,80}?\s*\]\]/g
const TEMPLATE_LITERAL = /\$\{\s*[A-Za-z_][\w.]{0,40}\s*\}/g
/** Words in angle brackets: a letter first, no attribute, path or quote inside. */
const ANGLE = /<(\p{L}[^<>{}[\]=/"':;@\n]{0,60}?)>/gu
/** Elements copy may carry inline, whose tag an angle slot never starts with. */
const HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'q', 's', 'small', 'span', 'strong',
  'sub', 'sup', 'u', 'ul',
])
/** One word in angle brackets that names a slot rather than a key or a tag. */
const SLOT_WORD =
  /^(?:placeholder|insert|tbd|todo|name|title|text|copy|value|company|business|city|phone|email|address|date|price|quote|author|your[\p{L}_-]*)$/iu

/** The placeholders a piece of copy holds, in the order they appear. */
export function aiPlaceholderTokens(text: string, options: AiPlaceholderOptions = {}): AiPlaceholderToken[] {
  if (!text) return []
  const found: Array<AiPlaceholderToken & { at: number }> = []
  if (text.includes('{{')) {
    for (const match of text.matchAll(MUSTACHE)) {
      const inner = match[1].trim()
      if (REPEAT_SLOT.test(inner)) {
        found.push({ kind: 'repeat-slot', token: match[0], at: match.index ?? 0 })
        continue
      }
      if (ID_TOKEN.test(inner) || SCOPED_TOKEN.test(inner)) continue
      if (options.mergeTokens && BARE_NAME.test(inner)) continue
      found.push({ kind: 'template-token', token: match[0], at: match.index ?? 0 })
    }
  }
  if (text.includes('[[')) {
    for (const match of text.matchAll(DOUBLE_BRACKET)) {
      found.push({ kind: 'double-bracket', token: match[0], at: match.index ?? 0 })
    }
  }
  if (text.includes('${')) {
    for (const match of text.matchAll(TEMPLATE_LITERAL)) {
      found.push({ kind: 'template-literal', token: match[0], at: match.index ?? 0 })
    }
  }
  if (!options.markup && text.includes('<')) {
    for (const match of text.matchAll(ANGLE)) {
      const inner = match[1].trim()
      const words = inner.split(/\s+/)
      const slot = words.length > 1 ? !HTML_TAGS.has(words[0].toLowerCase()) : SLOT_WORD.test(inner)
      if (slot) found.push({ kind: 'angle-slot', token: match[0], at: match.index ?? 0 })
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ kind, token }) => ({ kind, token }))
}

/** Whether copy holds a placeholder at all. */
export function aiHasPlaceholderToken(text: string, options: AiPlaceholderOptions = {}): boolean {
  return aiPlaceholderTokens(text, options).length > 0
}

/**
 * Whether copy is ONLY placeholders: with every token taken out, not one
 * letter or digit is left, as in `{{1}}` or `“{{1}}” — {{2}}`. Such copy says
 * nothing a reader could keep, which is what lets an item that shows only it
 * be taken out without losing a word (`aiSettlePlaceholderItems`).
 */
export function aiIsOnlyPlaceholders(text: string, options: AiPlaceholderOptions = {}): boolean {
  const tokens = aiPlaceholderTokens(text, options)
  if (!tokens.length) return false
  let rest = text
  for (const { token } of tokens) rest = rest.replace(token, ' ')
  return !/[\p{L}\p{N}]/u.test(rest)
}
