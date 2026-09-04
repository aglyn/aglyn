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
 * ONE AUDIENCE: who it is, how it is built, and every person on it.
 *
 * ## Why a route rather than an expanded row
 *
 * The membership used to unfold inside the list table, which cost three
 * things a merchant actually uses. A list was not linkable, so "check the
 * Wholesale audience" could not be sent to anybody. The back button walked out
 * of the whole surface rather than out of the list. And the list's own
 * settings had to live under a table they were not about.
 *
 * ## What it reads
 *
 * The list document — one document, whatever the audience's size — plus one
 * server aggregate for the subscriber total, plus the paged membership window
 * the table below draws. The membership is PII and there is one document per
 * subscriber, so it is read HERE, where somebody asked for it, and nowhere
 * that merely lists audiences.
 *
 * ## The rule is stated, not just flagged
 *
 * A dynamic list is a claim about who is on it, and "Rule" as a chip is not
 * that claim. The summary spells out every dimension the rule actually
 * carries, so the answer to "why is this person not in the audience" is on the
 * screen the question gets asked on.
 */

import {
  normalizeDynamicListRule,
  PageHeaderRecord,
  pluginDocsHelp,
  type ConsentGroup,
} from '@aglyn/aglyn'
import { mdiPencilOutline, mdiTrayArrowUp } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Button, Chip, Stack, Typography } from '@mui/material'
import { collection, doc, getCountFromServer } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useFirestoreDoc, useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { describeDynamicListRule } from './dynamic-list-rule-fields'
import ListImportDrawer from './list-import-drawer'
import ListMembersPanel from './list-members-panel'

export interface ListDetailCardProps {
  hostId: string
  /**
   * The controller this audience is being read AS, resolved by the page from
   * the org document it already holds.
   *
   * Passed through rather than resolved here: the group is a fact about the
   * ORG, one lookup serves every section, and a card that resolved its own
   * would be a second place for the answer to come from.
   */
  consentGroup: ConsentGroup
  listId: string
  /** The emails hub URL, for the way back to the audiences list. */
  basePath: string
}

