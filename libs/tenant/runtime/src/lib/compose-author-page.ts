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

import * as Aglyn from '@aglyn/aglyn/server'
import buildAuthorPageNodes from './author-page-nodes'
import { resolveBuiltInPageLayoutId } from './built-in-page-layout'
import composeScreenNodes, {
  composeNodesWithChrome,
} from './compose-screen-nodes'
import type { AuthorContent } from './get-author-content'
import getScreen from './get-screen'

/**
 * The host field naming the screen every author page renders through
 * (AGL-2518).
 *
 * ## Why the HOST and not the author
 *
 * A collection names its own list and entry templates because a site
 * legitimately designs its changelog differently from its blog. Author pages
 * are not like that: they are one page shape repeated per person, and letting
 * each author record name its own template would mean a masthead where the
 * design changes as the reader clicks between colleagues — plus a template
 * picker on a form whose whole subject is a byline.
 *
 * ## Why a SCREEN and not a layout
 *
 * The opposite call from `builtInPageLayoutId` (AGL-2513), and for the reason
 * that comment gives in reverse. Search results have no design worth
 * authoring — the platform composes the body and the site only chooses the
 * chrome around it. An author page has: a portrait, a bio, a role, links, and
 * a listing whose cards a designer wants to match the blog's. That is a page,
 * so the author designs it as one, with `{{author.*}}` tokens and the same
 * Collection entries block every list template uses.
 *
 * Unset is the ordinary case rather than a misconfiguration, and it renders
 * the built-in body — bylines link to this address, so it must always answer.
 */
export const AUTHOR_PAGE_SCREEN_FIELD = 'authorScreenId' as const

/**
 * The pseudo-collection an author page's entries block resolves against.
 *
 * The compose pipeline keys entry sources by collection slug, and this page
 * has no single collection — it mixes them. Its entries are handed over
 * already in hand (`ComposeCollectionContext.entries`), which is a path that
 * never touches Firestore, so the key only has to be a name that no real
 * collection can take: a collection slug is a URL segment, and this is not a
 * legal one.
 *
 * It never reaches a URL. Every entry on this page carries its OWN
 * `collectionSlug` out of the read that found it, and `collectionEntryTokens`
 * prefers that — which is the whole reason a cross-collection listing can
 * build correct `entry.url`s at all.
 */
export const AUTHOR_ENTRIES_SOURCE_SLUG = '__author__'

/** What the author route renders. */
export interface ComposedAuthorPage {
  /** The template screen doc, when one is designated; null for the built-in. */
  screen: Record<string, any> | null
  nodes: Record<string, any>
}

/** The tokens and entry context both compose paths share. */
function authorComposeContext(content: AuthorContent) {
  const address = content.author
    ? { author: content.author }
    : { authorName: content.slug }
  const pager = Aglyn.contentAuthorPaginationLinks({
    ...address,
    page: content.page,
    totalPages: content.totalPages,
  })
  return {
    tokens: {
      ...Aglyn.contentAuthorTokens(content.author, {
        entryCount: content.totalEntries,
      }),
      // The byline falls back to the raw segment for an unknown author, so a
      // heading bound to `{{author.name}}` prints something either way.
      'author.name': content.name,
      // Named `pagination.*` rather than `author.page*`, so a designer who has
      // already built a pager on a collection list template rebuilds nothing
      // here — and so the two pagers cannot drift into two spellings of the
      // same four values. The edges are the empty string, which is what makes
      // an unconditional binding correct on page 1 of 1.
      'pagination.page': String(pager.page),
      'pagination.totalPages': String(pager.totalPages),
      'pagination.prevUrl': pager.prevUrl,
      'pagination.nextUrl': pager.nextUrl,
    } as Record<string, string>,
    collection: {
      slug: AUTHOR_ENTRIES_SOURCE_SLUG,
      // Already narrowed to this author AND to this page's window by the
      // loader, for the reason the category route states: a page count
      // computed over the whole set advertises pages that render empty.
      entries: content.entries,
      categories: content.categories,
      page: content.page,
    },
  }
}

/**
 * An author page composed through the screen the host designated (AGL-2518).
 *
 * The `composeCollectionTemplatePage` shape: the screen goes through the
 * NORMAL published pipeline — theme, shared layout, reusable components,
 * Collection entries blocks — with `{{author.*}}` and `{{pagination.*}}`
 * substituted and Author Profile blocks filled from the record.
 *
 * Returns null when no screen is designated, or when the designated one has
 * been deleted, so the caller falls through to the built-in body rather than
 * serving a 404 for a page a byline links to.
 */
export async function composeAuthorTemplatePage(options: {
  hostId: string
  host: any
  content: AuthorContent
}): Promise<ComposedAuthorPage | null> {
  const { hostId, host, content } = options
  const screenId = String(host?.[AUTHOR_PAGE_SCREEN_FIELD] ?? '').trim()
  if (!screenId) return null
  try {
    // `allowTemplate`, exactly as a collection template is read: the screen is
    // deliberately not servable at an address of its own, and this is the
    // composition it exists for.
    const templateRes = await getScreen({
      hostId,
      screenId,
      allowTemplate: true,
    })
    if (!templateRes.screen) return null
    const { tokens, collection } = authorComposeContext(content)
    const nodes = await composeScreenNodes({
      hostId,
      screenId,
      screen: templateRes.screen,
      tokens,
      collection,
    })
    if (!nodes) return null
    /*
      The screen document travels UNCHANGED, and deliberately carries no
      composed SEO.

      A collection template composes the entry's title and cover into
      `screen.seo` because `page.tsx` reads that on its way to the head. An
      author page does not take that path: its head branch has the author
      RECORD in hand and builds the title, description and portrait from it
      directly, before the screen branch is ever reached. Writing a second,
      unread copy here would be a value that looks authoritative, is dead, and
      goes stale the first time the head's rule changes — which is how a
      template's stored title came to name every post in a collection
      (AGL-1345).
    */
    return {
      screen: templateRes.screen as Record<string, any>,
      nodes: Aglyn.expandContentAuthorProfile(nodes, content.author),
    }
  } catch (error) {
    console.error('author template composition failed', error)
    return null
  }
}

/**
 * The built-in author page (AGL-2518) — the body this file's own nodes build,
 * grafted into the site's shared layout so it carries the same header, nav and
 * footer as the posts it links to.
 *
 * Which layout is the host's to choose (`resolveBuiltInPageLayoutId`), shared
 * with site search so the two platform-built pages of a site cannot end up in
 * different chrome.
 *
 * Fail-open to `null`, and the route then renders the body with no chrome at
 * all. A person's page must not be the page that 500s because a layout was
 * deleted.
 */
export async function composeAuthorFallbackPage(options: {
  hostId: string
  host: any
  content: AuthorContent
}): Promise<ComposedAuthorPage | null> {
  const { hostId, host, content } = options
  try {
    const layoutId = await resolveBuiltInPageLayoutId({ hostId, host })
    const { tokens, collection } = authorComposeContext(content)
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes: buildAuthorPageNodes({
        slug: content.slug,
        name: content.name,
        author: content.author,
        hasEntries: content.entries.length > 0,
        page: content.page,
        perPage: content.perPage,
        totalPages: content.totalPages,
      }),
      tokens,
      collection,
      host: host as Aglyn.HostTokenSource,
    })
    return nodes ? { screen: null, nodes } : null
  } catch (error) {
    console.error('author page composition failed', error)
    return null
  }
}

export default composeAuthorTemplatePage
