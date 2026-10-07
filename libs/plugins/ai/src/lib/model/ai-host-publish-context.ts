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

import { liveCustomDomain, TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import type { AiInsightTable } from './ai-insight'

/**
 * Whether a site is published and where, read off its host document — the
 * facts an AI job must be told rather than left to infer. Pure: no read, so
 * every job that already holds the host can use it, and the site inventory
 * every AI job will get (AGL-3661) absorbs it rather than duplicating it.
 */
export interface AiHostPublishContext {
  /** At least one page a visitor can open. */
  published: boolean
  /** The address visitors use: a custom domain only once it serves, else the platform subdomain. */
  liveUrl: string | null
  /** The published pages' paths, `/` first. */
  publishedPages: string[]
  /** When the first page went live, in ms, when the screens passed say so. */
  firstPublishedAt: number | null
}

const millis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * `host.screens` is the routing map publishing writes — screen id to path —
 * so its entries are exactly the pages a visitor can reach. `screens`, when a
 * caller has the page documents, adds when the first one went live.
 */
export function aiHostPublishContext(
  host: Record<string, unknown> | null | undefined,
  screens?: ReadonlyArray<{ publishedAt?: unknown; deletedAt?: unknown }>,
): AiHostPublishContext {
  const routes = host?.['screens']
  const paths =
    routes && typeof routes === 'object'
      ? [...new Set(Object.values(routes as Record<string, unknown>).filter((path): path is string => typeof path === 'string' && path.startsWith('/')))]
      : []
  paths.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)))
  const domain = host ? liveCustomDomain(host as Parameters<typeof liveCustomDomain>[0]) : undefined
  const subdomain = typeof host?.['subdomain'] === 'string' ? (host['subdomain'] as string) : ''
  const liveUrl = domain ? `https://${domain}` : subdomain ? `https://${subdomain}.${TENANT_APEX}` : null
  const firsts = (screens ?? [])
    .filter((screen) => !screen.deletedAt)
    .map((screen) => millis(screen.publishedAt))
    .filter((ms): ms is number => ms !== null)
  return {
    published: paths.length > 0,
    liveUrl,
    publishedPages: paths,
    firstPublishedAt: firsts.length ? Math.min(...firsts) : null,
  }
}

/** The reader id the site-status table carries. Code writes it; the model never chooses it. */
export const AI_SITE_STATUS_READER = 'site.status'

/** At most this many paths are named; the rest are counted after them. */
const SITE_STATUS_MAX_PAGES = 12

/**
 * The site's publish state as a table an insight can cite (AGL-2915's trace
 * holds it like any other). Without it, a question about launch was answered
 * from traffic alone, and "no views yet" was read as "not live" for a site
 * that had been live for a minute.
 */
export function aiSiteStatusTable(context: AiHostPublishContext, ref: string): AiInsightTable {
  const pages = context.publishedPages.slice(0, SITE_STATUS_MAX_PAGES)
  const more = context.publishedPages.length - pages.length
  return {
    ref,
    reader: AI_SITE_STATUS_READER,
    days: 0,
    scope: 'site',
    title: 'Site status',
    source: { label: 'Pages', path: 'screens' },
    period: null,
    columns: [
      { key: 'figure', label: 'Figure', kind: 'text' },
      { key: 'value', label: 'Now', kind: 'text' },
    ],
    rows: [
      { figure: 'Published', value: context.published ? 'Yes: visitors can open the site now' : 'No: no page is published yet' },
      { figure: 'Address', value: context.liveUrl ?? 'None yet' },
      {
        figure: 'Published pages',
        value: pages.length ? `${pages.join(', ')}${more > 0 ? `, and ${more} more` : ''}` : 'None',
      },
    ],
    omitted: 0,
    notes: [
      'Page views count visits, not whether the site is up: a published site with no views yet is still live.',
    ],
  }
}
