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
  contactDisplayName,
  CRM_COLLECTIONS,
  nameSearchKey,
  normalizeContactEmail,
  pluginDocsHelp,
  readContactCompanyLink,
  readContactFacet,
} from '@aglyn/aglyn'
import { mdiAccountPlusOutline, mdiLinkOff } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, usePagedCollection } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  endAt,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { type CrmScope, crmVisibleToClause } from '../hooks/use-crm-scope'
import {
  CONTACT_COMPANY_IDS_FIELD,
  contactCompanyLinkWrites,
} from '../model/companies'
import { contactPrimaryGroup } from '../model/contact-record'
import type { CrmRoutes } from '../model/crm-routes'

/** How many matches a search offers to link. */
const SEARCH_LIMIT = 8

/** A very high private-use codepoint, closing a prefix range. */
const HIGH = '\uf8ff'

export interface CompanyContactsCardProps {
  companyId: string
  companyName: string
  crmScope: CrmScope
  /** The org document, for each contact's own holder at the organization level. */
  org?: Record<string, unknown> | null
  routes: CrmRoutes
}

interface ContactRow {
  $id: string
  name: string
  email: string
  /** Whether THIS holder's facet is what links the person here. */
  linkedByThisHolder: boolean
  /** Raw document, for the link helper to read the facets from. */
  data: Record<string, unknown>
}

/**
 * THE PEOPLE AT ONE COMPANY, and the control that puts a person there
 * (AGL-2597).
 *
 * ## What it reads
 *
 * Contacts whose `companyIds` mirror carries this company — see
 * `CONTACT_COMPANY_IDS_FIELD` for why a mirror and not the facet — newest
 * activity first, one page at a time under the shared footer, plus one
 * server aggregate for the total. The aggregate is what the footer counts
 * with: a company's people are a real list, bounded by how many the account
 * has met rather than by any taxonomy, and a page the reader can turn is the
 * only honest answer to the fifty-first. The membership is PII and one
 * document per person, so it is read HERE, where somebody opened the
 * company, and never on the list that names companies.
 *
 * ## The scope caveat, stated rather than hidden
 *
 * The listener cannot carry the `visibleTo` predicate beside the
 * `array-contains` on the mirror — Firestore takes one array clause per
 * query — so the rules admit it only to an org-wide member. A member scoped
 * to particular sites is refused, and the card SAYS so: an empty table for
 * them would read as "nobody works here", which is the answer this surface
 * must never give wrongly.
 *
 * ## Linking
 *
 * "Add contact" finds a person by email address or by name among the
 * contacts this site may see — those reads DO carry the scope predicate —
 * and links them through `contactCompanyLinkUpdate`, which is what keeps the
 * facet and the mirror in step. A person already at another company is moved,
 * and the row says so before the click.
 */
