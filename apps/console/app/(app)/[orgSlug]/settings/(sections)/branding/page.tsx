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
import OrgBrandingCard from '../../../../../../components/org-branding-card.component'

/** Brand colors and marks the console and emails use. */
const SettingsBranding: NextPageWithLayout<Record<string, never>> = () => <OrgBrandingCard />
SettingsBranding.displayName = 'Page:SettingsBranding'

export default SettingsBranding
