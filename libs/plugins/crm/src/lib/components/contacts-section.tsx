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

import * as Aglyn from '@aglyn/aglyn'
import {
  checkContactQuota,
  contactMatchesSegment,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_SOURCE_LABELS,
  type ContactLifecycleStage,
  type ContactSegment,
  type ContactSource,
  newResourceScopeFields,
  ORG_SCOPE_TOKEN,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { type ConsolePluginPageProps } from '@aglyn/aglyn'
import {
  gridFilterRequest,
  hiddenFilterVisibility,
  type ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { CONTACT_LIST_FILTER_FIELDS } from '../constants/contact-filters'
import { type ContactRecord, contactRecordFromDoc } from '../model/contact-record'
import { contactsListSeed } from '../model/contacts-list-seed'
import { crmRoutes } from '../model/crm-routes'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import ContactsBulkBar from './contacts-bulk-bar'
import { ContactImportButton } from './contact-import-drawer'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  listFilterConstraints,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostActivityLogger,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import type { GridFilterModel } from '@mui/x-data-grid'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RecentActivityFeed from './recent-activity-feed'
import { CONTACT_FILTER_COLUMNS, contactListColumns } from './contact-list-columns'
import NewContactDrawer, { type NewContactValues } from './new-contact-drawer'
import { useCrmApi } from './use-crm-api'
import { useOrgMembers } from './use-org-members'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { customFieldColumns } from './contact-custom-columns'

/**
 * The shared labels, under the name this file has always called them.
 *
 * The map lives beside the `ContactSource` union so the dynamic-list rule
 * editor and this filter cannot disagree about what `order` is called.
 */
const SOURCE_LABELS = CONTACT_SOURCE_LABELS

/**
 * Why a refund found no contact to record itself against (AGL-2329).
 *
 * The three reasons `recordContactRefund` distinguishes, in the operator's
 * language rather than the writer's enum. They are not interchangeable: two
 * of them are things the merchant can act on and one is a deletion nothing
 * should undo, and collapsing them into "unmatched" would turn an actionable
 * fact into a statistic.
 */
const UNMATCHED_REFUND_REASON: Record<string, string> = {
  'no-email': 'the order carried no email address',
  'no-contact': 'no contact record matched the buyer',
  'contact-deleted': 'the contact was deleted between the sale and the refund',
}

const csvEscape = (value: unknown) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Contacts CRM (AGL-198): the unified people list fed by AGL-197's
 * ingestion — search, source badges, a profile drawer with the
 * interaction timeline plus tags/notes editing, and CSV export. Available
 * on every plan; the contactsPerHost quota is the upgrade lever.
 */
/**
 * Contacts CRM (AGL-109 → AGL-395): the unified contacts list, segments,
 * and profile drawer, owned by the contacts plugin and rendered by the
 * shell's generic plugin route. The shell applies the `release_contacts`
 * gate (via the nav tab) and passes the resolved `org` doc for the
 * `contactsPerHost` quota check.
 *
 * Since AGL-2595 this is the `people` SECTION of the Contacts hub rather
 * than the whole page: `crm-console-page.tsx` routes to it, and the
 * companies, deals, tasks, reports and fields sections sit beside it. The
 * body is the v1 page unchanged, and it takes the shell's full prop bag so
 * nothing the v1 page read has to be threaded through the hub by name.
 */
export function ContactsPeopleSection(props: ConsolePluginPageProps) {
  const { hostId, org, releaseFlag, basePath } = props
  /*
   * A row is a LINK now (AGL-2596): opening a person navigates to their own
   * page rather than a drawer over the list, so the address can be pasted
   * and every other CRM record can point at it. `basePath` is what the hub
   * hands every section; the empty fallback only exists for a direct mount
   * without the shell, where there is nowhere to navigate to anyway.
   */
  const routes = crmRoutes(basePath ?? '')
  const router = useRouter()
  // Whether the audience overage on this page is actually INVOICED
  // (AGL-1662), and whether that question has been answered yet.
  //
  // AGL-1604 stopped the usage cron putting `contactsOverageUsd` into
  // `billedCents` while `release_contacts` is off for the org; `db5ecdf2b`
  // taught the console billing page's caption the same thing. This page's own
  // alert still quoted the dollar figure with no flag check — and this is the
  // surface a staff member reaches with the flag OFF, because the shell's
  // `FeatureGate` admits them on `visible` (`released || isStaff`). Support
  // then reads that number back to a customer whose invoice will not carry it.
  //
  // The shell resolves this from `released`, never `visible`: staff opening a
  // page does not put a line on the customer's bill.
  //
  // Both default to the WITHHELD answer when the prop is absent, which only
  // happens in a direct mount — the shell always supplies it for a surface
  // with a nav-tab flag. A caller that has not resolved the verdict has not
  // earned the right to quote a charge.
  const contactsBilled = releaseFlag?.released ?? false
  const releaseFlagsReady = releaseFlag?.ready ?? false
  // Org-shared data root (AGL-237). Null until the org lookup settles
  // (AGL-1061), and for a host with no owning org — the pre-migration host
  // path this used to fall back to is gone (AGL-1050), so the CRM lists
  // nothing rather than listing somewhere else.
  const { scope: dataScope, orgId } = useOrgDataScope({ hostId })
  // The org's custom fields, for the optional columns below (AGL-2601).
  const customFields = useContactFieldDefinitions(dataScope?.[1] ?? null)
  /*==========================================
   * THE CONTROLLER THIS PAGE IS SHOWING.
   *
   * A contact document is shared by every site in the org — one human who
   * touched two sites is one row, which is the dedupe the shared address book
   * exists for and the reason the org is billed once for them. Almost nothing
   * ON that row is shared: the notes, tags, timeline and lifetime value are
   * the holder's own business records, and while they lived at the top of the
   * document every site in an agency's account could read every client's.
   *
   * So the page resolves the group it is being viewed as — the sites declared
   * to be one sender, or this site alone — and reads that group's facet.
   * Pure, from the org document the shell already passed, so it costs no
   * read.
   *=========================================*/
  const consentGroup = useMemo(
    () => Aglyn.consentGroupForHost(org as Record<string, unknown>, hostId),
    [org, hostId],
  )
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: user } = useUser()
  const logActivity = useHostActivityLogger(hostId)

  /*
   * WHAT THE LIST WAS OPENED FOR (AGL-2612).
   *
   * Two surfaces address this list with a question rather than a record: a
   * form's own page ("who came in through this form") and an Inbox
   * submission row ("open the person with this address"). Both arrive as
   * query keys, parsed once into the same filter the grid's panel would
   * produce, so the seeded query IS a typed query and nothing here is a
   * second predicate.
   */
  const searchParams = useSearchParams()
  const seed = useMemo(() => contactsListSeed(searchParams), [searchParams])
  /*
   * The column filter, declared BEFORE the listener that reads it — the query
   * is rebuilt from it, so it cannot be state introduced further down.
   *
   * The grid's model is CONTROLLED, beside the request the query reads, so
   * a seeded filter shows in the panel exactly as a typed one would and the
   * chip that clears it below clears both — an `initialState` alone would
   * leave the panel claiming a filter the query had already dropped.
   */
  const [filter, setFilter] = useState<ListFilterRequest | null>(seed.filter)
  const [gridFilter, setGridFilter] = useState<GridFilterModel>(() => ({
    items: seed.filter
      ? [
          {
            id: 'seed',
            field: seed.filter.field,
            operator: seed.filter.op,
            value: seed.filter.value,
          },
        ]
      : [],
  }))
  /**
   * The one filter that cannot carry the scope clause.
   *
   * `formIds` is an `array-contains` on the mirror, and Firestore takes one
   * array clause per query — so this listener drops its `visibleTo`
   * predicate for it, exactly as the company contacts card does for
   * `companyIds`, and the rules then admit the read to an org-wide member
   * only. A scoped member's listener errors instead of listing, and the
   * alert below says so rather than showing an empty form.
   */
  const byForm = filter?.field === 'formIds'
  /**
   * The scope tokens this viewer may read, capped at what
   * `array-contains-any` accepts.
   *
   * `'org'` is included because an org-wide contact is visible to every site
   * — an org that widened its default deliberately still sees its own rows.
   */
  const visibleToTokens = useMemo(
    () =>
      [
        Aglyn.ORG_SCOPE_TOKEN,
        ...consentGroup.hostIds.map((id) => Aglyn.hostScopeToken(id)),
      ].slice(0, Aglyn.MAX_SCOPE_HOSTS),
    [consentGroup],
  )
  const {
    data: contactDocs,
    status: contactsStatus,
    /**
     * The rows the profile drawer is seeded from are unconfirmed by the
     * server (AGL-1358). This payload is narrower than most sites in this
     * issue — `email`, `sources` and `interactions` are not in it — but the
     * two fields that are, `tags` and `notes`, are BOTH written on every
     * save and both come off the seed. Edit the notes against a cached read
     * and the tags go back with them, and tags are what
     * `contactMatchesSegment` runs on: a saved segment is a campaign
     * audience, so a rollback here silently changes who gets emailed.
     */
    fromCache: contactsFromCache,
  } = useFirestoreCollection<any>(
    () => {
      if (!dataScope) return null
      /*
       * ORDERED, and filtered by the QUERY (AGL-2501, AGL-2292).
       *
       * Two bugs shared this one line. `limit(1000)` with no `orderBy` returns
       * documents in ID order — contacts are created with `.add()` and
       * `createResourceUid()`, so that is a pseudo-random SAMPLE of a thousand,
       * and the client `.sort()` below made it look reliably newest-first. An
       * org with forty thousand contacts saw a thousand arbitrary ones,
       * convincingly sorted.
       *
       * The search then ran over that sample, so a name on the wrong side of
       * the cap answered "no contacts match" — the answer a search must never
       * give wrongly, on the list a merchant uses to find one person.
       *
       * The cap STAYS: nobody needs forty thousand rows streamed into a table,
       * and the head-count has been a server aggregate since AGL-1706. What
       * changes is that the thousand are now the newest thousand, and that a
       * filter reaches the whole collection before the cap applies.
       */
      const constraints = listFilterConstraints(
        CONTACT_LIST_FILTER_FIELDS,
        filter,
      )
      /*
       * SCOPED, and this is the leak it closes.
       *
       * The listener had no `where()` at all: `hostId` reached it only to
       * resolve which ORG owns the data, so every site in the account listed
       * every contact in the account. An agency's client opened Contacts and
       * read the other clients' customers.
       *
       * `array-contains-any` over the group's tokens is the same predicate
       * the rules evaluate with `hasAny`, so a filtered query is provable
       * per-document and an UNFILTERED one is now permission-denied rather
       * than quietly returning everything.
       */
      return query(
        collection(firestore, dataScope[0], dataScope[1], 'contacts'),
        // Dropped for the form mirror alone — see `byForm`.
        ...(byForm
          ? []
          : [where('visibleTo', 'array-contains-any', visibleToTokens)]),
        ...(constraints ?? [orderBy('updatedAt', 'desc')]),
        limit(1000),
      )
    },
    [firestore, dataScope, filter, byForm, visibleToTokens],
    { idField: '$id' },
  )
  /*
   * OPENED FOR ONE ADDRESS: move straight on to the record (AGL-2612).
   *
   * The Inbox links here with an email because a contact's id is minted at
   * capture and nothing outside the CRM holds it; the list is the lookup.
   * Once the seeded `email equals` query has answered with exactly one row,
   * that row is the person and the list is a detour — `replace`, so Back
   * returns to the Inbox rather than to this redirect. Nothing else
   * navigates: no match leaves the filtered list on screen, which is the
   * honest answer for a submission whose contact the band dropped, and a
   * filter the reader has since changed is theirs.
   */
  const openedByEmail = useRef(false)
  useEffect(() => {
    if (openedByEmail.current || !seed.openEmail) return
    if (contactsStatus !== 'success') return
    if (filter?.field !== 'email' || filter.value !== seed.openEmail) return
    const only = (contactDocs ?? []).length === 1 ? contactDocs?.[0] : null
    if (!only) return
    openedByEmail.current = true
    router.replace(routes.contact(String(only.$id)))
  }, [seed.openEmail, contactsStatus, filter, contactDocs, router, routes])
  /**
   * Every row, flattened through THIS group's facet.
   *
   * One projection rather than a facet read at each of the nine places that
   * touch `tags`, `notes`, `name` or `interactions`: a surface that reads one
   * of them off the top of the document is a surface showing another
   * holder's records, and nine chances to forget is nine leaks.
   *
   * The canonical `name` is the fallback and the shared identity; a holder's
   * own override wins, so one business renaming a person cannot change what
   * an unrelated business sees.
   */
  const contacts: ContactRecord[] = useMemo(
    () =>
      (contactDocs ?? []).map((row) => contactRecordFromDoc(row, consentGroup)),
    [contactDocs, consentGroup],
  )
  /*
   * The roster, for the Owner column — read only once a loaded row actually
   * carries an owner. A list of people nobody has assigned never pays for
   * the team list, and the create drawer asks for it in its own right.
   */
  const [createOpen, setCreateOpen] = useState(false)
  const members = useOrgMembers(orgId, {
    enabled: createOpen || contacts.some((contact) => Boolean(contact.ownerUid)),
  })
  /**
   * The HEAD-COUNT, read as a server-side aggregate (AGL-1706).
   *
   * The listener above is `limit(1000)` and always will be — nobody needs
   * 40,000 rows streamed into a table. What it must not do is answer "how
   * many contacts does this org have", and it did: `contacts.length`
   * saturated at 1,000, which is *exactly* the smallest paid included band
   * (`starter`). So `overageContacts = max(0, used − included)` was 0 on
   * every stock plan and the alert below could not render at all.
   *
   * Worse than the dead alert, the same capped number fed the readout in the
   * toolbar. An org with 40,000 contacts on Pro read "1,000 contacts ·
   * 10,000 included" — a page whose job is telling a customer where they sit
   * in their band, telling them they have room they do not have. The console
   * billing page read the truth from `getCountFromServer` on this very
   * collection, so the two surfaces disagreed about the same org's audience.
   *
   * THE LIST AND THE COUNT ARE DIFFERENT QUESTIONS and now have different
   * answers: one aggregate read per mount, the same call
   * `billing-usage.component.tsx` already makes against the same path.
   *
   * The counting RULE is untouched — `checkContactQuota` is an entitlement
   * input and the usage cron is what bills from it. Only this page's input
   * stopped being a saturated one.
   */
  const [serverContactCount, setServerContactCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    if (!dataScope) return
    let active = true
    void getCountFromServer(
      collection(firestore, dataScope[0], dataScope[1], 'contacts'),
    )
      .then((snapshot) => {
        if (active) setServerContactCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the listener length below — a LOWER bound, and the
        // behaviour this page had before. Deliberately not 0: `checkContactQuota`
        // answers a question from whatever it is handed, and a defaulted 0
        // would clear the free plan's hard-band alert on an org that is over it.
      })
    return () => {
      active = false
    }
  }, [firestore, dataScope])
  // Pending or denied, the listener length stands in. It can only UNDERSTATE
  // (it is the same collection, capped), never overstate, so no alert this
  // number gates can fire on a count larger than the truth.
  const contactCount = serverContactCount ?? contacts.length
  // Audience bands (AGL-890): paid plans meter past the included count
  // instead of blocking; only free hard-bands (quota.allowed = false).
  const quota = checkContactQuota(org, contactCount)
  // Signups whose CRM record was dropped at the free band (AGL-891) —
  // written by upsert-contact, host-scoped.
  const { data: droppedCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'contactsDropped'),
    [firestore, hostId],
  )
  const droppedTotal = Number(droppedCounter?.['total'] ?? 0)

  /*==========================================
   * REFUNDS THAT REACHED NO CONTACT (AGL-2329).
   *
   * `recordContactRefund` refuses to create a contact for a refund — a
   * contact holding a refund and no purchase is a phantom record with
   * negative lifetime value — and increments
   * `hosts/{hostId}/counters/contactRefundsUnmatched` instead. Its own
   * comment says the shape mirrors `contactsDropped` "so an operator…", and
   * there the sentence stops: `contactsDropped` had this reader and the
   * refund counter had none, so a refund that reached no contact record
   * incremented a number nobody could see.
   *
   * It sits beside the dropped-signup alert because they are the same kind
   * of fact — something that happened to this host's CRM and left no row —
   * and an operator reconciling their contact list needs both or neither.
   *=========================================*/
  const { data: unmatchedRefundCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'contactRefundsUnmatched'),
    [firestore, hostId],
  )
  const unmatchedRefundTotal = Number(unmatchedRefundCounter?.['total'] ?? 0)
  const unmatchedRefundReason = String(
    unmatchedRefundCounter?.['lastReason'] ?? '',
  )

  // Saved segments (AGL-199): reusable audience filters.
  const { data: segmentDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'contactSegments',
            ),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const segments = [...(segmentDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  const [sourceFilter, setSourceFilter] = useState<'' | ContactSource>(seed.source)
  const [tagFilter, setTagFilter] = useState('')
  /*
   * Stage and owner narrow the loaded window the way the segment controls
   * do, and for the same reason one layer down: both live on the viewing
   * group's FACET, and a facet path is per group, so neither is a field the
   * query grammar can reach without an index per group. Ordinary orgs load
   * their whole list into the window anyway; the caption below says what
   * these narrow for the ones that do not.
   */
  const [stageFilter, setStageFilter] = useState<'' | ContactLifecycleStage>('')
  const [assignedToMe, setAssignedToMe] = useState(false)
  const filterSegment: Pick<ContactSegment, 'tags' | 'sources'> = useMemo(
    () => ({
      tags: tagFilter
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      sources: sourceFilter ? [sourceFilter] : [],
    }),
    [tagFilter, sourceFilter],
  )
  const filterActive = Boolean(
    filterSegment.tags?.length || filterSegment.sources?.length,
  )
  const windowNarrowed = filterActive || Boolean(stageFilter) || assignedToMe
  /*
   * The SEGMENT controls still narrow in the browser, and say so below.
   *
   * They are a different feature from the search: a segment is saved and
   * becomes a campaign audience, and `contactMatchesSegment` is the one
   * predicate that both the console and the sender read. Pushing it into the
   * query would need a second copy of it in Firestore terms — and two copies
   * of "who is in this audience" is how a campaign goes to the wrong people.
   *
   * So it refines the ordered window rather than the collection, which the
   * caption states rather than leaving to be discovered. The free-text search
   * that used to sit beside it is the grid's now, and reaches everything.
   */
  const uid = user?.uid ?? ''
  const visible = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          contactMatchesSegment(contact, filterSegment) &&
          (!stageFilter || contact.lifecycleStage === stageFilter) &&
          (!assignedToMe || (Boolean(uid) && contact.ownerUid === uid)),
      ),
    [contacts, filterSegment, stageFilter, assignedToMe, uid],
  )

  /* One row grammar, the console's (AGL-2501) — the same table everywhere. */
  const contactColumns = useMemo(
    () => [
      ...contactListColumns({ memberName: members.memberName }),
      // The org's custom fields as optional columns (AGL-2601).
      ...customFieldColumns(customFields.active),
    ],
    [members.memberName, customFields.active],
  )

  const [segmentName, setSegmentName] = useState('')
  const handleSaveSegment = useCallback(async () => {
    const name = segmentName.trim().slice(0, 60)
    // No org, no place to put it (AGL-1050). The button is disabled in
    // this state; the guard is here so the callback cannot outlive it.
    if (!name || !filterActive || !dataScope) return
    try {
      await addDoc(
        collection(firestore, dataScope[0], dataScope[1], 'contactSegments'),
        {
          name,
          tags: filterSegment.tags ?? [],
          sources: filterSegment.sources ?? [],
          // `contactSegments` is in SCOPED_COLLECTIONS and was the one
          // member of it with no `array-contains-any` reader and no rules
          // `hasAny` — the rules gate it on `isOrgWideMember()` and
          // `campaign-send` checks it with `visibleToHost`, which passes on
          // a missing field. So nothing broke, which is precisely why this
          // went unnoticed (AGL-1478): a collection listed as scoped that
          // nothing enforces is a trap set for whoever wires up the first
          // scoped read, and they would inherit every segment ever saved
          // already broken. Stamped at creation instead, like its siblings.
          //
          // Org-wide, unconditionally: `useOrgDataScope` resolves to
          // `['orgs', orgId]` or to null, AGL-1061 having removed the
          // `hosts/{hostId}` branch after counting zero documents there.
          // A segment is a saved filter over org contacts, so it is exactly
          // as visible as they are.
          ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
          createdAt: new Date(),
        },
      )
      setSegmentName('')
      enqueueSnackbar(
        `Segment "${name}" saved — usable as a campaign audience`,
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    segmentName,
    filterActive,
    filterSegment,
    firestore,
    dataScope,
    enqueueSnackbar,
  ])

  /** The rows ticked for a bulk action (AGL-2603); the bar above the table acts on them. */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /*==========================================
   * ADDING ONE PERSON BY HAND (AGL-2596).
   *
   * Through the plugin's server route rather than a client write, because
   * creating a contact is the one act on this surface the rules cannot fully
   * judge: the dedupe against every holder's rows is a lookup the capturing
   * site may not read, and the audience band is a count the browser cannot
   * take. The route answers `{ contactId, created }`; a merge onto somebody
   * already in the address book is not an error, and the page says which
   * happened before it opens the record.
   *=========================================*/
  const crmApi = useCrmApi(hostId)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const handleCreate = useCallback(
    async (values: NewContactValues) => {
      setCreateBusy(true)
      setCreateError(null)
      try {
        const { response, payload } = await crmApi('contacts-create', {
          email: values.email,
          ...(values.name ? { name: values.name } : {}),
          ...(values.phone ? { phone: values.phone } : {}),
          ...(values.jobTitle ? { jobTitle: values.jobTitle } : {}),
          ...(values.companyName ? { companyName: values.companyName } : {}),
          ...(values.address ? { address: values.address } : {}),
          ...(values.ownerUid ? { ownerUid: values.ownerUid } : {}),
          ...(values.lifecycleStage
            ? { lifecycleStage: values.lifecycleStage }
            : {}),
          ...(values.tags.length ? { tags: values.tags } : {}),
          marketingConsent: values.marketingConsent,
        })
        if (!response.ok) {
          // The route's own sentence, shown above the form unchanged: the
          // band refusal is the list's wording, and a field refusal names
          // the field.
          setCreateError(
            String(payload['error'] ?? 'The contact could not be added.'),
          )
          return
        }
        const contactId = String(payload['contactId'] ?? '')
        logActivity('Added contact', {
          type: 'contact',
          id: contactId,
          name: values.name || values.email,
        })
        enqueueSnackbar(
          payload['created']
            ? 'Contact added'
            : 'Already a contact — what you entered was merged into their record',
          { variant: 'success', persist: false },
        )
        setCreateOpen(false)
        if (contactId) router.push(routes.contact(contactId))
      } catch (error) {
        console.error(error)
        setCreateError('The contact could not be added.')
      } finally {
        setCreateBusy(false)
      }
    },
    [crmApi, enqueueSnackbar, logActivity, router, routes],
  )

  const handleExport = useCallback(() => {
    const rows = [
      [
        'email',
        'name',
        'phone',
        'company',
        'jobTitle',
        'owner',
        'stage',
        'sources',
        'tags',
        'lastInteraction',
        'notes',
      ],
      ...visible.map((contact) => [
        contact.email,
        contact.name ?? '',
        contact.phone,
        contact.companyName,
        contact.jobTitle,
        contact.ownerUid ? members.memberName(contact.ownerUid) : '',
        contact.lifecycleStage
          ? CONTACT_LIFECYCLE_STAGE_LABELS[contact.lifecycleStage]
          : '',
        Object.keys(contact.sources ?? {}).join('|'),
        (contact.tags ?? []).join('|'),
        contact.interactions?.[0]
          ? new Date(contact.interactions[0].atMs).toISOString()
          : '',
        contact.notes ?? '',
      ]),
    ]
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'contacts.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [visible, members])

  return (
    <>
      <CardDisplay
        header={'Contacts'}
        help={pluginDocsHelp('contacts', { anchor: '#the-contacts-page' })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {/* The org's audience, not the page's row count (AGL-1706) —
                  these two stopped being the same number the moment the
                  listener grew a `limit(1000)`. */}
              {`${contactCount.toLocaleString()} contacts · ${
                Number.isFinite(quota.included)
                  ? `${quota.included.toLocaleString()} included`
                  : '∞'
              }`}
            </Typography>
            <ContactImportButton hostId={hostId} org={org} />
            <Button
              size="small"
              onClick={handleExport}
              disabled={!visible.length}
            >
              {'Export CSV'}
            </Button>
            {/* A button that opens a drawer — never a create form above the
                list. Disabled until the org has resolved, because the route
                resolves the org from the site and a click before that has
                nowhere to write. */}
            <Button
              size="small"
              variant="contained"
              color="primary"
              disabled={!dataScope}
              onClick={() => {
                setCreateError(null)
                setCreateOpen(true)
              }}
            >
              {'New contact'}
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <TextField
              select
              size="small"
              label="Source"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as any)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{'Any source'}</MenuItem>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Tags"
              placeholder="vip, beta"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              sx={{ minWidth: 160 }}
            />
            <TextField
              select
              size="small"
              label="Stage"
              value={stageFilter}
              onChange={(event) =>
                setStageFilter(event.target.value as '' | ContactLifecycleStage)
              }
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{'Any stage'}</MenuItem>
              {CONTACT_LIFECYCLE_STAGES.map((stage) => (
                <MenuItem key={stage} value={stage}>
                  {CONTACT_LIFECYCLE_STAGE_LABELS[stage]}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={assignedToMe}
                  onChange={(event) => setAssignedToMe(event.target.checked)}
                />
              }
              label="Assigned to me"
            />
            {filterActive ? (
              <>
                <TextField
                  size="small"
                  label="Segment name"
                  value={segmentName}
                  onChange={(event) => setSegmentName(event.target.value)}
                  sx={{ minWidth: 160 }}
                />
                <Button
                  size="small"
                  disabled={!segmentName.trim() || !dataScope}
                  onClick={handleSaveSegment}
                >
                  {'Save segment'}
                </Button>
              </>
            ) : null}
            {segments.map((segment: any) => (
              <Chip
                key={segment.$id}
                label={segment.name}
                size="small"
                onClick={() => {
                  setTagFilter((segment.tags ?? []).join(', '))
                  setSourceFilter(segment.sources?.[0] ?? '')
                }}
                // A segment can only have come FROM an org scope, so this
                // is unreachable in practice — but the scope is nullable
                // now (AGL-1050) and an unguarded deref would be a crash
                // rather than a no-op if that ever stopped being true.
                onDelete={
                  dataScope
                    ? () =>
                        deleteDoc(
                          doc(
                            firestore,
                            dataScope[0],
                            dataScope[1],
                            'contactSegments',
                            segment.$id,
                          ),
                        )
                    : undefined
                }
              />
            ))}
          </Stack>
          {!quota.allowed ? (
            <Alert severity="warning">
              {'Contact limit reached — new visitors are no longer ' +
                'captured' +
                (droppedTotal > 0
                  ? ` (${droppedTotal.toLocaleString()} missed so far)`
                  : '') +
                '. Upgrade in Billing to keep collecting.'}
            </Alert>
          ) : quota.overageContacts > 0 &&
            quota.overageRateUsd != null &&
            // No claim about money until the verdict that decides it has
            // settled (AGL-1662). `release_contacts` is default-off before
            // Remote Config activation, so an ungated alert would assert the
            // withheld wording for one paint on an org that IS billed.
            releaseFlagsReady ? (
            <Alert severity="info">
              {contactsBilled
                ? // Same sentence as the billing page's caption, and the same
                  // basis (AGL-2399): the count here is LIVE, the invoice
                  // charges the last reading before the month closes, so the
                  // dollar figure is a projection until the month ends. Staff
                  // and customer must not read different sentences about the
                  // same org's money — that applies to WHEN it is measured as
                  // much as to how much.
                  `${quota.overageContacts.toLocaleString()} contacts over ` +
                  `your plan's included ${quota.included.toLocaleString()} — ` +
                  `metered at $${quota.overageRateUsd}/1,000 per month ` +
                  `(≈$${quota.overageMonthlyUsd.toFixed(2)} if your list ends ` +
                  'the month at this size). ' +
                  'Upgrade in Billing for a larger included audience.'
                : // The wording `db5ecdf2b` put on the billing page, which is
                  // itself the wording `1a2aed5cb` published to
                  // `billing-and-plans/overview.md` (AGL-1601/1603). Staff and
                  // customer must not read different sentences about the same
                  // org's money.
                  //
                  // THE COUNT STAYS, THE TOTAL GOES: the head-count is real —
                  // ingestion captured those records — and is not a claim
                  // about money. The upgrade nudge goes with the total, since
                  // it prompts a purchase premised on a charge that is not
                  // happening.
                  `${quota.overageContacts.toLocaleString()} contacts over ` +
                  `your plan's included ${quota.included.toLocaleString()} — ` +
                  'not billed while the Contacts page is unavailable. ' +
                  `The $${quota.overageRateUsd}/1,000 rate applies once ` +
                  'Contacts opens.'}
            </Alert>
          ) : droppedTotal > 0 ? (
            <Alert severity="info">
              {`${droppedTotal.toLocaleString()} earlier visitor${
                droppedTotal === 1 ? ' was' : 's were'
              } not captured while your contact band was full.`}
            </Alert>
          ) : null}
          {/*
            Unlike the band alert above, this one is NOT exclusive with the
            others: a host can be over its band AND have refunds that landed
            nowhere, and the two have different remedies. Chaining it into the
            same ternary would hide whichever fact came second.
          */}
          {unmatchedRefundTotal > 0 ? (
            <Alert severity="warning">
              {`${unmatchedRefundTotal.toLocaleString()} refund${
                unmatchedRefundTotal === 1 ? '' : 's'
              } could not be recorded against a contact${
                UNMATCHED_REFUND_REASON[unmatchedRefundReason]
                  ? ` — most recently because ${UNMATCHED_REFUND_REASON[unmatchedRefundReason]}`
                  : ''
              }. The money moved; the customer's timeline does not show it.`}
            </Alert>
          ) : null}
          {/*
            The form the list was opened for, as a chip that clears it — the
            panel holds the same filter, so the two clear together.
          */}
          {byForm && filter ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Captured through form ${filter.value}`}
                onDelete={() => {
                  setFilter(null)
                  setGridFilter({ items: [] })
                }}
              />
            </Stack>
          ) : null}
          {byForm && contactsStatus === 'error' ? (
            <Alert severity="info">
              {'The contacts this form captured could not be listed. Your ' +
                'access is limited to specific sites, and a form filter ' +
                'cannot be narrowed to them — an organization administrator ' +
                'can see it.'}
            </Alert>
          ) : contacts.length === 0 && filter ? (
            <Typography variant="body2" color="text.secondary">
              {contactsStatus === 'loading'
                ? 'Loading…'
                : 'No contacts match this filter.'}
            </Typography>
          ) : contacts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No contacts yet — form submissions, member sign-ups, ' +
                'orders, and bookings all become contacts automatically.'}
            </Typography>
          ) : (
            <>
              {/* The segment controls refine the loaded window; the search
                  and the column filters reach the whole collection. Said out
                  loud, because a control that narrows less than it looks like
                  it does is the thing this page has been fixing. */}
              {windowNarrowed ? (
                <Typography variant="caption" color="text.secondary">
                  {'Source, tag, stage and "Assigned to me" narrow the loaded ' +
                    'window. Search and the column filters reach every contact.'}
                </Typography>
              ) : null}
              <ContactsBulkBar hostId={hostId} scope={dataScope} consentGroup={consentGroup} rows={visible} selected={selectedIds} onSelectedChange={setSelectedIds} />
              <ListTable
                rows={visible}
                columns={contactColumns}
                selectable={{ selected: selectedIds, onChange: setSelectedIds }}
                onOpen={(id) => router.push(routes.contact(id))}
                /*
                 * The grid must NOT also filter. The query answers it, so a
                 * client pass could only drop rows the query already matched.
                 */
                filterMode="server"
                filterModel={gridFilter}
                onFilterModelChange={(model) => {
                  setGridFilter(model)
                  setFilter(gridFilterRequest(model))
                }}
                initialState={{
                  columns: {
                    columnVisibilityModel: hiddenFilterVisibility(
                      CONTACT_LIST_FILTER_FIELDS,
                      CONTACT_FILTER_COLUMNS,
                    ),
                  },
                }}
              />
            </>
          )}
          <RecentActivityFeed hostId={hostId} org={org} basePath={props.basePath} />
        </Stack>
      </CardDisplay>
      {/*
        Mounted only while open, so a page that never reaches for it never
        renders a drawer's chrome, and every opening starts from a blank form.
       */}
      {createOpen ? (
        <NewContactDrawer
          open
          onClose={() => setCreateOpen(false)}
          busy={createBusy}
          error={createError}
          consentGroup={consentGroup}
          owners={members.options}
          ownersReady={members.ready}
          onSubmit={(values) => void handleCreate(values)}
        />
      ) : null}
    </>
  )
}
ContactsPeopleSection.displayName = 'ContactsPeopleSection'

export default ContactsPeopleSection
