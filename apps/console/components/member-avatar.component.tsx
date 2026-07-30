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

import { gravatarUrlFromEmail } from '@aglyn/shared-util-tools'
import { Avatar, type AvatarProps } from '@mui/material'
import { useMemo } from 'react'

export interface MemberAvatarProps extends Omit<AvatarProps, 'src' | 'alt'> {
  /** The member's stored photo, when the roster has one. */
  photoURL?: string | null
  email?: string | null
  displayName?: string | null
  /** Rendered pixel size; the Gravatar request asks for 2× it. */
  size?: number
}

/**
 * One member's avatar, resolved the same way everywhere (AGL-1126).
 *
 * Order is deliberate: the member's own `photoURL` (what they chose), then
 * Gravatar for their email, then the initial. Before this, every member
 * surface rendered `<Avatar>{initial}</Avatar>` with no `src` at all, so a
 * member with a picture still showed a grey letter.
 *
 * `d=404` is the load-bearing detail. Gravatar's default is to SYNTHESIZE an
 * identicon for any address, so without it every member gets a generated
 * pattern and the initial fallback becomes unreachable. With `404`, an
 * address with no Gravatar fails the image request and MUI falls back to the
 * child — the initial.
 *
 * Works for SSO members too, who are the reason this is not simply read off
 * Firebase Auth: their auth record lives in a per-org tenant pool the console
 * cannot read from the client at all (AGL-1122). Email is on the roster doc;
 * that is enough.
 */
export function MemberAvatar(props: MemberAvatarProps) {
  const { photoURL, email, displayName, size = 32, sx, ...rest } = props
  const src = useMemo(() => {
    const stored = String(photoURL ?? '').trim()
    if (stored) return stored
    const address = String(email ?? '').trim()
    return address
      ? gravatarUrlFromEmail(address, {
          size: String(size * 2),
          default: '404',
          protocol: 'https',
        })
      : undefined
  }, [photoURL, email, size])

  const label = String(displayName || email || '?')
  return (
    <Avatar
      src={src}
      alt={label}
      // Google/Gravatar CDNs 403 a request that leaks the console referrer.
      slotProps={{ img: { referrerPolicy: 'no-referrer' } }}
      sx={{ width: size, height: size, fontSize: size * 0.45, ...sx }}
      {...rest}
    >
      {label.slice(0, 1).toUpperCase()}
    </Avatar>
  )
}
MemberAvatar.displayName = 'MemberAvatar'
MemberAvatar.aglyn = true

export default MemberAvatar
