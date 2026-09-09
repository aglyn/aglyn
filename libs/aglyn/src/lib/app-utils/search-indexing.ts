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

import { HostScreenVisibility } from '../foundation/definitions/platform.types'
import { SITEMAP_INDEX_PATH } from './sitemap'

/**
 * Search-indexing policy (AGL-1263): the single answer to "may a crawler
 * index this?", shared by every surface that has to agree about it.
 *
 * Four surfaces answer that question and they must never disagree — the
 * server `generateMetadata`, its client `<Head>` twin, `robots.txt` and
 * `sitemap.xml`. Before this module three of them had their own copy of the
 * rule and the fourth had none: the sitemap listed whatever was in the host's
 * routing map, so an UNLISTED page was simultaneously told "do not index me"
 * in its own head and advertised as a canonical URL in the site's sitemap.
 * That is not a harmless duplication — a sitemap entry is an explicit
 * submission, and submitting a page you have marked noindex is the shape that
 * gets a site flagged for conflicting directives.
 *
 * There are two controls and they compose:
 *
 * - **Site-level** `host.seo.discourageSearchEngines` — the staged-launch
 *   switch. Everything about the site goes dark to crawlers at once.
 * - **Per-screen** `screen.visibility` — the existing
 *   {@link HostScreenVisibility} model, NOT a parallel `noindex` flag.
 *   `UNLISTED` is literally `PUBLIC | (1 << 2)`: "public, plus the not-listed
 *   bit". A second per-screen field would be a field that can disagree with
 *   this one, and every render surface would then need a rule for which wins.
 */

/** The host fields this module reads; keeps callers free of the full doc. */
export interface SearchIndexingHost {
  seo?: {
    /**
     * Site-wide "discourage search engines" (AGL-1263). PERSISTED NAME — the
     * wording matches the switch an author sees, so support conversations and
     * the document agree.
     */
    discourageSearchEngines?: boolean
  } | null
}

/** The screen fields this module reads. */
export interface SearchIndexingScreen {
  visibility?: HostScreenVisibility | null
}

/**
 * Site-wide opt-out. Absent means "index me" — the default a site is created
 * with, and the only safe default: a missing field must never be read as
 * "hide this site", or a schema slip would quietly de-index every customer.
 */
export function isSearchDiscouraged(
  host: SearchIndexingHost | null | undefined,
): boolean {
  return host?.seo?.discourageSearchEngines === true
}

/**
 * Whether a screen may be indexed on its own merits, ignoring the site-level
 * switch.
 *
 * Only `PUBLIC` — and an absent value, which every screen predating the
 * visibility model carries — is indexable. Everything else is excluded, and
 * that is wider than the old `=== UNLISTED` test on purpose: a
 * password-protected, members-only or private screen has nothing a crawler
 * can reach, so listing it in a sitemap published a URL that answers with a
 * gate. `UNLISTED` was the only one anyone remembered because it is the only
 * one whose *name* is about search.
 */
export function isScreenIndexable(
  screen: SearchIndexingScreen | null | undefined,
): boolean {
  const visibility = screen?.visibility
  if (visibility == null) return true
  return visibility === HostScreenVisibility.PUBLIC
}

/** Both controls together — what a render surface actually wants to know. */
export function isPageIndexable(options: {
  host?: SearchIndexingHost | null
  screen?: SearchIndexingScreen | null
}): boolean {
  if (isSearchDiscouraged(options.host)) return false
  return isScreenIndexable(options.screen)
}

/**
 * The `robots.txt` body for a host.
 *
 * When search is discouraged the file disallows everything AND the pages
 * carry `noindex`, which reads like a contradiction and is not. `Disallow`
 * only asks a crawler not to FETCH; a URL linked from elsewhere can still be
 * indexed without ever being fetched, and a crawler that obeys the disallow
 * never sees the `noindex` that would have stopped it. Belt and braces is the
 * documented remedy, and it is what every other builder's equivalent switch
 * does.
 *
 * The `Sitemap:` line is dropped in that state rather than kept: handing a
 * crawler an index of the site you just asked it not to crawl is the
 * contradiction the rest of this module exists to remove.
 */
export function buildRobotsTxt(options: {
  host?: SearchIndexingHost | null
  /** Absolute origin (no trailing slash); omitted when unresolvable. */
  origin?: string
}): string {
  if (isSearchDiscouraged(options.host)) {
    /*
      Every named agent group is dropped along with the wildcard. A group that
      named an agent and allowed it would be a LOUDER permission than the
      wildcard's refusal — `robots.txt` precedence gives the most specific
      matching group, so `User-agent: ClaudeBot` beats `User-agent: *` — and a
      site that asked to be left alone would be inviting exactly the readers it
      asked to leave.
    */
    return 'User-agent: *\nDisallow: /\n'
  }
  const sitemap = options.origin
    ? `Sitemap: ${options.origin}${SITEMAP_INDEX_PATH}\n`
    : ''
  /*
    AI agents are named EXPLICITLY, and the group says exactly what the
    wildcard above already says.

    That looks redundant and is not. A wildcard `Allow: /` is the absence of a
    restriction; a named group is a STATEMENT, and several readers only look
    for the statement: an AI crawler checks for a group bearing its own token
    before it checks the wildcard, some readiness audits score a site on
    whether one exists, and an operator reading this file learns that admitting
    these agents is a decision somebody made rather than a default nobody
    revisited.

    It is also the file that will be edited when the decision changes. A site
    owner who wants to exclude one model's crawler edits its line here; before
    this list existed there was no line to edit, and the only lever was a
    wildcard `Disallow` that would have taken Google with it.

    ⚠️ `robots.txt` is a REQUEST, not a control. It stops a crawler that reads
    it and honors it, and nothing else — it is not an access control, and the
    WAF is where an agent is actually admitted or refused. The two have to
    agree: a site that names ClaudeBot here and challenges it at the edge has
    published an invitation it does not honor.
  */
  const agents = AI_AGENT_USER_AGENTS.map(
    (agent) => `User-agent: ${agent}\nAllow: /\n`,
  ).join('\n')
  return `User-agent: *\nAllow: /\n\n${agents}\n${sitemap}`
}

