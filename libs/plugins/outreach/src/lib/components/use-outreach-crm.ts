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
  pluginRecordListQuery,
  pluginRecordsFromRows,
  type PluginRecordListRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { getDocs, onSnapshot, type DocumentData, type QuerySnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { OutreachLoad } from './use-outreach-data'

/**
 * What Outreach lists from the organization's record system (AGL-2980): the
 * saved views people can be enrolled from, the email templates a step can
 * send, and the people a search finds.
 *
 * Through the record system's own list sources (`plugin-record-lists`,
 * AGL-3080) — the kinds `savedView`, `messageTemplate`, `contact` and `lead`
 * — and never through its collections or its plugin, which a plugin may not
 * import. The owner builds the query its security rules prove and applies
 * its own listing rules to what comes back; with no plugin keeping people,
 * each list reads as empty. The rules gate every one of these reads on
 * `data.manage`, the same permission the enroll routes ask for, so a member
 * who cannot read the people cannot enroll them either.
 */

const denied = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'permission-denied'

/** A listener's documents as rows a list source reads back, the id beside the fields. */
const rowsOf = (snapshot: QuerySnapshot<DocumentData>) =>
  snapshot.docs.map((entry) => ({ ...entry.data(), $id: entry.id }))

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A saved Contacts or Leads view people can be enrolled from (AGL-3234). */
export interface OutreachViewOption {
  id: string
  name: string
  /** Which list the view is of; a Leads view selects the sequence's site's leads. */
  section: 'contacts' | 'leads'
}

/** The most saved views the picker lists. */
export const OUTREACH_VIEWS_LIMIT = 50

/**
 * The saved Contacts and Leads views this reader may enroll from: their own
 * and the shared ones — a colleague's private view is theirs, and the record
 * system leaves it out — that it says can be taken whole as an audience. A
 * view filtering on something enrolling cannot apply is not offered, because
 * dropping that filter would enroll more people than the view shows.
 */
export function useOutreachSavedViews(
  orgId: string | null,
  uid: string | null,
): OutreachLoad<OutreachViewOption[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachViewOption[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId) return undefined
    const request: PluginRecordListRequest = { orgId, viewerUid: uid, limit: OUTREACH_VIEWS_LIMIT }
    const views = pluginRecordListQuery('savedView', firestore, request)
    if (!views) {
      setResult({ status: 'ready', data: [] })
      return undefined
    }
    return onSnapshot(
      views,
      (snapshot) =>
        setResult({
          status: 'ready',
          data: pluginRecordsFromRows('savedView', rowsOf(snapshot), '$id', request)
            // A view the owner says cannot be taken whole is not offered:
            // dropping the filter it could not apply would enroll more
            // people than the view shows.
            .filter((view) => view.facts['takeable'] === true)
            .map((view) => ({
              id: view.id,
              name: view.name,
              section: view.facts['recordKind'] === 'lead' ? ('leads' as const) : ('contacts' as const),
            })),
        }),
      (error) => {
        if (!denied(error))
          console.error('[outreach] saved views could not be read', error)
        setResult({ status: denied(error) ? 'refused' : 'error', data: [] })
      },
    )
  }, [firestore, orgId, uid])
  return result
}

/** An email template the record system keeps, which a step can send the body of. */
export interface OutreachTemplateOption {
  id: string
  name: string
  subject: string
  body: string
}

/**
 * The email templates a step at this site can use: whole letters, not
 * snippets — and, as the record system lists them, the team's and this
 * reader's own, written for the whole organization or for this site.
 */
export function useOutreachEmailTemplates(
  orgId: string | null,
  hostId: string | null,
  uid: string | null,
): OutreachLoad<OutreachTemplateOption[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachTemplateOption[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId) return undefined
    const request: PluginRecordListRequest = {
      orgId,
      hostId,
      viewerUid: uid,
      limit: OUTREACH_TEMPLATES_LIMIT,
    }
    const templates = pluginRecordListQuery('messageTemplate', firestore, request)
    if (!templates) {
      setResult({ status: 'ready', data: [] })
      return undefined
    }
    return onSnapshot(
      templates,
      (snapshot) =>
        setResult({
          status: 'ready',
          data: pluginRecordsFromRows('messageTemplate', rowsOf(snapshot), '$id', request)
            // Whole letters, not snippets.
            .filter((template) => template.facts['kind'] === 'template')
            .map((template) => ({
              id: template.id,
              name: template.name,
              subject: text(template.facts['subject']),
              body: text(template.facts['body']),
            })),
        }),
      (error) => {
        if (!denied(error))
          console.error('[outreach] email templates could not be read', error)
        setResult({ status: denied(error) ? 'refused' : 'error', data: [] })
      },
    )
  }, [firestore, orgId, hostId, uid])
  return result
}

/** A contact a search found. */
export interface OutreachContactOption {
  id: string
  name: string
  email: string | null
}

