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

import { BUSINESS_SOCIAL_LINKS_MAX } from '@aglyn/aglyn/app-utils/business-details'
import {
  type ApiV1ResourceDescription,
  integerField,
  isoField,
  nullableField,
  objectKindField,
  SITE_ID_PATH_PARAM,
  stringField,
  booleanField,
} from './api-v1-description'
import { BUSINESS_API_BOUNDS, BUSINESS_TEXT_LIMITS } from './business-details-write'
import { PAGE_SEO_LIMITS } from './page-seo-write'
import { SITE_SEO_FIELDS } from './site-seo-write'

/**
 * How the OpenAPI document — and the MCP tools derived from it — describes
 * a site's search listing, its pages and its business details (AGL-4235),
 * from the same limits the handlers hold a write to.
 */

/** Said on every write here, because none of these settings has a draft. */
const LIVE = 'The change shows on the live site right away.'

const PAGE_ID_PATH_PARAM = {
  name: 'pageId',
  description: 'Required. The page’s id — the `id` of a page from `listPages`.',
} as const

/** A writable text member: a string within `limit`, or `null` to clear it. */
const clearable = (description: string, limit: number) => ({
  type: ['string', 'null'],
  maxLength: limit,
  description: `${description} ${limit} characters or fewer. An empty string or null clears it.`,
})

/** A writable text member the console requires: it cannot be emptied. */
const required = (description: string, limit: number) => ({
  type: 'string',
  minLength: 1,
  maxLength: limit,
  description: `${description} ${limit} characters or fewer. It cannot be emptied.`,
})

export const SITE_SEO_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Search listing',
  docsPage: 'seo',
  description: 'A site’s search listing defaults: the title and description its pages fall back to, and how a page’s title is built.',
  schemaName: 'SiteSeo',
  required: ['object', 'site', 'title', 'description', 'separator', 'titlePattern', 'image', 'imageAlt'],
  fields: {
    object: objectKindField('site_seo'),
    site: stringField('The site’s id.'),
    title: nullableField(stringField('The title a page with no search title of its own falls back to.')),
    description: nullableField(stringField('The description a page with no search description of its own falls back to.')),
    separator: nullableField(stringField('The character between a page’s name and the site title, such as `|`.')),
    titlePattern: nullableField(stringField('How a page with no search title of its own is titled. Null means the default pattern.')),
    image: nullableField(stringField('The social image shown when a page is shared, as stored. Read-only here.')),
    imageAlt: nullableField(stringField('What the social image shows. Read-only here.')),
  },
  writable: ['title', 'description', 'separator', 'titlePattern'],
  writeOnly: {
    title: required('The site’s search title.', SITE_SEO_FIELDS.title.maxLength),
    description: required('The site’s search description.', SITE_SEO_FIELDS.description.maxLength),
    separator: required('The title separator.', SITE_SEO_FIELDS.separator.maxLength),
    titlePattern: clearable(
      'The title pattern, using `{{page.name}}`, `{{site.separator}}` and `{{site.name}}`.',
      SITE_SEO_FIELDS.titlePattern.maxLength,
    ),
  },
  writeNote: 'A member left out keeps its value.',
  ops: [
    {
      path: '/v1/sites/{siteId}/seo', method: 'get', operationId: 'getSiteSeo', summary: 'Get a site’s search listing', returns: 'SiteSeo',
      description: 'Returns the search title and description the site’s pages fall back to, the title separator and pattern, and the social image when one is set. Needs `siteId` from List sites.',
      pathParams: [SITE_ID_PATH_PARAM],
    },
    // destructive and idempotent by its method. openWorld: the title and
    // description show in search results and the browser tab on the live
    // site as soon as they are saved; the console has no draft for them.
    {
      path: '/v1/sites/{siteId}/seo', method: 'patch', operationId: 'updateSiteSeo', summary: 'Update a site’s search listing',
      accepts: 'SiteSeoWrite', returns: 'SiteSeo',
      description: `Changes the site’s search title, description, title separator or title pattern; members left out keep their values. Needs \`siteId\` from List sites. Returns the search listing as saved. ${LIVE}`,
      pathParams: [SITE_ID_PATH_PARAM], openWorld: true,
    },
  ],
}

