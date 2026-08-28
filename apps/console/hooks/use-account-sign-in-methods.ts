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

import { canLinkSocialProvider } from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'

export interface AccountSignInMethods {
  /** Firebase `providerId`s on this account, in the order Firebase lists them. */
  providerIds: string[]
  /** There is a console password to change (AGL-852). */
  hasPassword: boolean
  /** The account lives in an org's GCIP tenant pool rather than the project pool. */
  ssoGoverned: boolean
  /**
   * Whether the Security section applies to this account (AGL-662).
   *
   * A password to change OR passkeys to manage. An SSO-governed account with
   * no password has neither — passkeys are project-pool only, and the
   * customer's IdP owns the credentials.
   */
  securityApplies: boolean
}

/**
 * How this account signs in, answered once (AGL-693).
 *
 * Three surfaces ask the same question and must not disagree: the account
 * sections rail decides whether to OFFER Security, the Security route decides
 * whether to RENDER or redirect, and the sign-in card decides which controls
 * to draw. Two of those are a navigation decision paired with a guard, and a
 * guard computed separately from the rail that leads to it is how a section
 * comes to be listed and then refuse the person who clicks it.
 *
 * This is navigation and presentation only. The boundaries are elsewhere and
 * stay there: a GCIP tenant accepts only the providers enabled on it, and
 * `updatePassword` refuses an account with no password credential.
 */
export function useAccountSignInMethods(): AccountSignInMethods {
  const { data: user } = useUser()
  /*
    Recomputed every render, deliberately unmemoized. `linkWithPopup` and
    `unlink` MUTATE the signed-in `User` in place and the card re-renders by
    bumping a counter after `reload()` — so a memo keyed on `providerData`
    would keep answering with the providers the account had before the link,
    and the row for the provider just connected would not appear until a
    navigation. Three strings is not worth a cache.
  */
  const providerIds = (
    (user?.providerData ?? []) as Array<{ providerId?: string }>
  )
    .map((info) => info?.providerId)
    .filter((id): id is string => Boolean(id))
  const hasPassword = providerIds.includes('password')
  const ssoGoverned = !canLinkSocialProvider(
    user as { tenantId?: string | null },
  )
  return {
    providerIds,
    hasPassword,
    ssoGoverned,
    securityApplies: hasPassword || !ssoGoverned,
  }
}

export default useAccountSignInMethods
