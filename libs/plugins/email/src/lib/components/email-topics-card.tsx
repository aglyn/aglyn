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
  createResourceUid,
  isEmailTopicId,
  pluginDocsHelp,
  DEFAULT_EMAIL_TOPICS,
  EMAIL_TOPICS_COLLECTION,
} from '@aglyn/aglyn'
import {
  mdiArchiveArrowUpOutline,
  mdiArchiveOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useOrgEmailTopics, writeEmailTopic } from './use-org-email-topics'

export interface EmailTopicsCardProps {
  hostId: string
  /** The emails hub URL, which every topic route hangs beneath. */
  basePath: string
}

/**
 * Email topics: the streams a recipient can leave one at a time.
 *
 * ## What this closes
 *
 * `docs/specs/email-competitive-gaps.md` §1f is a table of what six
 * competitors have, and the preference-center row was the one where every one
 * of them had something and we had nothing: unsubscribe was all-or-nothing per
 * site. This card is the merchant's half of the fix — the recipient's half is
 * the hosted preference page the campaign footer now links to.
 *
 * ## Why the four built-ins are not documents
 *
 * Every org that exists today has an empty `emailTopics` collection, and a
 * seeding migration would leave any org created while it ran with none. So
 * `DEFAULT_EMAIL_TOPICS` is the FLOOR of the catalog rather than its initial
 * contents: the four are present for every org with no write anywhere, and
 * saving one on its detail page writes a document at the same id that renames
 * or retires it. A built-in with no stored document is not a missing row, it
 * is a row nobody has needed to change.
 *
 * ## Create is a drawer; edit is the topic's own page
 *
 * The console's standing shape for a list surface: creating opens the shared
 * `CreateArtifactDrawer`, the same one Screens, Components, Layouts and
 * Templates use, and changing an existing record happens on that record's
 * page rather than in a form stacked above the table. So this card lists and
 * routes, and `email-topic-detail.tsx` edits.
 *
 * ## The row grammar the rest of the surface uses
 *
 * The same one the audiences table sets: the row opens the topic, the topic's
 * name is ALSO a real link so it can be middle-clicked and copied, and the
 * secondary actions sit behind the shared `RowActionsMenu` rather than as text
 * buttons in the row. Retire is the reason the menu has more than one entry —
 * it is the only thing that can be done to a topic without opening it, and it
 * is destructive enough that it should not sit one mis-click from the row's
 * own open handler.
 */
