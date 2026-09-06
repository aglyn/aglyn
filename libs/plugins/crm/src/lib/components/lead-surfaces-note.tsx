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

/** The always-on surfaces, named once wherever the note is drawn. */
export const LEAD_SURFACES_INTRO =
  'Leads are created by member sign-ups, bookings, and forms with lead routing on'
/** What every capture does whether or not it files a lead. */
export const LEAD_SURFACES_CONTACTS_TOO =
  'Every submission with an email address also updates the contact in Contacts at stage Lead.'

/** One site's forms, sorted into the two answers the note gives. */
export interface LeadSurfaceFormsResult {
  /** `routing.lead` is on: every submission with an address files a lead. */
  routed: LeadSurfaceForm[]
  /** The rest, each with its verdict on whether the switch may be offered. */
  unrouted: LeadSurfaceForm[]
  /** The site has more forms than the window; the lists are not the whole answer. */
  truncated: boolean
  status: ReturnType<typeof useFirestoreCollection>['status']
}

/**
 * The site's forms, ordered by id and bounded at one past the window — the
 * same read the Inbox's form picker makes, ordered by `__name__` because a
 * form saved without a display name would otherwise fall out of an ordered
 * query and vanish from a list about routing. Host-scoped by path, so any
 * member of the site may read it and no scope predicate is needed.
 *
 * One listener per call, so a note that groups several sites mounts one
 * reader per site it shows and nothing for a site it has not opened.
 */
export function useLeadSurfaceForms(hostId: string): LeadSurfaceFormsResult {
  const firestore = useFirestore()
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
  return useMemo(() => {
    const forms = leadSurfaceForms(formDocs.slice(0, LEAD_SURFACE_FORMS_WINDOW))
    return {
      routed: forms.filter((form) => form.routed),
      unrouted: forms.filter((form) => !form.routed),
      truncated: formDocs.length > LEAD_SURFACE_FORMS_WINDOW,
      status,
    }
  }, [formDocs, status])
}

/** The form a switch is mid-flight on — under which site, since a form id is only unique within one. */
export interface LeadRoutingTarget {
  hostId: string
  formId: string
}

/**
 * The switch: one dotted `updateDoc` on `routing.lead`, so a dataset binding
 * beside it is untouched, under the same host-content write the form's page
 * makes. One at a time, whichever site the form is on — two switches in
 * flight would be two toasts racing for the same reader.
 *
 * `siteName` rides into the toast when the note shows more than one site,
 * because "Contact now files a lead" is an incomplete sentence to a reader
 * who can see three forms called Contact.
 */