/**
 * The AI agent user agents a site admits by name.
 *
 * Two kinds, kept in one list because `robots.txt` does not distinguish them
 * and a site owner reading the file should see everything that is admitted:
 *
 *  - **Fetchers** — `ChatGPT-User`, `Claude-User`, `Perplexity-User`,
 *    `Claude-SearchBot`, `ora-agent`. These act for a person who is asking
 *    about the site RIGHT NOW. Refusing one does not protect anything; it
 *    means the answer that person gets is written without the site's own
 *    words in it.
 *  - **Trainers and indexers** — `GPTBot`, `ClaudeBot`, `Google-Extended`,
 *    `PerplexityBot`, `Applebot-Extended`, `CCBot`, `Bytespider`,
 *    `Amazonbot`, `meta-externalagent`, `DeepSeekBot`, `cohere-ai`,
 *    `Diffbot`, `Omgilibot`, `Timpibot`, `YouBot`. These read for a corpus.
 *
 * Admitting the second group is a judgment, and it is the platform DEFAULT
 * rather than a permanent answer: a tenant site is published to be read, and
 * a site that is absent from the corpora is absent from the answers. A site
 * owner who disagrees has `discourageSearchEngines`, which refuses everything
 * here in one switch.
 *
 * Spellings are the vendors' own tokens and are case-sensitive to some
 * readers. Do not "tidy" them.
 */
export const AI_AGENT_USER_AGENTS: readonly string[] = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'Google-Extended',
  'PerplexityBot',
  'Perplexity-User',
  'Applebot-Extended',
  'meta-externalagent',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'cohere-ai',
  'DeepSeekBot',
  'Diffbot',
  'MistralAI-User',
  'Omgilibot',
  'Timpibot',
  'YouBot',
  'ora-agent',
  /*
    OUR OWN CLI (AGL-2717), and it belongs in this list rather than beside it.

    `@aglyn/cli` reads a site on a person's behalf — the same job
    `ChatGPT-User` and `Perplexity-User` do, and the same reason they are here.
    It names itself `aglyn-cli/<version> (+https://aglyn.com)` so a site
    operator has something to match on and somewhere to complain to.

    It is in THIS list, and not only in the WAF, because
    `check:agent-readiness` asserts the two are the same set: a client admitted
    at the edge but unnamed here is a client nobody reading `robots.txt` knows
    is admitted. The wildcard above already allows it, so the group changes
    nothing functionally — it is the statement that matters, exactly as for the
    twenty-three above.
  */
  'aglyn-cli',
]

/**
 * Screen ids that are PUBLISHED but are HTTP STATUS pages, and must never be
 * handed to a crawler or an agent (AGL-2716).
 *
 * ⚠️ NOT `screen-route.ts`'s `nonPageScreenIds`, which is a BILLING predicate:
 * that one answers "which live documents does the flat infrastructure cap
 * bound" and counts email documents and entry templates. Two questions, two
 * answers, and merging them would make a pricing cap decide what a crawler may
 * read. The name here says `status` for that reason.
 *
 * Two kinds, and both were found the hard way:
 *
 * - **Bound error screens.** `aglyn.com` published `/401`, `/404` and `/503`
 *   into its sitemap, which hands a new domain the worst possible first crawl:
 *   the crawler fetches each one, gets the status code it exists to represent,
 *   and logs crawl errors and soft-404s against a site it has never seen.
 * - **A bare status code as the whole path.** An error screen on this platform
 *   is usually just a screen published at the status path with nothing binding
 *   it, so filtering the bound ids alone changed nothing on the site that had
 *   the problem. The pattern is anchored, so a real page at `/404-guide` or
 *   `/products/503` keeps its place.
 *
 * Extracted from `/api/sitemap`, where it was written inline, so `/llms.txt`
 * and every later reader apply the same rule. The one thing this MUST NOT
 * become is a second copy of that filter: the two surfaces disagreeing is how
 * a site advertises to agents the URLs it withheld from crawlers.
 *
 * Template screens are NOT here. They are excluded too, but the source is a
 * Firestore read (`getTemplateScreenIds`) rather than the host document, so
 * they cannot be decided by a pure function.
 */
export function statusPageScreenIds(
  host:
    | {
        screens?: Record<string, string | undefined> | null
        errorScreens?: Record<string, string | undefined> | null
        notFoundScreenId?: string | null
      }
    | null
    | undefined,
): Set<string> {
  const excluded = new Set<string>()
  for (const bound of [
    ...Object.values(host?.errorScreens ?? {}),
    host?.notFoundScreenId,
  ]) {
    if (typeof bound === 'string' && bound) excluded.add(bound)
  }
  for (const [screenId, path] of Object.entries(host?.screens ?? {})) {
    if (STATUS_CODE_PATH.test(String(path))) excluded.add(screenId)
  }
  return excluded
}

/** A bare HTTP status code as an entire route path — `/404`, `503`. */
const STATUS_CODE_PATH = /^\/?[1-5][0-9][0-9]$/
