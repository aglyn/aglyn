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

import { NODE_MAP_MAX_BYTES } from '@aglyn/aglyn/app-utils/measure-node-map'
import { PAGE_CONTENT_MAX_EDITS, PAGE_CONTENT_MAX_INSERT_ELEMENTS } from '@aglyn/aglyn/plugin-manager/plugin-page-content'
import {
  type ApiV1ResourceDescription,
  type ApiV1Schema,
  booleanField,
  integerField,
  nullableField,
  objectKindField,
  queryParam,
  SITE_ID_PATH_PARAM,
  stringField,
  stringListField,
} from './api-v1-description'

/**
 * How the OpenAPI document — and the MCP tools derived from it — describes
 * what is on a page (AGL-4235). Filed under the `Pages` tag, beside the
 * page list and the page writes.
 *
 * `getPageContent` reads; `editPageContent` writes the page's DRAFT only, so
 * nothing public changes. Its hints say so beside it.
 */

const PAGE_ID_PATH_PARAM = {
  name: 'pageId',
  description: 'Required. The page’s id — the `id` of a page from `listPages`.',
} as const

const ELEMENT_ID = 'An element’s `id`, from Get a page’s content.'

/** A map of settings or styles, described as the open object it is. */
const openMap = (description: string): ApiV1Schema => ({ type: 'object', description, additionalProperties: true })

const ELEMENT: ApiV1Schema = {
  type: 'object',
  description: 'One element, flattened: what is inside it is named by id in `children`.',
  required: ['id', 'kind', 'parentId', 'children', 'props'],
  properties: {
    id: stringField('The element’s id, which an edit names it by.'),
    kind: stringField('The kind of element, such as `muiTypography` or `section`. `kinds` describes it.'),
    pluginId: stringField('The plugin that provides the kind, when there is one.'),
    name: stringField('The name the element has in the editor’s layers.'),
    parentId: nullableField(stringField('The element it sits in, or null for the page’s root.')),
    children: stringListField('The ids of the elements inside it, in the order they read.'),
    props: openMap('Its settings that an edit can set, as stored: its text, its picture, its link and the rest. `kinds` says what each holds.'),
    style: openMap('Its styles that an edit can set, as stored, such as `py` or `textAlign`; a value may be an object by screen size (`xs`, `sm`, `md`, `lg`, `xl`).'),
    hidden: booleanField('Whether the element is hidden.'),
    readOnly: {
      type: 'object',
      description: 'What the element stores that an edit cannot set, shown so it can be read: present only when there is some.',
      properties: {
        props: openMap('Settings an edit cannot set, such as rich text (`html`) or a class name. Setting `children` replaces rich text.'),
        style: openMap('Styles outside the keys an edit can set.'),
        interactions: integerField('How many interactions the element runs.'),
        fields: stringListField('Other fields it carries that only the editor changes, such as `className` or `styleOverrides`, and on the root `layoutStyleOverrides`, the page’s restyles of its layout.'),
      },
    },
  },
}

const KIND_PROP: ApiV1Schema = {
  type: 'object',
  description: 'One setting a kind of element takes.',
  properties: {
    role: stringField(
      'What the setting is for: `text` is copy a visitor reads, `media` a picture or file, `url` a link, `screen` a link to another page of the site by its id, `motion` an animation setting, `dataset` the dataset an element repeats over. Absent for a plain setting.',
    ),
    type: stringField('The type of value: `string`, `number`, `integer` or `boolean`.'),
    values: stringListField('The values a setting with a fixed list of choices takes.'),
    maxLength: integerField('The most characters the value may have.'),
  },
}

const KIND: ApiV1Schema = {
  type: 'object',
  description: 'What one kind of element is and takes.',
  properties: {
    label: stringField('The kind’s name in the editor.'),
    acceptsChildren: booleanField('Whether other elements can be added or moved into it.'),
    props: { type: 'object', description: 'Each setting it takes, by name.', additionalProperties: KIND_PROP },
  },
}

