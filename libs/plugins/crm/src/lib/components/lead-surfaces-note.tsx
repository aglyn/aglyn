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

import { buildRoute, Route } from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Button, Stack, Tooltip, Typography } from '@mui/material'
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  LEAD_SURFACE_FORMS_WINDOW,
  type LeadSurfaceForm,
  leadSurfaceForms,
} from '../model/lead-surfaces'

export interface LeadSurfacesNoteProps {
  hostId: string
}

/**
 * WHAT CREATES A LEAD ON THIS SITE (AGL-2612).
 *
 * Every capture lands in Contacts; a LEAD is filed only by a lead surface —
 * a member sign-up, a booking, or a form whose author declared
 * `routing.lead`. The first two are always on and the third is a switch on
 * each form's own page, which left the Leads list unable to say why one
 * form's people were in it and another's were not. This says so, by name,
 * and offers the switch here for the forms that could carry it.
 *
 * ## What it reads
 *
 * The site's forms, ordered by id and bounded at one past the window — the
 * same read the Inbox's form picker makes, ordered by `__name__` because a
 * form saved without a display name would otherwise fall out of an ordered
 * query and vanish from a list about routing. Host-scoped by path, so any
 * member of the site may read it and no scope predicate is needed.
 *
 * ## The switch
 *
 * One dotted `updateDoc` on `routing.lead`, so a dataset binding beside it
 * is untouched, under the same host-content write the form's page makes.
 * Offered only where `leadSurfaceForms` says the publish check would honor
 * it — a form with no email field is refused with the reason as the
 * tooltip, because a switch that flips and then fails at publish is the
 * exact confusion this note exists to remove. A consent field is not a
 * precondition: it is what makes a lead MAILABLE, and the note says so
 * rather than refusing on it.
 */
export function LeadSurfacesNote(props: LeadSurfacesNoteProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)

  const { data: formDocs, status } = useFirestoreCollection<
    Record<string, unknown> & { $id: string }
  >(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'forms'),
        orderBy('__name__'),
        limit(LEAD_SURFACE_FORMS_WINDOW + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const truncated = (formDocs?.length ?? 0) > LEAD_SURFACE_FORMS_WINDOW
  const forms = useMemo(
    () => leadSurfaceForms((formDocs ?? []).slice(0, LEAD_SURFACE_FORMS_WINDOW)),
    [formDocs],
  )
  const routed = forms.filter((form) => form.routed)
  const unrouted = forms.filter((form) => !form.routed)

  const formHref = useCallback(
    (formId: string) =>
      orgSlug && host
        ? buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId })
        : null,
    [orgSlug, host],
  )

  const [turningOn, setTurningOn] = useState<string | null>(null)
  const turnOn = useCallback(
    async (form: LeadSurfaceForm) => {
      if (turningOn) return
      setTurningOn(form.$id)
      try {
        await updateDoc(doc(firestore, 'hosts', hostId, 'forms', form.$id), {
          'routing.lead': true,
          updatedAt: serverTimestamp(),
        })
        enqueueSnackbar(
          `"${form.displayName}" now files a lead from every submission ` +
            'that carries an email address.',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Lead routing could not be turned on.', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setTurningOn(null)
      }
    },
    [turningOn, firestore, hostId, enqueueSnackbar],
  )

  const formName = (form: LeadSurfaceForm) => {
    const href = formHref(form.$id)
    return href ? (
      <AppLink key={form.$id} href={href}>
        {form.displayName}
      </AppLink>
    ) : (
      <span key={form.$id}>{form.displayName}</span>
    )
  }

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary" component="div">
        {'Leads are created by member sign-ups, bookings, and forms with lead routing on'}
        {status === 'loading' ? (
          '…'
        ) : routed.length ? (
          <>
            {': '}
            {routed.map((form, index) => (
              <span key={form.$id}>
                {index ? ', ' : ''}
                {formName(form)}
              </span>
            ))}
            {truncated ? ', and possibly more' : ''}
            {'.'}
          </>
        ) : (
          ' — no form routes leads yet.'
        )}
        {' Every submission with an email address also updates the contact in Contacts at stage Lead.'}
      </Typography>
      {unrouted.length ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <Typography variant="caption" color="text.secondary">
            {'Not routing leads:'}
          </Typography>
          {unrouted.map((form) => (
            <Stack
              key={form.$id}
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="caption" component="span">
                {formName(form)}
              </Typography>
              {/*
                Disabled with the reason as its tooltip rather than absent:
                an absent control and an inapplicable one look alike, and
                only one of them says what to do about it.
              */}
              <Tooltip
                title={
                  form.blocker ??
                  (form.hasConsentField
                    ? ''
                    : 'Turns on without a consent field. A lead is mailable ' +
                      'only once the form names one on its own page.')
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="text"
                    disabled={!form.canRoute || turningOn !== null}
                    onClick={() => void turnOn(form)}
                  >
                    {turningOn === form.$id ? 'Turning on…' : 'Turn on lead routing'}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}
LeadSurfacesNote.displayName = 'LeadSurfacesNote'

export default LeadSurfacesNote
