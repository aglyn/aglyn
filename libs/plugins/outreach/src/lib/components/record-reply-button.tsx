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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { collection, doc, limit, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { outreachEnrollmentHasInbound, outreachMailboxAddress } from '../engine/manual-reply'
import { OUTREACH_COLLECTIONS, type OutreachEnrollment, type OutreachMailbox } from '../model/outreach.types'
import { readStoredOutreachEnrollment, readStoredOutreachMailbox } from '../model/stored-records'
import { OutreachReplyDialog } from './reply-dialog'
import { useOutreachApi } from './use-outreach-api'

/**
 * "REPLY IN THREAD FROM <MAILBOX>" ON A CRM RECORD (AGL-4020), in the
 * record header's `crmRecordEmailActions` zone, before the CRM's own Send
 * email.
 *
 * Send email starts a new message from the site's sending address; a person
 * who answered a sequence is answered in that thread, from the mailbox that
 * wrote to them. So once one of their enrollments holds something they wrote
 * — or was stopped by their reply — the header offers that first, and opens
 * the same composer the enrollment's own page does. Nothing is drawn for a
 * person no sequence has heard from, one who opted out or bounced, or a
 * reader the Sequences rules do not let read enrollments.
 *
 * The props are the CRM zone's, restated here: a plugin never imports
 * another plugin's package.
 */

export interface OutreachRecordReplyButtonProps {
  hostId: string | null
  orgId: string | undefined
  kind: 'contact' | 'lead'
  recordId: string
  name: string
  email: string | null
}

/** The most enrollments of one address read; a person is in few sequences. */
const ENROLLMENTS_READ_MAX = 20

/** When the person last wrote, or was last heard from: what picks the thread to answer. */
const lastHeardMs = (enrollment: OutreachEnrollment) =>
  Math.max(
    enrollment.inboundMessages?.at(-1)?.atMs ?? 0,
    enrollment.stopReason === 'reply' ? (enrollment.stoppedAtMs ?? 0) : 0,
  )

/**
 * The enrollment an answer from the record goes into: of the person's
 * enrollments that heard from them, the one that heard from them last. Not
 * one that opted out or bounced.
 */
export function outreachEnrollmentToAnswer(enrollments: readonly OutreachEnrollment[]): OutreachEnrollment | null {
  return (
    enrollments
      .filter(
        (enrollment) =>
          outreachEnrollmentHasInbound(enrollment) &&
          enrollment.status !== 'opted_out' &&
          enrollment.status !== 'bounced',
      )
      .sort((a, b) => lastHeardMs(b) - lastHeardMs(a))[0] ?? null
  )
}

export function OutreachRecordReplyButton(props: OutreachRecordReplyButtonProps) {
  const { orgId } = props
  const firestore = useFirestore()
  const api = useOutreachApi(orgId ?? null)
  const email = normalizeContactEmail(props.email)
  const [enrollment, setEnrollment] = useState<OutreachEnrollment | null>(null)
  const [mailbox, setMailbox] = useState<OutreachMailbox | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setEnrollment(null)
    if (!orgId || !email) return undefined
    return onSnapshot(
      query(
        collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.enrollments),
        where('email', '==', email),
        limit(ENROLLMENTS_READ_MAX),
      ),
      (snapshot) =>
        setEnrollment(
          outreachEnrollmentToAnswer(
            snapshot.docs
              .map((entry) => readStoredOutreachEnrollment(entry.id, entry.data()))
              .filter((entry): entry is OutreachEnrollment => entry !== null),
          ),
        ),
      // A reader the rules refuse simply has nothing to answer from here.
      () => setEnrollment(null),
    )
  }, [firestore, orgId, email])

  const mailboxId = enrollment?.mailboxId ?? null
  useEffect(() => {
    setMailbox(null)
    if (!orgId || !mailboxId) return undefined
    return onSnapshot(
      doc(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.mailboxes, mailboxId),
      (snapshot) => setMailbox(readStoredOutreachMailbox(snapshot.id, snapshot.exists() ? snapshot.data() : undefined)),
      () => setMailbox(null),
    )
  }, [firestore, orgId, mailboxId])

  if (!enrollment || !mailbox) return null
  return (
    <>
      <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
        {`Reply in thread from ${outreachMailboxAddress(mailbox)}`}
      </Button>
      <OutreachReplyDialog
        enrollment={open ? enrollment : null}
        api={api}
        timeZone={mailbox.timezone}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
OutreachRecordReplyButton.displayName = 'OutreachRecordReplyButton'

export default OutreachRecordReplyButton
