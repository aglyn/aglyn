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

type Schema = Record<string, unknown>

/** The well-known location RFC 9727 reserves for an API catalog. */
export const API_CATALOG_PATH = '/.well-known/api-catalog'

/**
 * The linkset media type RFC 9727 REQUIRES the catalog to support.
 *
 * Not `application/json`. RFC 9727 §3 says a catalog "MUST support the Linkset
 * [RFC9264] format of application/linkset+json", and a client that content-
 * negotiates for it is entitled to get it. The `+json` structured suffix means
 * anything that parses JSON still parses this.
 */
export const API_CATALOG_MEDIA_TYPE = 'application/linkset+json'

/** One API in the catalog. */
export interface CatalogApi {
  /**
   * The API's root URI. This is the linkset `anchor` — the context every one
   * of its links hangs from — so it identifies the API rather than locating a
   * document about it.
   */
  url: string
  /** Human label, carried as the `title` target attribute on the listing. */
  title: string
  /** Machine-readable description: OpenAPI, published as `service-desc`. */
  specUrl?: string
  /** Human documentation, published as `service-doc`. */
  docsUrl?: string
  /**
   * Media type of {@link docsUrl}. Defaults to HTML because that is what a
   * documentation site serves — but a tenant's own documentation is
   * `/llms.txt`, which is Markdown, and declaring it HTML in a document whose
   * entire purpose is machine-readability would be a lie a client acts on.
   */
  docsType?: string
  /** Health endpoint, published as `status`. */
  statusUrl?: string
}

export interface AgentApiCatalogOptions {
  /** The site's public origin, no trailing slash. */
  origin: string
  /** The APIs to advertise, in the order a reader should meet them. */
  apis: readonly CatalogApi[]
}

/**
 * The site's API catalog (RFC 9727), as an RFC 9264 linkset.
 *
 * ## What this is for
 *
 * A tenant's `/openapi.json` describes the SITE: its pages as Markdown, its
 * sitemap, its feeds, and the handful of JSON reads that serve them. That is an
 * honest description of a website, and it is not the typed REST API. The typed
 * API is the platform's, it lives on another origin, and until this document
 * existed nothing on a customer's site pointed at it — an agent standing on
 * `acme.com` had no way to learn that a full CRUD API describes the same data.
 *
 * A catalog is the published answer to exactly that question, which is why this
 * follows RFC 9727 rather than inventing a `/apis.json`: an agent that knows
 * the standard finds this without being told, and one that does not can still
 * read it, because a linkset is plain JSON.
 *
 * ## The shape, and why entries are separate objects
 *
 * A linkset is a list of link CONTEXTS, each keyed by its `anchor`. The first
 * context is anchored at the catalog itself and carries the `item` links — the
 * membership list, "these are my APIs". Every context after it is anchored at
 * one API's own root and carries that API's `service-desc`, `service-doc` and
 * `status`. Folding the metadata into the `item` entries would say something
 * different and weaker: that the CATALOG has a description, rather than that
 * each API does.
 *
 * ## Absent members are omitted, never emitted empty
 *
 * An operator running this platform themselves configures their own console
 * and docs origins, and may have neither. A `service-doc` pointing at an empty
 * string is a link an agent will follow and a 404 it will attribute to us, so
 * an API with nothing but an anchor contributes no context object at all.
 */
export function buildAgentApiCatalog(options: AgentApiCatalogOptions): Schema {
  const origin = options.origin.replace(/\/+$/, '')
  const linkset: Schema[] = [
    {
      anchor: `${origin}${API_CATALOG_PATH}`,
      item: options.apis.map((api) => ({ href: api.url, title: api.title })),
    },
  ]

  for (const api of options.apis) {
    const context: Schema = { anchor: api.url }
    if (api.specUrl) {
      context['service-desc'] = [
        { href: api.specUrl, type: 'application/json' },
      ]
    }
    if (api.docsUrl) {
      context['service-doc'] = [
        { href: api.docsUrl, type: api.docsType ?? 'text/html' },
      ]
    }
    if (api.statusUrl) {
      context['status'] = [{ href: api.statusUrl, type: 'application/json' }]
    }
    // An anchor and nothing else describes nothing. See the note above.
    if (Object.keys(context).length > 1) linkset.push(context)
  }

  return { linkset }
}
