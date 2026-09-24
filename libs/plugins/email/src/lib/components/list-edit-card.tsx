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
 * A LIST'S SETTINGS: its name, how its membership is decided, and the filters
 * that decide it.
 *
 * ## Why it is its own route
 *
 * Editing the rule that decides an audience is not a thing to do in a row of a
 * table. It is nine fields, several of them consequential enough that the
 * merchant should see what they currently say before changing them, and a
 * rule saved by accident silently re-populates the audience on the next sweep.
 * A route also means the edit is linkable and the back button leaves it.
 *
 * ## The rule is edited as a DRAFT and written once
 *
 * The controls hold text; `draftToRule` turns it into a rule; Save writes that
 * rule. Nothing is written per keystroke, because a dynamic list's rule is
 * read by a sweep every fifteen minutes, which would otherwise re-materialize
 * the audience against a half-typed intermediate state.
 *
 * ## The two outcomes, and the sentence that tells them apart
 *
 * The SAME filters serve both kinds of list, and the difference is what
 * happens afterwards:
 *
 * - **Live** keeps the rule. Membership is re-evaluated on the sweep and the
 *   audience keeps growing as people start matching.
 * - **Fixed** does not. The filters are a way to FIND people; who is on the
 *   list is whoever was added, and it stays that way.
 *
 * A reader must never be unsure which they have, so the control says it in
 * those words and the page repeats it under whichever is selected. Switching
 * is safe in both directions and neither drops anybody: the sweep reconciles
 * away only rows IT wrote (`via: 'rule'`), so a person somebody added by hand
 * survives becoming live, and everyone on the list survives becoming fixed.
 * The rule is kept on a fixed list rather than deleted — it is the filter that
 * found these people, and losing it on a toggle would lose the work.
 *
 * ## Whose people the filters read is a choice, not a side effect
 *
 * A list is the organization's and its rule reads ONE site's leads, members
 * and form submissions — the list's `hostId`. That is written when somebody
 * chooses it and at no other time. A rename saved from another site's page
 * must not move the filters onto that site's people: the next sweep would
 * re-draw the whole audience from somebody else's customers. So the page
 * reads the stored site, offers the change in words, and writes `hostId` only
 * when it differs from what is stored — which is also how a list that never
 * had one gets the site it is first set up on.
 */

