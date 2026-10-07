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

/**
 * ONE EMAIL: what it is, where it went, what it did, and the console's
 * actions on it (AGL-3622).
 *
 * The figures are `campaignReport` over the stored `stats` and
 * `sendLinkReport` over the link rollup — the pure modules the console's
 * email page reads — so every rate names its denominator and an unrecorded
 * figure is a dash, never a zero. An unsent email has no report at all.
 *
 * The actions are the console page's, in the states it offers them, each a
 * POST to `/api/campaigns/send` behind the console's own confirmation: Send
 * now and Send to more recipients count first (`dryRun`) so the confirmation
 * names how many people it reaches. Writing the email is the console's
 * composer, which opens in the WebView.
 */

import { useLiveDoc } from '@aglyn/mobile-core'
import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, Card, Chip, EmptyState, Field, ListRow, Screen, Skeleton, Text, type ChipTone } from '@aglyn/mobile-ui'
import { sendLinkReport, type SendRate } from '@aglyn/shared-ui-email-campaigns/model/send-report'
import { useCallback, useMemo, useState } from 'react'
import { Alert, View } from 'react-native'
import { campaignHeldForReviewNotice, CAMPAIGN_SEND_CONTAINER_FIELD, orgEmailCampaignsPath } from '../lib/model/campaign-container'
import { campaignReport } from '../lib/model/campaign-report'
import { emailAudienceLabel, emailIsUnsent, emailSendTimeMs, emailSentAs } from '../lib/model/email-record'
import { CampaignTestSendSheet } from './campaign-test-send-sheet'
import {
  campaignSendControls,
  cancelConfirmation,
  followUpConfirmation,
  percent,
  postCampaignSend,
  refusalOf,
  sendNowConfirmation,
  useCampaignSend,
  useSiteSendRole,
  type CampaignSendRecord,
} from './campaign-sends'

/** RN's alert as a yes/no promise: the console's `confirm()`. */
export function confirmAlert(title: string, message: string, confirm: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel', onPress: () => resolve(false) },
      { text: confirm, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  )
}

const STATE_TONE: Partial<Record<string, ChipTone>> = { sending: 'info', stopped: 'warning', held: 'warning' }

const when = (ms: number) => new Date(ms).toLocaleString()

/** One count with the population it describes; `null` is a dash, never zero. */
function Figure({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <View style={{ minWidth: 140, flexGrow: 1 }} testID={`figure-${label}`}>
      <Text variant="heading">{value === null ? '—' : value.toLocaleString()}</Text>
      <Text>{label}</Text>
      <Text variant="caption" tone="secondary">
        {value === null ? 'not recorded' : note}
      </Text>
    </View>
  )
}

/** One rate with its denominator on the same line. */
function RateRow({ label, rate }: { label: string; rate: SendRate | null }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }} testID={`rate-${label}`}>
      <Text>{label}</Text>
      <Text tone={rate ? 'primary' : 'secondary'} variant={rate ? 'label' : 'caption'} style={{ flexShrink: 1, textAlign: 'right' }}>
        {rate
          ? `${percent(rate.value)} · ${rate.numerator.toLocaleString()} of ${rate.denominator.toLocaleString()} ${rate.denominatorLabel}`
          : '— not enough recorded to compute'}
      </Text>
    </View>
  )
}