const NEW_ELEMENT: ApiV1Schema = {
  type: 'object',
  description: 'An element to add, with anything inside it.',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: stringField('Required. The kind of element, such as `muiTypography`, `muiButton`, `image`, `muiStack` or `section`.'),
    props: openMap('Its settings, by name, as `kinds` describes them for its kind.'),
    style: openMap('Its styles, such as `{ "py": 4 }`.'),
    name: stringField('Its name in the editor’s layers, 80 characters or fewer.'),
    children: {
      type: 'array',
      description: 'Elements inside it, in order. Only a kind that accepts children takes them.',
      items: { $ref: '#/components/schemas/PageContentNewElement' },
    },
  },
}

/** One edit kind's schema: `op` fixed, its members described, the required ones marked. */
const editKind = (op: string, description: string, properties: Record<string, ApiV1Schema>, required: readonly string[]): ApiV1Schema => ({
  type: 'object',
  description,
  required: ['op', ...required],
  additionalProperties: false,
  properties: { op: { type: 'string', const: op, description: `Always \`${op}\`.` }, ...properties },
})

const ELEMENT_ID_MEMBER = { elementId: stringField(`Required. The element to change. ${ELEMENT_ID}`) }

const EDIT: ApiV1Schema = {
  description: 'One edit. `op` says which kind.',
  oneOf: [
    editKind(
      'updateProps',
      'Sets settings of an element, such as its text or its picture. The settings named replace those values; the rest stay as they are.',
      { ...ELEMENT_ID_MEMBER, props: openMap('Required. The settings to set, by name, such as `{ "children": "New headline" }`.') },
      ['elementId', 'props'],
    ),
    editKind(
      'updateStyle',
      'Sets styles of an element. The styles named replace those values; the rest stay as they are.',
      { ...ELEMENT_ID_MEMBER, style: openMap('Required. The styles to set, such as `{ "py": 8 }` or `{ "textAlign": { "xs": "center", "md": "left" } }`.') },
      ['elementId', 'style'],
    ),
    editKind(
      'rename',
      'Renames an element in the editor’s layers.',
      { ...ELEMENT_ID_MEMBER, name: stringField('Required. The new name, 80 characters or fewer.') },
      ['elementId', 'name'],
    ),
    editKind(
      'insert',
      `Adds a new element, with anything inside it, ${PAGE_CONTENT_MAX_INSERT_ELEMENTS} elements at most in one insert.`,
      {
        parentId: stringField(`Required. The element to add it into, which must accept children. ${ELEMENT_ID}`),
        index: nullableField(integerField('Its position among the parent’s children, from 0. Left out or null, it is added last.')),
        element: { $ref: '#/components/schemas/PageContentNewElement', description: 'Required. The element to add.' },
      },
      ['parentId', 'element'],
    ),
    editKind(
      'move',
      'Moves an element, with what is inside it, into another element or to another position.',
      {
        ...ELEMENT_ID_MEMBER,
        parentId: stringField(`Required. The element to move it into, which must accept children. ${ELEMENT_ID}`),
        index: integerField('Required. Its position among that element’s children, from 0.'),
      },
      ['elementId', 'parentId', 'index'],
    ),
    editKind('remove', 'Removes an element and everything inside it.', ELEMENT_ID_MEMBER, ['elementId']),
  ],
}

