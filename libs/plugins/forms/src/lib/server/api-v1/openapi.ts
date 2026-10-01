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
    { path: '/v1/sites/{siteId}/form-submissions', method: 'get', operationId: 'listFormSubmissions', summary: 'List submissions', list: true, returns: 'FormSubmission', description: 'Combining `form`/`formId` with `read` narrows on the form and checks `read` on the page, so pages can come back short.', filters: [q('form', 'Form name.'), q('formId', 'Form id.'), q('read', 'Either `true` or `false`. Anything else is a 400.', { type: 'string', enum: ['true', 'false'] })], pathParams: [{ name: 'siteId', description: 'Site id.' }] },
    { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'get', operationId: 'getFormSubmission', summary: 'Retrieve a submission', returns: 'FormSubmission', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'submissionId', description: 'Submission id.' }] },
    { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'patch', operationId: 'updateFormSubmission', summary: 'Mark a submission read', accepts: 'FormSubmissionWrite', returns: 'FormSubmission', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'submissionId', description: 'Submission id.' }] },
    { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'delete', operationId: 'deleteFormSubmission', summary: 'Delete a submission', returns: 'Deleted', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'submissionId', description: 'Submission id.' }] },
  ],
}
