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

// Each registry from its own module, not the `@aglyn/aglyn/server` barrel:
// boot needs one registry, not the whole server surface.
import {
  listPluginOrgErasers,
  registerPluginOrgEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import {
  listPluginUserErasers,
  registerPluginUserEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { OUTREACH_PLUGIN_ID } from './constants/bundle-common'

/**
 * Outreach's CONSOLE-ONLY server declarations (AGL-2978), named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot.
 *
 * The erasers are registered here rather than from `serverDeclarations`,
 * which the tenant runtime also loads: the workspace eraser revokes each
 * rep's Google grant, and the account eraser (AGL-3106) revokes and deletes
 * the person's own, and both open a sealed token with `OUTREACH_TOKEN_KEY`,
 * which only the console holds. The tenant may not so much as bundle the code
 * that does (`outreach-credential-isolation.spec.ts`). Every erasure runs in
 * the console, so this is where the erasers are needed.
 *
 * Light at boot: the erasers' module is imported when an erasure first asks
 * for it, so the boot cost is the registration.
 */
export function registerOutreachConsoleServerDeclarations(): void {
  // Idempotent against the REGISTRY, so a reset (a spec) registers again.
  if (!listPluginOrgErasers().includes(OUTREACH_PLUGIN_ID)) {
    registerPluginOrgEraser(
      async (request) => {
        const { createOutreachOrgEraser, defaultOutreachErasureDeps } = await import(
          './mailboxes/mailbox-erasure'
        )
        return createOutreachOrgEraser(defaultOutreachErasureDeps())(request)
      },
      { pluginId: OUTREACH_PLUGIN_ID },
    )
  }
  if (!listPluginUserErasers().includes(OUTREACH_PLUGIN_ID)) {
    registerPluginUserEraser(
      async (request) => {
        const { createOutreachUserEraser, defaultOutreachErasureDeps } = await import(
          './mailboxes/mailbox-erasure'
        )
        return createOutreachUserEraser(defaultOutreachErasureDeps())(request)
      },
      { pluginId: OUTREACH_PLUGIN_ID },
    )
  }
}
