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
  type ApiV1ResourceDescription,
  nullableField,
  objectKindField,
  SITE_ID_PATH_PARAM,
  stringField,
} from './api-v1-description'

/**
 * How the OpenAPI document — and the MCP tools derived from it — describes a
 * site's templates (AGL-4235), under the `Templates` tag the consent words
 * for `components:read` name.
 */
export const SITE_TEMPLATES_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Templates',
  docsPage: 'templates',
  description: 'A site’s page templates: the starting points a new page can be built from.',
  schemaName: 'Template',
  required: ['id', 'object', 'kind', 'name', 'description', 'category', 'placeholders', 'source'],
  fields: {
    id: stringField('The template’s id: the `templateId` a new page is created from.'),
    object: objectKindField('template'),
    kind: { type: 'string', const: 'page', description: 'Always `page`: a template a page is made from.' },
    name: nullableField(stringField('The template’s name.')),
    description: nullableField(stringField('What the template is for. A page made from it starts with this description.')),
    category: nullableField(stringField('The group the template is listed under, such as `Business`.')),
    placeholders: {
      type: 'array',
      description: 'The text the template asks for when a page is made from it. Empty when it asks for none.',
      items: {
        type: 'object',
        required: ['name', 'label', 'defaultValue'],
        properties: {
          name: stringField('The placeholder’s name: its key in a page create’s `placeholders`.'),
          label: nullableField(stringField('What the placeholder asks for, in words.')),
          defaultValue: nullableField(stringField('The text used when no value is given.')),
        },
      },
    },
    source: {
      type: 'string',
      enum: ['site', 'built_in'],
      description: '`site` for a template saved on or installed into this site; `built_in` for one of the platform’s starter pages.',
    },
  },
  ops: [
    {
      path: '/v1/sites/{siteId}/templates', method: 'get', operationId: 'listTemplates', summary: 'List a site’s page templates',
      list: true, returns: 'Template',
      description:
        'Lists the page templates a new page can be created from: the site’s own, then the built-in starter pages. Each has its name, description, category and the placeholders it asks for, not its content. A template’s `id` is the `templateId` Create a page takes. Needs `siteId` from List sites.',
      pathParams: [SITE_ID_PATH_PARAM],
    },
  ],
}
