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

/**
 * WRITING ONE EMAIL — its own route, and its own card.
 *
 * ## Why it is not on the message's page
 *
 * `/emails/messages/{emailId}` answers "what did this email do": delivery,
 * engagement, every rate over its own denominator, the links that were
 * followed and who it reached. Writing the thing is a different job with a
 * different shape — a form, a preview, and one irreversible button — and
 * carrying both on one route made the reader of a report scroll past a
 * composer and the writer of an email scroll past a table of zeros.
 *
 * So the record's page reports, and `…/edit` writes. It is the grammar this
 * surface already reads by: an audience is `…/audiences/{listId}` and its
 * settings are `…/audiences/{listId}/edit`, and a screen's page and its
 * besigner are two addresses for the same reason. Creating is still a drawer
 * on the list — it collects the name, mints the record and routes here — so no
 * list on this surface carries a form above it.
 *
 * ## Why the card is HERE and not inside the composer
 *
 * The composer is also mounted inside the campaign detail card, which already
 * supplies a card of its own; a `CardDisplay` in the component would nest one
 * inside another there. The surface owns the chrome, exactly as `ListEditCard`
 * owns the chrome around the audience rule fields.
 *
 * ## What may be edited
 *
 * Only an email that is still unsent. The route enforces it too — `schedule`
 * and `draft` answer 409 on a sent or canceled record — and this is the same
 * refusal said before the merchant types rather than after they press Send. An
 * email PART WAY THROUGH a send is stored as `scheduled` between batches, so
 * the stored status alone would let somebody rewrite the copy of a message
 * that is already reaching inboxes; `campaignSendDisplay` is what tells the
 * two apart.
 */

import { pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Typography } from '@mui/material'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import {
  campaignSendDisplay,
  CAMPAIGN_SEND_CONTAINER_FIELD,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-container'
import CampaignComposer from './campaign-composer'

const composeDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#send-a-campaign',
  excerpt:
    'Everything one email decides: who it goes to, how it is written, who ' +
    'it appears to come from, and how many people it reaches.',
})

export interface EmailComposeCardProps {
  hostId: string
  /** The message document under `hosts/{hostId}/campaigns`. */
  emailId: string
  /** The emails hub URL, for the way back to the message's own page. */
  basePath: string
}

export function EmailComposeCard(props: EmailComposeCardProps) {
  const { hostId, emailId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()

  const { data: email, status } = useFirestoreDoc<Record<string, any>>(
    () => doc(firestore, 'hosts', hostId, 'campaigns', emailId),
    [firestore, hostId, emailId],
  )

  const detailHref = `${basePath}/messages/${emailId}`
  const headerActions = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={detailHref}
      size="small"
      color="primary"
    >
      {'Back to the email'}
    </Button>
  )

  const subject = String(email?.subject ?? '')
  const displayName = String(email?.displayName ?? '')
  const state = String(email?.status ?? '')
  const display = email ? campaignSendDisplay(email as never) : null
  const editable =
    (state === 'draft' || state === 'scheduled') && display?.state !== 'sending'

  /**
   * Why this email cannot be written, in the words that say what to do next.
   *
   * Empty while it still can be. Each case is a different fact about the
   * record and not a variation on "no": one has not loaded, one is in inboxes
   * already, one is being delivered right now.
   */
  const refusal = !email
    ? status === 'loading'
      ? 'Loading this email…'
      : 'This email could not be loaded. It may have been deleted.'
    : editable
      ? ''
      : display?.state === 'sending'
        ? 'This email is being sent right now, so its message can no longer ' +
          'be changed. Its page reports what it has reached so far.'
        : state === 'sent'
          ? 'This email has been sent, so its subject, message and audience ' +
            'describe mail that is already in inboxes. Compose a new email ' +
            'to say something else.'
          : 'This email was canceled, so it can no longer be written or put ' +
            'back on the schedule. Compose a new email.'

  return (
    <CardDisplay
      header={subject || displayName || 'Untitled email'}
      subheader={'Write this email'}
      help={composeDocsHelp}
      contentGutterX
      contentGutterY
      HeaderProps={{ action: headerActions }}
    >
      {refusal ? (
        <Typography variant="body2" color="text.secondary">
          {refusal}
        </Typography>
      ) : (
        <CampaignComposer
          hostId={hostId}
          campaignId={emailId}
          emailCampaignId={
            email?.[CAMPAIGN_SEND_CONTAINER_FIELD]
              ? String(email[CAMPAIGN_SEND_CONTAINER_FIELD])
              : undefined
          }
          displayName={displayName || undefined}
          initial={{
            subject,
            body: String(email?.body ?? ''),
            fromName: String(email?.fromName ?? ''),
            replyTo: String(email?.replyTo ?? ''),
            /*
             * The sender this email is set to go out as, so reopening a draft
             * does not silently move it onto whichever sender has become the
             * site's default since it was saved.
             */
            senderId: String(email?.senderId ?? ''),
            preheader: String(email?.preheader ?? ''),
            audience: String(email?.audience ?? ''),
            listId: String(email?.listId ?? ''),
            segmentId: String(email?.segmentId ?? ''),
            topicId: String(email?.topicId ?? ''),
            /*
             * Which of the two ways this email is written. The composer
             * resolves the mode from this field through the same function the
             * send path reads, so a designed draft reopens designed.
             */
            templateScreenId: String(email?.templateScreenId ?? ''),
            /*
             * The plain-text half, and the design version it was written
             * against. Absent means the design generates it — the composer
             * reads that through the same resolver the record's shape is
             * defined by, so a stale override is named rather than guessed at.
             */
            plainText: String(email?.plainText ?? ''),
            plainTextVersionId: String(email?.plainTextVersionId ?? ''),
          }}
          /*
           * A send or a schedule lands on the record, and the record's page is
           * where its report will be — so the merchant is left looking at what
           * they just did rather than at the form that did it.
           */
          onSent={() => router.push(detailHref)}
        />
      )}
    </CardDisplay>
  )
}
EmailComposeCard.displayName = 'EmailComposeCard'

export default EmailComposeCard
