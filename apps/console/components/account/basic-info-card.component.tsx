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

import { normalizeAddress, normalizePhone } from '@aglyn/aglyn'
import {
  FIELD_SCHEMA_ADDRESS_CITY,
  FIELD_SCHEMA_ADDRESS_COUNTRY,
  FIELD_SCHEMA_ADDRESS_LINE1,
  FIELD_SCHEMA_ADDRESS_LINE2,
  FIELD_SCHEMA_ADDRESS_POSTAL_CODE,
  FIELD_SCHEMA_ADDRESS_STATE,
  FIELD_SCHEMA_FIRST_NAME,
  FIELD_SCHEMA_LAST_NAME,
  FIELD_SCHEMA_ORGANIZATION_NAME,
  FIELD_SCHEMA_PHONE_NUMBER,
} from '@aglyn/shared-data-forms'
import { CardDisplay, useLoading } from '@aglyn/shared-ui-jsx'
import {
  FormRenderer,
  FormSchema,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { Alert, Typography } from '@mui/material'
import { updateProfile } from 'firebase/auth'
import { deleteField, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useCallback } from 'react'
import CardDisplayFormTemplate from '../card-display-form-template'
import { docsHelp } from '../../constants/docs-links'
import useFirestoreDoc from '../../hooks/use-firestore-doc'

const basicSchema: FormSchema = {
  id: 'basic',
  title: 'Basic info',
  CardDisplayProps: {
    help: docsHelp('account', {
      excerpt:
        'Your name and contact details, stored on your personal console ' +
        'account and shown to teammates.',
    }),
  },
  fields: [
    FIELD_SCHEMA_FIRST_NAME,
    FIELD_SCHEMA_LAST_NAME,
    FIELD_SCHEMA_PHONE_NUMBER,
    FIELD_SCHEMA_ORGANIZATION_NAME,
    // AGL-1133. Personal, and deliberately NOT mirrored onto the org roster:
    // a roster doc is readable by every org member and every site
    // collaborator (AGL-1122/1026), which is fine for a display name and
    // squarely wrong for a home address.
    FIELD_SCHEMA_ADDRESS_LINE1,
    FIELD_SCHEMA_ADDRESS_LINE2,
    FIELD_SCHEMA_ADDRESS_CITY,
    FIELD_SCHEMA_ADDRESS_STATE,
    FIELD_SCHEMA_ADDRESS_POSTAL_CODE,
    FIELD_SCHEMA_ADDRESS_COUNTRY,
  ],
}

/**
 * Name, contact details and address on the personal console account
 * (AGL-1133).
 *
 * The Basic info section of Manage Account, its own component since the
 * sections became routes (AGL-693).
 */
export function BasicInfoCard() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const userRef = doc(firestore, 'users', user.uid)
  // `status` is not optional here (AGL-1143). A DENIED read and an EMPTY
  // document both arrive as `data === undefined`, and this form seeds itself
  // from `data` — so on a denied read it painted blank over a populated
  // document and a save would have written those blanks back. SSO accounts hit
  // exactly that on every client-side Firestore read, and the page reported
  // "up to date" while doing it.
  const {
    data,
    status: profileStatus,
    error: profileError,
    /**
     * The seeding snapshot is unconfirmed by the server (AGL-1356). The
     * guard below cannot rely on `profileStatus` alone: under
     * `persistentLocalCache` a refused listen still emits cached snapshots,
     * so a cache-served seed reads as a healthy `'success'` no matter what
     * the retry budget does.
     */
    fromCache: profileFromCache,
  } = useFirestoreDoc(() => userRef, [firestore, user.uid])
  /** The read failed — as opposed to succeeding and finding nothing. */
  const profileUnreadable = profileStatus === 'error'
  /**
   * The read failed AND there is nothing to put in the form (AGL-1066).
   *
   * The AGL-1143 replacement below hides the form so a blank cannot be saved
   * over a real value — which is right when the read produced nothing, and
   * wrong once a refused listen can reach `'error'` while
   * `persistentLocalCache` is still serving the profile. In that state the
   * form is populated with the user's real (if unconfirmed) values, and
   * ripping it out tells them their profile is gone when it is not. The SAVE
   * is still refused either way: `profileUnreadable` and `profileFromCache`
   * both feed the seed guard.
   */
  const profileUnreadableAndEmpty = profileUnreadable && !data

  const handleBasicSave = useCallback(
    async (fields: any) => {
      /**
       * Never write over a document we could not read (AGL-1143), and never
       * over one we could read but cannot TRUST (AGL-1356).
       *
       * This write is `{...fields}` — every field of the form, seeded from
       * the profile listener — so `merge: true` protects nothing, and the
       * address block is REPLACED outright (see AGL-1133 below). Saving one
       * change therefore rewrites everything else to whatever the seed held.
       *
       * The guard WRAPS the write rather than preceding it: an early return
       * is a shape you can keep while losing the protection, and the two
       * guards that used to sit here were both unreachable on this page —
       * `status === 'error'` because a cached emission resets the retry
       * budget so it never errors, and `staleSession` because this page
       * issues no labelled one-shot read and so can never reach the
       * two-collection threshold. `fromCache` is what actually catches it.
       */
      const dequeueLoading = queueLoading()
      try {
        const verdict = await writeGuardedBySeed(
          {
            subject: 'profile',
            unreadable: profileUnreadable,
            fromCache: profileFromCache,
          },
          async () => {
            // Normalize before storing, not after reading (AGL-1133).
            // Production held a bare ten-digit `phoneNumber` with no country
            // code — which is unusable for SMS or for a Stripe customer, and
            // every later reader would have had to guess a country to fix it.
            //
            // The whole address is REPLACED rather than merged: Firestore
            // merges nested maps key by key, so clearing one line would
            // silently leave the old value behind. `normalizeAddress` returns
            // null for an empty address, and null here means "no address",
            // not "an object of empty strings" — which every `if (address)`
            // in the codebase would read as having one.
            const normalizedPhone = normalizePhone(fields?.phoneNumber)
            const address = normalizeAddress(fields?.address)
            await setDoc(
              userRef,
              {
                ...fields,
                // Keep exactly what was typed if it cannot be normalized
                // confidently, rather than dropping the user's data on the
                // floor. The field's own validator is what stops nonsense
                // arriving here.
                phoneNumber: normalizedPhone ?? fields?.phoneNumber ?? null,
                address,
                // CLEARING THE ADDRESS IS AN ERASURE REQUEST (AGL-1963).
                //
                // `seedUserProfile` prefills an absent address from the IdP on
                // EVERY sign-in, so without this marker emptying the field
                // here is undone the next time an SSO user signs in — from
                // the customer's own directory, with no trace, and the
                // honoured request looks identical to the resurrected value.
                // Nobody files a ticket to remove a street address; they
                // empty the box on this page, which makes this the erasure
                // surface that actually gets used.
                //
                // Symmetric on purpose, so it needs no knowledge of the prior
                // value: saving an address CLEARS the marker, because someone
                // typing one back in has changed their mind and is asking for
                // prefill again. Same reasoning as the phone marker being
                // owner-writable — the only party who can undo this is the
                // person it protects.
                addressErasedAt: address ? deleteField() : serverTimestamp(),
              },
              { merge: true },
            )
            // Keep Firebase Auth's displayName in step (AGL-852): rosters and
            // comments read it, so without this a name edit here was
            // invisible to teammates. Best-effort — a failed sync must not
            // fail the save.
            const displayName = [
              String(fields?.[FIELD_SCHEMA_FIRST_NAME.name] ?? '').trim(),
              String(fields?.[FIELD_SCHEMA_LAST_NAME.name] ?? '').trim(),
            ]
              .filter(Boolean)
              .join(' ')
            if (displayName && displayName !== user?.displayName) {
              try {
                await updateProfile(user, { displayName })
              } catch (error) {
                console.error('displayName sync failed', error)
              }
            }
          },
        )
        if (!verdict.ok) {
          // Say why, and what to do about it. A refused save that reports
          // nothing sends the user back to retype a form that will be
          // refused again just as quietly.
          enqueueSnackbar(verdict.message, { variant: 'error' })
          return
        }
        enqueueSnackbar('Saved!', { variant: 'success' })
      } catch (e) {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
      } finally {
        dequeueLoading()
      }
    },
    [
      enqueueSnackbar,
      profileUnreadable,
      profileFromCache,
      queueLoading,
      userRef,
      user,
    ],
  )

  // Show the failure instead of an empty form (AGL-1143). Rendering the form
  // would invite the user to retype fields we simply could not read, and
  // saving merges — so a blank field deletes the real value.
  if (profileUnreadableAndEmpty) {
    return (
      <CardDisplay
        header="Basic info"
        help={docsHelp('manageAccount', {
          excerpt:
            'Your name and contact details, as they appear to teammates across ' +
            'every organization you belong to.',
        })}
        contentGutterX
        contentGutterY
      >
        <Alert severity="error" sx={{ maxWidth: 560 }}>
          {'We could not load your profile, so it is not shown here — the ' +
            'form is hidden rather than blank, because saving a blank form ' +
            'would overwrite what is stored. Nothing has been changed. ' +
            'Reload the page to try again.'}
          {profileError?.code ? (
            <Typography variant="caption" component="div" sx={{ mt: 1 }}>
              {`Reason: ${profileError.code}`}
            </Typography>
          ) : null}
        </Alert>
      </CardDisplay>
    )
  }

  return (
    <FormRenderer
      FormTemplate={CardDisplayFormTemplate}
      componentMapper={simpleComponentMapper}
      onSubmit={handleBasicSave}
      schema={basicSchema}
      subscription={{ values: true }}
      initialValues={data}
    />
  )
}
BasicInfoCard.displayName = 'BasicInfoCard'

export default BasicInfoCard
