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
  booleanField as bool,
  objectKindField as OBJECT_FIELD,
  openObjectField as objectOf,
  queryParam as q,
  RECORD_STAMPS as STAMPS,
  stringField as str,
  SITE_ID_PATH_PARAM,
} from '@aglyn/tenant-data-admin/server/api-v1-description'

/**
 * `/v1/sites/{siteId}/form-submissions` as the customer API's OpenAPI
 * document describes it — what the console's builder turns into paths, a tag
 * and schemas, and the MCP tools derive from. Transcribed unchanged from the
 * builder's own list when the resource moved here (AGL-3080);
 * `api-v1-openapi.spec.ts` holds the document to every endpoint the
 * documentation promises.
 */
export const FORM_SUBMISSIONS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Form submissions',
  docsPage: 'form-submissions',
  description: 'What visitors sent through a site’s forms.',
  schemaName: 'FormSubmission',
  required: ['id', 'object', 'form_id', 'fields'],
  writable: ['read'],
  writeRequired: ['read'],
  fields: {
    id: str('Submission id.'),
    object: OBJECT_FIELD('form_submission'),
    form_id: str('Form id.'),
    form: str('Form name.'),
    path: str('Page path the form was submitted from.'),
    fields: objectOf('The submitted values, keyed by field name.'),
    read: bool('Whether the submission has been marked read.'),
    routing: objectOf('Where the submission was routed.'),
    created: STAMPS.created,
  },
  ops: [
    { path: '/v1/sites/{siteId}/form-submissions', method: 'get', operationId: 'listFormSubmissions', summary: 'List a site’s form entries', list: true, returns: 'FormSubmission', description: 'Lists what visitors sent through one site’s forms, newest first, with each entry’s fields and whether it has been read. Needs `siteId` from List sites. Filter by form or by read state.', filters: [q('form', 'Form name.'), q('formId', 'Form id.'), q('read', 'Either `true` or `false`. Anything else is a 400.', { type: 'string', enum: ['true', 'false'] })], pathParams: [SITE_ID_PATH_PARAM] },
    { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'get', operationId: 'getFormSubmission', summary: 'Get a form entry', description: 'Returns one form entry. Needs `siteId` from List sites and `submissionId` from List a site’s form entries.', returns: 'FormSubmission', pathParams: [SITE_ID_PATH_PARAM, { name: 'submissionId', description: 'Submission id.' }] },
    { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'patch', operationId: 'updateFormSubmission', summary: 'Mark a form entry read or unread', description: 'Sets whether a form entry has been read; nothing else about it can change. Needs `siteId` and `submissionId`. Returns the entry.', accepts: 'FormSubmissionWrite', returns: 'FormSubmission', pathParams: [SITE_ID_PATH_PARAM, { name: 'submissionId', description: 'Submission id.' }] },
    { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'delete', operationId: 'deleteFormSubmission', summary: 'Delete a form entry', description: 'Deletes a form entry permanently. Needs `siteId` and `submissionId`.', returns: 'Deleted', pathParams: [SITE_ID_PATH_PARAM, { name: 'submissionId', description: 'Submission id.' }] },
  ],
}
