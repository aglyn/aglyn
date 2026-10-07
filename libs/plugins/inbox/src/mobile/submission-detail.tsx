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
 * ONE SUBMISSION, as the console's reader shows it (AGL-3622): when and
 * where it came in, every field in the order its form declares them, what
 * the submit route did
 * with it, the replies already sent, and the reply composer.
 *
 * Opening it marks it read, as opening the console's reader does. Mark
 * read/unread and Delete sit in the card header. The composer is the
 * console's: it says, before anything is sent, that the reply leaves from
 * the platform's address under the site's name and that answers come back
 * to the account's own email, never to this Inbox, because nothing here
 * receives mail.
 */

import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { ConsoleApiError } from '@aglyn/mobile-core'
import { Button, Card, Chip, EmptyState, Field, Screen, Skeleton, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import {
  REPLY_BODY_MAX,
  REPLY_SUBJECT_MAX,
  defaultReplySubject,
  replyRecipient,
} from '../lib/model/reply-policy'
import { submissionLinks } from '../lib/model/submission-links'
import { routingChips, submissionSender, type SubmissionRouting } from '../lib/model/submission-presenter'
import {
  orderedSubmissionFields,
  receivedAtMs,
  submissionPermissions,
  type DeclaredFormField,
  type SubmissionRow,
} from './submission-query'
import { deleteSubmission, sendSubmissionReply, setSubmissionRead } from './submission-writes'
import {
  SENT_REPLIES_LIMIT,
  useAccountEmail,
  useSentReplies,
  useSubmission,
  useSubmissionForm,
  useSubmissionSite,
} from './use-submissions'

const CHIP_TONES = { success: 'success', info: 'info', warning: 'warning', default: 'default' } as const

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ConsoleApiError && error.message) return error.message
  return fallback
}

