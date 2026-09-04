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

'use client'

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { HostSettingsForm } from '../../../host-settings-scope'

/**
 * The site's name and its address.
 *
 * Both are facts about the site as an OBJECT rather than about what a visitor
 * sees, which is why they sit here and not under Setup. The subdomain is the
 * address the site answers to — the same subject as the Custom Domain section
 * beside it — and the display name is what the site is called in the console,
 * where a visitor never sees it at all.
 *
 * One card, because one save handler: the two fields are submitted together
 * and the subdomain half goes through the rename endpoint that owns the public
 * address (AGL-642), so splitting them would split a single guarded write.
 */
const HostAdminGeneral: NextPageWithLayout<Record<string, never>> = () => (
  <HostSettingsForm schemaId="hostDetails" />
)
HostAdminGeneral.displayName = 'Page:HostAdminGeneral'

export default HostAdminGeneral