export const SITE_PAGES_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Pages',
  docsPage: 'pages',
  description: 'The pages of a site and the folders they sit in: their names, where they sit, their public addresses and their search listings.',
  schemaName: 'Page',
  required: ['id', 'object', 'name', 'kind', 'parentId', 'order', 'path', 'published', 'seo'],
  fields: {
    id: stringField('The page’s id.'),
    object: objectKindField('page'),
    name: nullableField(stringField('The page’s name in the console.')),
    kind: stringField('`page` for an ordinary page; `group` for a folder, which holds pages and has no address or content of its own.'),
    parentId: nullableField(stringField('The id of the page or folder it sits under, or null at the top.')),
    order: nullableField(integerField('Its place among the pages beside it.')),
    path: nullableField(stringField('Its public address on the site, such as `/about`, or null when it is not published. Always null for a folder.')),
    published: booleanField('Whether the page has a public address. Always false for a folder.'),
    seo: {
      type: 'object',
      description: 'The page’s own search listing. A member that is null falls back to the site’s.',
      properties: {
        title: nullableField(stringField('The search title.')),
        description: nullableField(stringField('The search description.')),
        breadcrumb: nullableField(stringField('The page’s short name in a breadcrumb trail.')),
        image: nullableField(stringField('The social image, as stored.')),
        imageAlt: nullableField(stringField('What the social image shows.')),
      },
    },
    created: isoField('When the page was created.'),
    updated: isoField('When the page last changed.'),
  },
  writable: ['title', 'description', 'breadcrumb'],
  writeOnly: {
    title: clearable('The page’s search title.', PAGE_SEO_LIMITS.title),
    description: clearable('The page’s search description.', PAGE_SEO_LIMITS.description),
    breadcrumb: clearable('The page’s short name in a breadcrumb trail.', PAGE_SEO_LIMITS.breadcrumb),
  },
  writeNote: 'Only the page’s search listing; a member left out keeps its value.',
  ops: [
    {
      path: '/v1/sites/{siteId}/pages', method: 'get', operationId: 'listPages', summary: 'List a site’s pages', list: true, returns: 'Page',
      description: 'Lists the site’s pages and folders with each one’s name, where it sits, its public address, whether it is published, and its search listing. A folder is listed with `kind` `group`; it has no address and is never published. A page’s `id` is the `pageId` other tools ask for, and a page or folder’s `id` is a `parentId` a page can be moved under. Needs `siteId` from List sites.',
      pathParams: [SITE_ID_PATH_PARAM],
    },
    {
      path: '/v1/sites/{siteId}/pages/{pageId}', method: 'get', operationId: 'getPage', summary: 'Get a page', returns: 'Page',
      description: 'Returns one page or folder: its name, where it sits, its public address, whether it is published, and its search listing. A folder has `kind` `group` and no address. Needs `siteId` from List sites and `pageId` from List a site’s pages.',
      pathParams: [SITE_ID_PATH_PARAM, PAGE_ID_PATH_PARAM],
    },
    // destructive and idempotent by its method. openWorld: a published
    // page's search title and description show in search results and the
    // browser tab as soon as they are saved; the console has no draft for them.
    {
      path: '/v1/sites/{siteId}/pages/{pageId}/seo', method: 'patch', operationId: 'updatePageSeo', summary: 'Update a page’s search listing',
      accepts: 'PageSeoWrite', returns: 'Page',
      description: `Changes one page’s search title, description or breadcrumb label; members left out keep their values. A folder has no search listing. Needs \`siteId\` from List sites and \`pageId\` from List a site’s pages. Returns the page. ${LIVE}`,
      pathParams: [SITE_ID_PATH_PARAM, PAGE_ID_PATH_PARAM], openWorld: true,
    },
  ],
}

const ADDRESS_MEMBERS = {
  street: 'The street address.',
  city: 'The city.',
  region: 'The state or region.',
  postalCode: 'The postal code.',
  country: 'A country name, or its two-letter code.',
} as const

