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
 * The OpenAPI 3.1 description of the customer REST API (AGL-2733).
 *
 * `/api/v1` has been a real API since AGL-617 — fourteen resources, around
 * sixty operations, every response JSON — described only in prose. A person
 * could read `/developers`; a client could not. So every integrator hand-wrote
 * types the server already knew, and learned the field names by trial and
 * error.
 *
 * ## Where the shapes come from
 *
 * The resource schemas below are transcribed from the RESPONSE EXAMPLES in
 * `apps/docs/api/resources/*.md`, which are the customer-facing contract. That
 * is deliberate: the handlers project their output field by field, so reading
 * them would describe the implementation, while the docs describe the
 * promise. A plugin that serves a resource describes it the same way, in the
 * data layer's terms (`api-v1-description.ts`), and hands the description to
 * the builder through its registration. Where the two ever
 * disagree the server is right and the difference is a bug in its own right —
 * `api-v1-openapi.spec.ts` pins the documented paths against the dispatcher so
 * a resource cannot be added to one and forgotten in the other.
 *
 * Write bodies are not transcribed. Each lists its handler's own writable set
 * (`writable` on the resource), because a body that disagreed with the handler
 * would tell a generated client to send what the handler refuses.
 *
 * ## Why it is served WITHOUT a key
 *
 * A description of how to authenticate that itself requires authentication is
 * useless at the only moment it is wanted. It carries no customer data — every
 * word of it is already published at `/developers` — so the gate would protect
 * nothing and cost discovery everything.
 */

import { MEDIA_EMBEDDED_GROUP_ORDER } from '@aglyn/aglyn/app-utils/media-embedded-fields'
// The description's shape and its field schemas are the data layer's, where a
// plugin that serves a resource describes it in the same terms.
import {
  type ApiV1ResourceDescription as ResourceSpec,
  booleanField as bool,
  integerField as int,
  nullableField as nullable,
  objectKindField as OBJECT_FIELD,
  RECORD_STAMPS as STAMPS,
  stringField as str,
  stringListField as strList,
} from '@aglyn/tenant-data-admin/server/api-v1-description'

/** A JSON Schema / OpenAPI fragment. Same shape the tenant builder uses. */
type Schema = Record<string, unknown>

/** The API's own version. Independent of the platform release. */
export const CUSTOMER_API_VERSION = 'v1'

/**
 * Where the route is mounted, and therefore the prefix every documented path
 * hangs off (AGL-3094).
 *
 * An OpenAPI URL is `servers[].url` joined to the path, and the paths below
 * are spelled `/v1/…` because that is what they are relative to the API. The
 * mount has to come from `servers`, and for as long as it did not, every one
 * of the 68 operations composed to `https://<origin>/v1/…` — which is a 404.
 * The route answers at `/api/v1/…`, `/api/v1/openapi.json` said so on the line
 * below, and only `servers` disagreed.
 *
 * Exported and shared rather than written twice: a generated client and the
 * document that generated it must not be able to drift about where the API is.
 */
export const CUSTOMER_API_MOUNT = '/api'

/** Where the description is served. */
export const CUSTOMER_API_OPENAPI_PATH = `${CUSTOMER_API_MOUNT}/${CUSTOMER_API_VERSION}/openapi.json`

/** The pagination pair, on every list. */
const LIMIT_PARAM: Schema = {
  name: 'limit',
  in: 'query',
  required: false,
  description:
    'Records per page. Values outside 1–100 are CLAMPED, not rejected: ' +
    '`limit=5000` gives 100, and `limit=0` or `limit=abc` gives the default.',
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
}

const CURSOR_PARAM: Schema = {
  name: 'cursor',
  in: 'query',
  required: false,
  description:
    'Opaque. Pass the previous response’s `next_cursor` back verbatim. Do ' +
    'not construct or parse one — an undecodable cursor is not an error, it ' +
    'returns an arbitrary page, so `has_more` is the only termination signal.',
  schema: { type: 'string' },
}

/**
 * The platform's own resources. A resource a plugin serves is described by
 * the plugin, through its `/v1` registration, and handed to the builder
 * (`served`) after these.
 */