export const PAGE_CONTENT_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Pages',
  docsPage: 'pages',
  description: 'What is on a page: its elements, read from the waiting draft or the saved version, and edits saved to its draft.',
  schemaName: 'PageContent',
  required: ['object', 'page', 'versionId', 'base', 'revision', 'rootId', 'total', 'elements', 'kinds', 'editorUrl'],
  fields: {
    object: objectKindField('page_content'),
    page: stringField('The page’s id.'),
    versionId: stringField('The id of the version the page points at, whose draft edits are saved in.'),
    base: { type: 'string', enum: ['draft', 'saved'], description: '`draft` when the page has a draft waiting, which is what was read; `saved` for the saved version.' },
    revision: stringField('Changes whenever the content read changes. Send it as `ifRevision` to refuse edits to a page that changed since.'),
    rootId: stringField('The id of the page’s root element, which holds the rest and cannot be changed itself.'),
    total: integerField('How many elements the page has, which is more than `elements` when one element was read with `elementId`.'),
    elements: { type: 'array', description: 'Every element read, the root first, each before what is inside it, in the order the page reads.', items: ELEMENT },
    kinds: { type: 'object', description: 'Each kind of element in `elements`, by kind.', additionalProperties: KIND },
    editorUrl: nullableField(stringField('A link that opens the page in the editor, on its draft when it has one.')),
  },
  components: {
    PageContentNewElement: NEW_ELEMENT,
    PageContentEdits: {
      type: 'object',
      description: 'Edits to a page’s draft, applied in order, all or none.',
      required: ['edits'],
      additionalProperties: false,
      properties: {
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: PAGE_CONTENT_MAX_EDITS,
          description: `Required. 1 to ${PAGE_CONTENT_MAX_EDITS} edits, applied in order as one change: if any is refused, none is saved.`,
          items: EDIT,
        },
        ifRevision: stringField('A `revision` from Get a page’s content. When the page has changed since, the edits are refused and nothing is saved.'),
      },
    },
    PageContentEditResult: {
      type: 'object',
      description: 'Edits saved to a page’s draft.',
      required: ['object', 'page', 'versionId', 'revision', 'applied', 'created', 'editorUrl'],
      properties: {
        object: objectKindField('page_content_edit'),
        page: stringField('The page’s id.'),
        versionId: stringField('The version whose draft the edits were saved in.'),
        revision: stringField('The draft’s revision after the edits.'),
        applied: integerField('How many edits were saved.'),
        created: {
          type: 'array',
          description: 'The ids given to added elements, one entry per insert.',
          items: {
            type: 'object',
            properties: {
              index: integerField('The position of the insert in `edits`, from 0.'),
              id: stringField('The id of the element the insert added.'),
              ids: stringListField('Every element the insert added, the added element first, then what is inside it in the order it reads.'),
            },
          },
        },
        editorUrl: nullableField(stringField('A link that opens the page’s draft in the editor.')),
      },
    },
  },
  ops: [
    {
      path: '/v1/sites/{siteId}/pages/{pageId}/content',
      method: 'get',
      operationId: 'getPageContent',
      summary: 'Get a page’s content',
      returns: 'PageContent',
      description:
        'Returns every element of one page in the order it reads: each element’s id, kind, parent and children, the settings (`props`) and styles (`style`) an edit can set, and under `readOnly` what it cannot. `kinds` says, for each kind of element present, which setting holds its text, picture or link, and each setting’s allowed values and length limit. The content is the page’s draft when one is waiting, otherwise its saved version; `base` says which, and `revision` changes whenever it changes. With `elementId`, returns that element and what is inside it. Needs `siteId` from List sites and `pageId` from List a site’s pages. Also returns `editorUrl`, a link that opens the page in the editor.',
      pathParams: [SITE_ID_PATH_PARAM, PAGE_ID_PATH_PARAM],
      filters: [queryParam('elementId', `Read only this element and what is inside it. ${ELEMENT_ID}`)],
    },
    // destructive: an edit can overwrite an element's settings and styles in
    // the draft, and remove elements from it. Not idempotent: a POST, and an
    // insert sent twice adds two elements, so a retry carries the same
    // `Idempotency-Key`. Not open-world: the edits are saved as the page's
    // draft, which no visitor sees until the page is published, so nothing
    // public changes.
    {
      path: '/v1/sites/{siteId}/pages/{pageId}/content/edits',
      method: 'post',
      operationId: 'editPageContent',
      summary: 'Edit a page’s content',
      accepts: 'PageContentEdits',
      returns: 'PageContentEditResult',
      description: `Changes elements of one page, named by their ids from Get a page’s content: sets settings or styles, renames, adds new elements with anything inside them, moves or removes. 1 to ${PAGE_CONTENT_MAX_EDITS} edits, applied in order, all or none. The edits are saved as the page’s draft: visitors see nothing until the page is published. Each edit is checked against what the element takes, and a refusal names each problem by edit and member in \`fields\` and saves nothing. With \`ifRevision\`, the edits are refused if the page changed since it was read. A page is at most ${NODE_MAP_MAX_BYTES} bytes. Needs \`siteId\` from List sites and \`pageId\` from List a site’s pages. Returns the new \`revision\`, the ids of any elements added, and \`editorUrl\`, a link that opens the draft in the editor.`,
      pathParams: [SITE_ID_PATH_PARAM, PAGE_ID_PATH_PARAM],
      destructive: true,
    },
  ],
}
