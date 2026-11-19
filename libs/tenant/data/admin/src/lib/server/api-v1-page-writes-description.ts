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

import type { ApiV1ResourceDescription } from './api-v1-description'

/**
 * How the OpenAPI document — and the MCP tools derived from it — describes
 * adding, changing and removing a site's pages (AGL-4235). Filed under the
 * `Pages` tag; the record a write returns is the `Page` the reads describe.
 *
 * `ops` stays EMPTY until `handlePageWrites` works: an operation described
 * before it is built becomes a tool that answers "Not available yet". The
 * builder skips a description with no operations, so this adds no tag and no
 * schema until then.
 */
export const PAGE_WRITES_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Pages',
  docsPage: 'pages',
  description: 'Adding, renaming, moving and deleting a site’s pages. A new page starts unpublished.',
  schemaName: 'PageWrite',
  required: [],
  fields: {},
  ops: [],
}
