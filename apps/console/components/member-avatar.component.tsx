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

import { splitDisplayName } from '@aglyn/shared-util-tools'
import { Avatar, type AvatarProps } from '@mui/material'
import { useMemo } from 'react'

export interface MemberAvatarProps extends Omit<AvatarProps, 'src' | 'alt'> {
  /** The member's stored photo, when the roster has one. */
  photoURL?: string | null
  email?: string | null
  displayName?: string | null
  /** Rendered pixel size. */
  size?: number
}

/**
 * Initials for a member, drawn locally when there is no stored photo.
 *
 * `splitDisplayName` is already the console's answer for "one provider string,
 * two name fields" (AGL-1127), so the two-letter form follows whatever that
 * decides rather than a second, differently-naive parse. A single-word name
 * gives one letter; an invited row has only an email, so the local part
 * before `@` stands in — `ada@example.com` reads as "A", not "@".
 */
export function memberInitials(
  displayName?: string | null,
  email?: string | null,
): string {
  const { firstName, lastName } = splitDisplayName(displayName)
  const initials = `${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.trim()
  if (initials) return initials.toUpperCase()
  const localPart = String(email ?? '')
    .trim()
    .split('@')[0]
  return (localPart.slice(0, 1) || '?').toUpperCase()
}

/**
 * One member's avatar, resolved the same way everywhere (AGL-1126).
 *
 * The member's own `photoURL` (what they chose), then their initials, drawn
 * here. Before AGL-1126 every member surface rendered `<Avatar>{initial}</Avatar>`
 * with no `src` at all, so a member with a picture still showed a grey letter.
 *
 * There used to be a Gravatar step between those two, and it is gone
 * (AGL-1683). It put an MD5 of the member's email in a URL to gravatar.com,
 * which the browser then fetched with the viewer's IP and a `Referer` naming
 * the console — so opening the members list told Automattic the email
 * addresses of the org's whole team. An email MD5 anonymises nothing: a
 * gravatar hash exists precisely to be looked up from an address, and email
 * addresses are low-entropy enough to enumerate. Automattic is on no
 * subprocessor register of ours, there was no DPA, no vendor review, no gate,
 * and no opt-out — and the members list leaks OTHER people's addresses, who
 * never had the chance to consent for themselves.
 *
 * Initials are the substitute because they need no vendor. The photo path is
 * untouched: `upsertOrgMember` mirrors the provider `photoURL` onto the roster
 * (AGL-1126) and that is what actually gives most members a face. Works for
 * SSO members too, whose auth record lives in a per-org tenant pool the
 * console cannot read from the client at all (AGL-1122).
 */
export function MemberAvatar(props: MemberAvatarProps) {
  const { photoURL, email, displayName, size = 32, sx, ...rest } = props
  const src = useMemo(() => {
    const stored = String(photoURL ?? '').trim()
    return stored || undefined
  }, [photoURL])

  const label = String(displayName || email || '?')
  const initials = memberInitials(displayName, email)
  return (
    <Avatar
      src={src}
      alt={label}
      // Google's CDN 403s a request that leaks the console referrer.
      slotProps={{ img: { referrerPolicy: 'no-referrer' } }}
      sx={{
        width: size,
        height: size,
        // Two letters need to fit the same circle one did.
        fontSize: size * (initials.length > 1 ? 0.36 : 0.45),
        ...sx,
      }}
      {...rest}
    >
      {initials}
    </Avatar>
  )
}
MemberAvatar.displayName = 'MemberAvatar'
MemberAvatar.aglyn = true

export default MemberAvatar
