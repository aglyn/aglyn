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

import {
  PageHeaderRecord,
  pluginDocsHelp,
  resolveCampaignTopic,
  DEFAULT_EMAIL_TOPICS,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useOrgEmailTopics, writeEmailTopic } from './use-org-email-topics'

export interface EmailTopicDetailProps {
  hostId: string
  topicId: string
  /** `/…/emails`, so the page can route back to the list. */
  basePath: string
}

/**
 * One topic's own page — where every change to an existing topic is made.
 *
 * The console's shape for a list surface is create-in-a-drawer, edit-on-the
 * record's page, and this is the second half of it for topics. The list card
 * lists and routes; nothing about a saved topic is editable from a form
 * stacked above that table.
 *
 * ## Saving a built-in
 *
 * The four built-ins have no stored document until somebody changes one, so
 * this page's save is the same `setDoc` for a built-in and a custom topic:
 * the write CREATES the override document at the built-in's id. That is the
 * whole overlay design — see `email-topics.ts`.
 *
 * ## Retire, not delete
 *
 * A retired topic leaves the composer's picker and the recipient's preference
 * page, and stays resolvable everywhere else. It has to: campaigns already
 * sent under it minted unsubscribe links carrying its id, those links are in
 * inboxes, and an id that stops resolving is a preference page that cannot
 * name the message the recipient is holding. There is no delete on this page,
 * and the Firestore rules refuse one too.
 */
