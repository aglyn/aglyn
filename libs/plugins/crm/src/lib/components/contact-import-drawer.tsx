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
 * IMPORTING A CONTACT FILE — the contact vocabulary over the shared drawer
 * (AGL-2602; the drawer itself is `csv-import-drawer.tsx` since AGL-2621).
 *
 * The server half is `server/contacts-import.ts`. What this file adds to
 * the walk the shared drawer makes is what is particular to people: the
 * contact fields and their aliases, the holder's custom fields as further
 * targets, the email as the one cell every row needs — judged here by the
 * same normalizer the route runs, as a courtesy count — and the line in
 * the result that says how many companies the file's company column made.
 */

import {
  CONTACT_IMPORT_CHUNK_SIZE,
  CONTACT_IMPORT_FIELD_LABELS,
  CONTACT_IMPORT_FIELDS,
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_PREVIEW_ROWS,
  CONTACT_IMPORT_SKIP_LABELS,
  type ConsolePluginPageProps,
  type ContactFieldDefinition,
  type ContactImportChunkResult,
  type ContactImportField,
  type ContactImportRawRow,
  type ContactImportSkippedRow,
  contactImportSkippedCsv,
  CRM_COLLECTIONS,
  consentGroupForHost,
  emptyContactImportResult,
  guessContactImportMapping,
  hostScopeToken,
  mapContactImportRow,
  MAX_SCOPE_HOSTS,
  mergeContactImportResults,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import { Typography } from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { contactImportTemplateCsv } from '../model/contacts-csv'
import {
  CsvImportButton,
  CsvImportDrawer,
  type CsvImportVocabulary,
} from './csv-import-drawer'

export interface ContactImportDrawerProps {
  open: boolean
  onClose: () => void
  hostId: string
  /**
   * The org document the shell passed, for the consent group's scope
   * tokens. Typed as the page prop it is forwarded from, so the contacts
   * list mounts the button with the value it already holds and no cast.
   */
  org?: ConsolePluginPageProps['org']
}

/**
 * The holder's live custom-field definitions, read only while the drawer
 * is open.
 *
 * A local hook rather than a shared one because the Fields section that
 * will own these definitions is landing beside this drawer; when it ships a
 * `useContactFieldDefinitions`, this is the read to replace with it. Scoped
 * by `visibleTo` the way the contacts listener is, because the rules prove
 * a scoped member's query per document and refuse an unfiltered one.
 *
 * Ordered in memory rather than by the query: `array-contains-any` with an
 * `orderBy` on another field needs a composite index the collection does
 * not have, and a holder's field list fits in one page.
 */
function useImportFieldDefinitions(options: {
  orgId: string | null | undefined
  visibleToTokens: readonly string[]
  enabled: boolean
}): ContactFieldDefinition[] {
  const { orgId, visibleToTokens, enabled } = options
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<ContactFieldDefinition & { $id: string }>(
    () =>
      enabled && orgId
        ? query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.contactFields),
            where('visibleTo', 'array-contains-any', [...visibleToTokens]),
            limit(100),
          )
        : null,
    [firestore, orgId, visibleToTokens, enabled],
    { idField: '$id' },
  )
  return useMemo(
    () =>
      (data ?? [])
        .filter((field) => !!field.key && !field.retiredAt)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)),
    [data],
  )
}

/** The contact vocabulary, over the holder's custom fields. */
function contactImportVocabulary(
  fields: readonly ContactFieldDefinition[],
): CsvImportVocabulary<
  ContactImportField,
  ContactImportRawRow & Record<string, unknown>,
  ContactImportSkippedRow
> {
  return {
    title: 'Import contacts from CSV',
    help: pluginDocsHelp('contacts', { anchor: '#import-from-csv' }),
    intro:
      'A CSV with a header row. Match its columns to contact fields ' +
      'below, check the preview, then import. A person already in your ' +
      'contacts is updated rather than added twice. Up to ' +
      `${CONTACT_IMPORT_MAX_ROWS.toLocaleString()} rows per file — split a ` +
      'larger one.',
    fields: CONTACT_IMPORT_FIELDS,
    fieldLabels: CONTACT_IMPORT_FIELD_LABELS,
    customFields: fields,
    requiredField: 'email',
    requiredWarning:
      'Choose which column holds the email address. It is the one field ' +
      'every row needs.',
    unusable: (cell) => !normalizeContactEmail(cell),
    unusableNotice: (count, total) =>
      `${count.toLocaleString()} of ${total.toLocaleString()} rows have no ` +
      'usable email address and will be skipped. You can download them ' +
      'after the import.',
    guessMapping: (columns) => guessContactImportMapping(columns, fields),
    mapRow: (cells, mapping) =>
      mapContactImportRow(cells, mapping) as ContactImportRawRow & Record<string, unknown>,
    route: '/api/crm/contacts-import',
    maxRows: CONTACT_IMPORT_MAX_ROWS,
    chunkSize: CONTACT_IMPORT_CHUNK_SIZE,
    previewRows: CONTACT_IMPORT_PREVIEW_ROWS,
    emptyResult: emptyContactImportResult,
    mergeResults: (total, chunk, offset) =>
      mergeContactImportResults(
        total as ContactImportChunkResult,
        chunk as ContactImportChunkResult,
        offset,
      ),
    skipLabels: CONTACT_IMPORT_SKIP_LABELS,
    skippedCsv: contactImportSkippedCsv,
    skippedFileName: 'skipped-contacts.csv',
    templateCsv: () => contactImportTemplateCsv(fields),
    templateFileName: 'contacts-template.csv',
    resultExtras: (result) => {
      const created = (result as ContactImportChunkResult).companiesCreated
      return created ? (
        <Typography variant="body2" color="text.secondary">
          {`${created.toLocaleString()} new ${
            created === 1 ? 'company' : 'companies'
          } created from the company column.`}
        </Typography>
      ) : null
    },
  }
}

export function ContactImportDrawer(props: ContactImportDrawerProps) {
  const { open, onClose, hostId, org } = props
  const { orgId } = useOrgDataScope({ hostId })
  const consentGroup = useMemo(
    () => consentGroupForHost((org ?? {}) as Record<string, unknown>, hostId),
    [org, hostId],
  )
  const visibleToTokens = useMemo(
    () =>
      [
        ORG_SCOPE_TOKEN,
        ...consentGroup.hostIds.map((id) => hostScopeToken(id)),
      ].slice(0, MAX_SCOPE_HOSTS),
    [consentGroup],
  )
  const fields = useImportFieldDefinitions({
    orgId,
    visibleToTokens,
    enabled: open,
  })
  const vocabulary = useMemo(() => contactImportVocabulary(fields), [fields])
  return (
    <CsvImportDrawer
      open={open}
      onClose={onClose}
      hostId={hostId}
      vocabulary={vocabulary}
    />
  )
}
ContactImportDrawer.displayName = 'ContactImportDrawer'

/**
 * The "Import CSV" action on the contacts list, with the drawer it opens —
 * mounted only once opened, so the list pays nothing for it until then.
 */
export function ContactImportButton(props: {
  hostId: string
  org?: ConsolePluginPageProps['org']
}) {
  const { hostId, org } = props
  return (
    <CsvImportButton>
      {(open, onClose) => (
        <ContactImportDrawer open={open} onClose={onClose} hostId={hostId} org={org} />
      )}
    </CsvImportButton>
  )
}
ContactImportButton.displayName = 'ContactImportButton'

export default ContactImportDrawer
