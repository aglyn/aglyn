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

import type {
  MatchKeySpec,
  TransferAliasDictionary,
  TransferCatalogInput,
} from '@aglyn/aglyn/data-transfer'
import { REDIRECT_KINDS } from '../model/redirects'

/**
 * What the redirects resource is made of, without reading anything: its key,
 * its fields, the keys a row finds its rule by and other products' header
 * spellings. Light on purpose — the console's boot registers the resource
 * with these, and only an import or an export loads the module that reads
 * and writes (`redirects-transfer.ts`).
 */

/** The resource key declared in `plugins.config.json` (`transferResources`). */
export const REDIRECTS_TRANSFER_KEY = 'redirects'

/** The kind `/api/hosts/resources` creates a rule as, and whose declaration holds its allow-list. */
export const REDIRECT_HOST_RESOURCE_KIND = 'redirect'

/** The rule's match mode, as stored. */
export type RedirectKind = (typeof REDIRECT_KINDS)[number]

/** Field ids, as the catalog, the plan and the export name them. */
export const REDIRECT_FIELD = {
  source: 'source',
  kind: 'kind',
  destination: 'destination',
  statusCode: 'statusCode',
  priority: 'priority',
  enabled: 'enabled',
  approvedBy: 'externalDestinationApprovedBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdBy: 'createdBy',
  lastHitAt: 'lastHitAt',
  hits: 'hits30d',
} as const

/** The fields a file may write: the rule's own six, the create route's allow-list. */
export const REDIRECT_WRITABLE_FIELDS = [
  REDIRECT_FIELD.source,
  REDIRECT_FIELD.destination,
  REDIRECT_FIELD.statusCode,
  REDIRECT_FIELD.kind,
  REDIRECT_FIELD.priority,
  REDIRECT_FIELD.enabled,
] as const

/**
 * The keys a row finds its rule by: the Aglyn ID, then the path it redirects
 * from. The core folds the from-path only by trimming it; the lookup and the
 * plan read it the way the redirects page stores it (lowercase, no trailing
 * slash, no query) and within its match mode, so `/Old-Page/` finds the exact
 * rule for `/old-page` and not the prefix rule beside it.
 */
export const REDIRECTS_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
  { fieldId: REDIRECT_FIELD.source, normalizer: 'trim' },
]

const GROUPS = [
  { id: 'rule', label: 'Rule' },
  { id: 'usage', label: 'Usage' },
]

/** The field catalog: the rule, its usage, and what the platform stamps on it. */
export function redirectsTransferCatalog(): TransferCatalogInput {
  return {
    groups: GROUPS,
    standard: [
      {
        id: REDIRECT_FIELD.source,
        label: 'From path',
        group: 'rule',
        type: 'text',
        required: true,
        matchKey: true,
        description:
          'The path visitors arrive at, like /old-page; for a regex rule, the pattern.',
        aliases: ['from', 'source', 'source path', 'from url', 'old path', 'old url', 'redirect from', 'origin', 'pattern'],
      },
      {
        id: REDIRECT_FIELD.kind,
        label: 'Kind',
        group: 'rule',
        type: 'text',
        description: 'exact, prefix or regex; exact when blank.',
        aliases: ['match', 'match mode', 'match type', 'kind', 'mode', 'regex'],
      },
      {
        id: REDIRECT_FIELD.destination,
        label: 'To',
        group: 'rule',
        type: 'text',
        required: true,
        description: 'A path on this site, like /new-page, or an https:// address.',
        aliases: ['to', 'destination', 'target', 'to url', 'new path', 'new url', 'redirect to', 'redirect url'],
      },
      {
        id: REDIRECT_FIELD.statusCode,
        label: 'Status code',
        group: 'rule',
        type: 'integer',
        description: '301, 302, 307 or 308; 302 when blank.',
        aliases: ['status', 'status code', 'code', 'http code', 'http status', 'type', 'redirect type'],
      },
      {
        id: REDIRECT_FIELD.priority,
        label: 'Priority',
        group: 'rule',
        type: 'integer',
        description: 'Lower fires first when several rules match; 100 when blank.',
        aliases: ['order', 'position'],
      },
      {
        id: REDIRECT_FIELD.enabled,
        label: 'Enabled',
        group: 'rule',
        type: 'boolean',
        description: 'Whether the rule is on; on when blank.',
        aliases: ['active', 'on', 'enabled'],
      },
    ],
    derived: [
      {
        id: REDIRECT_FIELD.hits,
        label: 'Hits in the last 30 days',
        group: 'usage',
        type: 'integer',
        readOnly: true,
        description: 'Sampled: one per cache window with traffic.',
      },
    ],
    system: [
      {
        id: REDIRECT_FIELD.approvedBy,
        label: 'Off-site destination approved by',
        type: 'text',
        readOnly: true,
        description:
          'Who confirmed an off-site destination. Importing one approves it in your name; it is never read from a file.',
      },
      { id: REDIRECT_FIELD.lastHitAt, label: 'Last hit', group: 'usage', type: 'datetime', readOnly: true },
      { id: REDIRECT_FIELD.createdAt, label: 'Created', type: 'datetime', readOnly: true },
      { id: REDIRECT_FIELD.updatedAt, label: 'Updated', type: 'datetime', readOnly: true },
      { id: REDIRECT_FIELD.createdBy, label: 'Created by', type: 'text', readOnly: true },
    ],
  }
}

