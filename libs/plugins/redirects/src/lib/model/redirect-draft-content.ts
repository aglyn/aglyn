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
  REDIRECT_KINDS,
  REDIRECT_STATUS_CODES,
  normalizeRedirectDestination,
  normalizeRedirectSource,
  validateRedirectRule,
} from './redirects'

/**
 * A REDIRECT RULE CHANGE ANOTHER PLUGIN ASKS FOR (AGL-3745): the content the
 * `redirect` writer takes on the core's resource-drafts seam, and its pure
 * check. Pure and light, so the console's boot answers `check` without the
 * Admin SDK; the writer (`server/redirect-ai-writer.ts`) reads it again and
 * makes every check that needs the site.
 *
 * One change per item, named by `action`:
 *
 *  - `create` a rule from `source` to `destination`, with the page's
 *    defaults where a field is not given: exact, 302, priority 100, on;
 *  - `update` the live rule at `source` (of `kind`, when the site has rules
 *    of two modes at that path): any of `newSource`, `destination`,
 *    `statusCode`, `priority`, `enabled`;
 *  - `remove` the live rule at `source`, as the page's Delete does.
 *
 * Only the rule's own fields (`HostRedirect`) are read, plus
 * `replacesLivePage`: a from-path the site publishes a page at is refused
 * unless the person asked for that page to be redirected. The provenance
 * stamp on an off-site destination is never content: the writer stamps the
 * member the change is made for.
 */

/** The resource the writer is registered under: the create route's kind. */
export const REDIRECT_DRAFT_RESOURCE = 'redirect'

export const REDIRECT_DRAFT_ACTIONS = ['create', 'update', 'remove'] as const
export type RedirectDraftAction = (typeof REDIRECT_DRAFT_ACTIONS)[number]

/** The longest from-path the source normalizer keeps. */
export const REDIRECT_DRAFT_SOURCE_MAX = 500
/** The longest destination the destination normalizer keeps. */
export const REDIRECT_DRAFT_DESTINATION_MAX = 1000

/** The content, read. Fields the item did not give are absent. */
export interface RedirectDraftContent {
  action: RedirectDraftAction
  source: string
  kind?: (typeof REDIRECT_KINDS)[number]
  destination?: string
  newSource?: string
  statusCode?: (typeof REDIRECT_STATUS_CODES)[number]
  priority?: number
  enabled?: boolean
  replacesLivePage?: boolean
}

export type RedirectDraftContentRead =
  | { ok: true; value: RedirectDraftContent }
  | { ok: false; problems: string[] }

const KEYS = new Set([
  'action',
  'source',
  'kind',
  'destination',
  'newSource',
  'statusCode',
  'priority',
  'enabled',
  'replacesLivePage',
])

/** The fields an update may change, and a remove may not carry. */
const CHANGES = ['newSource', 'destination', 'statusCode', 'priority', 'enabled'] as const

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/** A status code as a number: a build's arguments carry it as text. */
function statusCodeOf(value: unknown): number | null {
  const code = typeof value === 'string' && /^\d{3}$/.test(value.trim()) ? Number(value) : value
  return (REDIRECT_STATUS_CODES as readonly unknown[]).includes(code) ? (code as number) : null
}

/** The content as the writer reads it, or every problem that stops it. Pure. */
export function readRedirectDraftContent(
  content: Readonly<Record<string, unknown>>,
): RedirectDraftContentRead {
  const problems: string[] = []
  for (const key of Object.keys(content)) {
    if (!KEYS.has(key)) problems.push(`"${key}" is not a redirect field`)
  }
  const action = content['action']
  if (!(REDIRECT_DRAFT_ACTIONS as readonly unknown[]).includes(action)) {
    problems.push('Say whether the redirect is created, updated or removed')
  }
  const source = typeof content['source'] === 'string' ? content['source'].trim() : ''
  if (!source) problems.push('Enter a site path like /old-page')
  const value: RedirectDraftContent = { action: action as RedirectDraftAction, source }

  if (given(content['kind'])) {
    if ((REDIRECT_KINDS as readonly unknown[]).includes(content['kind'])) {
      value.kind = content['kind'] as RedirectDraftContent['kind']
    } else problems.push('Unknown match mode')
  }
  for (const key of ['destination', 'newSource'] as const) {
    if (!given(content[key])) continue
    if (typeof content[key] === 'string') value[key] = (content[key] as string).trim()
    else problems.push(`"${key}" is text`)
  }
  if (given(content['statusCode'])) {
    const code = statusCodeOf(content['statusCode'])
    if (code === null) problems.push('Status codes are 301, 302, 307 or 308')
    else value.statusCode = code as RedirectDraftContent['statusCode']
  }
  if (given(content['priority'])) {
    const priority = content['priority']
    if (typeof priority === 'number' && Number.isInteger(priority)) value.priority = priority
    else problems.push('The priority is a whole number')
  }
  for (const key of ['enabled', 'replacesLivePage'] as const) {
    if (content[key] === undefined || content[key] === null) continue
    if (typeof content[key] === 'boolean') value[key] = content[key] as boolean
    else problems.push(`"${key}" is true or false`)
  }

  if (value.action === 'create') {
    if (!value.destination) problems.push('Destinations are internal paths or https:// URLs')
    if (value.newSource !== undefined) problems.push('A new redirect has no "newSource": its from-path is "source"')
  } else if (value.action === 'update') {
    if (!CHANGES.some((key) => value[key] !== undefined)) {
      problems.push('Say what changes: the from-path, the destination, the status code, the priority or whether it is on')
    }
  } else if (value.action === 'remove') {
    if (CHANGES.some((key) => value[key] !== undefined)) {
      problems.push('Removing a redirect names only its from-path and, where needed, its match mode')
    }
  }

  // The page's own rules on what the content gives: a path or pattern the
  // matcher can use, and a destination it can serve that wears no other
  // company's address. The site's own domains are the writer's to add.
  const kind = value.kind ?? 'exact'
  if (source && kind !== 'regex' && !normalizeRedirectSource(source)) {
    problems.push('Enter a site path like /old-page')
  }
  const written = value.action === 'create' ? source : value.newSource
  if (written) {
    const problem = validateRedirectRule({ kind, source: written, destination: '/' })
    if (problem) problems.push(problem)
  }
  if (value.destination) {
    const problem = normalizeRedirectDestination(value.destination)
      ? validateRedirectRule({ kind: 'exact', source: '/', destination: value.destination })
      : 'Destinations are internal paths or https:// URLs'
    if (problem) problems.push(problem)
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  return { ok: true, value }
}

/**
 * The seam's `check`: whether the content is a change the writer would try,
 * with what it says about it. Pure. A change is live once written.
 */
export function checkRedirectDraftContent(
  content: Readonly<Record<string, unknown>>,
): { ok: true; facts: Readonly<Record<string, unknown>> } | { ok: false; problems: string[] } {
  const read = readRedirectDraftContent(content)
  if (read.ok === false) return read
  const { action, source, destination, kind } = read.value
  return {
    ok: true,
    facts: { action, source, ...(destination ? { destination } : {}), kind: kind ?? 'exact', live: true },
  }
}
