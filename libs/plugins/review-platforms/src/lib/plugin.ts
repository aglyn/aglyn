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

import * as Aglyn from '@aglyn/aglyn'
import { lazy } from 'react'
import { REVIEW_PLATFORMS_ENTITLEMENT, REVIEW_PLATFORMS_PLUGIN_ID } from './constants/bundle-common'

const ReviewPlatformsSettingsCards = lazy(() => import('./components/review-platforms-settings-card.component'))
const ReviewPlatformsOrderWidget = lazy(() => import('./components/review-platforms-order-widget.component'))

/**
 * Review platforms' console half (AGL-3699): no page of its own. It fills
 * two zones the commerce plugin hosts — the store's settings and the order
 * dialog. Gated on the plans that sell. The store's built-in product
 * reviews stay where they are and stay the reviews its product pages show.
 */
export function registerReviewPlatformsConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: REVIEW_PLATFORMS_PLUGIN_ID,
    displayName: 'Review platforms',
    featureFlag: REVIEW_PLATFORMS_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'review-platforms-services',
        title: 'Review platforms',
        Component: ReviewPlatformsSettingsCards,
      },
      {
        slot: 'orderDetail',
        widgetId: 'review-platforms-order',
        title: 'Review invitations',
        Component: ReviewPlatformsOrderWidget,
      },
    ],
  })
}