function ReplyComposer({
  context,
  hostId,
  submission,
  siteName,
}: {
  context: MobilePluginContext
  hostId: string
  submission: SubmissionRow
  siteName: string
}) {
  const accountEmail = useAccountEmail()
  const recipient = useMemo(() => replyRecipient(submission.fields), [submission.fields])
  const sent = useSentReplies(context.firestore, hostId, submission.$id)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'secondary' | 'error'; text: string } | null>(null)
  const theme = useMobileTheme()

  // Re-seeded per submission: a tablet keeps this mounted while the reader
  // moves between rows, and the subject names the site of the one open.
  useEffect(() => {
    setSubject(defaultReplySubject(siteName, submission.formName))
    setMessage('')
    setStatus(null)
  }, [siteName, submission.$id, submission.formName])

  if (!('email' in recipient)) {
    return (
      <Card title="Reply">
        <Text tone="secondary">This submission has no email field, so there is nobody to reply to.</Text>
      </Card>
    )
  }

  const send = async () => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      const result = await sendSubmissionReply(context.api, {
        hostId,
        submissionId: submission.$id,
        subject,
        message,
      })
      setMessage('')
      setStatus({ tone: 'secondary', text: `Reply sent to ${result?.to ?? 'the sender'}` })
    } catch (error) {
      setStatus({ tone: 'error', text: errorText(error, 'The reply was not sent') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Reply">
      <Text tone="secondary">{`To ${recipient.email}`}</Text>
      <TextField
        label="Subject"
        testID="inbox-reply-subject"
        value={subject}
        maxLength={REPLY_SUBJECT_MAX}
        onChangeText={(text) => setSubject(text.slice(0, REPLY_SUBJECT_MAX))}
      />
      <TextField
        label="Message"
        testID="inbox-reply-message"
        value={message}
        multiline
        maxLength={REPLY_BODY_MAX}
        placeholder="Write your reply. The original message is quoted underneath it."
        onChangeText={(text) => setMessage(text.slice(0, REPLY_BODY_MAX))}
      />
      <Text variant="caption" tone="secondary">
        {"Sent from your site's name at this platform's address, with replies directed to " +
          `${accountEmail ?? 'your account email'}. Answers arrive in your email, not in this Inbox.`}
      </Text>
      <Button
        testID="inbox-reply-send"
        title={busy ? 'Sending…' : 'Send reply'}
        busy={busy}
        disabled={!subject.trim() || !message.trim()}
        onPress={() => void send()}
      />
      {status ? (
        <Text testID="inbox-reply-status" tone={status.tone}>
          {status.text}
        </Text>
      ) : null}
      {sent.replies.length ? (
        <View style={{ gap: theme.space(1) }}>
          <Text variant="label" tone="secondary">
            Replies sent
          </Text>
          {sent.more ? (
            <Text variant="caption" tone="secondary">
              {`Showing the ${SENT_REPLIES_LIMIT} most recent. This thread has more.`}
            </Text>
          ) : null}
          {sent.replies.map((reply) => (
            <View key={reply.$id} testID={`inbox-reply-${reply.$id}`} style={{ gap: theme.space(0.25) }}>
              <Text variant="caption" tone="secondary">
                {`${reply.sentAtMs ? new Date(reply.sentAtMs).toLocaleString() : ''} · to ${reply.to ?? ''}`}
              </Text>
              <Text>{reply.message ?? ''}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

export interface SubmissionDetailProps {
  context: MobilePluginContext
  hostId: string | null
  submissionId: string | null
  /** The site's name beside the time, where the list spans every site. */
  showSite?: boolean
  /** Called once the submission is deleted (a tablet clears its pick). */
  onDeleted?: () => void
}

export function SubmissionDetail({ context, hostId, submissionId, showSite, onDeleted }: SubmissionDetailProps) {
  const live = useSubmission(context.firestore, hostId, submissionId)
  const site = useSubmissionSite(context.firestore, hostId)
  const form = useSubmissionForm(context.firestore, hostId, typeof live.data?.formId === 'string' ? live.data.formId : null)
  const role = site.data?.memberRoles?.[context.uid]
  const { canWrite, canReply } = submissionPermissions(role)
  const [failure, setFailure] = useState<string | null>(null)
  const theme = useMobileTheme()
  const submission = useMemo<SubmissionRow | null>(() => (live.data ? { ...live.data, $id: live.data.$id } : null), [live.data])

  // Opening a submission marks it read, as the console's reader does; once
  // per id, so marking it unread again here sticks.
  const markedOpen = useRef<string | null>(null)
  useEffect(() => {
    if (!hostId || !submission || !canWrite) return
    if (markedOpen.current === submission.$id) return
    markedOpen.current = submission.$id
    if (submission.read !== true) {
      setSubmissionRead(context.firestore, hostId, submission.$id, true).catch(() => undefined)
    }
  }, [context.firestore, hostId, submission, canWrite])

  if (!submissionId || !hostId) {
    return <EmptyState icon="mail-open-outline" title="Pick a submission to read it here" />
  }
  if (!live.ready) {
    return (
      <Screen>
        <Skeleton height={24} />
        <Skeleton height={120} />
      </Screen>
    )
  }
  if (live.error) return <EmptyState icon="warning-outline" title="Could not load this submission" />
  if (!submission) {
    return <EmptyState icon="mail-unread-outline" title="That submission is no longer in the Inbox." />
  }

  const siteName = String(site.data?.displayName ?? site.data?.subdomain ?? '')
  const at = receivedAtMs(submission)
  const sender = submissionSender(submission.fields)
  const links = submissionLinks({
    submission,
    // A record's console page opens from the console; the app names none here.
    hrefOf: () => null,
    siteOrigin: hostPublicOrigin({ subdomain: site.data?.subdomain ?? null }) ?? null,
  })

  const toggleRead = () => {
    setFailure(null)
    setSubmissionRead(context.firestore, hostId, submission.$id, submission.read !== true).catch(() =>
      setFailure('Could not change this submission.'),
    )
  }
  const remove = () => {
    setFailure(null)
    deleteSubmission(context.firestore, context.api, hostId, submission)
      .then((deleted) => {
        if (deleted) onDeleted?.()
      })
      .catch(() => setFailure('Could not delete this submission.'))
  }

  return (
    <Screen>
      <Card
        title={submission.formName ?? 'Form submission'}
        actions={
          canWrite ? (
            <View style={{ flexDirection: 'row' }}>
              <Button
                testID="inbox-toggle-read"
                variant="text"
                icon={submission.read ? 'mail-unread-outline' : 'mail-open-outline'}
                title={submission.read ? 'Mark unread' : 'Mark read'}
                onPress={toggleRead}
              />
              <Button testID="inbox-delete" variant="text" icon="trash-outline" title="Delete" onPress={remove} />
            </View>
          ) : null
        }
      >
        <Text variant="heading">{sender.label}</Text>
        <Text variant="caption" tone="secondary">
          {`Received ${at ? new Date(at).toLocaleString() : ''}` + (showSite && siteName ? ` · ${siteName}` : '')}
        </Text>
        {failure ? <Text tone="error">{failure}</Text> : null}
        {links.map((link) => (
          <Field
            key={link.key}
            label={link.label}
            value={
              link.href ? (
                <Pressable
                  testID={`inbox-link-${link.key}`}
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(String(link.href))}
                >
                  <Text tone="accent">{link.text}</Text>
                </Pressable>
              ) : (
                link.text
              )
            }
          />
        ))}
      </Card>
      <Card title="Message">
        {orderedSubmissionFields(
          submission.fields,
          Array.isArray(form.data?.fields) ? (form.data.fields as DeclaredFormField[]) : null,
        ).map((field) => (
          <Field key={field.key} testID={`inbox-field-${field.key}`} label={field.label} value={field.value} />
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
          {routingChips(submission.routing as SubmissionRouting | undefined).map((chip) => (
            <Chip key={chip.label} label={chip.label} tone={CHIP_TONES[chip.color]} />
          ))}
        </View>
      </Card>
      {canReply ? (
        <ReplyComposer context={context} hostId={hostId} submission={submission} siteName={siteName} />
      ) : null}
    </Screen>
  )
}
