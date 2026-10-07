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
 * The Forms plugin's mobile surface (AGL-3622): a site's forms with what
 * each collected, one form's figures, and its submissions through the
 * Inbox's reader; a "Form submissions" quick action; and the console's
 * Forms pages opening natively. Reached only through the generated mobile
 * manifest, never from `src/index.ts`.
 */

import {
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
} from '@aglyn/mobile-plugin-host'
import { FORM_SCREEN, FORMS_LIST_SCREEN } from './screen-ids'

export { FORM_SCREEN, FORMS_LIST_SCREEN }

export function registerFormsMobile(): void {
  registerMobileScreen({
    pluginId: 'forms',
    id: FORMS_LIST_SCREEN,
    title: 'Forms',
    requiresSite: true,
    load: () => import('./forms-list-screen'),
  })
  registerMobileScreen({
    pluginId: 'forms',
    id: FORM_SCREEN,
    title: 'Form',
    requiresSite: true,
    load: () => import('./form-screen'),
  })
  registerMobileQuickAction({
    pluginId: 'forms',
    id: 'forms.submissions',
    title: 'Form submissions',
    icon: 'document-text-outline',
    order: 40,
    requiresSite: true,
    screen: FORMS_LIST_SCREEN,
  })
  // The console's Forms list, and one form's page (`/forms/{formId}`).
  registerMobileDeepLink({
    pluginId: 'forms',
    id: 'forms.page',
    path: '/forms',
    screen: FORMS_LIST_SCREEN,
  })
  registerMobileDeepLink({
    pluginId: 'forms',
    id: 'forms.record',
    path: '/forms/:formId',
    screen: FORM_SCREEN,
  })
}