import {
  normalizeDynamicListRule,
  PageHeaderRecord,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import DynamicListRuleFields, {
  draftToRule,
  useRuleDraft,
} from './dynamic-list-rule-fields'
import {
  OrgSiteSelect,
  useEmailDataScope,
  useEmailOrgMount,
} from './email-org-mount'

export interface ListEditCardProps {
  /** The site, or `null` on the organization's Emails page. */
  hostId: string | null
  listId: string
  /** The emails hub URL, which the audiences routes hang beneath. */
  basePath: string
}

export function ListEditCard(props: ListEditCardProps) {
  const { hostId, listId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const orgMount = useEmailOrgMount()
  const { scope } = useEmailDataScope(hostId)

  const { data: list, status } = useFirestoreDoc<Record<string, any>>(
    () => (scope ? doc(firestore, scope[0], scope[1], 'lists', listId) : null),
    [firestore, scope, listId],
  )

  const storedName = String(list?.['name'] ?? '')
  const storedKind: 'manual' | 'dynamic' =
    list?.['kind'] === 'dynamic' ? 'dynamic' : 'manual'
  /*
   * Normalized before the form ever sees it, by the same function the
   * materializer reads it back through. A rule shown one way and evaluated
   * another is the defect this screen exists to make visible.
   */
  const storedRule = list ? normalizeDynamicListRule(list['rule']) : undefined

  const [name, setName] = useState('')
  const [kind, setKind] = useState<'manual' | 'dynamic'>('manual')
  const dynamic = kind === 'dynamic'
  /*
   * Seeded ONCE, when the document first arrives. The listen is live, so
   * re-seeding on every snapshot would take the field away from whoever is
   * typing in it — including on the snapshot their own save produces.
   */
  const seeded = useRef(false)
  useEffect(() => {
    if (!list || seeded.current) return
    seeded.current = true
    setName(storedName)
    setKind(storedKind)
  }, [list, storedName, storedKind])

  const [draft, setDraft] = useRuleDraft(storedRule, listId)
  const [busy, setBusy] = useState(false)

  /*
   * WHOSE PEOPLE THE FILTERS READ — see the file header.
   *
   * The stored site stands until somebody chooses another. A list with none
   * yet starts on the site whose page this is, or on the organization's page
   * on the reader's pick this session (or the only site). A stored site the
   * org's page does not list — one since deleted — is not offered as the
   * answer there, so the reader chooses a live one.
   */
  const storedHostId = String(list?.['hostId'] ?? '')
  const [chosenHostId, setChosenHostId] = useState('')
  const storedIsOffered = orgMount
    ? orgMount.hosts.some((site) => site.id === storedHostId)
    : Boolean(storedHostId)
  const ruleHostId: string =
    chosenHostId ||
    (storedIsOffered ? storedHostId : '') ||
    (hostId ?? orgMount?.pickedHostId ?? '')
  /** Under a site, the filters were last set up on a different one. */
  const drawsFromAnotherSite =
    hostId != null && Boolean(storedHostId) && storedHostId !== hostId

  const audiencesHref = `${basePath}/audiences`
  const detailHref = `${audiencesHref}/${listId}`

  const handleSave = async () => {
    const next = name.trim()
    /*
     * An empty name is not a rename. The list table orders on `name`, and
     * `orderBy` drops a document that does not carry the field — so a list
     * renamed to nothing would vanish from the page that lists it.
     */
    if (!next || !scope || busy) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, scope[0], scope[1], 'lists', listId), {
        name: next,
        kind,
        /*
         * The rule is written whichever kind was chosen. On a live list it is
         * what the sweep evaluates; on a fixed one it is the filter that finds
         * people to add, and keeping it is what lets a merchant refine the
         * search across visits instead of retyping it.
         */
        rule: draftToRule(draft),
        /*
         * WHICH SITE'S people the rule draws from.
         *
         * Lists are org-shared but leads, members and form submissions are
         * host-owned, and org contacts are read narrowed to one host. A rule
         * with no host has no silos at all, so the sweep skips it. Written
         * only when it changes — see the file header.
         */
        ...(ruleHostId && ruleHostId !== storedHostId
          ? { hostId: ruleHostId }
          : {}),
      })
      enqueueSnackbar('List saved', { variant: 'success', persist: false })
      router.push(detailHref)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The list was not saved', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const headerActions = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={detailHref}
      size="small"
      color="primary"
    >
      {'Back to the audience'}
    </Button>
  )

  if (!list) {
    const settled = Boolean(scope) && status !== 'loading'
    return (
      <CardDisplay
        header={'Edit list'}
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

  /* The card, named so the page chrome above it is a plain list of
     what this surface publishes upward. */
  const card = (
    <CardDisplay
      header={'Edit audience'}
      help={pluginDocsHelp('emailCampaigns', {
        anchor: dynamic ? '#lists-built-from-a-rule' : '#manual-lists',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{ action: headerActions }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="List name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ flexGrow: 1, minWidth: 240, maxWidth: 360 }}
          />
          {/*
            The one decision on this page that changes what the list DOES, so
            the options are named for their outcome rather than for the field
            they set. "Dynamic" and "manual" describe the implementation; "keeps
            growing" and "does not change" describe what the merchant gets.
           */}
          <TextField
            select
            size="small"
            label="Membership"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as 'manual' | 'dynamic')
            }
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="dynamic">{'Live — keeps growing'}</MenuItem>
            <MenuItem value="manual">{'Fixed — does not change'}</MenuItem>
          </TextField>
        </Stack>

        <Alert severity={dynamic ? 'info' : 'success'}>
          {dynamic
            ? 'Everyone matching these filters is enrolled automatically, ' +
              'about every fifteen minutes, and leaves when they stop ' +
              'matching. Anyone added by hand stays. Being matched is not ' +
              'consent to be emailed — a campaign still only reaches people ' +
              'whose consent is on record.'
            : 'Membership does not change on its own. Use the filters below ' +
              'to FIND people, then add them from the audience page — who ' +
              'you add is who stays on the list.'}
        </Alert>

        {/*
          WHOSE PEOPLE, said before the filters that read them. On the org
          page it is a picker. Under a site it is said only when the stored
          site is another one, with the one control that moves it here.
         */}
        {orgMount ? (
          <OrgSiteSelect
            mount={orgMount}
            label="Site"
            value={ruleHostId}
            onChange={setChosenHostId}
            helperText={
              'The site whose leads, members and form submissions these ' +
              'filters read. A list draws from one site’s people.'
            }
          />
        ) : drawsFromAnotherSite ? (
          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() =>
                  setChosenHostId(chosenHostId ? '' : String(hostId))
                }
              >
                {chosenHostId ? 'Keep the other site' : 'Use this site'}
              </Button>
            }
          >
            {chosenHostId
              ? 'Saving moves these filters onto this site’s people. The ' +
                'next sweep re-draws the audience from them.'
              : 'These filters read another site’s people — the site this ' +
                'list was set up on. Saving here keeps it that way.'}
          </Alert>
        ) : null}

        {scope && ruleHostId ? (
          <DynamicListRuleFields
            key={ruleHostId}
            scope={scope as readonly [string, string]}
            hostId={ruleHostId}
            draft={draft}
            onChange={setDraft}
            listId={listId}
          />
        ) : orgMount ? (
          <Typography variant="body2" color="text.secondary">
            {'Choose the site whose people these filters read to edit them.'}
          </Typography>
        ) : null}
        {/*
          A rule with no source matches nobody, and an audience emptied that
          way looks exactly like one whose sweep has not run yet. It is only a
          warning on a LIVE list: on a fixed one an unset filter selects
          nothing to add and takes nobody off.
         */}
        {draft.sources.length || !dynamic ? null : (
          <Alert severity="warning">
            {'These filters draw from no source, so they match nobody. The ' +
              'next sweep would empty the list of everyone the rule enrolled.'}
          </Alert>
        )}

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            color="primary"
            disabled={busy || !name.trim() || !scope}
            onClick={() => void handleSave()}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={detailHref}
            size="small"
          >
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )

  return (
    <>
      {/*
        The audience being edited. This route is one level BELOW it, and the
        way back is the card header's own button — the trail names where the
        reader is and does not link its last step.
      */}
      <PageHeaderRecord title={storedName || listId} />
      {card}
    </>
  )
}
ListEditCard.displayName = 'ListEditCard'

export default ListEditCard