export function EmailTopicsCard(props: EmailTopicsCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { topics, scope } = useOrgEmailTopics(hostId)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busyTopicId, setBusyTopicId] = useState('')

  /** The topic's own page, which is also its edit page. */
  const topicHref = useCallback(
    (topicId: string) => `${basePath}/topics/${topicId}`,
    [basePath],
  )

  const create = useCallback(
    async (values: Record<string, any>) => {
      if (!scope) return
      const name = String(values?.displayName ?? '').trim()
      if (!name) return
      // `createResourceUid` is nanoid's `A-Za-z0-9_-`, so the id it mints
      // always satisfies `isEmailTopicId`. Checked anyway, because this id is
      // signed into every unsubscribe link the topic ever mints and the send
      // path refuses one that is not usable — a topic nothing can be sent
      // under is a row the merchant would have no way to diagnose.
      const id = createResourceUid()
      if (!isEmailTopicId(id)) {
        return void enqueueSnackbar('Could not create the topic', {
          variant: 'error',
        })
      }
      try {
        await setDoc(
          doc(firestore, scope[0], scope[1], EMAIL_TOPICS_COLLECTION, id),
          {
            name,
            description: String(values?.description ?? '').trim(),
            archived: false,
          },
        )
        setDrawerOpen(false)
        setError(null)
        enqueueSnackbar('Topic added', { variant: 'success', persist: false })
        // Straight to the record, which is where every further change is made.
        router.push(topicHref(id))
      } catch (caught) {
        console.error(caught)
        setError(caught)
      }
    },
    [scope, firestore, enqueueSnackbar, topicHref, router],
  )

  /**
   * Retire a topic, or bring one back.
   *
   * Retire and not delete: campaigns already sent under a topic minted
   * unsubscribe links carrying its id, those links are sitting in inboxes, and
   * an id that stops resolving is a preference page that cannot name the
   * message the recipient is holding. The Firestore rules refuse a delete for
   * the same reason.
   *
   * Restoring is not asked about — it puts a choice back rather than taking
   * one away, and it is undone by retiring again.
   */
  const toggleArchived = useCallback(
    async (topic: { id: string; name: string; description: string; archived?: boolean }) => {
      if (!scope || busyTopicId) return
      if (!topic.archived) {
        const accepted = await confirm({
          title: `Retire “${topic.name}”?`,
          description:
            'It leaves the composer and the preference page, so nothing new ' +
            'can be sent under it and recipients stop seeing it as a choice. ' +
            'Campaigns already sent under it keep working — their ' +
            'unsubscribe links still name this topic. You can bring it back ' +
            'at any time.',
          confirmationText: 'Retire',
        })
          // `confirm` resolves with NO VALUE and REJECTS on cancel, so gating
          // on the resolved value alone makes this always return (AGL-950).
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
      }
      setBusyTopicId(topic.id)
      try {
        await writeEmailTopic(firestore, scope, {
          id: topic.id,
          name: topic.name,
          description: topic.description,
          archived: !topic.archived,
        })
        enqueueSnackbar(topic.archived ? 'Topic restored' : 'Topic retired', {
          variant: 'success',
          persist: false,
        })
      } catch (caught) {
        console.error(caught)
        enqueueSnackbar('An error has occurred', { variant: 'error' })
      } finally {
        setBusyTopicId('')
      }
    },
    [scope, busyTopicId, confirm, firestore, enqueueSnackbar],
  )

  const rowActions = (topic: {
    id: string
    name: string
    description: string
    archived?: boolean
  }): RowActionsMenuItem[] => [
    {
      key: 'edit',
      label: 'Edit topic',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      href: topicHref(topic.id),
    },
    {
      key: 'archive',
      label: topic.archived ? 'Restore' : 'Retire',
      icon: (
        <MdiIcon
          path={
            topic.archived
              ? mdiArchiveArrowUpOutline.path
              : mdiArchiveOutline.path
          }
          size={0.8}
        />
      ),
      destructive: !topic.archived,
      disabled: Boolean(busyTopicId),
      disabledReason: busyTopicId ? 'Another topic is being saved' : undefined,
      onClick: () => void toggleArchived(topic),
    },
  ]

  return (
    <CardDisplay
      header="Topics"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#topics' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: scope ? (
          <Button variant="contained" onClick={() => setDrawerOpen(true)}>
            {'New topic'}
          </Button>
        ) : null,
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The streams your recipients can leave one at a time. Every ' +
            'campaign belongs to one, and the preference page linked from ' +
            'each email lets someone stop that stream without stopping ' +
            'everything. Topics are shared across every site in this ' +
            'organization, the same way your lists are.'}
        </Typography>
        {!scope ? (
          <Typography variant="body2" color="text.secondary">
            {'This site has no organization, so it has no topic list.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Topic'}</TableCell>
                <TableCell>{'What recipients are told they get'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {topics.map((topic) => {
                const href = topicHref(topic.id)
                return (
                  <TableRow
                    key={topic.id}
                    hover
                    onClick={() => router.push(href)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        {/*
                          The row's own handler would fire too and push the
                          same route twice — one history entry per back press.
                         */}
                        <AppLink
                          href={href}
                          onClick={(event: { stopPropagation: () => void }) =>
                            event.stopPropagation()
                          }
                        >
                          {topic.name}
                        </AppLink>
                        {topic.archived ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            color="warning"
                            label="Retired"
                          />
                        ) : null}
                        {DEFAULT_EMAIL_TOPICS.some(
                          (it) => it.id === topic.id,
                        ) ? (
                          <Typography
                            variant="overline"
                            color="text.secondary"
                          >
                            {'Built in'}
                          </Typography>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {topic.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ width: 56 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <RowActionsMenu
                        label={topic.name}
                        items={rowActions(topic)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Stack>
      <CreateArtifactDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New email topic"
        submitLabel="Create topic"
        onSubmit={create}
        errorSlot={
          error ? (
            <Typography variant="body2" color="error" sx={{ mt: 2 }}>
              {'Could not create the topic. Try again.'}
            </Typography>
          ) : null
        }
      />
    </CardDisplay>
  )
}

export default EmailTopicsCard