const RESOURCES: readonly ResourceSpec[] = [
  {
    tag: 'Sites',
    description: 'The sites an organization publishes.',
    schemaName: 'Site',
    required: ['id', 'object', 'displayName'],
    fields: {
      id: str('Site id.'),
      object: OBJECT_FIELD('site'),
      displayName: str('Name shown in the console.'),
      subdomain: str('Platform subdomain, without the apex.'),
      domain: nullable(str('Custom domain, when one is attached.')),
    },
    ops: [
      { path: '/v1/sites', method: 'get', operationId: 'listSites', summary: 'List sites', list: true, returns: 'Site' },
      { path: '/v1/sites', method: 'post', operationId: 'createSite', summary: 'Create a site', accepts: 'SiteWrite', returns: 'Site', creates: true, description: 'Limited to 10 per hour per organization, separately from the request budget.' },
      { path: '/v1/sites/{siteId}', method: 'get', operationId: 'getSite', summary: 'Retrieve a site', returns: 'Site', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      {
        path: '/v1/sites/{siteId}/publish', method: 'post', operationId: 'publishSite', summary: 'Publish a site', returns: 'PublishResult',
        description: 'Limited to 10 per site per hour, on top of — not instead of — the per-key limit. Sized to the work: one publish drops up to 250 cached pages, so minting extra keys does not raise it.',
        pathParams: [{ name: 'siteId', description: 'Site id.' }],
      },
    ],
  },
  {
    tag: 'Media',
    description: 'The organization library, and a site’s own files.',
    schemaName: 'MediaAsset',
    required: ['id', 'object', 'fileName', 'url'],
    fields: {
      id: str('Asset id.'),
      object: OBJECT_FIELD('media'),
      fileName: str('Original file name.'),
      contentType: str('MIME type.'),
      sizeBytes: int('Size in bytes.'),
      width: nullable(int('Pixel width, for images.')),
      height: nullable(int('Pixel height, for images.')),
      alt: nullable(str('Alt text.')),
      description: nullable(str('Long description.')),
      tags: strList('Free-form tags.'),
      folderId: nullable(str('Folder the asset sits in.')),
      url: str('Canonical URL.'),
      cdnUrl: str('CDN URL. Prefer this for delivery.'),
      private: bool('Whether the asset requires a signed URL.'),
      customMetadata: {
        type: 'object',
        description: 'Custom fields set in the library, name to value. Empty when there are none.',
        additionalProperties: { type: 'string' },
      },
      embeddedMetadata: nullable({
        type: 'object',
        description:
          'What the file carries inside itself: EXIF, IPTC and XMP on photos, a PDF’s document info, Office document properties, video tags. Null until the file has been read.',
        required: ['format', 'truncated', 'fields'],
        properties: {
          format: str('The file format the details were read from, e.g. `jpeg`, `pdf`, `mp4`.'),
          truncated: bool('True when fields were left out to stay inside the stored limits.'),
          fields: {
            type: 'array',
            description: 'Every detail found, grouped the way the library shows them.',
            items: {
              type: 'object',
              required: ['key', 'label', 'group', 'value', 'values'],
              properties: {
                key: str('Stable key: `title`, `creator`, `gps`… or a namespaced key for anything else the file carries.'),
                label: str('The name to show a person.'),
                group: {
                  type: 'string',
                  description: 'Which section the field belongs to.',
                  enum: [...MEDIA_EMBEDDED_GROUP_ORDER],
                },
                value: nullable(str('The value of a single-valued field; null for a list.')),
                values: nullable(strList('The items of a list-valued field, such as keywords; null otherwise.')),
              },
            },
          },
        },
      }),
      created: STAMPS.created,
    },
    ops: [
      { path: '/v1/media', method: 'get', operationId: 'listOrgMedia', summary: 'List organization media', list: true, returns: 'MediaAsset', description: 'Rows deleted since they were written are dropped after the read, so pages can come back short.' },
      { path: '/v1/media', method: 'post', operationId: 'uploadOrgMedia', summary: 'Upload to the organization library', accepts: 'MediaUpload', returns: 'MediaAsset', creates: true },
      { path: '/v1/media/{mediaId}', method: 'get', operationId: 'getOrgMedia', summary: 'Retrieve an asset', returns: 'MediaAsset', pathParams: [{ name: 'mediaId', description: 'Asset id.' }] },
      { path: '/v1/sites/{siteId}/media', method: 'get', operationId: 'listSiteMedia', summary: 'List a site’s media', list: true, returns: 'MediaAsset', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      { path: '/v1/sites/{siteId}/media', method: 'post', operationId: 'uploadSiteMedia', summary: 'Upload to a site', accepts: 'MediaUpload', returns: 'MediaAsset', creates: true, pathParams: [{ name: 'siteId', description: 'Site id.' }] },
    ],
  },
]

/**
 * The write shape for a resource: exactly the members its handler accepts.
 *
 * It closes, because every handler with a body built here names an unknown key
 * in a `400` (`refuseUnknownKeys` and its equivalents), so a typo'd member is a
 * refusal rather than a value that vanishes. A body whose handler ignores an
 * unknown member instead is declared by name further down, open, and says so.
 */
function writeSchema(resource: ResourceSpec): Schema {
  const properties: Record<string, Schema> = {}
  for (const name of resource.writable ?? []) {
    const schema = resource.writeOnly?.[name] ?? resource.fields[name]
    if (!schema) {
      throw new Error(`${resource.schemaName} lists "${name}" as writable with no schema for it`)
    }
    properties[name] = schema
  }
  return {
    type: 'object',
    description:
      `Writable fields of a ${resource.schemaName}.` +
      (resource.writeNote ? ` ${resource.writeNote}` : '') +
      ' Any other member is a `400` that names it, never silently ignored.',
    ...(resource.writeRequired ? { required: [...resource.writeRequired] } : {}),
    properties,
    additionalProperties: false,
  }
}

/** `{ object: "list", data: [...], next_cursor, has_more }`. */
function listSchema(itemRef: string): Schema {
  return {
    type: 'object',
    required: ['object', 'data', 'has_more'],
    properties: {
      object: { type: 'string', const: 'list' },
      data: { type: 'array', items: { $ref: `#/components/schemas/${itemRef}` } },
      next_cursor: {
        type: ['string', 'null'],
        description:
          'Pass back verbatim for the next page. `null` when `has_more` is false.',
      },
      has_more: {
        type: 'boolean',
        description:
          'The ONLY termination signal. `data.length < limit` never means the ' +
          'end — several lists filter rows out after the read, so a page of ' +
          '100 can return 60 rows, or none, with `has_more: true`.',
      },
    },
  }
}

const ERROR_SCHEMA: Schema = {
  type: 'object',
  required: ['error'],
  description: 'Every failure, in one shape.',
  properties: {
    error: {
      type: 'object',
      required: ['type', 'message'],
      properties: {
        type: {
          type: 'string',
          description:
            'The stable, machine-readable field. Branch on this, never on ' +
            '`message`.',
          enum: [
            'bad_request',
            'unauthorized',
            'plan_required',
            'insufficient_scope',
            'not_found',
            'method_not_allowed',
            'conflict',
            'rate_limited',
          ],
        },
        message: { type: 'string', description: 'Human-readable. May change.' },
        code: {
          type: 'string',
          description:
            'The specific detail, when there is one — `validation_failed`, ' +
            '`dataset_not_empty`, `contact_exists`, `company_exists`, ' +
            '`order_transition`, `idempotency_in_progress`, or the missing ' +
            'scope or entitlement.',
        },
      },
    },
  },
}

/** Options the caller supplies; nothing here is guessed from the environment. */
export interface CustomerApiOpenApiOptions {
  /** Origin the API is served from, e.g. `https://app.aglyn.com`. */
  readonly origin: string
  /** Where the prose documentation lives. */
  readonly documentationUrl: string
  /** The operator's brand name — self-hosters are not "Aglyn". */
  readonly brandName: string
}

/**
 * Build the OpenAPI 3.1 description of `/api/v1`: the platform's resources,
 * then `served` — the descriptions of the resources the build's plugins serve
 * (`describePluginApiV1Resources` in `api-v1-resources.ts`).
 *
 * Per-operation `security` is deliberately absent: every operation uses the
 * document-level requirement, and repeating it would be one more place for a
 * new endpoint to be added without it.
 */
export function buildCustomerApiOpenApi(
  options: CustomerApiOpenApiOptions,
  served: readonly ResourceSpec[] = [],
): Schema {
  const origin = options.origin.replace(/\/+$/, '')
  const schemas: Record<string, Schema> = { Error: ERROR_SCHEMA }
  const paths: Record<string, Schema> = {}
  const tags: Schema[] = []
  const listItems = new Set<string>()
  const resources = [...RESOURCES, ...served]

  for (const resource of resources) {
    tags.push({ name: resource.tag, description: resource.description })
    schemas[resource.schemaName] = {
      type: 'object',
      description: resource.description,
      required: [...resource.required],
      properties: resource.fields,
    }

    for (const op of resource.ops) {
      if (op.accepts && !(op.accepts in schemas)) {
        // Built from the resource's `writable` list. A body whose handler
        // ignores an unknown member rather than refusing it is declared by
        // name below, open, and replaces what this builds.
        schemas[op.accepts] = writeSchema(resource)
      }
      if (op.list && op.returns) listItems.add(op.returns)

      const parameters: Schema[] = [
        ...(op.pathParams ?? []).map((p) => ({
          name: p.name,
          in: 'path',
          required: true,
          description: p.description,
          schema: { type: 'string' },
        })),
        ...(op.list ? [LIMIT_PARAM, CURSOR_PARAM] : []),
        ...(op.filters ?? []),
      ]

      const body = (): Schema => ({
        'application/json': {
          schema: op.list
            ? { $ref: `#/components/schemas/${op.returns}List` }
            : { $ref: `#/components/schemas/${op.returns}` },
        },
      })
      // A create answers `201` fresh and `200` on an `Idempotency-Key` replay,
      // which is how a client tells the two apart. Every other success — a
      // delete included — is a `200` with a body.
      const success: Record<string, Schema> = op.creates
        ? {
            '201': { description: 'Created.', content: body() },
            '200': {
              description:
                'A replay of the same `Idempotency-Key`: the record the original create made.',
              content: body(),
            },
          }
        : {
            '200': {
              description: op.list
                ? 'One page of the list.'
                : op.returns === 'Deleted'
                  ? 'Deleted. The receipt names what was removed.'
                  : 'The record.',
              content: body(),
            },
          }

      const responses: Record<string, Schema> = {
        ...success,
        '400': errorResponse('Validation failed. No data was read.'),
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
        '404': errorResponse('No such record — or no such endpoint.'),
        '429': errorResponse('Rate limit exceeded. `Retry-After` says how long.'),
      }
      if (op.entitlement) {
        responses['403'] = errorResponse(
          `The organization's plan does not include \`${op.entitlement}\`. ` +
            '`code` names it.',
        )
      }

      const item = (paths[op.path] ??= {})
      ;(item as Record<string, unknown>)[op.method] = {
        operationId: op.operationId,
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        tags: [resource.tag],
        ...(parameters.length ? { parameters } : {}),
        ...(op.accepts
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${op.accepts}` },
                  },
                },
              },
            }
          : {}),
        responses,
      }
    }
  }

  for (const item of listItems) schemas[`${item}List`] = listSchema(item)
  // A resource's own named schemas replace what the loop derived under the
  // same name — a body that is not the record's write shape.
  for (const resource of resources) Object.assign(schemas, resource.components ?? {})

  // The service paths. Not resources: no ids, no collection, no scope.
  paths['/v1'] = {
    get: {
      operationId: 'getApiRoot',
      summary: 'API root',
      description:
        'Names the API, its version, the documentation URL and the top-level ' +
        'resources. Sub-resources are deliberately absent — advertising a ' +
        'path that 404s is worse than not advertising it.',
      tags: ['Service'],
      responses: {
        '200': {
          description: 'The service description.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiRoot' } },
          },
        },
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
        '405': errorResponse('This path answers GET only; `Allow` says so.'),
      },
    },
  }
  paths['/v1/me'] = {
    get: {
      operationId: 'getKeyIdentity',
      summary: 'Introspect the calling key',
      description: 'Says which organization and scopes this key carries. Never returns the key.',
      tags: ['Service'],
      responses: {
        '200': {
          description: 'The key’s identity.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/KeyIdentity' } } },
        },
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
      },
    },
  }
  paths['/v1/usage'] = {
    get: {
      operationId: 'getUsage',
      summary: 'This month’s billed requests',
      description: 'Every authenticated call is billed, including one that fails validation.',
      tags: ['Service'],
      responses: {
        '200': {
          description: 'The current billing period’s usage.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Usage' } } },
        },
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
      },
    },
  }
  paths[CUSTOMER_API_OPENAPI_PATH.replace('/api', '')] = {
    get: {
      operationId: 'getApiDescription',
      summary: 'This document',
      description:
        'Served WITHOUT a key. A description of how to authenticate that ' +
        'requires authentication is useless at the only moment it is wanted, ' +
        'and it carries nothing the public documentation does not.',
      tags: ['Service'],
      security: [],
      responses: {
        '200': {
          description: 'The OpenAPI 3.1 description of this API.',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
  }

  Object.assign(schemas, {
    SiteWrite: {
      type: 'object',
      required: ['displayName', 'subdomain'],
      description:
        'A new site. Members this body does not name are ignored rather than ' +
        'rejected.',
      properties: {
        displayName: { type: 'string', description: 'Name shown in the console. Trimmed, and truncated at 80 characters.' },
        subdomain: {
          type: 'string',
          description:
            '3–30 characters: lowercase letters, numbers and hyphens, starting ' +
            'with a letter or number. A reserved or taken subdomain is refused.',
        },
      },
      additionalProperties: true,
    },
    Deleted: {
      type: 'object',
      description:
        'What every delete answers, with `200` rather than `204`. A retry that ' +
        'carries the `Idempotency-Key` of the delete that removed the record ' +
        'replays this receipt.',
      required: ['id', 'object', 'deleted'],
      properties: {
        id: { type: 'string', description: 'Id of the deleted record.' },
        object: { type: 'string', description: 'What was deleted, e.g. `dataset`, `record` or `contact`.' },
        deleted: { type: 'boolean', const: true },
      },
    },
    ApiRoot: {
      type: 'object',
      required: ['object', 'name', 'version', 'resources'],
      properties: {
        object: { type: 'string', const: 'api' },
        name: { type: 'string' },
        version: { type: 'string', const: CUSTOMER_API_VERSION },
        documentation: { type: 'string', description: 'Where the prose documentation lives.' },
        resources: { type: 'array', items: { type: 'string' }, description: 'Top-level resource names.' },
      },
    },
    KeyIdentity: {
      type: 'object',
      required: ['object'],
      properties: {
        object: { type: 'string', const: 'api_key' },
        org: { type: 'string', description: 'Organization this key belongs to.' },
        name: { type: ['string', 'null'], description: 'The name the organization gave the key, e.g. `Zapier`.' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'What the key may do.' },
      },
      additionalProperties: true,
    },
    Usage: {
      type: 'object',
      properties: {
        object: { type: 'string', const: 'usage' },
        requests: { type: 'integer', description: 'Billed requests this period.' },
        periodStart: { type: 'string', format: 'date-time' },
        periodEnd: { type: 'string', format: 'date-time' },
      },
      additionalProperties: true,
    },
    PublishResult: {
      type: 'object',
      description: 'The outcome of a publish.',
      properties: {
        object: { type: 'string', const: 'publish' },
        siteId: { type: 'string' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: true,
    },
    MediaUpload: {
      type: 'object',
      required: ['data', 'contentType'],
      description:
        'An upload, as JSON with the file’s bytes base64-encoded — there is no ' +
        'multipart form. Members this body does not name are ignored rather ' +
        'than rejected.',
      properties: {
        data: {
          type: 'string',
          contentEncoding: 'base64',
          description: 'The file’s bytes. Anything that is not valid base64 is a `400`.',
        },
        contentType: { type: 'string', description: 'MIME type. Must be on the allowed list.' },
        fileName: { type: 'string', description: 'Defaults to `upload`. Truncated at 200 characters.' },
        folderId: { type: 'string', description: 'The folder to put the file in, by id.' },
        alt: { type: 'string', description: 'Alt text.' },
        private: { type: 'boolean', description: '`true` stores it restricted: no `cdnUrl`, no public link.' },
      },
      additionalProperties: true,
    },
  })

  /*
    Rate-limit headers on every response, attached by a walk. Written into
    each operation by hand they would be sixty places for a new endpoint to
    quietly omit them — and the headers are the whole reason a client can pace
    itself, so an endpoint missing them is one a careful client throttles
    against nothing.
  */
  const rateHeaders: Schema = {
    'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
    'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
    'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
    'X-RateLimit-Limit': { $ref: '#/components/headers/XRateLimitLimit' },
    'X-RateLimit-Remaining': { $ref: '#/components/headers/XRateLimitRemaining' },
    'X-RateLimit-Reset': { $ref: '#/components/headers/XRateLimitReset' },
  }
  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (pathName === '/v1/openapi.json') continue
    for (const operation of Object.values(pathItem as Record<string, Schema>)) {
      const responses = (operation as Schema)['responses'] as
        | Record<string, Schema>
        | undefined
      if (!responses) continue
      for (const [status, response] of Object.entries(responses)) {
        response['headers'] = {
          ...rateHeaders,
          ...(status === '429'
            ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } }
            : {}),
          ...((response['headers'] as Schema) ?? {}),
        }
      }
    }
  }

  return {
    openapi: '3.1.0',
    // Stated rather than assumed: it is what tells a consumer these schemas
    // are JSON Schema 2020-12, where nullability is a type UNION and not
    // OpenAPI 3.0's `nullable` keyword.
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: `${options.brandName} REST API`,
      version: CUSTOMER_API_VERSION,
      summary: `Programmatic access to an organization's data on ${options.brandName}.`,
      description:
        `The customer REST API. Authenticate with an API key as a bearer ` +
        'token; every response is JSON.\n\n' +
        '## Pagination\n\n' +
        'Every list returns `{ object: "list", data, next_cursor, has_more }` ' +
        'and pages with an opaque cursor. **`has_more` is the only ' +
        'termination signal.** Several lists filter rows out after the read, ' +
        'so a page of 100 can come back with 60 rows — or none — and ' +
        '`has_more: true`. A loop written as `while (data.length === limit)` ' +
        'stops early on those, and it looks like it worked.\n\n' +
        '## Ordering\n\n' +
        'Every list is ordered by record id, ascending — **not** by created ' +
        'or updated time. Page 1 is not "the 25 newest", and there is no ' +
        '`sort` param. The CRM lists are the exception: pass `updatedAfter` ' +
        'and they reorder by `updated` ascending, which is what a ' +
        'sync should walk.\n\n' +
        '## Rate limits\n\n' +
        'Both the RFC 9331 `RateLimit-*` headers and the older ' +
        '`X-RateLimit-*` are sent, from the same reading so they cannot ' +
        'disagree. The RFC `Reset` is SECONDS REMAINING; the legacy one is a ' +
        'Unix timestamp. On a `401` they describe the per-address lookup ' +
        'budget rather than a key\'s, because the key was never identified.\n\n' +
        `Full documentation: ${options.documentationUrl}`,
      contact: { name: options.brandName, url: options.documentationUrl },
    },
    servers: [
      { url: `${origin}${CUSTOMER_API_MOUNT}`, description: options.brandName },
    ],
    security: [{ apiKey: [] }],
    tags: [
      ...tags,
      { name: 'Service', description: 'The API’s description of itself.' },
    ],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An API key, sent as `Authorization: Bearer aglyn_sk_…`. Keys are ' +
            'organization credentials, not user ones — there is no user ' +
            'scope to evaluate. Mint and revoke them in the console.',
        },
      },
      headers: {
        RateLimitLimit: { description: 'Requests allowed per window, per RFC 9331.', schema: { type: 'integer' } },
        RateLimitRemaining: { description: 'Requests left in the current window.', schema: { type: 'integer' } },
        RateLimitReset: { description: 'SECONDS until the window resets — a duration, so it is read against your clock rather than ours.', schema: { type: 'integer' } },
        XRateLimitLimit: { description: 'Same number as `RateLimit-Limit`. The older spelling, not deprecated.', schema: { type: 'integer' } },
        XRateLimitRemaining: { description: 'Same number as `RateLimit-Remaining`.', schema: { type: 'integer' } },
        XRateLimitReset: { description: 'When the window resets, as a Unix TIMESTAMP in seconds — not a duration. Not interchangeable with `RateLimit-Reset`.', schema: { type: 'integer' } },
        RetryAfter: { description: 'Seconds to wait. Sent with a 429.', schema: { type: 'integer' } },
      },
      schemas,
    },
  }
}

/** One error response, in the shared envelope. */
function errorResponse(description: string): Schema {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Error' } },
    },
  }
}
