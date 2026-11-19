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
 * How the OpenAPI document — and the MCP tools derived from it — describes a
 * site's templates (AGL-4235), under the `Templates` tag the consent words
 * for `components:read` name.
 *
 * `ops` stays EMPTY until `handleSiteTemplates` works: an operation described
 * before it is built becomes a tool that answers "Not available yet". The
 * builder skips a description with no operations, so this adds no tag and no
 * schema until then.
 */
export const SITE_TEMPLATES_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Templates',
  description: 'A site’s page templates: the starting points a new page can be built from.',
  schemaName: 'Template',
  required: [],
  fields: {},
  ops: [],
}
