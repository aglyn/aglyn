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

import { isMediaCdnPath } from '@aglyn/aglyn'
import { CardDisplay, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useUser,
  useUserPhoto,
} from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { updateProfile } from 'firebase/auth'
import { deleteField, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { accountPhotoProfilePatch } from '../account-photo-payload'
import MediaUrlField from '../media-url-field.component'
import MemberAvatar from '../member-avatar.component'
import { docsHelp } from '../../constants/docs-links'
import { AVATAR_HINT } from '../../constants/media-size-hints'
import useFirestoreDoc from '../../hooks/use-firestore-doc'
import useAccountSignInMethods from '../../hooks/use-account-sign-in-methods'
import { useOrgScope } from '../../hooks/use-org-scope'

/**
 * The personal avatar the console shows for this account (AGL-365).
 *
 * The Profile image section of Manage Account, its own component since the
 * sections became routes (AGL-2501). Mirrors to the auth `photoURL` (app bar,
 * comments) and to the users doc (team lists, activity), then fans out to the
 * org roster through a route, because no colleague can read another person's
 * auth record.
 */
export function ProfileImageCard() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { currentOrg } = useOrgScope()
  const { ssoGoverned } = useAccountSignInMethods()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const userRef = doc(firestore, 'users', user.uid)
  const { data } = useFirestoreDoc(() => userRef, [firestore, user.uid])
  const [photoUrl, setPhotoUrl] = useState('')
  // The same resolver the app bar uses (AGL-1127). The card three inches
  // below it rendered a bare initial with no `src`, so one page gave two
  // answers for one user's avatar — a photo up top, a grey "Z" in the card
  // that claims to be showing you your avatar.
  const resolvedPhotoUrl = useUserPhoto()
  useEffect(() => {
    setPhotoUrl(String((data as any)?.photoUrl ?? user?.photoURL ?? ''))
  }, [(data as any)?.photoUrl, user?.photoURL])

  const handlePhotoSave = useCallback(async () => {
    const cleaned = photoUrl.trim()
    // Must accept what this card's own Browse button produces (AGL-2286) —
    // `MediaUrlField` writes `media.cdnPath`, which is never absolute. This
    // check fired FIRST, so a user who picked a library image never even
    // reached the server's identical refusal; the field's own helper text
    // offers the library. Mirrors `normalizeMemberPhotoUrl`, which is the
    // boundary — this one is the courtesy.
    const cleanedIsHttps = /^https:\/\//i.test(cleaned)
    if (cleaned && !cleanedIsHttps && !isMediaCdnPath(cleaned)) {
      return void enqueueSnackbar(
        'Image URL must be an https:// URL or an image from your media library',
        { variant: 'warning', persist: false },
      )
    }
    const dequeueLoading = queueLoading()
    try {
      // `deleteField()` on a clear plus a removal marker, never a bare `''`
      // (AGL-2486) — `accountPhotoProfilePatch` holds the rule and the
      // reasoning, and its spec is where the two sentinels are pinned.
      await setDoc(
        userRef,
        accountPhotoProfilePatch(cleaned, { deleteField, serverTimestamp }),
        { merge: true },
      )
      await updateProfile(user, { photoURL: cleaned || null })
      // Neither of the two writes above is what a COLLEAGUE reads (AGL-1976).
      // Every member surface — Team, the member detail page, activity,
      // presence — feeds `MemberAvatar` from `orgs/{id}/members/{uid}.photoURL`,
      // because none of them can read another person's auth record: an SSO
      // member's lives in a per-org pool (AGL-1122). That row is
      // `allow write: if false`, so the fan-out is a route.
      //
      // Deliberately NOT fatal to the save. The two writes above have already
      // committed and the picture is live on this person's own surfaces; a
      // roster fan-out that failed is a stale colleague view, which the next
      // save repairs. Rolling back a committed avatar to report it would be
      // worse than saying so.
      const idToken = await user.getIdToken()
      const response = await fetch('/api/account/photo', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ photoUrl: cleaned }),
      })
      if (!response.ok) {
        console.error('[manage/user] roster photo fan-out failed', response.status)
        return void enqueueSnackbar(
          'Profile image saved — your team may still see the old one for a while.',
          { variant: 'warning', persist: false },
        )
      }
      enqueueSnackbar('Profile image saved', { variant: 'success' })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Saving the image failed', { variant: 'error' })
    } finally {
      dequeueLoading()
    }
  }, [photoUrl, userRef, user, queueLoading, enqueueSnackbar])

  return (
    <CardDisplay
      header={'Profile image'}
      help={docsHelp('account', {
        excerpt:
          'Your personal avatar across the console — the app bar, ' +
          'comments, and team lists.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2.5} sx={{ maxWidth: 560 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <MemberAvatar
            // The edited field first, so the card previews what Save would
            // do; the auth `photoURL` when it is empty, so clearing the field
            // shows what the console will actually fall back to. That used to
            // include a Gravatar step, removed in AGL-1683 — with nothing
            // stored, the initials are now what everyone else sees, and this
            // card has to show exactly that.
            //
            // `MemberAvatar`, not a bare `Avatar` (AGL-2486): this card
            // promises "shown across the console", and it was the one place
            // rendering a DIFFERENT avatar from the one the console actually
            // shows — one grey letter here, two coloured initials everywhere
            // else. A preview that does not match is worse than none.
            photoURL={photoUrl.trim() || resolvedPhotoUrl || undefined}
            name={user?.displayName}
            email={user?.email}
            size={72}
            sx={{ border: '1px solid', borderColor: 'divider' }}
          />
          <Stack spacing={0.25}>
            <Typography variant="subtitle2">{'Your avatar'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Shown across the console — the app bar, comments, and team ' +
                'lists.'}
            </Typography>
          </Stack>
        </Stack>
        {/* WHY THERE IS NO PICTURE, for the only accounts that cannot
            answer it themselves (AGL-2486).

            A self-serve account arrives through Google and brings a photo
            with it, so an empty avatar there means "you have not set one".
            An SSO account does not: its picture can only come from a
            `picture` attribute in the SAML assertion, and a SAML assertion
            carries only what the customer's IdP admin chose to map. Google
            Workspace's SAML app offers no photo attribute at ALL — measured
            on the live `aglyn-org-y5v14` tenant, whose auth record, provider
            entry and profile document are all still photo-less after a
            sign-in three weeks after the mapping shipped — so for those
            orgs there is nothing to map and nothing coming.

            Without this the page is silent about that, and an empty field
            beside a grey initial reads as "not loaded yet" or "the SSO
            import is broken", which is the ticket this text answers. It is
            NOT a per-account diagnosis of the assertion: we do not keep the
            attributes, and claiming to know what a specific IdP sent would
            be a guess. It says what is true of every SSO account — the
            picture is yours to set here — and only while there is none. */}
        {ssoGoverned && !photoUrl.trim() && !resolvedPhotoUrl ? (
          <Alert severity="info">
            {'Your organization signs you in through its identity provider, ' +
              'and identity providers usually do not send a profile picture — ' +
              'many, including Google Workspace SAML, cannot. Set yours ' +
              'here: ' +
              // Only offer Browse when there IS one. The button beside the
              // field is org-scoped and simply does not render without a
              // workspace, and advice pointing at a control that is not on
              // the screen is worse than the shorter sentence.
              (currentOrg
                ? 'browse your organization’s media library, where you can ' +
                  'upload an image, or paste an https link.'
                : 'paste an https link to an image.')}
          </Alert>
        ) : null}
        <MediaUrlField
          label="Image URL"
          helperText={`Browse the org media library to upload or pick an image, or paste an https URL. ${AVATAR_HINT}`}
          orgId={currentOrg?.$id ?? null}
          value={photoUrl}
          onChange={setPhotoUrl}
        />
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            color="primary"
            onClick={() => void handlePhotoSave()}
          >
            {'Save'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
ProfileImageCard.displayName = 'ProfileImageCard'

export default ProfileImageCard