export const BUSINESS_DETAILS_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Business details',
  docsPage: 'business-details',
  description: 'A site’s business details: the name, slogan, phone, email, address and social links its pages, structured data and emails show.',
  schemaName: 'BusinessDetails',
  required: ['object', 'site', 'name', 'slogan', 'phone', 'email', 'address', 'socialLinks'],
  fields: {
    object: objectKindField('business_details'),
    site: stringField('The site’s id.'),
    name: nullableField(stringField('The business name. Null means the site’s name is used.')),
    slogan: nullableField(stringField('A short line about the business.')),
    phone: nullableField(stringField('The phone number, as customers should dial it.')),
    email: nullableField(stringField('Where customers write to the business.')),
    address: {
      type: 'object',
      description: 'The postal address, in parts. A part that is null is not set.',
      properties: Object.fromEntries(
        Object.entries(ADDRESS_MEMBERS).map(([member, description]) => [member, nullableField(stringField(description))]),
      ),
    },
    socialLinks: {
      type: 'array',
      description: 'The business’s social profiles.',
      items: {
        type: 'object',
        properties: { label: stringField('What the link is called.'), url: stringField('The profile’s address.') },
      },
    },
  },
  writable: ['name', 'slogan', 'phone', 'email', 'address', 'socialLinks'],
  writeOnly: {
    name: clearable('The business name, as customers know it. Empty means the site’s name is used.', BUSINESS_TEXT_LIMITS.name),
    slogan: clearable('A short line about the business.', BUSINESS_TEXT_LIMITS.slogan),
    phone: clearable('The phone number, as customers should dial it, such as `+1 512-555-0100`.', BUSINESS_TEXT_LIMITS.phone),
    email: clearable('An email address, such as `you@example.com`.', BUSINESS_TEXT_LIMITS.email),
    address: {
      type: ['object', 'null'],
      description: 'The postal address, in parts. A part left out keeps its value; null clears every part.',
      properties: Object.fromEntries(
        Object.entries(ADDRESS_MEMBERS).map(([member, description]) => [member, clearable(description, BUSINESS_API_BOUNDS.addressPart)]),
      ),
      additionalProperties: false,
    },
    socialLinks: {
      type: ['array', 'null'],
      maxItems: BUSINESS_SOCIAL_LINKS_MAX,
      description: `The business’s social profiles, ${BUSINESS_SOCIAL_LINKS_MAX} or fewer. Replaces the whole list; an empty list or null clears it.`,
      items: {
        type: 'object',
        required: ['url'],
        properties: {
          label: { type: 'string', maxLength: BUSINESS_API_BOUNDS.socialLinkLabel, description: `What the link is called, such as \`Instagram\`. ${BUSINESS_API_BOUNDS.socialLinkLabel} characters or fewer.` },
          url: { type: 'string', minLength: 1, maxLength: BUSINESS_API_BOUNDS.socialLinkUrl, description: `Required. The profile’s address. ${BUSINESS_API_BOUNDS.socialLinkUrl} characters or fewer.` },
        },
        additionalProperties: false,
      },
    },
  },
  writeNote: 'A member left out keeps its value.',
  ops: [
    {
      path: '/v1/sites/{siteId}/business', method: 'get', operationId: 'getBusinessDetails', summary: 'Get a site’s business details', returns: 'BusinessDetails',
      description: 'Returns the business name, slogan, phone, email, address and social links the site’s pages, structured data and emails show. Needs `siteId` from List sites.',
      pathParams: [SITE_ID_PATH_PARAM],
    },
    // destructive and idempotent by its method. openWorld: the details show
    // in the live site's pages, its structured data and its emails as soon
    // as they are saved; the console has no draft for them.
    {
      path: '/v1/sites/{siteId}/business', method: 'patch', operationId: 'updateBusinessDetails', summary: 'Update a site’s business details',
      accepts: 'BusinessDetailsWrite', returns: 'BusinessDetails',
      description: `Changes the site’s business name, slogan, phone, email, address or social links; members left out keep their values. Needs \`siteId\` from List sites. Returns the business details as saved. ${LIVE}`,
      pathParams: [SITE_ID_PATH_PARAM], openWorld: true,
    },
  ],
}

/** The three, in the order the document lists them. */
export const SITE_SETTINGS_DESCRIPTIONS: readonly ApiV1ResourceDescription[] = [
  SITE_SEO_DESCRIPTION,
  SITE_PAGES_DESCRIPTION,
  BUSINESS_DETAILS_DESCRIPTION,
]
