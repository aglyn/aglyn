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

import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  mdiCalendarClockOutline,
  mdiCloseCircleOutline,
  mdiDeleteOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import {
  campaignLinkReport,
  campaignReport,
  type CampaignLinkRollup,
  type CampaignStats,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-report'
import {
  campaignSendDisplay,
  CAMPAIGN_SEND_CONTAINER_FIELD,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-container'
import {
  emailAudienceLabel,
  emailIsUnsent,
  emailSendTimeMs,
} from '@aglyn/shared-ui-email-campaigns/model/email-record'
import CampaignComposer from './campaign-composer'
import { useMarketingHubPath } from './use-marketing-hub-path'
import EmailDesignPreview from './email-design-preview'
import EmailEditDrawer from './email-edit-drawer'
import EmailRecipientsCard from './email-recipients-card'
import {
  Figure,
  percent,
  RateRow,
  Section,
} from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import {
  useCampaignManageApi,
  useCampaignSendApi,
} from './use-campaign-send-api'

const previewDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#the-campaign-report',
  excerpt:
    'The email as an inbox receives it, drawn by the same renderer the send ' +
    'path uses. Merge tokens are left standing — a real send fills them from ' +
    'each recipient.',
})

const emailDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#the-campaign-report',
  excerpt:
    'One email: what it looked like, who it went to, what was delivered, ' +
    'and which links were followed — each rate over the population it is ' +
    'measured against.',
})

export interface EmailDetailProps {
  hostId: string
  /** The message document under `hosts/{hostId}/campaigns`. */
  emailId: string
  /** The emails hub URL, for the way back and for sibling links. */
  basePath: string
}

/**
 * ONE MESSAGE: what it looked like, where it went, and what it did.
 *
 * ## The template it was built from, drawn as it stands NOW
 *
 * The preview renders the template's CURRENT version, because the HTML that
 * was actually mailed is not stored — it is rendered per recipient at send
 * time, with that recipient's merge values in it, and keeping a copy per
 * message would be a copy of the whole email per address. So a message sent
 * before its template was last edited previews as the template is today, and
 * the frame says so rather than letting a reader take it for a record of what
 * went out.
 *
 * ## Every rate names its denominator
 *
 * The arithmetic is `campaign-report.ts` — the same pure module the campaign
 * report reads — so open rate over `delivered` and click rate over `delivered`
 * are computed once, carry their own denominator labels, and come back `null`
 * rather than 0% when they cannot honestly be taken. Nothing on this screen
 * divides anything.
 *
 * ## What this page reads
 *
 * Four documents: the message, its link rollup, the template screen and the
 * template's version. None of them grows with the size of the send. The
 * recipient list is the one read that does, and it is its own card with its
 * own request.
 */