export function CompanyContactsCard(props: CompanyContactsCardProps) {
  const { companyId, companyName, crmScope, org, routes } = props
  const { scope, consentGroup, visibleTo } = crmScope
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  /**
   * The holder a person is read and linked through: the viewing group under
   * a site; at the organization level (AGL-2630) each person's own primary
   * holder, so the link lands on the facet the record page edits.
   */
  const groupIdOf = useCallback(
    (row: Record<string, unknown>) =>
      consentGroup?.groupId ?? contactPrimaryGroup(row, org ?? null).groupId,
    [consentGroup, org],
  )

  const {
    rows: contactDocs,
    status,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<Record<string, unknown> & { $id: string }>(
    (pageLimit) =>
      scope
        ? query(
            collection(firestore, scope[0], scope[1], 'contacts'),
            where(CONTACT_COMPANY_IDS_FIELD, 'array-contains', companyId),
            orderBy('updatedAt', 'desc'),
            limit(pageLimit),
          )
        : null,
    [firestore, scope, companyId],
    { idField: '$id' },
  )
  const contacts: ContactRow[] = contactDocs.map((row) => ({
    $id: row.$id,
    name: contactDisplayName(row, groupIdOf(row)),
    email: String(row['email'] ?? ''),
    linkedByThisHolder:
      readContactFacet(row, groupIdOf(row)).companyId === companyId,
    data: row,
  }))

  /*
   * The total, as a server aggregate, re-taken when a link is made or
   * removed here — a figure that disagreed with the table under it would
   * read as the link having failed.
   */
  const [count, setCount] = useState<number | null>(null)
  const [membershipVersion, setMembershipVersion] = useState(0)
  useEffect(() => {
    if (!scope) return undefined
    let active = true
    void getCountFromServer(
      query(
        collection(firestore, scope[0], scope[1], 'contacts'),
        where(CONTACT_COMPANY_IDS_FIELD, 'array-contains', companyId),
      ),
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
  }, [firestore, scope, companyId, membershipVersion])
  const bumpMembership = useCallback(
    () => setMembershipVersion((version) => version + 1),
    [],
  )

  /*==========================================
   * ADD CONTACT: a search, run on ASK.
   *
   * One text box that decides for itself: an `@` in it is an address and is
   * matched exactly on the normalized email; anything else is a name and is
   * matched as a prefix on `nameLower`. Both are one-shot reads issued when
   * the button is pressed — not a listener per keystroke — because a search
   * is a question the person asked, and each answer costs a page of PII.
   *=========================================*/
  const [adding, setAdding] = useState(false)
  const [term, setTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ContactRow[] | null>(null)
  const [searchError, setSearchError] = useState('')

  const handleSearch = useCallback(async () => {
    if (!scope || searching) return
    const raw = term.trim()
    if (!raw) return
    setSearching(true)
    setSearchError('')
    try {
      const contactsRef = collection(firestore, scope[0], scope[1], 'contacts')
      // Absent at the organization level, where the tokens are `null` (AGL-2630).
      const scoped = crmVisibleToClause(visibleTo)
      let found
      if (raw.includes('@')) {
        const email = normalizeContactEmail(raw)
        if (!email) {
          setResults([])
          return
        }
        found = await getDocs(
          query(contactsRef, ...scoped, where('email', '==', email), limit(SEARCH_LIMIT)),
        )
      } else {
        const key = nameSearchKey(raw)
        found = await getDocs(
          query(
            contactsRef,
            ...scoped,
            orderBy('nameLower'),
            startAt(key),
            endAt(`${key}${HIGH}`),
            limit(SEARCH_LIMIT),
          ),
        )
      }
      setResults(
        found.docs.map((snapshot) => {
          const data = snapshot.data()
          return {
            $id: snapshot.id,
            name: contactDisplayName(data, groupIdOf(data)),
            email: String(data['email'] ?? ''),
            linkedByThisHolder:
              readContactFacet(data, groupIdOf(data)).companyId === companyId,
            data,
          }
        }),
      )
    } catch (error) {
      console.error(error)
      setResults(null)
      setSearchError('The search could not be run.')
    } finally {
      setSearching(false)
    }
  }, [scope, searching, term, firestore, visibleTo, groupIdOf, companyId])

  const setLink = useCallback(
    async (row: ContactRow, companyIdOrNull: string | null) => {
      if (!scope) return
      /*
       * The name rides with the link, so the person reads as "at Acme" in
       * the contact list and the global search the moment they are linked
       * here — and stops reading so when unlinked. The count on each company
       * the link moves lands in the same commit, so the figure above this
       * table and the one on the companies list cannot disagree.
       */
      const groupId = groupIdOf(row.data)
      const link = contactCompanyLinkWrites(
        readContactCompanyLink(row.data, groupId),
        groupId,
        companyIdOrNull,
        companyIdOrNull ? companyName : null,
      )
      if (!link) return
      try {
        const batch = writeBatch(firestore)
        batch.update(
          doc(firestore, scope[0], scope[1], 'contacts', row.$id),
          link.contact,
        )
        for (const company of link.companies) {
          batch.update(
            doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, company.id),
            company.update,
          )
        }
        await batch.commit()
        bumpMembership()
        enqueueSnackbar(
          companyIdOrNull
            ? `${row.name || row.email} linked to ${companyName}`
            : `${row.name || row.email} unlinked`,
          { variant: 'success', persist: false },
        )
        if (companyIdOrNull) {
          setResults(null)
          setTerm('')
          setAdding(false)
        }
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    },
    [scope, groupIdOf, firestore, bumpMembership, enqueueSnackbar, companyName],
  )

  const denied = status === 'error'

  return (
    <CardDisplay
      header={'Contacts'}
      help={pluginDocsHelp('companies', { anchor: '#contacts-at-a-company' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button
            size="small"
            color="primary"
            variant="outlined"
            disabled={!scope}
            startIcon={<MdiIcon path={mdiAccountPlusOutline.path} size={0.8} />}
            onClick={() => setAdding((open) => !open)}
          >
            {'Add contact'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {count === null
            ? denied
              ? ''
              : 'Counting contacts…'
            : count === 1
              ? '1 contact'
              : `${count.toLocaleString()} contacts`}
        </Typography>

        {adding ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                size="small"
                label="Find by email or name"
                placeholder="jane@acme.com or Jane"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSearch()
                  }
                }}
                sx={{ flexGrow: 1, maxWidth: 360 }}
              />
              <Button
                size="small"
                variant="contained"
                disabled={searching || !term.trim()}
                onClick={() => void handleSearch()}
              >
                {searching ? 'Finding…' : 'Find'}
              </Button>
            </Stack>
            {searchError ? <Alert severity="warning">{searchError}</Alert> : null}
            {results && results.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'No contact your site can see matches that.'}
              </Typography>
            ) : null}
            {results?.map((row) => {
              const elsewhere =
                readContactFacet(row.data, groupIdOf(row.data)).companyId
              return (
                <Stack
                  key={row.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                    {row.name ? `${row.name} · ${row.email}` : row.email}
                    {elsewhere && elsewhere !== companyId ? (
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                      >
                        {' — at another company; linking moves them'}
                      </Typography>
                    ) : null}
                  </Typography>
                  <Button
                    size="small"
                    disabled={row.linkedByThisHolder}
                    onClick={() => void setLink(row, companyId)}
                  >
                    {row.linkedByThisHolder ? 'Linked' : 'Link'}
                  </Button>
                </Stack>
              )
            })}
          </Stack>
        ) : null}

        {denied ? (
          <Alert severity="info">
            {'The contacts at this company could not be listed. Your access ' +
              'is limited to specific sites, and this list cannot be ' +
              'narrowed to them — an organization administrator can see it.'}
          </Alert>
        ) : contacts.length === 0 && page === 0 ? (
          <EmptyStateComponent
            compact
            label={status === 'loading' ? 'Loading contacts…' : 'Nobody is linked to this company yet'}
            description={
              status === 'loading'
                ? undefined
                : 'Find a contact by email address or name and link them here.'
            }
            action={
              status === 'loading' || adding ? undefined : (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  disabled={!scope}
                  startIcon={<MdiIcon path={mdiAccountPlusOutline.path} size={0.8} />}
                  onClick={() => setAdding(true)}
                >
                  {'Add contact'}
                </Button>
              )
            }
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Contact'}</TableCell>
                <TableCell>{'Email'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.map((row) => (
                <TableRow key={row.$id} hover>
                  <TableCell>
                    <AppLink href={routes.contact(row.$id)}>
                      {row.name || row.email}
                    </AppLink>
                  </TableCell>
                  <TableCell>{row.email}</TableCell>
                  <TableCell align="right" sx={{ width: 56 }}>
                    {/*
                      Unlinking is offered only where THIS holder's facet is
                      the link. A person here through another site's filing
                      is that site's record to change, and the mirror would
                      keep them here anyway.
                     */}
                    {row.linkedByThisHolder ? (
                      <Tooltip title="Unlink from this company">
                        <IconButton
                          size="small"
                          aria-label={`Unlink ${row.name || row.email}`}
                          onClick={() => void setLink(row, null)}
                        >
                          <MdiIcon path={mdiLinkOff.path} size={0.8} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {'Linked by another site'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {/*
          The footer counts with the server aggregate when it has arrived —
          the one number this card knows that the paged window does not —
          and with the probe row until then.
         */}
        {!denied && (contacts.length > 0 || page > 0) ? (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={contacts.length}
            count={count ?? undefined}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CompanyContactsCard.displayName = 'CompanyContactsCard'

export default CompanyContactsCard