/** The most templates the picker reads — the record system's own ceiling. */
export const OUTREACH_TEMPLATES_LIMIT = 200

/** The most contacts one search answers with. */
export const OUTREACH_SEARCH_LIMIT = 25

/**
 * The contacts at `hostId` a search finds — by address when the text is one,
 * otherwise by a word of the name, the record system's own search — named as
 * the sequence's consent group knows them. `idle` until something is typed.
 */
export function useOutreachContactSearch(input: {
  orgId: string | null
  hostId: string | null
  contactGroupId: string | null
  text: string
}): OutreachLoad<OutreachContactOption[]> & { idle: boolean } {
  const { orgId, hostId, contactGroupId } = input
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachContactOption[]>>({
    status: 'ready',
    data: [],
  })
  const search = input.text
  const request: PluginRecordListRequest | null =
    orgId && hostId
      ? { orgId, hostId, consentGroupId: contactGroupId, search, limit: OUTREACH_SEARCH_LIMIT }
      : null
  // Nothing to look for — no site, nothing typed, or no record system — is
  // idle rather than an empty answer.
  const idle = !request || !pluginRecordListQuery('contact', firestore, request)
  useEffect(() => {
    if (idle || !request) {
      setResult({ status: 'ready', data: [] })
      return undefined
    }
    const contacts = pluginRecordListQuery('contact', firestore, request)
    if (!contacts) return undefined
    let current = true
    setResult((previous) => ({ status: 'loading', data: previous.data }))
    // Settles the typing before it reads: one query per pause, not per key.
    const timer = setTimeout(() => {
      getDocs(contacts)
        .then((snapshot) => {
          if (!current) return
          setResult({
            status: 'ready',
            data: pluginRecordsFromRows('contact', rowsOf(snapshot), '$id', request).map((contact) => ({
              id: contact.id,
              name: contact.name,
              email: text(contact.facts['email']) || null,
            })),
          })
        })
        .catch((error: unknown) => {
          if (!current) return
          if (!denied(error))
            console.error('[outreach] the contact search failed', error)
          setResult({ status: denied(error) ? 'refused' : 'error', data: [] })
        })
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
    // The request is data; these are its parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, orgId, hostId, contactGroupId, search, idle])
  return { ...result, idle }
}

/** The most leads the picker reads — the Leads list's own window. */
export const OUTREACH_LEADS_WINDOW = 200

/**
 * The open leads at `hostId` a search finds (AGL-3234): the site's most
 * recently seen leads, read once while the tab is open and narrowed in
 * the browser by a word of the name or the address — a lead carries no
 * search tokens, and the window is the Leads list's own. Leads the record
 * system says are no longer open — converted or closed — are left out: they
 * are a contact's, or a verdict's, to enroll. `idle` until something is
 * typed.
 */
export function useOutreachLeadSearch(input: {
  orgId: string | null
  hostId: string | null
  text: string
  enabled: boolean
}): OutreachLoad<OutreachContactOption[]> & { idle: boolean } {
  const { orgId, hostId, text: typed, enabled } = input
  const firestore = useFirestore()
  const [window, setWindow] = useState<OutreachLoad<OutreachContactOption[]>>({
    status: 'ready',
    data: [],
  })
  useEffect(() => {
    if (!enabled || !hostId || !orgId) {
      setWindow({ status: 'ready', data: [] })
      return undefined
    }
    const request: PluginRecordListRequest = { orgId, hostId, limit: OUTREACH_LEADS_WINDOW }
    const leads = pluginRecordListQuery('lead', firestore, request)
    if (!leads) {
      setWindow({ status: 'ready', data: [] })
      return undefined
    }
    let current = true
    setWindow({ status: 'loading', data: [] })
    getDocs(leads)
      .then((snapshot) => {
        if (!current) return
        setWindow({
          status: 'ready',
          data: pluginRecordsFromRows('lead', rowsOf(snapshot), '$id', request)
            // Converted and closed leads are a contact's, or a verdict's, to enroll.
            .filter((lead) => lead.facts['open'] === true)
            .map((lead) => ({
              id: lead.id,
              name: lead.name,
              email: text(lead.facts['email']) || null,
            })),
        })
      })
      .catch((error: unknown) => {
        if (!current) return
        if (!denied(error)) console.error('[outreach] the leads could not be read', error)
        setWindow({ status: denied(error) ? 'refused' : 'error', data: [] })
      })
    return () => {
      current = false
    }
  }, [firestore, orgId, hostId, enabled])
  const needle = typed.trim().toLowerCase()
  const idle = !hostId || !needle
  const data = idle
    ? []
    : window.data
        .filter(
          (lead) =>
            lead.name.toLowerCase().includes(needle) ||
            (lead.email ?? '').includes(needle),
        )
        .slice(0, OUTREACH_SEARCH_LIMIT)
  return { ...window, data, idle }
}
