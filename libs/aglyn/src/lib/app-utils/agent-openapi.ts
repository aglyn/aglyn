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

/** A JSON-Schema-shaped object; loose on purpose — this is a document, not a type. */
type Schema = Record<string, unknown>

/** `text/markdown`, per RFC 7763. */
const MARKDOWN = 'text/markdown'

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
            content: { 'application/json': { schema: { type: 'object' } } },
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
            content: { 'application/manifest+json': { schema: { type: 'object' } } },
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
              'Which site to describe: its custom domain, its ' +
              '`{subdomain}.aglyn.app` address, or its bare subdomain. ' +
              "Defaults to the domain the request was sent to, so an agent " +
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
          'the previous response’s `nextPageToken`; an empty token means the ' +
          'last page.',
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
            name: 'nextPageToken',
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
                        nextPageToken: {
                          type: 'string',
                          description:
                            'Cursor for the next request; empty on the last page.',
                        },
                      },
                      required: ['screens', 'nextPageToken'],
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
    version: options.version || '1.0.0',
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
      `or [/sitemap.xml](${origin}/sitemap.xml) for every indexable URL.`,
    ...(options.contactEmail
      ? { contact: { name: options.siteName, email: options.contactEmail } }
      : {}),
    ...(options.termsOfServiceUrl ? { termsOfService: options.termsOfServiceUrl } : {}),
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
    },
  }
}
