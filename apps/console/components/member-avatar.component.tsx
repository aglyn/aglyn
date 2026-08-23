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

/**
 * Six colours, spaced around the wheel and all legible under white text at
 * 11px (AGL-2486).
 *
 * NOT a generated hue: an unconstrained hash lands on yellows and pale greens
 * that fail contrast against the white initials, and one unreadable person in
 * a members list is worse than two people sharing a colour.
 */
export const AVATAR_COLOURS = [
  '#e8710a',
  '#1a73e8',
  '#12b5cb',
  '#9334e6',
  '#d93025',
  '#188038',
]

/**
 * A stable colour for a seed — deterministic, so the same identity is the
 * same colour on every screen and for every viewer without anything being
 * coordinated or stored.
 *
 * The SEED is the caller's choice and it matters. Member surfaces seed on the
 * email, so a rename does not repaint someone. Presence seeds on
 * `uid:sessionId`, because Zach asked for one avatar per open SESSION each in
 * its own colour, matching the cursor that session draws.
 */
export function avatarColourFor(seed: string): string {
  let hash = 0
  const text = String(seed ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

export interface MemberAvatarProps extends Omit<AvatarProps, 'src' | 'alt'> {
  /**
   * Overrides the seeded colour. Presence passes the session's own colour so
   * the avatar matches the cursor and selection box drawn on the canvas.
   */
  colour?: string
  /** Seed for the colour when none is given; defaults to email, then name. */
  colourSeed?: string
  /** The member's stored photo, when the roster has one. */
  photoURL?: string | null
  email?: string | null
  /**
   * The person's name.
   *
   * NOT `displayName`, and that is not a style preference (AGL-2486). A JSX
   * prop literally named `displayName` is STRIPPED by this app's compiler:
   * measured in the browser by passing the identical value under both names
   * on one element, `name: entry.displayName || 'Someone'` was emitted into
   * the chunk while the other spelling was absent from it AND from the props
   * the component received. Every call site here had been passing a prop that
   * never arrived, so this component fell back to the email — or, where no
   * email was passed, rendered `?` — from the day it was written.
   *
   * The jest suite never caught it because jest compiles with a different
   * transform that keeps the prop, so `member-avatar.component.spec.tsx`
   * asserted two-letter initials from that spelling and went green against a
   * browser build in which the prop does not exist.
   * `no-displayname-jsx-prop.spec.ts` is the guard that now fails instead.
   */
  name?: string | null
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
  const {
    photoURL,
    email,
    name,
    colour,
    colourSeed,
    size = 32,
    sx,
    ...rest
  } = props
  const src = useMemo(() => {
    const stored = String(photoURL ?? '').trim()
    return stored || undefined
  }, [photoURL])

  const label = String(name || email || '?')
  const initials = memberInitials(name, email)
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
        fontWeight: 600,
        // COLOUR, not the SDK's grey (AGL-2486). Zach, seeing the account
        // menu next to the presence stack: "I like how we created the named
        // avatars for no profile picture let's do the same". The grey letter
        // was not a neutral choice — MUI's `colorDefault` is the same grey it
        // uses for an image that FAILED to load, so a deliberate initials
        // avatar was rendering as a broken one. It matters most for SSO
        // accounts, which have no picture at all: `zach@aglyn.com`
        // authenticates through `saml.aglyn-workspace`, whose assertion
        // carries no photo, so for the enterprise tier the initials ARE the
        // avatar on every screen.
        bgcolor: colour ?? avatarColourFor(colourSeed || email || label),
        // `common.white`, not `#fff` — the same colour, said in the one
        // spelling the hardcoded-colour ratchet accepts. It is deliberately
        // NOT `getContrastText` or a mode-aware token: the six background
        // colours above are fixed identity colours chosen for legibility
        // under white 11px text, so the foreground has to be fixed with them.
        // A theme-aware pairing would flip this to black in a light theme and
        // put black on #d93025.
        color: 'common.white',
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
