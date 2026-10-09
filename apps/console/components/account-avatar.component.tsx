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

import { Avatar } from '@mui/material'
import { useState } from 'react'

/** `Ada Lovelace` → `AL`, `ada@example.com` → `A`, nothing → `?`. */
export function accountInitials(
  name: string | null | undefined,
  email?: string | null,
): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length) {
    const first = words[0]?.[0] ?? ''
    const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
    return `${first}${last}`.toUpperCase()
  }
  const local = String(email ?? '').trim()
  return local ? (local[0] ?? '?').toUpperCase() : '?'
}

export interface AccountAvatarProps {
  /** The account's photo URL — Google's is on `lh3.googleusercontent.com`. */
  photoUrl?: string | null
  name?: string | null
  email?: string | null
  /** Diameter in px. */
  size?: number
}

/**
 * An account's profile photo, or its initials (AGL-3660).
 *
 * A plain `<img>` (MUI's `Avatar`), not `next/image`: the photo is the
 * provider's own, already sized, and an optimizer would only add a hop.
 * `lh3.googleusercontent.com` is already in the console's `img-src`
 * (`security-origins.js`). `no-referrer`, because Google's photo host
 * refuses some requests that carry a third-party referrer, and a photo that
 * fails falls back to the initials rather than a broken image.
 */
export function AccountAvatar({ photoUrl, name, email, size = 32 }: AccountAvatarProps) {
  const [failed, setFailed] = useState(false)
  const src = photoUrl && !failed ? photoUrl : undefined
  return (
    <Avatar
      src={src}
      alt={name || email || 'Account'}
      slotProps={{
        img: { referrerPolicy: 'no-referrer', onError: () => setFailed(true), loading: 'lazy' },
      }}
      sx={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {accountInitials(name, email)}
    </Avatar>
  )
}
AccountAvatar.displayName = 'AccountAvatar'

export default AccountAvatar