function Figures({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>{children}</View>
}

export interface CampaignSendDetailProps {
  context: MobilePluginContext
  sendId: string | null
}

export function CampaignSendDetail({ context, sendId }: CampaignSendDetailProps) {
  const { firestore, orgId, uid, api } = context
  const { send, links } = useCampaignSend(firestore, orgId, sendId)
  const email = send.data
  /** The site this email is sent as: the picked one, or the send's own on the workspace. */
  const hostId = context.hostId ?? (email?.hostId ? String(email.hostId) : null)
  const siteless = !context.hostId && Boolean(email) && !hostId
  const scope = context.hostId ? 'site' : 'org'
  const role = useSiteSendRole(firestore, hostId, uid)
  /*
   * The console's `/marketing/campaigns/{id}` names a campaign CONTAINER or
   * a single send. A link that reached this screen with a container's id
   * finds no send; the container's page is the console's.
   */
  const container = useLiveDoc<{ name?: string }>(
    firestore,
    send.ready && !email && orgId && sendId ? [...orgEmailCampaignsPath(orgId), sendId] : null,
  )
  const templateScreenId = email?.['templateScreenId'] ? String(email['templateScreenId']) : null
  const template = useLiveDoc<{ displayName?: string }>(
    firestore,
    hostId && templateScreenId ? ['hosts', hostId, 'screens', templateScreenId] : null,
  )

  const report = useMemo(() => campaignReport(email?.stats), [email])
  const linkReport = useMemo(() => sendLinkReport(links.data ?? undefined), [links.data])
  const controls = campaignSendControls(email)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [testing, setTesting] = useState(false)

  const say = (text: string, error = false) => setNotice({ text, error })

  /** Count with `dryRun`, confirm with the count, then send — the console's two-request shape. */
  const countThenSend = useCallback(
    async (action: 'sendNow' | 'followUp') => {
      if (busy || !hostId || !sendId || !email) return
      setBusy(action)
      setNotice(null)
      let counted: Record<string, unknown>
      try {
        counted = await postCampaignSend(api, hostId, { action, campaignId: sendId, dryRun: true })
      } catch (error) {
        setBusy('')
        return say(
          refusalOf(error, action === 'sendNow' ? 'This email cannot be sent' : 'This email cannot be sent again'),
          true,
        )
      }
      setBusy('')
      const reaching = Number(counted['sendable'] ?? (action === 'sendNow' ? counted['sent'] : 0) ?? 0)
      if (action === 'followUp' && !reaching) return say('Everyone in this audience already has this email')
      const words =
        action === 'sendNow'
          ? sendNowConfirmation(reaching, String(email.status) === 'scheduled')
          : followUpConfirmation(reaching, Number(counted['alreadyReached'] ?? 0))
      if (!(await confirmAlert(words.title, words.message, words.confirm))) return
      setBusy(action)
      try {
        const result = await postCampaignSend(api, hostId, { action, campaignId: sendId })
        const sent = Number(result['sent'] ?? 0).toLocaleString()
        say(action === 'sendNow' ? `Sent to ${sent} recipients` : `Sent to ${sent} more recipients`)
      } catch (error) {
        say(refusalOf(error, 'Send failed'), true)
      } finally {
        setBusy('')
      }
    },
    [api, busy, email, hostId, sendId],
  )

  const handleCancel = useCallback(async () => {
    if (busy || !hostId || !sendId) return
    const midFlight = controls.stop
    const words = cancelConfirmation(midFlight, controls.display.progress.reached, controls.display.progress.remaining)
    if (!(await confirmAlert(words.title, words.message, words.confirm))) return
    setBusy('cancel')
    setNotice(null)
    try {
      await postCampaignSend(api, hostId, { action: 'cancel', campaignId: sendId })
      say(midFlight ? 'This email has stopped sending' : 'This email will not be sent')
    } catch (error) {
      say(refusalOf(error, 'This email could not be canceled'), true)
    } finally {
      setBusy('')
    }
  }, [api, busy, controls, hostId, sendId])

  if (!sendId) return <EmptyState icon="mail-outline" title="Pick an email to see it here" />
  if (!send.ready) {
    return (
      <View style={{ padding: 16, gap: 12 }} testID="campaign-detail-loading">
        <Skeleton height={28} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </View>
    )
  }
  if (!email) {
    if (container.data) {
      return (
        <Screen>
          <Card title={String(container.data.name || 'Untitled campaign')}>
            <Text tone="secondary">
              This campaign groups several emails. Its report and its emails are on its page in the console.
            </Text>
            <Button
              title="Open in the console"
              variant="outlined"
              icon="open-outline"
              onPress={() => context.openConsolePath(`/marketing/campaigns/${sendId}`, scope)}
            />
          </Card>
        </Screen>
      )
    }
    if (!container.ready && !send.error) return <Skeleton height={44} />
    return (
      <EmptyState
        icon="warning-outline"
        title="This email could not be loaded"
        body="It may have been deleted."
      />
    )
  }

  const subject = String(email.subject || 'Untitled email')
  const state = String(email.status ?? '')
  const unsent = emailIsUnsent(email)
  const sendTimeMs = emailSendTimeMs(email)
  const sendCount = Number(email['sendCount'] ?? 1) || 1
  const lastSent = email['lastSentAt'] ? emailSendTimeMs({ sentAt: email['lastSentAt'] }) : 0
  const sentAs = emailSentAs(email)
  const displayName = String(email['displayName'] ?? '')
  const campaignId = String(email[CAMPAIGN_SEND_CONTAINER_FIELD] ?? sendId)
  const { display } = controls
  const mayAct = !siteless && role.canSend

  const primary = !mayAct ? null : controls.sendNow ? (
    <Button
      testID="campaign-send-now"
      title={busy === 'sendNow' ? 'Checking…' : 'Send now'}
      disabled={Boolean(busy)}
      onPress={() => void countThenSend('sendNow')}
    />
  ) : controls.stop ? (
    <Button testID="campaign-stop" title="Stop sending" disabled={Boolean(busy)} onPress={() => void handleCancel()} />
  ) : controls.followUp ? (
    <Button
      testID="campaign-follow-up"
      title={busy === 'followUp' ? 'Checking…' : 'Send to more recipients'}
      disabled={Boolean(busy)}
      onPress={() => void countThenSend('followUp')}
    />
  ) : null

  return (
    <Screen>
      {display.state === 'held' ? (
        <Card>
          <Text tone="secondary">{campaignHeldForReviewNotice(email)}</Text>
        </Card>
      ) : null}
      {siteless ? (
        <Card>
          <Text tone="secondary">
            This email does not record which site it was sent as, so it can only be managed from that site’s own
            Emails page. Its figures below are complete.
          </Text>
        </Card>
      ) : null}
      <Card title={subject} actions={primary}>
        {notice ? (
          <Text testID="campaign-notice" tone={notice.error ? 'error' : 'accent'}>
            {notice.text}
          </Text>
        ) : null}
        {report.caveats.map((caveat) => (
          <Text key={caveat.id} variant="caption" tone="secondary">
            {caveat.message}
          </Text>
        ))}
        <Field
          label="State"
          testID="campaign-state"
          value={<Chip label={display.label} tone={STATE_TONE[display.state] ?? 'default'} />}
        />
        {controls.stop ? (
          <Field
            label="Next batch"
            value={
              `${display.progress.remaining.toLocaleString()} still to reach, ` +
              (display.progress.nextAtMs ? `next run ${when(display.progress.nextAtMs)}` : 'next run due')
            }
          />
        ) : null}
        <Field label={state === 'sent' ? 'Sent' : 'Scheduled for'} value={sendTimeMs ? when(sendTimeMs) : 'not recorded'} />
        {sendCount > 1 ? (
          <Field
            label="Sends"
            value={`${sendCount.toLocaleString()}, most recently ${lastSent ? when(lastSent) : 'not recorded'}`}
          />
        ) : null}
        {displayName ? <Field label="Name" value={displayName} /> : null}
        <Field label="Sent as" testID="campaign-sent-as" value={sentAs.recorded ? String(sentAs.from) : unsent ? 'not sent yet' : 'not recorded'} />
        {sentAs.recorded ? <Field label="From name" value={sentAs.fromName ?? 'The address on its own'} /> : null}
        {sentAs.recorded ? <Field label="Reply-to" value={sentAs.replyTo ?? 'The sending address'} /> : null}
        <Field label="List" testID="campaign-audience" value={emailAudienceLabel(email)} />
        <Field
          label="Template"
          value={
            templateScreenId
              ? String(template.data?.displayName || 'Untitled template')
              : 'Written as plain text in the composer'
          }
        />
        <Text variant="caption" tone="secondary">
          The list and the sender are recorded as they were when this email was sent, not as this site is configured
          now.
        </Text>
      </Card>

      {!siteless ? (
        <Card title="Manage">
          {mayAct && controls.compose ? (
            <ListRow testID="campaign-test" icon="flask-outline" title="Send a test" onPress={() => setTesting(true)} />
          ) : null}
          {mayAct && controls.compose ? (
            <ListRow
              testID="campaign-write"
              icon="create-outline"
              title="Write this email"
              subtitle="Opens the composer in the console"
              onPress={() => context.openConsolePath(`/emails/messages/${sendId}/edit`, scope)}
            />
          ) : null}
          {mayAct && controls.cancel ? (
            <ListRow testID="campaign-cancel" icon="close-circle-outline" title="Cancel send" onPress={() => void handleCancel()} />
          ) : null}
          <ListRow
            icon="megaphone-outline"
            title="Open the campaign"
            onPress={() => context.openConsolePath(`/marketing/campaigns/${campaignId}`, scope)}
          />
          <ListRow
            icon="open-outline"
            title="Open in the console"
            subtitle="Schedule, rename, preview or discard it there"
            onPress={() => context.openConsolePath(`/emails/messages/${sendId}`, scope)}
          />
          {role.ready && !role.canSend ? (
            <Text variant="caption" tone="secondary">
              Only an admin or editor of the site this email is sent as can send it.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {unsent ? (
        <Card title="Delivery">
          <Text tone="secondary" testID="campaign-unsent">
            {state === 'sending'
              ? 'This email is being sent right now. Its figures appear here once the send finishes.'
              : state === 'draft'
                ? 'This email has not been sent, so there is nothing to report yet. Write this email, then send it or put it on the schedule.'
                : 'This email has not been sent yet. Its figures appear here once it goes out.'}
          </Text>
        </Card>
      ) : (
        <>
          <Card title="Delivery">
            <Figures>
              <Figure label="Addressed" value={report.recipients} note="after the per-send cap" />
              <Figure label="Sent" value={report.sent} note="accepted by the provider" />
              <Figure label="Delivered" value={report.delivered} note="accepted by the receiving server" />
              <Figure label="Bounced" value={report.bounced} note="of sent" />
              <Figure label="Marked as spam" value={report.complained} note="of delivered" />
            </Figures>
          </Card>
          <Card title="Engagement">
            <Figures>
              <Figure label="Opens" value={report.opens} note="every open, repeats included" />
              <Figure label="Readers who opened" value={report.uniqueOpens} note="distinct recipients" />
              <Figure label="Clicks" value={report.clicks} note="every click, repeats included" />
              <Figure label="Readers who clicked" value={report.uniqueClicks} note="distinct recipients" />
              <Figure label="Unsubscribed" value={report.unsubscribes} note="through this email's link" />
            </Figures>
          </Card>
          <Card title="Rates">
            <RateRow label="Delivery rate" rate={report.rates.delivery} />
            <RateRow label="Open rate" rate={report.rates.open} />
            <RateRow label="Click rate" rate={report.rates.click} />
            <RateRow label="Click-to-open rate" rate={report.rates.clickToOpen} />
            <RateRow label="Bounce rate" rate={report.rates.bounce} />
            <RateRow label="Complaint rate" rate={report.rates.complaint} />
            <RateRow label="Unsubscribe rate" rate={report.rates.unsubscribe} />
          </Card>
          {report.populations.length ? (
            <Card title="Who this was allowed to reach">
              <Text variant="caption" tone="secondary">
                Measured when this email was sent, and stored as it was then. These figures describe the send, not the
                audience as it stands today.
              </Text>
              {report.populations.map((population) => (
                <Field
                  key={population.id}
                  label={population.label}
                  value={`${population.count.toLocaleString()} of ${population.of.toLocaleString()} ${population.ofLabel}`}
                />
              ))}
            </Card>
          ) : null}
          <Card title="Links">
            {linkReport.rows.length ? (
              <>
                {linkReport.rows.map((row) => (
                  <Field
                    key={row.url}
                    label={row.url}
                    value={
                      `${row.clicks.toLocaleString()} clicks` +
                      (row.share
                        ? ` · ${percent(row.share.value)} of ${row.share.denominator.toLocaleString()} ${row.share.denominatorLabel}`
                        : '')
                    }
                  />
                ))}
                <Text variant="caption" tone="secondary">
                  Counted by address and path — query strings are dropped, so two links to the same page with different
                  tracking parameters count as one row.
                </Text>
                {linkReport.unattributedClicks ? (
                  <Text variant="caption" tone="secondary">
                    {`${linkReport.unattributedClicks.toLocaleString()} clicks arrived without a destination and are not in this list.`}
                  </Text>
                ) : null}
                {linkReport.overflowClicks ? (
                  <Text variant="caption" tone="secondary">
                    {`This email has more distinct destinations than the rollup keeps. ${linkReport.overflowClicks.toLocaleString()} clicks landed on links past that limit and are counted in the click total above but not in this list.`}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text tone="secondary">
                {report.clicks
                  ? 'Clicks were recorded for this email, but none of them carried a destination, so there is nothing to break down by link.'
                  : 'No link clicks have been recorded for this email.'}
              </Text>
            )}
          </Card>
        </>
      )}
      {hostId && testing ? (
        <CampaignTestSendSheet visible={testing} onClose={() => setTesting(false)} api={api} hostId={hostId} send={email as CampaignSendRecord} />
      ) : null}
    </Screen>
  )
}