export function EmailTopicDetail(props: EmailTopicDetailProps) {
  const { hostId, topicId, basePath } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { topics, scope } = useOrgEmailTopics(hostId)

  /*
   * `resolveCampaignTopic` rather than a bare `find`, so an id that no longer
   * names anything lands on a real topic instead of an empty form. A stale
   * bookmark is the common way to arrive here with one.
   */
  const topic = resolveCampaignTopic(topicId, topics)
  const known = topics.some((it) => it.id === topicId)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  /**
   * Whether joining this stream needs a confirmation click.
   *
   * Three states, held as a string because a `Select` carries one and a
   * boolean cannot: `''` defers to the site, `'on'` and `'off'` are decisions
   * about this stream. Collapsing the first into a boolean would make "not
   * chosen" indistinguishable from "off", and the site default would then be
   * unreachable once anybody saved a topic.
   */
  const [doubleOptIn, setDoubleOptIn] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  /*
   * Seed the fields ONCE, when the catalog first arrives.
   *
   * Re-seeding on every change of `topic` would overwrite what the operator is
   * typing the moment the collection listener fires — and it fires on this
   * page's own save.
   */
  useEffect(() => {
    if (loaded || !topics.length) return
    setName(topic.name)
    setDescription(topic.description)
    setDoubleOptIn(
      typeof topic.doubleOptIn === 'boolean'
        ? topic.doubleOptIn
          ? 'on'
          : 'off'
        : '',
    )
    setLoaded(true)
  }, [loaded, topics, topic])

  const storedDoubleOptIn =
    typeof topic.doubleOptIn === 'boolean'
      ? topic.doubleOptIn
        ? 'on'
        : 'off'
      : ''
  const dirty =
    loaded &&
    (name !== topic.name ||
      description !== topic.description ||
      doubleOptIn !== storedDoubleOptIn)

  /**
   * Save what is in the form, optionally changing the retired flag with it.
   *
   * The write itself is `writeEmailTopic`, which the list card's row menu also
   * goes through — a topic retired from the list and one retired here have to
   * leave the same document behind.
   */
  const save = useCallback(
    async (patch?: { archived?: boolean }) => {
      if (!scope || busy) return
      const nextName = name.trim()
      if (!nextName) {
        return void enqueueSnackbar('Give the topic a name', {
          variant: 'warning',
          persist: false,
        })
      }
      setBusy(true)
      try {
        await writeEmailTopic(firestore, scope, {
          id: topic.id,
          name: nextName,
          description: description.trim(),
          archived: patch?.archived ?? !!topic.archived,
          // `null` clears the field, which is how "whatever the site says"
          // is expressed. A stored `false` is a different answer and has to
          // survive as one.
          doubleOptIn:
            doubleOptIn === 'on' ? true : doubleOptIn === 'off' ? false : null,
        })
        enqueueSnackbar('Topic saved', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [
      scope,
      busy,
      name,
      description,
      doubleOptIn,
      firestore,
      topic,
      enqueueSnackbar,
    ],
  )

  const toggleArchived = useCallback(async () => {
    if (topic.archived) return void save({ archived: false })
    const accepted = await confirm({
      title: `Retire “${topic.name}”?`,
      description:
        'It leaves the composer and the preference page, so nothing new can ' +
        'be sent under it and recipients stop seeing it as a choice. ' +
        'Campaigns already sent under it keep working — their unsubscribe ' +
        'links still name this topic. You can bring it back at any time.',
      confirmationText: 'Retire',
    })
      // `confirm` resolves with NO VALUE and REJECTS on cancel, so gating on
      // the resolved value alone makes this always return (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    await save({ archived: true })
  }, [topic, confirm, save])

  /* The card, named so the page chrome above it is a plain list of
     what this surface publishes upward. */
  const card = (
    <CardDisplay
      header={'Topic'}
      subheader={
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
          {topic.archived ? (
            <Chip
              size="small"
              variant="outlined"
              color="warning"
              label="Retired"
            />
          ) : null}
          {DEFAULT_EMAIL_TOPICS.some((it) => it.id === topic.id) ? (
            <Typography variant="overline" color="text.secondary">
              {'Built in'}
            </Typography>
          ) : null}
        </Stack>
      }
      help={pluginDocsHelp('emailCampaigns', { anchor: '#topics' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button component={Link} href={`${basePath}/topics`} size="small">
            {'All topics'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        {!scope ? (
          <Typography variant="body2" color="text.secondary">
            {'This site has no organization, so it has no topic list.'}
          </Typography>
        ) : (
          <>
            {!known && loaded ? (
              <Typography variant="body2" color="text.secondary">
                {'That topic no longer exists, so this is the one campaigns ' +
                  'fall back to.'}
              </Typography>
            ) : null}
            <TextField
              label="Name"
              size="small"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy || !loaded}
              helperText="What recipients see on the preference page."
            />
            <TextField
              label="Description"
              size="small"
              multiline
              minRows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy || !loaded}
              helperText="One sentence telling them what this stream is."
            />
            {/*
              CONFIRMATION — off unless somebody chooses it.

              No jurisdiction verified requires a double opt-in by statute.
              They require prior express consent plus a burden of proof on
              the sender, and a confirmation click is the proof the courts
              have so far accepted — so this is an option a merchant reaches
              for, never a default the product imposes.

              A three-way select rather than a switch, because the third
              state is real: this topic can defer to the site's own setting,
              and a switch has nowhere to put that.
             */}
            <TextField
              select
              label="Confirmation"
              size="small"
              value={doubleOptIn}
              onChange={(event) => setDoubleOptIn(event.target.value)}
              disabled={busy || !loaded}
              helperText={
                'Ask new subscribers to confirm by email before anything is ' +
                'sent to them. Until they do, nothing on this stream reaches ' +
                'them and they stay on your list.'
              }
              slotProps={{ select: { native: true } }}
            >
              <option value="">{'Use the site setting'}</option>
              <option value="on">{'Require a confirmation click'}</option>
              <option value="off">{'No confirmation for this stream'}</option>
            </TextField>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={!dirty || busy}
                onClick={() => void save()}
              >
                {'Save'}
              </Button>
              <Button
                color={topic.archived ? 'primary' : 'error'}
                disabled={busy || !loaded}
                onClick={() => void toggleArchived()}
              >
                {topic.archived ? 'Restore' : 'Retire'}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </CardDisplay>
  )

  return (
    <>
      {/* The page heading and the trail name the topic; this card is
          then free to say what it holds rather than repeating the title. */}
      <PageHeaderRecord title={topic.name || topic.id} />
      {card}
    </>
  )
}

export default EmailTopicDetail
