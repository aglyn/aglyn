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
 * How a `/v1` resource is described in the customer API's OpenAPI document
 * (AGL-2733), in the shape the console's builder turns into paths, tags and
 * schemas — whoever serves the resource.
 *
 * The platform describes its own resources with these; a plugin that serves
 * one (`api-v1-resources.ts`) hands the builder its description through the
 * registration, so the document, and the MCP tools derived from it, describe
 * every resource the build serves and nothing it does not.
 *
 * Pure data and pure functions: nothing here reads a request or a store.
 */

/** A JSON Schema / OpenAPI fragment. */
export type ApiV1Schema = Record<string, unknown>

export interface ApiV1Operation {
  /** Path relative to the server, e.g. `/v1/contacts/{contactId}`. */
  readonly path: string
  readonly method: 'get' | 'post' | 'patch' | 'delete'
  readonly operationId: string
  readonly summary: string
  readonly description?: string
  /** `true` when the response is the paginated list envelope. */
  readonly list?: boolean
  /** Schema name for the response body, when it is a single record. */
  readonly returns?: string
  /** Schema name for the request body. */
  readonly accepts?: string
  /** Extra query parameters beyond the pagination pair. */
  readonly filters?: readonly ApiV1Schema[]
  /** Path parameters, in order. */
  readonly pathParams?: readonly { name: string; description: string }[]
  /**
   * `true` for a create: a fresh one answers `201`, and a replay of the same
   * `Idempotency-Key` answers `200` with the record the original create made.
   */
  readonly creates?: boolean
  /** Entitlement the call needs, named in the 403. */
  readonly entitlement?: string
}

export interface ApiV1ResourceDescription {
  readonly tag: string
  readonly description: string
  readonly schemaName: string
  readonly fields: Record<string, ApiV1Schema>
  readonly required: readonly string[]
  readonly ops: readonly ApiV1Operation[]
  /**
   * The members a write body may carry: the handler's own writable set, in the
   * order they are described. A record returns members nothing can write —
   * `siteId`, `sources`, the stamps — and a closed body listing them would tell
   * a generated client to send what the handler refuses.
   */
  readonly writable?: readonly string[]
  /** Schemas for writable members the record does not return, or returns differently. */
  readonly writeOnly?: Record<string, ApiV1Schema>
  /** What a create accepts that an update does not, in words. */
  readonly writeNote?: string
  /** Members a write must carry. Only for a body a single method takes. */
  readonly writeRequired?: readonly string[]
  /**
   * Further named schemas the operations reference — a request body that is
   * not the record's write shape (`ContactMerge`), a response that is not the
   * record (`LeadConversion`). Each replaces a schema of the same name the
   * builder would otherwise derive.
   */
  readonly components?: Record<string, ApiV1Schema>
}

// ── Field schemas ──────────────────────────────────────────────────────────

export const isoField = (description: string): ApiV1Schema => ({
  type: 'string',
  format: 'date-time',
  description,
})

export const stringField = (description: string): ApiV1Schema => ({ type: 'string', description })
export const integerField = (description: string): ApiV1Schema => ({ type: 'integer', description })
export const booleanField = (description: string): ApiV1Schema => ({ type: 'boolean', description })
export const stringListField = (description: string): ApiV1Schema => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

/**
 * A field the API may answer with `null`.
 *
 * OpenAPI 3.1 is JSON Schema 2020-12, where nullability is a type UNION and
 * not the 3.0 `nullable: true` keyword — a generator reading `nullable` here
 * would silently produce a non-optional field, which is the whole class of bug
 * the document exists to remove.
 */
export const nullableField = (base: ApiV1Schema): ApiV1Schema => ({
  ...base,
  type: [base['type'], 'null'],
})

export const openObjectField = (description: string): ApiV1Schema => ({
  type: 'object',
  description,
  additionalProperties: true,
})

/** A record's `object` member, which names its kind. */
export const objectKindField = (name: string): ApiV1Schema => ({
  type: 'string',
  const: name,
  description: `Always \`${name}\`. Lets a client discriminate a mixed array.`,
})

export const postalAddressField = (): ApiV1Schema => ({
  type: 'object',
  description: 'Postal address. Members are optional and free-form.',
  properties: {
    line1: { type: 'string' },
    line2: { type: 'string' },
    city: { type: 'string' },
    region: { type: 'string' },
    postalCode: { type: 'string' },
    country: { type: 'string' },
  },
  additionalProperties: true,
})

/** Every record carries these two. */
export const RECORD_STAMPS = {
  created: isoField('When the record was created.'),
  updated: isoField('When the record last changed. CRM lists can be walked by it.'),
}

// ── Query parameters ───────────────────────────────────────────────────────

export const UPDATED_AFTER_PARAM: ApiV1Schema = {
  name: 'updatedAfter',
  in: 'query',
  required: false,
  description:
    'ISO 8601 instant WITH an offset (`2026-09-01T00:00:00Z`). A bare date ' +
    'is a 400 — midnight in whose zone is not a question this API can ' +
    'answer. Reorders the list by `updated` ascending, and moves every other ' +
    'filter out of the query and onto the page, so pages can come back short.',
  schema: { type: 'string', format: 'date-time' },
}

/** An optional query parameter a list filters by. */
export const queryParam = (
  name: string,
  description: string,
  schema: ApiV1Schema = { type: 'string' },
): ApiV1Schema => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
})
