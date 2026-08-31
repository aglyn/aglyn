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

import { buildRoute, Route } from './route-links'

export interface AccountSection {
  /** The section's URL segment, and the key the rail and specs match on. */
  id: 'account' | 'emails' | 'profile' | 'basic' | 'security' | 'close'
  label: string
  href: string
}

/**
 * Manage Account's sections, in rail order (AGL-2501).
 *
 * One list, read by the callers that must agree: the sections layout draws
 * the rail from it, and the spec that guards the security-alert link checks
 * it. Three hand-written copies of six labels is how a section comes to be
 * listed under one name and linked under another.
 *
 * Close account is last and separate, as it was as a tab: an irreversible
 * control should not sit one mis-click below a password field somebody is
 * already typing in.
 */
export const ACCOUNT_SECTIONS: readonly AccountSection[] = [
  {
    id: 'account',
    label: 'Account',
    href: buildRoute(Route.MANAGE_USER_ACCOUNT),
  },
  // Several addresses per account (AGL-2486). Its own section rather than a
  // block inside the Account card: that card is about SIGN-IN METHODS
  // (password, Google, passkeys, which pool you are in), and addresses are a
  // different question with four controls of their own. Directly after Account
  // because the read-only "Email" field there is what sends people looking for
  // this.
  {
    id: 'emails',
    label: 'Email addresses',
    href: buildRoute(Route.MANAGE_USER_EMAILS),
  },
  {
    id: 'profile',
    label: 'Profile image',
    href: buildRoute(Route.MANAGE_USER_PROFILE),
  },
  {
    id: 'basic',
    label: 'Basic info',
    href: buildRoute(Route.MANAGE_USER_BASIC),
  },
  {
    id: 'security',
    label: 'Security',
    href: buildRoute(Route.MANAGE_USER_SECURITY),
  },
  {
    id: 'close',
    label: 'Close account',
    href: buildRoute(Route.MANAGE_USER_CLOSE),
  },
]

/** Where `/manage/user` lands when nothing names a section. */
export const DEFAULT_ACCOUNT_SECTION_HREF = ACCOUNT_SECTIONS[0].href
