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
  isoField as ISO,
  nullableField as nullable,
  objectKindField as OBJECT_FIELD,
  stringField as str,
  stringListField as strList,
} from '@aglyn/tenant-data-admin/server/api-v1-description'

/**
 * `/v1/datasets` as the customer API's OpenAPI document describes it — the
 * dataset, its records and the two write bodies — what the console's builder
 * turns into paths, a tag and schemas, and the MCP tools derive from.
 * Transcribed from the customer-facing contract in
 * `apps/docs/api/resources/datasets.md`; `api-v1-openapi.spec.ts` holds the
 * document to every endpoint the documentation promises.
 */
export const DATASETS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Datasets',
  description: 'Structured collections and the records inside them.',
  schemaName: 'Dataset',
  required: ['id', 'object', 'name', 'fields'],
  fields: {
    id: str('Dataset id.'),
    object: OBJECT_FIELD('dataset'),
    name: str('Display name; `""` when none is set.'),
    fields: strList(
      'Field ids in the dataset’s model. The model itself — types, limits, display names — is not returned.',
    ),
    created: nullable(ISO('When the dataset was created.')),
  },
  ops: [
    { path: '/v1/datasets', method: 'get', operationId: 'listDatasets', summary: 'List datasets', list: true, returns: 'Dataset' },
    { path: '/v1/datasets', method: 'post', operationId: 'createDataset', summary: 'Create a dataset', accepts: 'DatasetWrite', returns: 'Dataset', creates: true },
    { path: '/v1/datasets/{datasetId}', method: 'get', operationId: 'getDataset', summary: 'Retrieve a dataset', returns: 'Dataset', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
    { path: '/v1/datasets/{datasetId}', method: 'patch', operationId: 'updateDataset', summary: 'Update a dataset', accepts: 'DatasetWrite', returns: 'Dataset', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
    {
      path: '/v1/datasets/{datasetId}', method: 'delete', operationId: 'deleteDataset', summary: 'Delete a dataset', returns: 'Deleted',
      description: 'Refuses with `409 conflict` (`code: "dataset_not_empty"`) while the dataset still holds records.',
      pathParams: [{ name: 'datasetId', description: 'Dataset id.' }],
    },
    { path: '/v1/datasets/{datasetId}/records', method: 'get', operationId: 'listDatasetRecords', summary: 'List records', list: true, returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
    { path: '/v1/datasets/{datasetId}/records', method: 'post', operationId: 'createDatasetRecord', summary: 'Create a record', accepts: 'DatasetRecordWrite', returns: 'DatasetRecord', creates: true, pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
    { path: '/v1/datasets/{datasetId}/records/{recordId}', method: 'get', operationId: 'getDatasetRecord', summary: 'Retrieve a record', returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }, { name: 'recordId', description: 'Record id.' }] },
    { path: '/v1/datasets/{datasetId}/records/{recordId}', method: 'patch', operationId: 'updateDatasetRecord', summary: 'Update a record', accepts: 'DatasetRecordWrite', returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }, { name: 'recordId', description: 'Record id.' }] },
    { path: '/v1/datasets/{datasetId}/records/{recordId}', method: 'delete', operationId: 'deleteDatasetRecord', summary: 'Delete a record', returns: 'Deleted', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }, { name: 'recordId', description: 'Record id.' }] },
  ],
  components: {
    DatasetRecord: {
      type: 'object',
      description:
        'A row in a dataset. Its values sit under `values`, keyed by field id — ' +
        'whatever that dataset’s model defines, so they cannot be enumerated here.',
      required: ['id', 'object', 'values'],
      properties: {
        id: { type: 'string', description: 'Record id. Opaque — do not pattern-match it.' },
        object: { type: 'string', const: 'record', description: 'Always `record`.' },
        values: {
          type: 'object',
          description:
            'Field id → value. A timestamp field comes back as epoch milliseconds, ' +
            'not an ISO string.',
          additionalProperties: true,
        },
        created: { type: ['string', 'null'], format: 'date-time' },
        updated: { type: ['string', 'null'], format: 'date-time' },
      },
    },
    DatasetRecordWrite: {
      type: 'object',
      description:
        'A record’s values, under `values` and keyed by field id.\n\n' +
        'Only `values` is read. Any other member — `id` included — is ignored ' +
        'rather than rejected, and so is a field id inside `values` that the ' +
        'dataset’s model does not define. Strings are coerced to the field’s ' +
        'type, and a `PATCH` merges `values` shallowly over the stored ones.',
      properties: {
        values: {
          type: 'object',
          description: 'Field id → value, per the dataset’s model.',
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    DatasetWrite: {
      type: 'object',
      description:
        'The writable half of a dataset. A create needs `name` and `fields`; a ' +
        '`PATCH` takes any of the three and leaves an omitted one as it is.\n\n' +
        'Members this body does not name are ignored rather than rejected — ' +
        '`id` and `created` included.',
      properties: {
        name: { type: 'string', description: 'Display name. Trimmed, and truncated to 120 characters.' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Field ids. Blanks are dropped and at most 100 kept; an empty result ' +
            'is a `400`. A `PATCH` replaces the list rather than merging it.',
        },
        model: {
          type: 'object',
          additionalProperties: true,
          description:
            'The typed field model. Stored as sent when it serializes to under ' +
            '64 KB; its shape is not validated, and it is never returned.',
        },
      },
      additionalProperties: true,
    },
  },
}
