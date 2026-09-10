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
 * `/openapi.json` for a tenant site (AGL-2716) — the machine-readable
 * description of what a site serves, per host.
 *
 * ## Why this is generated and not a checked-in file
 *
 * The document is a function of the SITE: its name, its origin, the content
 * collections it publishes. A static file would describe one site, and every
 * other host on the platform would publish a spec naming somebody else's
 * domain in `servers[]` — which is worse than no spec, because a client that
 * trusts it makes requests to the wrong origin.
 *
 * ## Read-only, deliberately
 *
 * Only GET operations are described. The tenant does serve writes — form
 * submissions, membership, consent — and each is reachable, rate-limited and
 * public, so listing them would be truthful. It would also be an invitation:
 * a spec is a list of things to call, an agent that reads one calls them, and
 * "submit this form" is not an operation a site owner asked to publish to
 * every crawler on the internet. Writes stay discoverable the way they always
 * were, from the page that carries the form.
 *
 * That decision belongs in the document, not just in this comment, so the
 * `description` says so — a reader who needs a write endpoint is told where to
 * look rather than left assuming none exists.
 *
 * ## Shaped for function calling
 *
 * Every operation carries a unique `operationId`, a `summary`, a `description`
 * and typed parameters, and every response names a schema. That is exactly the
 * subset an LLM tool-calling bridge reads when it turns a spec into callable
 * functions — a missing `operationId` becomes a generated name nobody can
 * predict, and a missing parameter type becomes a string the model guesses at.
 *
 * OpenAPI **3.1.0** rather than 3.0: 3.1 aligns its schema dialect with JSON
 * Schema 2020-12, which is the dialect the function-calling formats already
 * speak, so a bridge converts without a lossy pass.
 */

/** A content collection the site publishes, as the feed operation names it. */
export interface AgentOpenApiCollection {
  slug: string
  name?: string
}

export interface AgentOpenApiOptions {
  /** The site's name, for `info.title`. */
  siteName: string
  /** Absolute origin, no trailing slash — the single `servers[]` entry. */
  origin: string
  /** The site's own description, for `info.description`. */
  description?: string
  /** Published content collections, for the feed operation's enum. */
  collections?: readonly AgentOpenApiCollection[]
  /** Whether the site serves `/search`. */
  hasSearch?: boolean
  /** Platform version, so a consumer can tell two documents apart. */
  version?: string
  /** Contact email published in `info.contact`, when the site has one. */
  contactEmail?: string
  /** Absolute URL of the site's terms, when it publishes any. */
  termsOfServiceUrl?: string
}

import { API_CATALOG_MEDIA_TYPE } from './agent-api-catalog'

/** A JSON-Schema-shaped object; loose on purpose — this is a document, not a type. */
type Schema = Record<string, unknown>

/** `text/markdown`, per RFC 7763. */
const MARKDOWN = 'text/markdown'

/**
 * The header that carries the API version, in both directions (AGL-2722).
 *
 * A header and not a URL segment, because most of this surface sits at a
 * location some other specification fixed — `/openapi.json`, `/robots.txt`,
 * `/llms.txt`, `/sitemap.xml`, `/manifest.webmanifest`. `/v1/robots.txt` is
 * not a robots.txt: the crawler that needs it looks at the root and nowhere
 * else. Versioning only the `/api/*` half would leave one surface running two
 * rules, which is worse than either rule alone.
 */
export const API_VERSION_HEADER = 'Aglyn-API-Version'

/**
 * The version this description and these responses are.
 *
 * ⚠️ Independent of the platform's release version, and deliberately so. The
 * platform ships several times a day; this shape is a promise to strangers and
 * moves only when the promise does. Bump it when a field is removed or
 * renamed, or when an operation narrows what it accepts — never for an
 * addition, which is why a consumer is told to parse leniently.
 */
export const API_VERSION = '1.0.0'

/**
 * The RFC 9331 headers, and the 429, for the two operations that actually
 * meter (AGL-2722).
 *
 * Declared on those two only, never blanket-applied. `/api/health` is an
 * uptime probe answering from several regions on a schedule — metering it
 * would turn a bookkeeping limit into a false outage — and the static files
 * are served from the edge cache without ever reaching a counter. A header
 * describing a limit that is not enforced is worse than no header, because a
 * caller paces against it.
 */