export function useTurnOnLeadRouting(): {
  turningOn: LeadRoutingTarget | null
  turnOn: (target: {
    hostId: string
    form: LeadSurfaceForm
    siteName?: string | null
  }) => Promise<void>
} {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [turningOn, setTurningOn] = useState<LeadRoutingTarget | null>(null)
  const turnOn = useCallback(
    async ({
      hostId,
      form,
      siteName,
    }: {
      hostId: string
      form: LeadSurfaceForm
      siteName?: string | null
    }) => {
      if (turningOn) return
      setTurningOn({ hostId, formId: form.$id })
      const where = siteName ? ` on ${siteName}` : ''
      try {
        await updateDoc(doc(firestore, 'hosts', hostId, 'forms', form.$id), {
          'routing.lead': true,
          updatedAt: serverTimestamp(),
        })
        enqueueSnackbar(
          `"${form.displayName}"${where} now files a lead from every submission ` +
            'that carries an email address.',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`Lead routing could not be turned on${where}.`, {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setTurningOn(null)
      }
    },
    [turningOn, firestore, enqueueSnackbar],
  )
  return { turningOn, turnOn }
}

/** A form by name, linked to its own page when the console can address it. */
export function LeadSurfaceFormName(props: {
  form: LeadSurfaceForm
  href: string | null
}) {
  const { form, href } = props
  return href ? (
    <AppLink href={href}>{form.displayName}</AppLink>
  ) : (
    <span>{form.displayName}</span>
  )
}
LeadSurfaceFormName.displayName = 'LeadSurfaceFormName'

/** The routed forms as one clause — "A, B, and possibly more" — for a sentence to end. */
export function LeadSurfaceFormList(props: {
  forms: LeadSurfaceForm[]
  truncated: boolean
  formHref: (formId: string) => string | null
}) {
  const { forms, truncated, formHref } = props
  return (
    <>
      {forms.map((form, index) => (
        <span key={form.$id}>
          {index ? ', ' : ''}
          <LeadSurfaceFormName form={form} href={formHref(form.$id)} />
        </span>
      ))}
      {truncated ? ', and possibly more' : ''}
    </>
  )
}
LeadSurfaceFormList.displayName = 'LeadSurfaceFormList'

/**
 * "Not routing leads:" — every form that does not route, with the switch
 * beside the ones that could and the reason beside the ones that cannot.
 *
 * Offered only where `leadSurfaceForms` says the publish check would honor
 * it — a form with no email field, or one that records no consent, is
 * refused with the reason as the tooltip, because a switch that flips and
 * then fails at publish is the exact confusion this note exists to remove.
 */
export function UnroutedLeadSurfaces(props: {
  hostId: string
  forms: LeadSurfaceForm[]
  formHref: (formId: string) => string | null
  turningOn: LeadRoutingTarget | null
  onTurnOn: (form: LeadSurfaceForm) => void
}) {
  const { hostId, forms, formHref, turningOn, onTurnOn } = props
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
    >
      <Typography variant="caption" color="text.secondary">
        {'Not routing leads:'}
      </Typography>
      {forms.map((form) => {
        const pending =
          turningOn?.hostId === hostId && turningOn.formId === form.$id
        return (
          <Stack
            key={form.$id}
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center' }}
          >
            <Typography variant="caption" component="span">
              <LeadSurfaceFormName form={form} href={formHref(form.$id)} />
            </Typography>
            {/*
              Disabled with the reason as its tooltip rather than absent:
              an absent control and an inapplicable one look alike, and
              only one of them says what to do about it.
            */}
            <Tooltip title={form.blocker ?? ''}>
              <span>
                <Button
                  size="small"
                  variant="text"
                  disabled={!form.canRoute || turningOn !== null}
                  onClick={() => onTurnOn(form)}
                >
                  {pending ? 'Turning on…' : 'Turn on lead routing'}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        )
      })}
    </Stack>
  )
}
UnroutedLeadSurfaces.displayName = 'UnroutedLeadSurfaces'

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
 * The reader, the switch and the two rows are shared with the
 * organization-level note (`OrgLeadSurfacesNote`), which draws them once
 * per site; this is the one-site composition. The form links resolve the
 * site's console route from the host index, because under a site that is
 * the only address the note is handed.
 */
export function LeadSurfacesNote(props: LeadSurfacesNoteProps) {
  const { hostId } = props
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)
  const { routed, unrouted, truncated, status } = useLeadSurfaceForms(hostId)
  const { turningOn, turnOn } = useTurnOnLeadRouting()

  const formHref = useCallback(
    (formId: string) =>
      orgSlug && host
        ? buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId })
        : null,
    [orgSlug, host],
  )

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary" component="div">
        {LEAD_SURFACES_INTRO}
        {status === 'loading' ? (
          '…'
        ) : routed.length ? (
          <>
            {': '}
            <LeadSurfaceFormList forms={routed} truncated={truncated} formHref={formHref} />
            {'.'}
          </>
        ) : (
          ' — no form routes leads yet.'
        )}
        {` ${LEAD_SURFACES_CONTACTS_TOO}`}
      </Typography>
      {unrouted.length ? (
        <UnroutedLeadSurfaces
          hostId={hostId}
          forms={unrouted}
          formHref={formHref}
          turningOn={turningOn}
          onTurnOn={(form) => void turnOn({ hostId, form })}
        />
      ) : null}
    </Stack>
  )
}
LeadSurfacesNote.displayName = 'LeadSurfacesNote'

export default LeadSurfacesNote
