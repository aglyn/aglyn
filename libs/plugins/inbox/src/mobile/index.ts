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

/**
 * The Inbox plugin's mobile surface (AGL-3622): the Inbox tab, a site's
 * form submissions as threads (the message and the replies sent to it), the
 * reply, and the console's Inbox addresses opening natively. Reached only
 * through the generated mobile manifest, never from `src/index.ts`.
 */

import {
  registerMobileDeepLink,
  registerMobileScreen,
  registerMobileTab,
} from '@aglyn/mobile-plugin-host'
import { INBOX_SUBMISSION_SCREEN, INBOX_SUBMISSIONS_SCREEN } from './screen-ids'

export { INBOX_SUBMISSION_SCREEN, INBOX_SUBMISSIONS_SCREEN }

export function registerInboxMobile(): void {
  registerMobileScreen({
    pluginId: 'inbox',
    id: INBOX_SUBMISSIONS_SCREEN,
    title: 'Inbox',
    requiresSite: true,
    load: () => import('./submissions-screen'),
  })
  registerMobileScreen({
    pluginId: 'inbox',
    id: INBOX_SUBMISSION_SCREEN,
    title: 'Submission',
    requiresSite: true,
    load: () => import('./submission-screen'),
  })
  registerMobileTab({
    pluginId: 'inbox',
    id: 'inbox.tab',
    title: 'Inbox',
    icon: 'mail-outline',
    screen: INBOX_SUBMISSIONS_SCREEN,
    order: 30,
  })
  // The Inbox hub, which the console lands on its Submissions section, and
  // the notifications about a site's paused form door (`/{hostId}/inbox`).
  registerMobileDeepLink({
    pluginId: 'inbox',
    id: 'inbox.page',
    path: '/inbox',
    screen: INBOX_SUBMISSIONS_SCREEN,
  })
  // The Submissions section, at a site and at the workspace, and one
  // submission (`?submission={id}`): the console's record address and the
  // new-submission notification's link (`/{hostId}/inbox/submissions?…`).
  registerMobileDeepLink({
    pluginId: 'inbox',
    id: 'inbox.submissionsPage',
    path: '/inbox/submissions',
    screen: INBOX_SUBMISSIONS_SCREEN,
  })
}