const RATE_LIMIT_HEADERS: Schema = {
  'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
  'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
  'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
}

const TOO_MANY_REQUESTS: Schema = {
  description:
    'The address exceeded its per-minute budget. `Retry-After` names the ' +
    'seconds to wait. Reaching this from ordinary reading would be ' +
    'surprising — the budget is set well above what reading a whole site ' +
    'costs.',
  headers: {
    ...RATE_LIMIT_HEADERS,
    'Retry-After': { $ref: '#/components/headers/RetryAfter' },
  },
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/Error' } },
  },
}

/**
 * The `Accept` parameter, declared once and referenced by every page
 * operation.
 *
 * A header parameter rather than prose, because it is the ONLY way a client
 * discovers the Markdown representation from the document alone — and a
 * function-calling bridge that reads this turns it into an argument the model
 * can set, which is the whole point of publishing it.
 */
const ACCEPT_PARAMETER: Schema = {
  name: 'Accept',
  in: 'header',
  required: false,
  description:
    'Content negotiation, per RFC 9110. `text/markdown` returns a clean ' +
    'Markdown rendering of the page with the navigation, styling and scripts ' +
    'removed; anything else returns HTML. Quality values are honored, and a ' +
    'request that accepts neither representation is answered `406`. ' +
    'Responses carry `Vary: Accept`.',
  schema: {
    type: 'string',
    enum: ['text/html', MARKDOWN],
    default: 'text/html',
  },
}

/** Error envelope shared by the JSON operations. */
const ERROR_SCHEMA: Schema = {
  type: 'object',
  description: 'The error envelope every JSON endpoint on this site returns.',
  properties: {
    status: { type: 'string', enum: ['error'], description: 'Always `error`.' },
    statusMessage: { type: 'string', description: 'Human-readable reason.' },
    errorCode: { type: 'string', description: 'Stable machine-readable code.' },
  },
  required: ['status'],
}

/** The `seo` block both the site and page schemas carry. */
const SEO_SCHEMA: Schema = {
  type: 'object',
  description: 'Search and social metadata.',
  properties: {
    title: { type: 'string', description: 'Title used in the page head.' },
    description: { type: 'string', description: 'Meta description.' },
    image: { type: 'string', description: 'Social card image reference.' },
    imageWidth: { type: 'integer', description: 'Social card width in pixels.' },
    imageHeight: { type: 'integer', description: 'Social card height in pixels.' },
    imageAlt: {
      type: 'string',
      description: 'Alternative text for the social card image.',
    },
  },
}

