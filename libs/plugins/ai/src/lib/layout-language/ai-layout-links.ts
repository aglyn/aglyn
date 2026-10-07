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

import { aiPageLinkSection } from '../runtime/ai-page-links'

/**
 * Where a link the layout language names goes (AGL-3660), resolved by code to
 * a destination rule 10 admits: a page of this site by its id, a section of
 * this page by the platform's Scroll to element interaction, or an `https:`
 * address the brief itself gave. A destination that resolves to nothing, or
 * to the home page under words that do not say home, is no destination, and
 * the compiler leaves the button out rather than shipping a dead control.
 */

/** A page of the site a link may go to: built, or minted on a guided start's plan. */
export interface AiLayoutPage {
  id: string
  label: string
  slug: string
}

/** Everything a page's links resolve against. */
export interface AiLayoutTargets {
  /** The page being built, which no link of its own goes to. */
  pageId?: string | null
  /** The site's pages a link may go to. */
  pages: readonly AiLayoutPage[]
  /** The site's home pages, which only words that say home link (rule 10). */
  homeIds: readonly string[]
  /** The saved forms a page may place. */
  forms: readonly { id: string; name: string }[]
  /** The page that places the site's form, where that is another page. */
  formPageId?: string | null
  /** The reusable components a page may place, with the props each fills. */
  components: readonly {
    id: string
    name: string
    props: Record<string, string>
  }[]
  /** Every word the job was given: the brief, the site's answers, its profile. */
  facts: string
}

/** Where a link resolved to. */
export type AiLayoutDestination =
  | { kind: 'page'; screenId: string }
  | { kind: 'section'; index: number }
  | { kind: 'href'; href: string }

/** The words of a label or a name, as they are compared. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function slugOf(slug: string): string {
  return `/${slug.replace(/^\/+|\/+$/g, '')}`.toLowerCase()
}

const HOME_WORDS = /\bhome(?:\s?page)?\b/i

/** Words that ask a visitor to get in touch, which the site's form answers. */
const CONTACT_WORDS =
  /\b(?:contact|book|booking|call|quote|estimate|appointment|schedule|reserve|reservation|get in touch|request|visit|enquire|inquire|enquiry|inquiry|message|talk|consult|consultation|order|sign up|join|apply|start)\b/i

export interface AiLayoutLinkScope {
  /** The page's section names in plan order. */
  sections: readonly string[]
  /** The section the link sits in, which it does not scroll to. */
  from: number
  /** The section of this page that places the site's form, if one does. */
  formSection: number | null
}

/** The page a word names: an id, a label or an address. */
function pageNamed(
  word: string,
  targets: AiLayoutTargets,
): AiLayoutPage | null {
  const value = word.trim()
  if (!value) return null
  const byId = targets.pages.find((page) => page.id === value)
  if (byId) return byId
  const lower = value.toLowerCase()
  if (lower.startsWith('/'))
    return (
      targets.pages.find((page) => slugOf(page.slug) === slugOf(lower)) ?? null
    )
  const words = wordsOf(value).join(' ')
  return (
    targets.pages.find((page) => wordsOf(page.label).join(' ') === words) ??
    null
  )
}

/** A destination rule 10 admits, from the page it names, for the words a link shows. */
function pageDestination(
  page: AiLayoutPage | null,
  label: string,
  targets: AiLayoutTargets,
): AiLayoutDestination | null {
  if (!page || page.id === targets.pageId) return null
  if (
    targets.homeIds.includes(page.id) &&
    !HOME_WORDS.test(label) &&
    !isHomeSlug(page.slug)
  )
    return null
  if (isHomeSlug(page.slug) && !HOME_WORDS.test(label)) return null
  return { kind: 'page', screenId: page.id }
}

function isHomeSlug(slug: string): boolean {
  return slugOf(slug) === '/'
}

/** Where the site's form is: a section of this page, else the page that places it. */
function formDestination(
  scope: AiLayoutLinkScope,
  targets: AiLayoutTargets,
): AiLayoutDestination | null {
  if (scope.formSection !== null && scope.formSection !== scope.from)
    return { kind: 'section', index: scope.formSection }
  if (targets.formPageId && targets.formPageId !== targets.pageId) {
    return { kind: 'page', screenId: targets.formPageId }
  }
  return null
}

/**
 * Where a link goes: the destination its `to` names, read the language's
 * way; failing that, for words that ask a visitor to get in touch, the site's
 * form; failing that, a page whose name the words say. `null` is a link with
 * nowhere to go, which is left out.
 */
export function aiLayoutResolveLink(
  to: string | undefined,
  label: string,
  scope: AiLayoutLinkScope,
  targets: AiLayoutTargets,
): AiLayoutDestination | null {
  const named = to ? resolveNamed(to.trim(), label, scope, targets) : null
  if (named) return named
  if (CONTACT_WORDS.test(label)) {
    const form = formDestination(scope, targets)
    if (form) return form
    const contact = targets.pages.find(
      (page) =>
        page.id !== targets.pageId &&
        !isHomeSlug(page.slug) &&
        CONTACT_WORDS.test(page.label),
    )
    if (contact) return { kind: 'page', screenId: contact.id }
  }
  const labelWords = new Set(wordsOf(label))
  const said = targets.pages.filter(
    (page) =>
      page.id !== targets.pageId &&
      !isHomeSlug(page.slug) &&
      wordsOf(page.label).length > 0 &&
      wordsOf(page.label).every((word) => labelWords.has(word)),
  )
  return said.length === 1 ? { kind: 'page', screenId: said[0].id } : null
}

function resolveNamed(
  to: string,
  label: string,
  scope: AiLayoutLinkScope,
  targets: AiLayoutTargets,
): AiLayoutDestination | null {
  const lower = to.toLowerCase()
  if (
    lower === 'form' ||
    lower.startsWith('form:') ||
    targets.forms.some((form) => form.id === to)
  ) {
    return formDestination(scope, targets)
  }
  if (lower.startsWith('https://')) {
    return targets.facts.includes(to) ? { kind: 'href', href: to } : null
  }
  const section = lower.startsWith('#')
    ? to.slice(1)
    : lower.startsWith('section:')
      ? to.slice(8)
      : null
  if (section !== null) {
    const number = Number(section.trim())
    const index =
      Number.isInteger(number) && number >= 1 && number <= scope.sections.length
        ? number - 1
        : aiPageLinkSection(section, scope.sections)
    return index !== null && index !== scope.from
      ? { kind: 'section', index }
      : null
  }
  const page = pageNamed(lower.startsWith('page:') ? to.slice(5) : to, targets)
  return pageDestination(page, label, targets)
}
