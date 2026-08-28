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
  /**
   * The id this section carried as a `?tab=` panel, and its URL segment.
   *
   * The two are the same string on purpose — see `accountSectionHrefForTab`.
   */
  id: 'account' | 'emails' | 'profile' | 'basic' | 'security' | 'close'
  label: string
  href: string
}

/**
 * Manage Account's sections, in rail order (AGL-693).
 *
 * One list, read by three callers that must agree: the sections layout draws
 * the rail from it, the `/manage/user` index forwards an old `?tab=` link
 * through it, and the spec that guards the security-alert email checks it.
 * Three hand-written copies of six labels is how a section comes to be listed
 * under one name and linked under another.
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

/**
 * An old `?tab=` id → the section route that holds it now, or null.
 *
 * ## Why this map exists when the settings and admin conversions dropped theirs
 *
 * A transactional email already in people's inboxes links
 * `/manage/user?tab=security`. `security-alerts.ts` sends it when a new device
 * signs in, it cannot be edited once delivered, and the person opening it has
 * just been told a stranger reached their account — landing them on the
 * default section, or on nothing, is the one case where "there are no shipped
 * customers holding old links" is false and the cost of being wrong is
 * highest. `account-section-links.spec.tsx` is what stops this being deleted
 * as dead weight.
 *
 * Unknown ids resolve to null and the index falls back to the default
 * section, so a typo or a retired id lands somewhere real.
 */
export function accountSectionHrefForTab(
  tab: string | null | undefined,
): string | null {
  if (!tab) return null
  return ACCOUNT_SECTIONS.find((section) => section.id === tab)?.href ?? null
}
