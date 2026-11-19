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

import { type ApiV1ResourceDescription, SITE_ID_PATH_PARAM } from './api-v1-description'

/**
 * How the OpenAPI document — and the MCP tools derived from it — describes
 * adding, changing and removing a site's pages (AGL-4235). Filed under the
 * `Pages` tag; the record a create and an update return is the `Page` the
 * reads describe, and a delete answers the shared `Deleted` receipt.
 *
 * The two bodies are named schemas of their own (`PageCreateWrite`,
 * `PageWrite`), closed, because `handlePageWrites` names an unknown member
 * in a `400`.
 */

const PAGE_ID_PATH_PARAM = {
  name: 'pageId',
  description: 'Required. The page’s id — the `id` of a page from `listPages`.',
} as const

const NAME = {
  type: 'string',
  minLength: 1,
  description: 'The page’s name, as the console lists it. A published page’s browser title falls back to it.',
}
const DESCRIPTION = {
  type: ['string', 'null'],
  description: 'A short description of the page. A published page’s search description falls back to it. An empty string or null clears it.',
}
const SLUG = {
  type: 'string',
  description:
    'The page’s own address segment, such as `about`, or `/` for the home page. One segment: a `/` inside it is refused, and so is a reserved address. Nesting comes from the page’s parent.',
}

const PAGE_CREATE_WRITE = {
  type: 'object',
  description:
    'A new page. Any other member is a `400` that names it, never silently ignored.',
  required: ['name'],
  properties: {
    name: { ...NAME, description: `Required. ${NAME.description}` },
    description: DESCRIPTION,
    slug: {
      ...SLUG,
      description: `${SLUG.description} Stored for when the page is published; taken from the name when left out, and made unique against the site’s other pages.`,
    },
    templateId: {
      type: 'string',
      description:
        'The page template to start from — the `id` of a template from `listTemplates`. Left out, the page starts blank.',
    },
    placeholders: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description:
        'Only with `templateId`: the text for each of the template’s placeholders, by placeholder `name`. A placeholder left out takes its default value, or nothing.',
    },
  },
  additionalProperties: false,
}

const PAGE_WRITE = {
  type: 'object',
  description:
    'What to change on a page; a member left out keeps its value, and at least one is required. Any other member is a `400` that names it, never silently ignored.',
  properties: {
    name: NAME,
    description: { ...DESCRIPTION, description: `${DESCRIPTION.description} A folder has no description.` },
    slug: {
      ...SLUG,
      description: `${SLUG.description} On a published page this moves the page, and the published pages under it, to the new address. A folder has no address.`,
    },
    parentId: {
      type: ['string', 'null'],
      description:
        'Move the page under another page or folder — the `id` of a page or folder from `listPages` — or to the top level with null. Not under itself or a page below it.',
    },
    index: {
      type: 'integer',
      minimum: 0,
      description:
        'Its position among the pages beside it, counting from 0. With `parentId`, its position under the new parent; alone, it reorders the page where it is. Left out with `parentId`, it goes last.',
    },
  },
  additionalProperties: false,
}

export const PAGE_WRITES_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Pages',
  docsPage: 'pages',
  description: 'Adding, renaming, moving and deleting a site’s pages. A new page starts unpublished.',
  schemaName: 'PageWrite',
  required: [],
  fields: {},
  components: { PageCreateWrite: PAGE_CREATE_WRITE, PageWrite: PAGE_WRITE },
  ops: [
    // A create, not idempotent: each call makes another page. Not
    // open-world: the new page has no address, so no visitor can reach it
    // until someone publishes it.
    {
      path: '/v1/sites/{siteId}/pages', method: 'post', operationId: 'createPage', summary: 'Create a page',
      accepts: 'PageCreateWrite', returns: 'Page', creates: true,
      description:
        'Adds a page to a site, blank or from a page template with its placeholders filled in. The page is not published: it has no address, and visitors cannot reach it until it is published. Counts against the plan’s page allowance. Needs `siteId` from List sites and a `name`; `templateId` comes from List a site’s page templates. Returns the new page.',
      pathParams: [SITE_ID_PATH_PARAM],
    },
    // destructive and idempotent by its method. openWorld: on a published
    // page the new name (its title's fallback), address or position shows
    // on the live site as soon as it is saved; the console has no draft for
    // any of them.
    {
      path: '/v1/sites/{siteId}/pages/{pageId}', method: 'patch', operationId: 'updatePage', summary: 'Update a page',
      accepts: 'PageWrite', returns: 'Page',
      description:
        'Renames a page, changes its description or its address, or moves or reorders it among the site’s pages; members left out keep their values. On a published page the change shows on the live site right away, and a new address moves the published pages under it too; such a change needs the publish permission. Every part is checked before anything is saved, so a refused change saves nothing. Needs `siteId` from List sites and `pageId` from List a site’s pages. Returns the page.',
      pathParams: [SITE_ID_PATH_PARAM, PAGE_ID_PATH_PARAM], openWorld: true,
    },
    // openWorld: a published page leaves the live site as soon as it is
    // deleted.
    {
      path: '/v1/sites/{siteId}/pages/{pageId}', method: 'delete', operationId: 'deletePage', summary: 'Delete a page',
      returns: 'Deleted',
      description:
        'Deletes a page and takes its address off the site; a published page leaves the live site right away. The pages under it stay where they are. A folder is not deleted this way. Needs `siteId` from List sites and `pageId` from List a site’s pages.',
      pathParams: [SITE_ID_PATH_PARAM, PAGE_ID_PATH_PARAM], openWorld: true,
    },
  ],
}