/** Build the OpenAPI 3.1 document for one site. */
export function buildAgentOpenApi(options: AgentOpenApiOptions): Schema {
  const origin = options.origin.replace(/\/+$/, '')
  const collections = options.collections ?? []
  const collectionSlugs = collections.map((collection) => collection.slug)

  const paths: Schema = {
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiDocument',
        summary: 'This document',
        description:
          'The OpenAPI 3.1 description of everything this site serves. ' +
          'Generated per site, so `servers[0].url` always names this origin.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'The OpenAPI document.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OpenApiDocument' },
              },
            },
          },
        },
      },
    },
    '/.well-known/api-catalog': {
      get: {
        operationId: 'getApiCatalog',
        summary: 'API catalog',
        description:
          'Every API that answers for this site, as an RFC 9727 catalog in ' +
          'RFC 9264 linkset form. Two of them exist and they are not ' +
          'interchangeable: this site’s own API, described by the document ' +
          'you are reading, is anonymous and read-only; the platform API it ' +
          'names is keyed, typed and writes. Each entry carries the API’s ' +
          '`service-desc` (its OpenAPI description), `service-doc` and, where ' +
          'there is one, `status`.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'The catalog.',
            content: {
              [API_CATALOG_MEDIA_TYPE]: {
                schema: { $ref: '#/components/schemas/ApiCatalog' },
              },
            },
          },
        },
      },
    },
    '/llms.txt': {
      get: {
        operationId: 'getAgentGuidance',
        summary: 'Agent guidance (llms.txt)',
        description:
          'What this site is for, when an agent should reach for it, and the ' +
          'entry points that lead to everything else. Follows the ' +
          'llmstxt.org format: an H1 name, a summary blockquote, and ' +
          'H2-delimited link lists.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'The guidance file.',
            content: { [MARKDOWN]: { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/robots.txt': {
      get: {
        operationId: 'getRobotsTxt',
        summary: 'Crawler policy',
        description:
          'The exclusion rules this site asks crawlers to honor, and the ' +
          'address of its sitemap index.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'The robots policy.',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/sitemap.xml': {
      get: {
        operationId: 'getSitemapIndex',
        summary: 'Sitemap index',
        description:
          'A sitemap INDEX — it names child sitemaps rather than URLs. Each ' +
          'child lists up to 5,000 URLs with their last-modified dates.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'A `<sitemapindex>` document.',
            content: { 'application/xml': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/manifest.webmanifest': {
      get: {
        operationId: 'getWebAppManifest',
        summary: 'Web app manifest',
        description: "The site's installable web app manifest.",
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'The manifest.',
            content: {
              'application/manifest+json': {
                schema: { $ref: '#/components/schemas/WebAppManifest' },
              },
            },
          },
        },
      },
    },
    '/{path}': {
      get: {
        operationId: 'getPage',
        summary: 'Fetch one page',
        description:
          'Any page on this site, in HTML or Markdown. `path` is the page ' +
          'path without a leading slash — use an empty string for the home ' +
          'page — and MAY contain `/` for a nested page. Two ways to ask for ' +
          'Markdown: send `Accept: text/markdown`, or append `.md` to the ' +
          'path. Enumerate the available paths with `listPublishedPages` or ' +
          'from the sitemap index.',
        tags: ['Content'],
        parameters: [
          {
            name: 'path',
            in: 'path',
            required: true,
            description:
              'Page path without a leading slash, e.g. `pricing` or ' +
              '`blog/hello-world`. May end in `.md` to request Markdown ' +
              'without a content-negotiation header.',
            schema: { type: 'string' },
            example: 'pricing',
          },
          ACCEPT_PARAMETER,
        ],
        responses: {
          '200': {
            description: 'The page.',
            headers: {
              Vary: {
                description:
                  'Includes `Accept`, so a cache cannot serve one ' +
                  'representation in answer to a request for the other.',
                schema: { type: 'string' },
              },
            },
            content: {
              'text/html': { schema: { type: 'string' } },
              [MARKDOWN]: {
                schema: {
                  type: 'string',
                  description:
                    'The page as Markdown: an H1 title, a blockquote ' +
                    'summary, the content region, and a `Source:` line ' +
                    'carrying the canonical URL. Navigation and footer are ' +
                    'omitted.',
                },
              },
            },
          },
          '404': { description: 'No page answers at that path.' },
          '406': {
            description:
              'The request accepts neither `text/html` nor `text/markdown`. ' +
              'The body lists the representations that are available.',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/host': {
      get: {
        operationId: 'getSiteIdentity',
        summary: 'Who publishes this site',
        description:
          "The site's public identity: display name, logo, locales and the " +
          'search/social metadata it defaults to. Anonymous, cacheable, and ' +
          'an allow-listed projection — never the underlying document.',
        tags: ['Site'],
        parameters: [
          {
            name: 'host',
            in: 'query',
            required: false,
            description:
              // NO PLATFORM APEX HERE. This string is published in the
              // OpenAPI document of EVERY site, including a self-hosted
              // operator's — naming Aglyn's own apex would tell their callers
              // to address a domain that is not theirs (the self-host ratchet
              // in `selfhost-hardcoded-hosts.spec.ts` is what caught it).
              'Which site to describe: its custom domain, its platform ' +
              'subdomain address, or its bare subdomain. ' +
              'Defaults to the domain the request was sent to, so an agent ' +
              'talking to one site never needs it.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'The site identity.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['success'] },
                    data: {
                      type: 'object',
                      properties: {
                        host: { $ref: '#/components/schemas/SiteIdentity' },
                      },
                    },
                  },
                  required: ['status'],
                },
              },
            },
          },
          '400': {
            description: 'The site could not be resolved.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/api/screen': {
      get: {
        operationId: 'listPublishedPages',
        summary: 'List published pages',
        description:
          'Every published, indexable page on this site, with its title, ' +
          'description and dates. Gated pages — private, password-protected, ' +
          'members-only and unlisted — are omitted, so this listing never ' +
          'advertises an address a visitor cannot open. Paginate by passing ' +
          'the previous response’s `cursor`; an empty cursor means the last ' +
          'page.',
        tags: ['Content'],
        parameters: [
          {
            name: 'host',
            in: 'query',
            required: false,
            description:
              'Which site to list. Defaults to the domain the request was ' +
              'sent to.',
            schema: { type: 'string' },
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            description:
              'Cursor from the previous response. Omit for the first page.',
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Pages per response.',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'One page of the listing.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['success'] },
                    data: {
                      type: 'object',
                      properties: {
                        screens: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/PublishedPage' },
                        },
                        cursor: {
                          type: 'string',
                          description:
                            'Cursor for the next request; empty on the last page.',
                        },
                      },
                      required: ['screens', 'cursor'],
                    },
                  },
                  required: ['status'],
                },
              },
            },
          },
          '400': {
            description: 'The site could not be resolved.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/api/health': {
      get: {
        operationId: 'getSiteHealth',
        summary: 'Service health',
        description:
          'Whether the site runtime and its datastore are answering. `200` ' +
          'when healthy, `503` when not; the body names which check failed.',
        tags: ['Site'],
        responses: {
          '200': {
            description: 'Healthy.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Health' } },
            },
          },
          '503': {
            description: 'A dependency is unavailable.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Health' } },
            },
          },
        },
      },
    },
  }

  /*
    The feed operation exists only where a feed does. A site with no content
    collection has no `/{slug}/rss.xml` to serve, and publishing the operation
    anyway would put an endpoint in the document that answers 404 — the one
    defect that makes a client distrust the rest of the spec.
  */
  if (collectionSlugs.length > 0) {
    paths['/{collectionSlug}/rss.xml'] = {
      get: {
        operationId: 'getCollectionFeed',
        summary: 'Collection feed',
        description:
          "A content collection's newest entries as RSS 2.0, newest first.",
        tags: ['Content'],
        parameters: [
          {
            name: 'collectionSlug',
            in: 'path',
            required: true,
            description: 'Which collection to read.',
            // An enum rather than a bare string: this site's collections are
            // known here, and a function-calling bridge turns an enum into a
            // constrained argument the model cannot get wrong.
            schema: { type: 'string', enum: collectionSlugs },
            example: collectionSlugs[0],
          },
        ],
        responses: {
          '200': {
            description: 'An RSS 2.0 document.',
            content: { 'application/rss+xml': { schema: { type: 'string' } } },
          },
          '404': { description: 'No collection answers at that slug.' },
        },
      },
    }
  }

  if (options.hasSearch) {
    paths['/search'] = {
      get: {
        operationId: 'searchSite',
        summary: 'Search this site',
        description:
          "Full-text search across this site's published pages and content " +
          'entries. HTML only — unlike every other page here, the results are ' +
          'computed in the browser, so a Markdown variant would be a heading ' +
          'with no results under it. To read the matches as Markdown, follow ' +
          'the result links and fetch each page with `Accept: text/markdown`.',
        tags: ['Content'],
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            description: 'The query.',
            schema: { type: 'string', minLength: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'The results page.',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
        },
      },
    }
  }

  const info: Schema = {
    title: `${options.siteName} — public API`,
    /*
      The CONTRACT version, not the build. `info.version` carrying the platform
      release meant it changed several times a day, so a consumer reading it as
      "the shape I was built against" was tracking deploy noise and had nothing
      to pin. The build identifier keeps its purpose — telling two documents
      apart — under its own key.
    */
    version: API_VERSION,
    ...(options.version ? { 'x-aglyn-platform-version': options.version } : {}),
    summary: `Everything ${options.siteName} publishes for machine consumption.`,
    description:
      `The read-only surface of ${options.siteName}. Every operation is ` +
      'anonymous — no key, no session — and every page can be fetched as ' +
      'Markdown instead of HTML by sending `Accept: text/markdown` or by ' +
      'appending `.md` to its path.\n\n' +
      'Write endpoints are deliberately not described here. This site does ' +
      'accept form submissions and account actions, but those belong to the ' +
      'page that carries them rather than to a spec published to every ' +
      'crawler; follow the form on the relevant page.\n\n' +
      `Start at [/llms.txt](${origin}/llms.txt) for what this site is for, ` +
      `or [/sitemap.xml](${origin}/sitemap.xml) for every indexable URL.\n\n` +
      '## Versioning and deprecation\n\n' +
      'This surface is versioned by HEADER, not by URL. Send ' +
      `\`${API_VERSION_HEADER}: ${API_VERSION}\` to pin the shape you were ` +
      'built against; omit it and you get the current version. Every ' +
      `response names the version that served it in the same header.\n\n` +
      'A path version was the alternative and it does not fit this surface: ' +
      'most of what is described here lives at a location some other ' +
      'specification fixed — `/openapi.json`, `/robots.txt`, `/llms.txt`, ' +
      '`/sitemap.xml`, `/manifest.webmanifest`. Moving those under `/v1/` ' +
      'would break the specs that define them, and versioning only the ' +
      '`/api/*` half would leave one surface with two rules.\n\n' +
      'Additive changes — a new operation, a new optional field — ship ' +
      'without a version bump, so parse leniently and ignore what you do ' +
      'not recognise. Anything that removes or renames a field, or narrows ' +
      'what an operation accepts, does bump it.\n\n' +
      'Removal is announced on the responses themselves, not only in a ' +
      'changelog. A deprecated operation answers with `Deprecation` (RFC ' +
      '9745) from the moment it is deprecated, and `Sunset` (RFC 8594) ' +
      'naming the date it stops answering. Both are HTTP dates. An ' +
      'operation that has never carried either is not scheduled for ' +
      'removal.',
    ...(options.contactEmail
      ? { contact: { name: options.siteName, email: options.contactEmail } }
      : {}),
    ...(options.termsOfServiceUrl ? { termsOfService: options.termsOfServiceUrl } : {}),
  }

  /*
    Every response names the version that served it and declares the two
    headers a removal is announced on; every operation accepts the version
    request header. Attached by a walk rather than written into each operation
    by hand — a policy stated in `info` and then missing from an operation is
    not a policy, and eleven hand-copied blocks is exactly how that happens.
  */
  const versionedHeaders: Schema = {
    [API_VERSION_HEADER]: { $ref: '#/components/headers/ApiVersion' },
    Deprecation: { $ref: '#/components/headers/Deprecation' },
    Sunset: { $ref: '#/components/headers/Sunset' },
  }
  /** The paths `publicReadApiGate` actually meters. Kept in step by AGL-2722's spec. */
  const METERED = new Set(['/api/host', '/api/screen'])
  for (const [pathName, pathItem] of Object.entries(paths as Record<string, Schema>)) {
    const metered = METERED.has(pathName)
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== 'object') continue
      const verb = operation as Schema
      const responses = verb.responses as Record<string, Schema> | undefined
      if (!responses) continue
      if (metered && !responses['429']) responses['429'] = { ...TOO_MANY_REQUESTS }
      for (const response of Object.values(responses)) {
        // The operation's own headers win: a walk that overwrote them would
        // silently drop something an operation deliberately said.
        response.headers = {
          ...versionedHeaders,
          ...(metered ? RATE_LIMIT_HEADERS : {}),
          ...((response.headers as Schema) ?? {}),
        }
      }
      verb.parameters = [
        ...((verb.parameters as unknown[]) ?? []),
        { $ref: '#/components/parameters/ApiVersionRequest' },
      ]
    }
  }

  return {
    openapi: '3.1.0',
    // The dialect, stated rather than assumed. It is what tells a consumer the
    // schemas below are JSON Schema 2020-12 and not OpenAPI 3.0's dialect.
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info,
    servers: [{ url: origin, description: options.siteName }],
    tags: [
      {
        name: 'Discovery',
        description: 'Files that describe the site to a machine.',
      },
      { name: 'Content', description: 'The pages and entries the site publishes.' },
      { name: 'Site', description: 'Identity and operational status.' },
    ],
    paths,
    components: {
      schemas: {
        Error: ERROR_SCHEMA,
        ApiCatalog: {
          type: 'object',
          description:
            'An RFC 9264 linkset. Each member of `linkset` is a link ' +
            'CONTEXT keyed by its `anchor`: the first is anchored at the ' +
            'catalog and lists its members under `item`, and each one after ' +
            'it is anchored at a single API and carries that API’s links.',
          required: ['linkset'],
          properties: {
            linkset: {
              type: 'array',
              items: {
                type: 'object',
                required: ['anchor'],
                properties: {
                  anchor: {
                    type: 'string',
                    format: 'uri',
                    description:
                      'What every link in this object is a link FROM.',
                  },
                  item: {
                    type: 'array',
                    description: 'Catalog membership — the APIs listed.',
                    items: { $ref: '#/components/schemas/CatalogLink' },
                  },
                  'service-desc': {
                    type: 'array',
                    description:
                      'Machine-readable description of the anchored API.',
                    items: { $ref: '#/components/schemas/CatalogLink' },
                  },
                  'service-doc': {
                    type: 'array',
                    description: 'Documentation written for a person.',
                    items: { $ref: '#/components/schemas/CatalogLink' },
                  },
                  status: {
                    type: 'array',
                    description: 'Where the anchored API reports its health.',
                    items: { $ref: '#/components/schemas/CatalogLink' },
                  },
                },
              },
            },
          },
        },
        CatalogLink: {
          type: 'object',
          description: 'One link in a linkset.',
          required: ['href'],
          properties: {
            href: { type: 'string', format: 'uri' },
            type: {
              type: 'string',
              description: 'Media type of the target, when it is known.',
            },
            title: { type: 'string', description: 'Human label.' },
          },
        },
        OpenApiDocument: {
          type: 'object',
          description:
            'An OpenAPI 3.1 description — this document. Described rather ' +
            'than left as a bare object so a consumer knows which dialect ' +
            'the schemas inside it use before it fetches them.',
          required: ['openapi', 'info', 'paths'],
          properties: {
            openapi: {
              type: 'string',
              description: 'OpenAPI specification version, e.g. `3.1.0`.',
            },
            jsonSchemaDialect: {
              type: 'string',
              description: 'The JSON Schema dialect the schemas below use.',
            },
            info: {
              type: 'object',
              description: 'Title, version, summary and description.',
            },
            servers: {
              type: 'array',
              description: 'Origins this description applies to.',
              items: { type: 'object' },
            },
            tags: {
              type: 'array',
              description: 'Operation groupings.',
              items: { type: 'object' },
            },
            paths: {
              type: 'object',
              description: 'Every path, keyed by template, each with its verbs.',
            },
            components: {
              type: 'object',
              description: 'Reusable schemas, parameters and headers.',
            },
          },
        },
        WebAppManifest: {
          type: 'object',
          description:
            'A W3C web app manifest. Only the members this site actually ' +
            'emits are described; the specification allows more.',
          properties: {
            name: { type: 'string', description: 'Full name of the site.' },
            short_name: {
              type: 'string',
              description: 'Name used where space is tight.',
            },
            description: { type: 'string', description: 'What the site is.' },
            start_url: {
              type: 'string',
              description: 'Where an installed instance opens.',
            },
            scope: { type: 'string', description: 'URLs the install covers.' },
            display: {
              type: 'string',
              description: 'Preferred display mode, e.g. `standalone`.',
            },
            theme_color: {
              type: 'string',
              description: 'CSS color for the surrounding UI.',
            },
            background_color: {
              type: 'string',
              description: 'CSS color painted before the site renders.',
            },
            icons: {
              type: 'array',
              description: 'Installable icons.',
              items: {
                type: 'object',
                properties: {
                  src: { type: 'string' },
                  sizes: { type: 'string' },
                  type: { type: 'string' },
                  purpose: { type: 'string' },
                },
              },
            },
          },
        },
        SiteIdentity: {
          type: 'object',
          description: "A site's public identity.",
          properties: {
            $id: { type: 'string', description: 'Stable site identifier.' },
            displayName: { type: 'string', description: 'Human-readable name.' },
            logoUrl: { type: 'string', description: "The site's logo." },
            subdomain: {
              type: 'string',
              description: 'Platform subdomain, without the apex.',
            },
            cname: { type: 'string', description: 'Custom domain, when set.' },
            locales: {
              type: 'array',
              items: { type: 'string' },
              description: 'BCP-47 locales this site publishes.',
            },
            defaultLocale: { type: 'string', description: 'The default locale.' },
            seo: SEO_SCHEMA,
          },
        },
        PublishedPage: {
          type: 'object',
          description: 'One published, indexable page.',
          properties: {
            $id: { type: 'string', description: 'Stable page identifier.' },
            slug: { type: 'string', description: 'The page’s own path segment.' },
            parentId: {
              type: 'string',
              description: 'Parent page, for a nested page.',
            },
            order: { type: 'integer', description: 'Sort order among siblings.' },
            displayName: { type: 'string', description: 'The page’s name.' },
            description: { type: 'string', description: 'Author’s summary.' },
            locale: { type: 'string', description: 'BCP-47 locale.' },
            publishedAt: {
              type: 'string',
              format: 'date-time',
              description: 'When this page was last published.',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'When this page was last saved.',
            },
            seo: SEO_SCHEMA,
          },
          required: ['$id'],
        },
        Health: {
          type: 'object',
          description: 'Service health.',
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'degraded', 'down'],
              description: 'Overall verdict.',
            },
            service: { type: 'string', description: 'Which service answered.' },
            version: { type: 'string', description: 'Platform version.' },
            environment: { type: 'string', description: 'Deployment environment.' },
            checks: {
              type: 'object',
              description: 'Per-dependency results.',
              additionalProperties: { type: 'object' },
            },
          },
          required: ['status'],
        },
      },
      headers: {
        ApiVersion: {
          description:
            'The API version that produced this response. Compare it with ' +
            'the version you were built against; they differ only when ' +
            'something was removed, renamed, or narrowed.',
          schema: { type: 'string', examples: [API_VERSION] },
        },
        Deprecation: {
          description:
            'Present only on a deprecated operation, per RFC 9745: the HTTP ' +
            'date the deprecation took effect. Its absence is meaningful — ' +
            'an operation that has never carried this is not scheduled for ' +
            'removal.',
          schema: { type: 'string' },
        },
        Sunset: {
          description:
            'Present only once a removal date is set, per RFC 8594: the ' +
            'HTTP date after which this operation stops answering. Always ' +
            'accompanied by `Deprecation`.',
          schema: { type: 'string' },
        },
        RateLimitLimit: {
          description:
            'Requests this address may make per window, per RFC 9331.',
          schema: { type: 'integer' },
        },
        RateLimitRemaining: {
          description:
            'Requests left in the current window.\n\n' +
            '⚠️ Counted PER SERVING INSTANCE, not across the deployment. ' +
            'The limit is a backstop set far above ordinary reading, and an ' +
            'exact global counter would cost every request two round trips ' +
            'to enforce a number nobody should reach. Pace against it as a ' +
            'courtesy signal, not as an exact budget.',
          schema: { type: 'integer' },
        },
        RateLimitReset: {
          description:
            'Seconds until the current window resets — a duration, not a ' +
            'timestamp, so a caller uses its own clock rather than trusting ' +
            'ours.',
          schema: { type: 'integer' },
        },
        RetryAfter: {
          description:
            'Seconds to wait before retrying. Sent only with a 429.',
          schema: { type: 'integer' },
        },
      },
      parameters: {
        ApiVersionRequest: {
          name: API_VERSION_HEADER,
          in: 'header',
          required: false,
          description:
            'Pin the response shape to a version you were built against. ' +
            'Omit it to get the current version, which is what most callers ' +
            'want — additive changes never bump it.',
          schema: { type: 'string', examples: [API_VERSION] },
        },
      },
    },
  }
}
