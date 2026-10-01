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

import type { TenantEmailEntry } from '@aglyn/shared-util-email'

/**
 * The emails a site sends its own customers through Workflows (AGL-769/770).
 *
 * Declared here, by the plugin that sends them, and compiled into the
 * platform's tenant email catalog (`TENANT_EMAILS` in
 * `@aglyn/shared-util-email`) by `tools/scripts/generate-plugin-manifests.mjs`
 * (AGL-3080): the catalog's readers include the send path, which loads no
 * plugin code, so a runtime registry it had not filled would quietly send
 * the text card in place of the site's designed email. Regenerate after
 * changing an entry; `--check` refuses a stale catalog.
 */
export function workflowsTenantEmails(): readonly TenantEmailEntry[] {
  return [
    {
      key: 'workflow-email',
      name: 'Workflow email step',
      description:
        "An email sent by a workflow's send-email action when its trigger " +
        'fires.',
      pluginId: 'workflows',
      plugin: 'Workflows',
      control: 'external',
      authoredIn: 'the workflow that sends it',
      footerReason:
        'You’re receiving this because you’re in touch with {{host.businessName}}.',
    },
  ]
}
