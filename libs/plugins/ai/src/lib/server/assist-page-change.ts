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

import {
  ASSIST_PAGE_CHANGE_ACTION_ID,
  ASSIST_PAGE_CHANGE_SUMMARY_MAX_CHARS,
  ASSIST_PAGE_CHANGE_TOOL_NAME,
  type AssistPageChangeProposal,
} from '../model/assist-page-change'
import { ASSIST_BUILD_TOOL_NAME } from '../model/assist-build'
import type { AiTool } from '../providers/contract'
import { AI_JOB_BRIEF_MAX_CHARS } from '../jobs/ai-job-text-step'
import { assistBuildBriefWithoutGaps } from './assist-build'

/**
 * A change to a page the site already has, from the Assist chat (AGL-4116):
 * the tool the model asks through, the site's pages it picks from, and the
 * resolution the panel starts an `edit` job from. See
 * `model/assist-page-change.ts`.
 */

/** The most pages the chat is shown; a site's pages past it are asked about by name. */
export const ASSIST_SITE_PAGES_MAX = 60

/** One of the site's pages, as the chat is shown it. */
export interface AssistSitePage {
  id: string
  name: string
  /** The address it is served at, or would be once published. */
  slug: string
  /** Visitors reach it: the site routes its address to it. */
  live: boolean
  /** The site's home page. */
  home: boolean
}

const STRING = { type: 'string' } as const

export function assistPageChangeTool(): AiTool {
  return {
    name: ASSIST_PAGE_CHANGE_TOOL_NAME,
    description:
      'Change a page this site already has. The change is saved into that page’s draft, or as a new ' +
      'version when the user asks for one, and the user is given a link to open it in the Besigner, ' +
      'check it and publish it. Call at most once per message, for one page.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: STRING,
        page: STRING,
        change: STRING,
        newVersion: { type: 'boolean' },
      },
      required: ['summary', 'page', 'change', 'newVersion'],
      additionalProperties: false,
    },
    strict: true,
  }
}

/** The protocol: the same for every site, so it is cached. */
export function assistPageChangeBlock(): string {
  return [
    'Changing a page the site already has:',
    `- When the user asks to change something on one of the pages under "The site's pages" (its words, pictures, sections, layout or look), do not plan a build. Write one sentence saying you will make the change as a draft of that page, then call the ${ASSIST_PAGE_CHANGE_TOOL_NAME} tool once.`,
    '- page: the id of that page from the list. Where two pages share a name or an address, it is the live one unless the user names the other.',
    '- change: exactly what they asked to change on that page, in their words, with what this conversation settled about it. Add nothing they did not ask for.',
    '- summary: one short sentence, such as "Make the top image fill the background on Home".',
    '- The change is saved into that page’s draft, on any plan: the published page stays as it is until they publish. When it is ready, the chat shows Open in the Besigner, where Open draft shows the change and they publish it. A further change to the same page is made on that draft.',
    '- newVersion: true only when they ask for the change as a new or separate version of the page; otherwise false. Never offer a new version they did not ask for.',
    '- Nothing is changed when you call the tool: never say it is done. Never say you cannot use a draft, cannot edit the page or cannot give a link.',
    `- One page per message. For changes to several pages, change the first and say to ask for the next. A request that also asks for new pages, forms or anything else to be made is a build: call ${ASSIST_BUILD_TOOL_NAME} with the whole request instead.`,
  ].join('\n')
}

/**
 * The site's pages, per site and per moment, so volatile — and, on a plan
 * without version history, that a new version cannot be made, so a request
 * for one is answered with the draft rather than a promise.
 */
export function assistSitePagesBlock(
  pages: readonly AssistSitePage[],
  options: { versioning: boolean } = { versioning: true },
): string | null {
  if (!pages.length) return null
  return [
    "The site's pages (id · name · address · live or draft):",
    ...pages.map(
      (page) =>
        `- ${page.id} · ${page.name} · ${page.slug || '/'} · ${page.live ? 'live' : 'draft, not live'}${page.home ? ', the home page' : ''}`,
    ),
    ...(options.versioning
      ? []
      : [
          'This workspace’s plan keeps no version history (it comes with Pro), so newVersion is always false: if they ask for a new version, say the change goes into the page’s draft instead.',
        ]),
  ].join('\n')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The site's pages a change may name: not deleted, not a collection's entry
 * template, an email design or an error body. Live ones and the home page
 * first, so a cap keeps the pages a person means.
 */
export async function readAssistSitePages(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<AssistSitePage[]> {
  const host = firestore.collection('hosts').doc(hostId)
  const [hostDoc, screens] = await Promise.all([
    host.get(),
    host
      .collection('screens')
      .select('displayName', 'name', 'slug', 'kind', 'deletedAt')
      .limit(ASSIST_SITE_PAGES_MAX * 3)
      .get(),
  ])
  const routing = (hostDoc.get('screens') ?? {}) as Record<string, unknown>
  const homeId = text(hostDoc.get('defaultHomeScreenId'))
  const pages: AssistSitePage[] = []
  for (const doc of screens.docs) {
    const data = doc.data()
    // A page has no kind; an entry template, an email design and an error
    // body each carry theirs, as the site inventory reads them.
    if (data['deletedAt'] || text(data['kind'])) continue
    const slug = text(data['slug'])
    pages.push({
      id: doc.id,
      name: text(data['displayName']) || text(data['name']) || slug || doc.id,
      slug: slug.startsWith('/') ? slug : `/${slug}`,
      live: typeof routing[doc.id] === 'string',
      home: doc.id === homeId,
    })
  }
  const rank = (page: AssistSitePage) => (page.home ? 0 : page.live ? 1 : 2)
  return pages.sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug)).slice(0, ASSIST_SITE_PAGES_MAX)
}

/**
 * The model's call, held to the site's own pages: a page it named that the
 * site does not have, or a change with nothing in it, proposes nothing.
 */
export function resolveAssistPageChange(
  input: Record<string, unknown> | null,
  scope: { hostId: string; pages: readonly AssistSitePage[] },
): AssistPageChangeProposal | null {
  if (!input) return null
  const page = scope.pages.find((one) => one.id === text(input['page']))
  if (!page) return null
  const change = assistBuildBriefWithoutGaps(text(input['change']))
  if (!change) return null
  const summary = text(input['summary'])
  return {
    id: ASSIST_PAGE_CHANGE_ACTION_ID,
    hostId: scope.hostId,
    pageId: page.id,
    pageName: page.name,
    brief: change.slice(0, AI_JOB_BRIEF_MAX_CHARS),
    summary: (summary || `Change ${page.name}`).slice(0, ASSIST_PAGE_CHANGE_SUMMARY_MAX_CHARS),
    ...(input['newVersion'] === true ? { newVersion: true } : {}),
  }
}
