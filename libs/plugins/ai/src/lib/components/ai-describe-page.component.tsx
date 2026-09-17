'use client'

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

import type { ConsoleHostScreensZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { AiDescribeButton } from './ai-describe-button.component'

/**
 * "Describe it" (AGL-2907): a page from a brief, beside Templates and Create
 * New Screen on a site's Screens page, mounted through the `hostScreens`
 * zone. The Assist panel's AI jobs opens the same dialog. The button, its
 * probe and its dialog are the ones every describe entry shares
 * (`ai-describe-button.component.tsx`, AGL-3043).
 */
export function AiDescribePageButton(props: ConsoleHostScreensZoneProps) {
  return <AiDescribeButton {...props} kind="page" />
}

export default AiDescribePageButton