export function EmailDetail(props: EmailDetailProps) {
  const { hostId, emailId, basePath } = props
  // The sibling hub: a campaign's page belongs to the Marketing console.
  const marketingHub = useMarketingHubPath()
  const firestore = useFirestore()

  const { data: email, status } = useFirestoreDoc<
    Record<string, any> & { stats?: CampaignStats }
  >(
    () => doc(firestore, 'hosts', hostId, 'campaigns', emailId),
    [firestore, hostId, emailId],
  )
  const notFound = status !== 'loading' && !email

  /*
   * The link rollup, its own document rather than a field on the message.
   *
   * A map of destinations grows with the content, and the message document is
   * read by the list, the glance widget and the send path; putting an
   * unbounded map on it would make every one of those reads larger.
   */
  const { data: links } = useFirestoreDoc<CampaignLinkRollup>(
    () =>
      doc(firestore, 'hosts', hostId, 'campaigns', emailId, 'reports', 'links'),
    [firestore, hostId, emailId],
  )

  const templateScreenId: string | undefined = email?.templateScreenId
  const { data: template } = useFirestoreDoc<any>(
    () =>
      templateScreenId
        ? doc(firestore, 'hosts', hostId, 'screens', templateScreenId)
        : null,
    [firestore, hostId, templateScreenId],
  )
  const templateVersionId: string | undefined = template?.versionId
  const { data: templateVersion } = useFirestoreDoc<any>(
    () =>
      templateScreenId && templateVersionId
        ? doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            templateScreenId,
            'versions',
            templateVersionId,
          )
        : null,
    [firestore, hostId, templateScreenId, templateVersionId],
  )

  const report = useMemo(() => campaignReport(email?.stats), [email])
  const linkReport = useMemo(() => campaignLinkReport(links), [links])
  const subject = String(email?.subject || 'Untitled email')
  /*
   * The composed body, kept on the send document. A message written without
   * a template still has a rendered HTML part in the inbox, so this is what
   * the preview draws for one.
   */
  const composedBody = String(email?.body ?? '')
  const sendTimeMs = email ? emailSendTimeMs(email) : 0
  const state = String(email?.status ?? '')
  /** What this email is doing, which the stored status alone cannot say. */
  const display = campaignSendDisplay(email as never)
  /**
   * Part way through an audience larger than one batch.
   *
   * Stored as `scheduled` — the state the processor claims to resume it — so
   * every control below that keyed on `scheduled` alone was offering an
   * action about an email that is already going out.
   */
  const midFlight = display.state === 'sending'
  /**
   * This email has not gone to anybody yet.
   *
   * Everything below the state table is a REPORT, and an unsent email has
   * nothing to report — no `stats` at all. Drawing the figures anyway would
   * fill the page with zeros and a delivery rate of 0%, which is the reading
   * "this reached nobody" rather than "this has not been sent", and those are
   * different facts about an email.
   */
  const unsent = emailIsUnsent(email)
  /** The merchant's own name for this email, where one was given. */
  const displayName = String(email?.displayName ?? '')
  /**
   * How many times this email has been sent, and when the last one was.
   *
   * A message written before an email could be sent twice carries neither, and
   * one send is what an absent count means — not zero.
   */
  const sendCount = Number(email?.sendCount ?? 1) || 1
  const lastSentMs = email?.lastSentAt
    ? emailSendTimeMs({ sentAt: email.lastSentAt })
    : 0

  /*
   * The campaign this message belongs to.
   *
   * `emailCampaignId` — {@link CAMPAIGN_SEND_CONTAINER_FIELD} — is the one
   * linkage, and it is deliberately not spelled `campaignId`: on a message
   * document that name already means the message's OWN id, which is what the
   * report route addresses and what every delivered unsubscribe footer
   * carries as `cid=`.
   *
   * The fallback is the migration. A message written before campaigns grouped
   * anything names no container, and its own id IS the campaign the URL
   * resolves — the campaign detail route answers an id it does not recognize
   * as a container with that message's own report.
   */
  const campaignId = String(email?.[CAMPAIGN_SEND_CONTAINER_FIELD] ?? emailId)

  /*==========================================
   * SENDING THIS EMAIL TO MORE PEOPLE.
   *
   * The whole control is a confirmation and one POST. Every decision it looks
   * like it is making — who is left, who is suppressed, whether there is
   * allowance and hourly room — is made by the send path, which is also the
   * path the original send took; asking any of it here would be a second set
   * of rules to disagree with the first.
   *
   * Two requests rather than one, and the first is a READ. `dryRun` runs the
   * whole resolution and writes nothing, so the confirmation can say how many
   * people this would reach before the merchant agrees to it. A send is the
   * one action on this page that cannot be taken back, and "Send to more
   * recipients?" with no number in it is a button nobody can answer honestly.
   *=========================================*/
  const campaignSendApi = useCampaignSendApi(hostId)
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const [sendingMore, setSendingMore] = useState(false)

  const handleSendToMore = useCallback(async () => {
    if (sendingMore) return
    setSendingMore(true)
    try {
      const counted = await campaignSendApi({
        action: 'followUp',
        campaignId: emailId,
        dryRun: true,
      })
      if (!counted.response.ok) {
        return void enqueueSnackbar(
          counted.payload?.error ?? 'This email cannot be sent again',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const reaching = Number(counted.payload?.sendable ?? 0)
      const already = Number(counted.payload?.alreadyReached ?? 0)
      if (!reaching) {
        return void enqueueSnackbar(
          'Everyone in this audience already has this email',
          { variant: 'info', persist: false },
        )
      }
      const agreed = await confirm({
        title: 'Send this email to more people?',
        description:
          `This sends the same email to ${reaching.toLocaleString()} more ` +
          `${reaching === 1 ? 'person' : 'people'} in the same audience. ` +
          `The ${already.toLocaleString()} who already received it are not ` +
          'sent it again, and its report adds the new figures to the ones ' +
          'it already holds.',
        confirmationText: 'Send',
      })
        .then(() => true)
        .catch(() => false)
      if (!agreed) return
      const result = await campaignSendApi({
        action: 'followUp',
        campaignId: emailId,
      })
      if (!result.response.ok) {
        return void enqueueSnackbar(result.payload?.error ?? 'Send failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(
        `Sent to ${Number(result.payload?.sent ?? 0).toLocaleString()} more ` +
          'recipients',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Send failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSendingMore(false)
    }
  }, [campaignSendApi, confirm, emailId, enqueueSnackbar, sendingMore])

  /*==========================================
   * THE LIFECYCLE ACTIONS.
   *
   * Every one of them is one POST to the same route the composer and the
   * scheduled processor use. None of them decides anything: whether an email
   * may be sent now, rescheduled or canceled is decided by the route against
   * the record's stored `status`, so the rules live in one place and the
   * header's job is only to offer the ones that apply.
   *
   * The copy is deliberately NOT sent with any of them. `sendNow` reads the
   * whole message off the record — a request that could also carry a subject
   * and a body would be a way to put arbitrary copy on an existing send id
   * and mail it under that id's unsubscribe scope.
   *=========================================*/
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState<'details' | 'schedule' | null>(null)

  /** One POST, one snackbar, one busy flag — the shape all four share. */
  const runAction = useCallback(
    async (
      key: string,
      request: Record<string, unknown>,
      success: (payload: any) => string,
      failure: string,
    ) => {
      if (busy) return false
      setBusy(key)
      try {
        const { response, payload } = await campaignSendApi({
          campaignId: emailId,
          ...request,
        })
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? failure, {
            variant: 'warning',
            allowDuplicate: true,
          })
          return false
        }
        enqueueSnackbar(success(payload), {
          variant: 'success',
          persist: false,
        })
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar(failure, { variant: 'error', allowDuplicate: true })
        return false
      } finally {
        setBusy('')
      }
    },
    [busy, campaignSendApi, emailId, enqueueSnackbar],
  )

  const handleSendNow = useCallback(async () => {
    /*
     * Counted before it is offered, the same two-request shape the follow-up
     * uses: `dryRun` runs the whole resolution and writes nothing, so the
     * confirmation can name how many people this reaches. "Send this now?"
     * with no number in it is a question nobody can answer honestly, and this
     * is the action on the page that cannot be taken back.
     */
    if (busy) return
    setBusy('sendNow')
    /*
     * `null` for "the count did not happen", which is not the same answer as
     * zero — zero is a real reach that the confirmation would go on to
     * describe, and the failure branches below return rather than reaching it.
     */
    let reaching: number | null = null
    try {
      const counted = await campaignSendApi({
        action: 'sendNow',
        campaignId: emailId,
        dryRun: true,
      })
      if (counted.response.ok) {
        reaching = Number(
          counted.payload?.sendable ?? counted.payload?.sent ?? 0,
        )
      } else {
        enqueueSnackbar(counted.payload?.error ?? 'This email cannot be sent', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Send failed', { variant: 'error', allowDuplicate: true })
    }
    setBusy('')
    if (reaching === null) return
    const agreed = await confirm({
      title: 'Send this email now?',
      description:
        `This sends it to ${reaching.toLocaleString()} ` +
        `${reaching === 1 ? 'person' : 'people'} straight away` +
        (state === 'scheduled'
          ? ', instead of at the time it is scheduled for. '
          : '. ') +
        'It cannot be taken back once it goes.',
      confirmationText: 'Send now',
    })
      .then(() => true)
      .catch(() => false)
    if (!agreed) return
    await runAction(
      'sendNow',
      { action: 'sendNow' },
      (payload) =>
        `Sent to ${Number(payload?.sent ?? 0).toLocaleString()} recipients`,
      'Send failed',
    )
  }, [
    busy,
    campaignSendApi,
    confirm,
    emailId,
    enqueueSnackbar,
    runAction,
    state,
  ])

  /*==========================================
   * STOPPING A SEND, WHICH NOW MEANS TWO DIFFERENT THINGS.
   *
   * `cancel` acts on `scheduled`, and an email delivering an audience larger
   * than one batch is stored as `scheduled` between runs — so the control
   * that withdraws a campaign before it goes also stops one that is half
   * delivered, with no change to the route. That is a real capability, and a
   * merchant watching a send go wrong needs to be told which of the two they
   * are about to do: nothing has been mailed, or two thousand people already
   * have it and are keeping it.
   *=========================================*/
  const handleCancel = useCallback(async () => {
    const reached = display.progress.reached
    const left = display.progress.remaining
    const agreed = await confirm({
      title: midFlight ? 'Stop sending this email?' : 'Cancel this scheduled email?',
      description: midFlight
        ? `It has reached ${reached.toLocaleString()} ` +
          `${reached === 1 ? 'person' : 'people'} so far, and stopping it ` +
          `leaves ${left.toLocaleString()} unaddressed. What has already ` +
          'gone out cannot be taken back — those messages stay in inboxes ' +
          'and keep their unsubscribe links. The email and its report are ' +
          'kept, but a stopped send cannot be resumed; reaching the rest ' +
          'means composing a new email.'
        : 'It will not be sent at the time it is scheduled for. The email ' +
          'and everything written on it are kept, but a canceled email ' +
          'cannot be put back on the schedule — you would compose a new one.',
      confirmationText: midFlight ? 'Stop sending' : 'Cancel send',
    })
      .then(() => true)
      .catch(() => false)
    if (!agreed) return
    await runAction(
      'cancel',
      { action: 'cancel' },
      () =>
        midFlight
          ? 'This email has stopped sending'
          : 'This email will not be sent',
      'This email could not be canceled',
    )
  }, [confirm, display.progress, midFlight, runAction])

  const handleReschedule = useCallback(
    async (values: { sendAtMs?: number }) => {
      const done = await runAction(
        'schedule',
        { action: 'schedule', sendAtMs: values.sendAtMs },
        () =>
          `Scheduled for ${new Date(
            Number(values.sendAtMs ?? 0),
          ).toLocaleString()}`,
        'This email could not be scheduled',
      )
      if (done) setEditing(null)
    },
    [runAction],
  )

  /*==========================================
   * DISCARDING A DRAFT, WHICH IS THE ONE REMOVAL THIS PAGE HAS.
   *
   * Only ever offered on a `draft`, and refused again by the route inside the
   * transaction that deletes — the state on screen is a snapshot, and
   * `sendNow` claims a draft by moving it to `sending` in a transaction of
   * its own, so a check made only here could remove a record the send path
   * was mailing from.
   *
   * A sent email is never discardable from anywhere. Its report is what a
   * merchant answers a complaint with, and its id is inside the HMAC of every
   * unsubscribe link it delivered; a scheduled one is withdrawn with Cancel,
   * which keeps the record and takes it off the clock.
   *
   * The reader is sent back to the list afterwards rather than left on the
   * page of a record that no longer exists — which would render the "could
   * not be loaded" branch and read as a failure.
   *=========================================*/
  const manageApi = useCampaignManageApi(hostId)
  const router = useRouter()

  const handleDiscard = useCallback(async () => {
    const agreed = await confirm({
      title: 'Discard this draft?',
      description:
        'This email has not been sent to anybody, and discarding it removes ' +
        'it for good — the subject, the message and everything else written ' +
        'on it. There is no undo.',
      confirmationText: 'Discard',
    })
      .then(() => true)
      .catch(() => false)
    if (!agreed) return
    if (busy) return
    setBusy('discard')
    try {
      const { response, payload } = await manageApi({
        action: 'discardEmail',
        campaignId: emailId,
      })
      if (!response.ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'This draft could not be discarded',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      enqueueSnackbar('Draft discarded', { variant: 'success', persist: false })
      router.push(`${basePath}/emails`)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('This draft could not be discarded', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy('')
    }
  }, [basePath, busy, confirm, emailId, enqueueSnackbar, manageApi, router])

  const handleRename = useCallback(
    async (values: { displayName?: string }) => {
      const done = await runAction(
        'update',
        { action: 'update', displayName: values.displayName },
        () => 'Name updated',
        'The name could not be updated',
      )
      if (done) setEditing(null)
    },
    [runAction],
  )

  /*==========================================
   * THE HEADER, IN THREE REGISTERS.
   *
   * Navigation reads as navigation — a naked link button, because that is
   * what it is and a reader should be able to tell without clicking. The
   * PRIMARY action of the state is the one contained button, so there is
   * exactly one on the page and it is the thing a merchant came to do.
   * Everything else goes in the overflow, and the two irreversible entries in
   * there are marked `destructive` so they carry the error color rather than
   * sitting in the list looking like "Rename".
   *
   * `RowActionsMenu` is named for table rows and its rendering is not: it is
   * a kebab `IconButton` and a `Menu` whose items support `onClick`,
   * `destructive`, `disabled` and `disabledReason` — exactly what a card
   * header's overflow needs. Reusing it is what keeps the menu on this page
   * behaving like every other overflow menu in the console.
   *=========================================*/
  const scheduled = state === 'scheduled'
  const draft = state === 'draft'
  const sending = state === 'sending'

  const overflowItems: RowActionsMenuItem[] = [
    {
      key: 'rename',
      label: 'Edit details',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      onClick: () => setEditing('details'),
    },
    /*
      Rescheduling an email that is ALREADY GOING OUT is not a thing to
      offer: its remaining batches are due when the sender said, and moving
      `sendAtMs` under the processor mid-campaign changes when the rest of a
      delivery happens rather than when it starts.
     */
    ...((draft || scheduled) && !midFlight
      ? [
          {
            key: 'schedule',
            label: scheduled ? 'Reschedule' : 'Schedule',
            icon: <MdiIcon path={mdiCalendarClockOutline.path} size={0.8} />,
            onClick: () => setEditing('schedule'),
          } as RowActionsMenuItem,
        ]
      : []),
    ...(scheduled && !midFlight
      ? [
          {
            key: 'cancel',
            label: 'Cancel send',
            icon: <MdiIcon path={mdiCloseCircleOutline.path} size={0.8} />,
            destructive: true,
            disabled: Boolean(busy),
            disabledReason: 'Another action on this email is still running',
            onClick: () => void handleCancel(),
          } as RowActionsMenuItem,
        ]
      : []),
    /*
      Discard is offered ONLY on a draft, and it is hidden rather than
      disabled everywhere else — the opposite of how this menu treats
      `Reschedule`, and deliberately.

      A disabled control tells a reader that the action exists for this
      record and is momentarily unavailable. There is no state in which a
      sent email becomes discardable, so showing the entry greyed out on one
      would be an offer this product will never honor, sitting under the
      report it is promising to destroy.
     */
    ...(draft
      ? [
          {
            key: 'discard',
            label: 'Discard draft',
            icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
            destructive: true,
            disabled: Boolean(busy),
            disabledReason: 'Another action on this email is still running',
            onClick: () => void handleDiscard(),
          } as RowActionsMenuItem,
        ]
      : []),
  ]

  /*
   * The one contained button, and what it is per state.
   *
   * `draft` and `scheduled` share it: the email has not gone out, so the act
   * is to make it go. A `sent` email's is the follow-up. A `canceled` one has
   * no primary act at all — it was withdrawn deliberately, and offering a way
   * to un-withdraw it would be a resurrect path this model does not have —
   * and neither does one that is mid-send.
   */
  const primaryAction =
    (draft || scheduled) && !midFlight ? (
      <Button
        size="small"
        variant="contained"
        disabled={Boolean(busy)}
        onClick={() => void handleSendNow()}
      >
        {busy === 'sendNow' ? 'Checking…' : 'Send now'}
      </Button>
    ) : midFlight ? (
      /*
        A CAMPAIGN THAT IS ALREADY GOING OUT HAS ONE ACT: STOPPING IT.

        "Send now" is withheld rather than disabled, and the reason is not
        cosmetic — `sendNow` re-resolves the WHOLE audience and mails it, with
        no subtraction of anyone already reached, so pressing it on an email
        between batches sends a second copy to every person who has had the
        first. Withholding it leaves exactly one primary action, and it is the
        one a merchant watching a send go wrong actually wants.
       */
      <Button
        size="small"
        variant="contained"
        color="error"
        disabled={Boolean(busy)}
        onClick={() => void handleCancel()}
      >
        {'Stop sending'}
      </Button>
    ) : state === 'sent' ? (
      <Button
        size="small"
        variant="contained"
        disabled={sendingMore}
        onClick={() => void handleSendToMore()}
      >
        {sendingMore ? 'Checking…' : 'Send to more recipients'}
      </Button>
    ) : null

  const headerActions = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={`${basePath}/emails`}
        size="small"
        color="primary"
      >
        {'All emails'}
      </Button>
      {templateScreenId ? (
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={`${basePath}/templates/${templateScreenId}`}
          size="small"
          color="primary"
        >
          {'Open template'}
        </Button>
      ) : null}
      {primaryAction}
      <RowActionsMenu label={subject} items={overflowItems} />
    </Stack>
  )

  if (notFound) {
    return (
      <CardDisplay
        header={'Email'}
        help={emailDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        {/*
         * Not "no data". An email that cannot be read is a different
         * situation from one with no engagement, and rendering an empty
         * report for the first is how somebody comes to believe a message
         * they sent reached nobody.
         */}
        <Typography variant="body2" color="text.secondary">
          {'This email could not be loaded. It may have been deleted.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={subject}
        subheader={'Email'}
        help={emailDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Stack spacing={3}>
          {report.caveats.map((caveat) => (
            <Alert key={caveat.id} severity="info">
              {caveat.message}
            </Alert>
          ))}

          <Divider />

          <Section title="Where this went">
            <Table size="small">
              <TableBody>
                {/*
                  WHAT THIS EMAIL IS DOING, not the field it stores.

                  An email delivering an audience larger than one batch is
                  written back as `scheduled` between runs — the state the
                  processor claims to resume it — so the stored status read
                  "Scheduled" on a page reporting five hundred deliveries.
                 */}
                <TableRow>
                  <TableCell>{'State'}</TableCell>
                  <TableCell align="right">
                    <Chip
                      size="small"
                      color={
                        display.state === 'sending'
                          ? 'info'
                          : display.state === 'stopped'
                            ? 'warning'
                            : undefined
                      }
                      label={display.label}
                    />
                  </TableCell>
                </TableRow>
                {midFlight ? (
                  <TableRow>
                    <TableCell>{'Next batch'}</TableCell>
                    <TableCell align="right">
                      {`${display.progress.remaining.toLocaleString()} still ` +
                        'to reach, ' +
                        (display.progress.nextAtMs
                          ? `next run ${new Date(
                              display.progress.nextAtMs,
                            ).toLocaleString()}`
                          : 'next run due')}
                    </TableCell>
                  </TableRow>
                ) : null}
                <TableRow>
                  <TableCell>
                    {state === 'sent' ? 'Sent' : 'Scheduled for'}
                  </TableCell>
                  <TableCell align="right">
                    {sendTimeMs
                      ? new Date(sendTimeMs).toLocaleString()
                      : 'not recorded'}
                  </TableCell>
                </TableRow>
                {/*
                  An email that has been sent more than once, said out loud.
                  Every figure below covers all of them, and a reader who took
                  the single `Sent` date above for the whole story would read
                  the delivery numbers as one mailing's.
                */}
                {sendCount > 1 ? (
                  <TableRow>
                    <TableCell>{'Sends'}</TableCell>
                    <TableCell align="right">
                      {`${sendCount.toLocaleString()}, most recently ` +
                        (lastSentMs
                          ? new Date(lastSentMs).toLocaleString()
                          : 'not recorded')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {displayName ? (
                  <TableRow>
                    <TableCell>{'Name'}</TableCell>
                    <TableCell align="right">{displayName}</TableCell>
                  </TableRow>
                ) : null}
                <TableRow>
                  <TableCell>{'Campaign'}</TableCell>
                  <TableCell align="right">
                    {/*
                      The campaign's page belongs to the Marketing console, so
                      this href is built from the sibling hub rather than this
                      surface's own. Plain text until that hub resolves: a
                      link with no destination is worse than none.
                     */}
                    {marketingHub ? (
                      <AppLink href={`${marketingHub}/campaigns/${campaignId}`}>
                        {'Open the campaign'}
                      </AppLink>
                    ) : (
                      'Open the campaign'
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{'List'}</TableCell>
                  <TableCell align="right">
                    {emailAudienceLabel(email)}
                  </TableCell>
                </TableRow>
                {/*
                  Always a row, never a hidden one. A template this email did
                  not use and a template row that was not rendered look
                  identical to a reader, and the second sends them looking for
                  a link that was never going to be there.
                 */}
                <TableRow>
                  <TableCell>{'Template'}</TableCell>
                  <TableCell align="right">
                    {templateScreenId ? (
                      <AppLink
                        href={`${basePath}/templates/${templateScreenId}`}
                      >
                        {template?.displayName ?? 'Untitled template'}
                      </AppLink>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {'Written as plain text in the composer'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {/*
             * The list is named as the SEND recorded it, and saying so is
             * what stops a renamed or deleted list quietly rewriting the
             * history of a message that went out months ago.
             */}
            <Typography variant="caption" color="text.secondary">
              {'The list is named as it was when this email was sent.'}
            </Typography>
          </Section>

          <Divider />

          {/*==========================================
            * AN EMAIL THAT HAS NOT BEEN SENT HAS NO REPORT.
            *
            * Not an empty one — none. Every figure below divides or counts
            * something that only exists once mail has gone out, and an unsent
            * email carries no `stats` at all, so rendering the sections would
            * publish a column of zeros and a delivery rate of 0%. That reads
            * as "this reached nobody", which is a claim about a send that
            * happened; the truth is that no send has happened.
            *
            * The same reasoning the rate rows already follow, one level up: a
            * rate whose denominator is unrecorded renders absent rather than
            * as 0%, and a report whose whole subject is unrecorded renders
            * absent rather than as zeros.
            *=========================================*/}
          {unsent ? (
            <Section title="Delivery">
              <Typography variant="body2" color="text.secondary">
                {sending
                  ? 'This email is being sent right now. Its figures appear ' +
                    'here once the send finishes.'
                  : draft
                    ? 'This email has not been sent, so there is nothing to ' +
                      'report yet. Write it below, then send it or put it on ' +
                      'the schedule.'
                    : 'This email has not been sent yet. Its figures appear ' +
                      'here once it goes out.'}
              </Typography>
            </Section>
          ) : (
            <>
          <Section title="Delivery">
            <Stack
              direction="row"
              spacing={4}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Figure
                label="Addressed"
                value={report.recipients}
                note="after the per-send cap"
              />
              <Figure
                label="Sent"
                value={report.sent}
                note="accepted by the provider"
              />
              <Figure
                label="Delivered"
                value={report.delivered}
                note="accepted by the receiving server"
              />
              <Figure label="Bounced" value={report.bounced} note="of sent" />
              <Figure
                label="Marked as spam"
                value={report.complained}
                note="of delivered"
              />
            </Stack>
          </Section>

          <Divider />

          <Section title="Engagement">
            <Stack
              direction="row"
              spacing={4}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Figure
                label="Opens"
                value={report.opens}
                note="every open, repeats included"
              />
              <Figure
                label="Readers who opened"
                value={report.uniqueOpens}
                note="distinct recipients"
              />
              <Figure
                label="Clicks"
                value={report.clicks}
                note="every click, repeats included"
              />
              <Figure
                label="Readers who clicked"
                value={report.uniqueClicks}
                note="distinct recipients"
              />
              <Figure
                label="Unsubscribed"
                value={report.unsubscribes}
                note="through this email's link"
              />
            </Stack>
          </Section>

          <Divider />

          <Section title="Rates">
            <Stack spacing={1}>
              <RateRow label="Delivery rate" rate={report.rates.delivery} />
              <RateRow label="Open rate" rate={report.rates.open} />
              <RateRow label="Click rate" rate={report.rates.click} />
              <RateRow
                label="Click-to-open rate"
                rate={report.rates.clickToOpen}
              />
              <RateRow label="Bounce rate" rate={report.rates.bounce} />
              <RateRow label="Complaint rate" rate={report.rates.complaint} />
              <RateRow
                label="Unsubscribe rate"
                rate={report.rates.unsubscribe}
              />
            </Stack>
          </Section>

          {report.populations.length ? (
            <>
              <Divider />
              <Section title="Who this was allowed to reach">
                <Typography variant="body2" color="text.secondary">
                  {'Measured when this email was sent, and stored as it was ' +
                    'then. These figures describe the send, not the audience ' +
                    'as it stands today.'}
                </Typography>
                <Table size="small">
                  <TableBody>
                    {report.populations.map((population) => (
                      <TableRow key={population.id}>
                        <TableCell>{population.label}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {population.count.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="caption" color="text.secondary">
                            {`of ${population.of.toLocaleString()} ${population.ofLabel}`}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            </>
          ) : null}

          <Divider />

          <Section title="Links">
            {linkReport.rows.length ? (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Destination'}</TableCell>
                      <TableCell align="right">{'Clicks'}</TableCell>
                      <TableCell align="right">{'Share'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {linkReport.rows.map((row) => (
                      <TableRow key={row.url}>
                        <TableCell sx={{ wordBreak: 'break-all' }}>
                          {row.url}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {row.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {row.share
                            ? `${percent(row.share.value)} of ${row.share.denominator.toLocaleString()} ${row.share.denominatorLabel}`
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary">
                  {'Counted by address and path — query strings are dropped, ' +
                    'so two links to the same page with different tracking ' +
                    'parameters count as one row.'}
                </Typography>
                {linkReport.unattributedClicks ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${linkReport.unattributedClicks.toLocaleString()} clicks ` +
                      'arrived without a destination and are not in this table.'}
                  </Typography>
                ) : null}
                {linkReport.overflowClicks ? (
                  <Alert severity="info">
                    {'This email has more distinct destinations than the ' +
                      `rollup keeps. ${linkReport.overflowClicks.toLocaleString()} ` +
                      'clicks landed on links past that limit and are counted ' +
                      'in the click total above but not in this table.'}
                  </Alert>
                ) : null}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {report.clicks
                  ? 'Clicks were recorded for this email, but none of them ' +
                    'carried a destination, so there is nothing to break down ' +
                    'by link.'
                  : 'No link clicks have been recorded for this email.'}
              </Typography>
            )}
          </Section>
            </>
          )}
        </Stack>
      </CardDisplay>

      {/*==========================================
        * THE COMPOSER, ON THE EMAIL'S OWN PAGE.
        *
        * This is where an email is written, and the only place. The create
        * drawer on the Emails list collects the name and the campaign, mints
        * the record and routes here — so a list page carries no form, and
        * editing happens on the record's own surface exactly as it does for
        * screens, components, layouts and templates.
        *
        * Mounted only while the email can still be changed. It opens listens
        * of its own — the site's email designs, the org's lists and segments,
        * the running experiments — and a reader who came to read the report
        * of a sent email must not pay for a composer that could not edit it
        * anyway.
        *=========================================*/}
      {draft || scheduled ? (
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
            subject: String(email?.subject ?? ''),
            body: composedBody,
            fromName: String(email?.fromName ?? ''),
            replyTo: String(email?.replyTo ?? ''),
            preheader: String(email?.preheader ?? ''),
            audience: String(email?.audience ?? ''),
            listId: String(email?.listId ?? ''),
            segmentId: String(email?.segmentId ?? ''),
            topicId: String(email?.topicId ?? ''),
            templateScreenId: templateScreenId ?? '',
          }}
        />
      ) : null}

      <EmailRecipientsCard hostId={hostId} emailId={emailId} />

      {/*
       * Last, and its own card. The numbers are what a reader came for and
       * the preview is the tallest thing on the page — above them it pushes
       * every figure below the fold.
       *
       * `header` rather than `title`: `CardDisplay` has no `title` prop, so
       * one spreads through to the MUI `Card` root and lands on the DOM as a
       * hover tooltip, leaving the card with no heading at all. The gutters
       * are named for the same reason — without them the 640px frame sits
       * flush against the card's edge.
       */}
      <CardDisplay
        header={'Preview'}
        help={previewDocsHelp}
        contentGutterX
        contentGutterY
      >
        {templateScreenId ? (
          <EmailDesignPreview
            hostId={hostId}
            nodes={templateVersion?.nodes}
            loading={template === undefined || templateVersion === undefined}
            subject={subject}
            preheader={String(template?.emailPreheader ?? '')}
            emptyMessage={
              'The template this email was built from is empty or has ' +
              'been deleted, so there is nothing to draw.'
            }
            note={
              'The template as it stands today. The mail itself is ' +
              'rendered per recipient at send time and not kept, so a ' +
              'template edited since this went out previews as it is now.'
            }
          />
        ) : (
          <EmailDesignPreview
            hostId={hostId}
            nodes={undefined}
            text={composedBody}
            loading={email === undefined}
            subject={subject}
            emptyMessage={
              'This email carries no body, so there is nothing to draw.'
            }
            note={
              'Written as plain text in the composer. Merge tokens are ' +
              'left standing here — the mail itself resolves them per ' +
              'recipient at send time and is not kept.'
            }
          />
        )}
      </CardDisplay>

      {/*
       * Editing in a DRAWER, never a form above the content. The name is the
       * one detail a sent email still owns — see the drawer's own header for
       * why the subject, body, audience and topic are not on offer once mail
       * has been delivered.
       */}
      <EmailEditDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        field={editing === 'schedule' ? 'schedule' : 'details'}
        title={
          editing === 'schedule'
            ? scheduled
              ? 'Reschedule this email'
              : 'Schedule this email'
            : 'Edit details'
        }
        submitLabel={
          editing === 'schedule'
            ? scheduled
              ? 'Reschedule'
              : 'Schedule'
            : 'Save'
        }
        displayName={displayName}
        sendAtMs={scheduled ? sendTimeMs : 0}
        busy={Boolean(busy)}
        note={
          editing === 'schedule'
            ? 'The email goes out at this time. You can send it sooner, or ' +
              'cancel it, from this page.'
            : unsent
              ? 'The name is for finding this email in your own lists. The ' +
                'subject and the message are written in the composer below.'
              : 'This email has been sent, so its subject, message and ' +
                'audience describe mail that is already in inboxes and can ' +
                'no longer be changed. Its name is yours and stays editable.'
        }
        onSubmit={(values) =>
          void (editing === 'schedule'
            ? handleReschedule(values)
            : handleRename(values))
        }
      />
    </Stack>
  )
}
EmailDetail.displayName = 'EmailDetail'

export default EmailDetail