export function ListDetailCard(props: ListDetailCardProps) {
  const { hostId, consentGroup, listId, basePath } = props
  const firestore = useFirestore()
  const { scope } = useOrgDataScope({ hostId })

  const { data: list, status } = useFirestoreDoc<Record<string, any>>(
    () =>
      scope ? doc(firestore, scope[0], scope[1], 'lists', listId) : null,
    [firestore, scope, listId],
  )

  /*
   * The subscriber total, as a server aggregate.
   *
   * Not the length of the page below: a count beside a paged table is exactly
   * where a page length gets mistaken for a total. Taken once, and re-taken
   * only when a membership is added or removed — a figure that disagreed with
   * the table directly under it would read as the add having failed.
   */
  const [count, setCount] = useState<number | null>(null)
  const [membershipVersion, setMembershipVersion] = useState(0)
  useEffect(() => {
    if (!scope) return undefined
    let active = true
    void getCountFromServer(
      collection(firestore, scope[0], scope[1], 'lists', listId, 'members'),
    )
      .then((snapshot) => {
        if (active) setCount(snapshot.data().count)
      })
      .catch(() => {
        if (active) setCount(null)
      })
    return () => {
      active = false
    }
  }, [firestore, scope, listId, membershipVersion])

  const onMembershipChanged = useCallback(
    () => setMembershipVersion((version) => version + 1),
    [],
  )

  /*
   * Importing is a DRAWER opened from the header, not a control inside the
   * membership panel. It is a multi-step act — choose a file, read what is in
   * it, state that you have permission — and the middle step is the one that
   * must not be cramped, because it carries the screening warnings and the
   * consent readout the attestation is given against.
   */
  const [importing, setImporting] = useState(false)

  const audiencesHref = `${basePath}/audiences`
  const headerActions = (
    <Stack direction="row" spacing={1}>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={audiencesHref}
        size="small"
        color="primary"
      >
        {'All audiences'}
      </Button>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={`${audiencesHref}/${listId}/edit`}
        size="small"
        color="primary"
        variant="outlined"
        startIcon={<MdiIcon path={mdiPencilOutline.path} size={0.8} />}
      >
        {'Edit list'}
      </Button>
      <Button
        size="small"
        color="primary"
        variant="contained"
        startIcon={<MdiIcon path={mdiTrayArrowUp.path} size={0.8} />}
        onClick={() => setImporting(true)}
      >
        {'Import'}
      </Button>
    </Stack>
  )

  if (!list) {
    /*
     * Loading and MISSING are different answers, and the difference matters
     * more here than almost anywhere. Not "no members" — a list that cannot be
     * read is a different situation from an empty one, and rendering an empty
     * membership for the first is how somebody comes to believe an audience
     * they built has lost everybody. Reading `status` rather than the absence
     * of data is also what stops the refusal being flashed on every arrival,
     * before the org scope has even resolved.
     */
    const settled = Boolean(scope) && status !== 'loading'
    return (
      <CardDisplay
        header={'Audience'}
        help={pluginDocsHelp('emailCampaigns', { anchor: '#email-lists' })}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Typography variant="body2" color="text.secondary">
          {settled
            ? 'This list could not be loaded. It may have been deleted.'
            : 'Loading this audience…'}
        </Typography>
      </CardDisplay>
    )
  }

  const dynamic = list['kind'] === 'dynamic'
  /*
   * The filters, whichever kind of list this is.
   *
   * On a live list they are what the sweep evaluates. On a fixed one they are
   * a saved SEARCH — the same filters, used to find people to add rather than
   * to decide membership — so they are read and described either way, and only
   * the sentence about what happens next differs.
   */
  const rule = normalizeDynamicListRule(list['rule'])
  const hasFilters = rule.sources.length > 0
  const summary = hasFilters ? describeDynamicListRule(rule) : []

  /* The card, named so the page chrome above it is a plain list of
     what this surface publishes upward. */
  const card = (
    <CardDisplay
      header={'Audience'}
      help={pluginDocsHelp('emailCampaigns', { anchor: '#list-members' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{ action: headerActions }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          {dynamic ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={
                list['lastEvaluatedAt']?.toDate
                  ? `Rule · ${list['lastEvaluatedAt']
                      .toDate()
                      .toLocaleString()}`
                  : 'Rule · not yet evaluated'
              }
            />
          ) : (
            <Chip size="small" variant="outlined" label="Fixed membership" />
          )}
          <Typography variant="body2" color="text.secondary">
            {count === null
              ? 'Counting subscribers…'
              : count === 1
                ? '1 subscriber'
                : `${count.toLocaleString()} subscribers`}
          </Typography>
        </Stack>

        {/*
          A live list's filters are stated HERE rather than only on the edit
          page: they are the answer to "why is this person not in the
          audience", which is a question asked while looking at the membership.
          A fixed list states them inside the find-people control instead,
          beside the button that acts on them.
         */}
        {dynamic && hasFilters ? (
          <Stack spacing={0.5}>
            {summary.map((clause) => (
              <Typography key={clause} variant="body2" color="text.secondary">
                {clause}
              </Typography>
            ))}
          </Stack>
        ) : null}

        {scope ? (
          <ListMembersPanel
            hostId={hostId}
            consentGroup={consentGroup}
            scope={scope as readonly [string, string]}
            listId={listId}
            listName={String(list['name'] ?? '')}
            onMembershipChanged={onMembershipChanged}
            /*
              Offered only on a FIXED list. A live list's membership is the
              sweep's to decide, and hand-adding its own matches would write
              `via: 'manual'` copies of rows the sweep already owns — rows it
              then may not reconcile away when the person stops matching.
             */
            findRule={dynamic || !hasFilters ? null : rule}
            ruleSummary={summary}
          />
        ) : null}
      </Stack>
      {/*
        Mounted only while it is open, so a page nobody is importing on runs
        none of its effects — the drawer looks for an unfinished import when
        it opens, and that read must not be a cost of visiting an audience.
       */}
      {importing ? (
        <ListImportDrawer
          open
          onClose={() => setImporting(false)}
          hostId={hostId}
          listId={listId}
          listName={String(list['name'] ?? '')}
          onMembershipChanged={onMembershipChanged}
        />
      ) : null}
    </CardDisplay>
  )

  return (
    <>
      {/* The page heading and the trail name the audience; this card is
          then free to say what it holds rather than repeating the title. */}
      <PageHeaderRecord title={String(list['name'] || listId)} />
      {card}
    </>
  )
}
ListDetailCard.displayName = 'ListDetailCard'

export default ListDetailCard