/**
 * Other products' redirect exports, by their own header spellings, so their
 * files map without a person matching columns by hand.
 */
export const REDIRECTS_ALIAS_DICTIONARIES: readonly TransferAliasDictionary[] = [
  {
    source: 'Shopify URL redirects',
    aliases: {
      [REDIRECT_FIELD.source]: ['Redirect from'],
      [REDIRECT_FIELD.destination]: ['Redirect to'],
    },
  },
  {
    source: 'WordPress Redirection',
    aliases: {
      [REDIRECT_FIELD.source]: ['source'],
      [REDIRECT_FIELD.destination]: ['target'],
      [REDIRECT_FIELD.statusCode]: ['code'],
      [REDIRECT_FIELD.kind]: ['regex'],
    },
  },
  {
    source: 'Yoast SEO redirects',
    aliases: {
      [REDIRECT_FIELD.source]: ['Origin'],
      [REDIRECT_FIELD.destination]: ['Target'],
      [REDIRECT_FIELD.statusCode]: ['Type'],
      [REDIRECT_FIELD.kind]: ['Format'],
    },
  },
  {
    source: 'Wix URL redirects',
    aliases: {
      [REDIRECT_FIELD.source]: ['Old URL'],
      [REDIRECT_FIELD.destination]: ['New URL'],
    },
  },
  {
    source: 'Webflow 301 redirects',
    aliases: {
      [REDIRECT_FIELD.source]: ['Old path'],
      [REDIRECT_FIELD.destination]: ['Redirect to path'],
    },
  },
  {
    source: 'Spreadsheet',
    aliases: {
      [REDIRECT_FIELD.source]: ['Source', 'From', 'Old'],
      [REDIRECT_FIELD.destination]: ['Destination', 'Target', 'To', 'New'],
      [REDIRECT_FIELD.statusCode]: ['Status', 'Type', 'HTTP status code'],
    },
  },
]

/**
 * The spellings a file's Kind cell may take, read to the stored mode. Covers
 * the console's own labels ("Path prefix"), the words other products use,
 * and a yes/no "regex" column (the WordPress Redirection export's).
 * Yoast's Format column says `plain` or `regex`.
 */
const KIND_SPELLINGS: Readonly<Record<string, RedirectKind>> = {
  exact: 'exact',
  'exact path': 'exact',
  'exact match': 'exact',
  plain: 'exact',
  path: 'exact',
  page: 'exact',
  '0': 'exact',
  no: 'exact',
  false: 'exact',
  prefix: 'prefix',
  'path prefix': 'prefix',
  'starts with': 'prefix',
  folder: 'prefix',
  directory: 'prefix',
  regex: 'regex',
  regexp: 'regex',
  'regular expression': 'regex',
  pattern: 'regex',
  '1': 'regex',
  yes: 'regex',
  true: 'regex',
}

/** A Kind cell as the stored mode, or `null` when it names none. */
export function canonicalRedirectKind(value: unknown): RedirectKind | null {
  if (typeof value === 'boolean') return value ? 'regex' : 'exact'
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return KIND_SPELLINGS[text] ?? null
}
