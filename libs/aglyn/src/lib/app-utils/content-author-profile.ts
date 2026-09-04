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

import type { AglynNodeSchema, NodeId } from '../foundation'
import {
  type ContentAuthorRecord,
  contentAuthorPageUrl,
  normalizeContentAuthorLinks,
} from './content-authors'

/**
 * The Author Profile block (AGL-2518) — who this page is about.
 *
 * ## Why not the Entry Author card
 *
 * `collectionEntryAuthor` is the card that CLOSES an article, and everything
 * about it is downstream of a routed entry: it fills from `entry.author`, it
 * renders nothing when there is no entry, and its shape is a byline footnote
 * — portrait, name, blurb, in a row.
 *
 * An author PAGE has no routed entry, and it is not a footnote: it is the
 * page's subject. It carries what the record actually holds, including the
 * two fields the article card has no room for — `jobTitle` and `worksFor` —
 * which are precisely the fields that say who a stranger is looking at.
 * Reusing one component for both would mean a block whose meaning depends on
 * which route it happens to be dropped on, and whose Show switches half apply.
 *
 * They share the link-row rendering, which is the part that would actually
 * drift.
 */
export const CONTENT_AUTHOR_PROFILE_COMPONENT_ID = 'contentAuthorProfile'

/**
 * The `{{author.*}}` token map for an author page (AGL-2518).
 *
 * Empty strings everywhere off an author page, which is what lets a designed
 * screen bind them unconditionally: a heading bound to `{{author.name}}` has
 * nothing to print elsewhere, and a link whose href does not resolve renders
 * as inert markup of the same element (AGL-1268/1357) rather than as a link
 * to nowhere. The same rule `{{collection.category}}` follows on an
 * unfiltered listing.
 *
 * `author.image` stays RAW — a `media:` reference or a plain URL, whichever
 * was saved — because turning one into a fetchable src needs the rendering
 * host, and a token map has none. Every image field in this codebase does the
 * same; `resolveMediaSrc` is the renderer's job.
 */
export function contentAuthorTokens(
  author: ContentAuthorRecord | null | undefined,
  extras?: { entryCount?: number },
): Record<string, string> {
  const count = Math.max(0, Math.floor(Number(extras?.entryCount) || 0))
  return {
    'author.name': author?.name ?? '',
    'author.bio': author?.bio ?? '',
    'author.image': author?.image ?? '',
    'author.jobTitle': author?.jobTitle ?? '',
    'author.worksFor': author?.worksFor ?? '',
    // Their OWN site, which is `schema.org` `url` — a different destination
    // from the page this token map is describing, and a template should be
    // able to offer either.
    'author.url': author?.url ?? '',
    'author.pageUrl': author ? contentAuthorPageUrl({ author }) : '',
    'author.entryCount': String(count),
    // Pluralized here rather than in the template, because a template has no
    // conditional to do it with — the whole reason these tokens resolve to
    // literals server-side.
    'author.entryCountLabel': `${count} ${count === 1 ? 'post' : 'posts'}`,
  }
}

/**
 * Fill Author Profile blocks from the routed author (AGL-2518).
 *
 * The `expandCollectionEntryAuthor` shape, one subject over: an authored
 * value on the node always wins, so a designer who typed a name into the
 * block keeps it, and the record fills only what was left blank. `links` has
 * no authorable form — a row carries a platform or a picked icon, both chosen
 * in the console's author editor — so the record's rows are the only ones
 * there are, and `Show links` is the template's control over them.
 */
export function expandContentAuthorProfile<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  author: ContentAuthorRecord | null | undefined,
): Record<NodeId, N> {
  if (!author) return nodes
  const containers = Object.entries(nodes).filter(
    ([, node]) => node?.componentId === CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
  )
  if (!containers.length) return nodes
  const links = normalizeContentAuthorLinks(author.links)
  const values: Record<string, string> = {
    name: author.name ?? '',
    bio: author.bio ?? '',
    image: author.image ?? '',
    jobTitle: author.jobTitle ?? '',
    worksFor: author.worksFor ?? '',
    url: author.url ?? '',
  }
  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const props = (container.props ?? {}) as Record<string, unknown>
    const filled: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (String(props[key] ?? '').trim()) continue
      if (!value) continue
      filled[key] = value
    }
    if (links.length) filled['links'] = links
    if (!Object.keys(filled).length) continue
    next[containerId] = {
      ...container,
      props: { ...(container.props ?? {}), ...filled } as never,
    }
  }
  return next
}
