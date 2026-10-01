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
  hostIdsFromScope,
  isOrgWideScope,
  scopeTokensForHost,
} from '@aglyn/aglyn'
import {
  pluginContainerKind,
  type PluginContainerKind,
} from '@aglyn/aglyn/plugin-manager/plugin-containers'
import { collection, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { collectionCeiling } from './host-collection-queries'
import { useFirestore } from './firebase/firebase-services'
import { useFirestoreCollection } from './use-firestore-collection'
import { useHostOrgIdState } from './use-host-org-id'

/**
 * How many containers a picker offers.
 *
 * The same fifty an owner's container table draws, so a container a merchant
 * can see in its list is one they can file a record under. A picker with a
 * larger window would offer containers the list they came from does not
 * show; a smaller one would hide containers that are plainly there.
 */
export const CONTAINER_OPTION_CEILING = 50

const NO_ROWS: ReadonlyArray<Record<string, unknown>> = Object.freeze([])

/** One container, as much of it as a picker needs. */
export interface ContainerOption {
  value: string
  label: string
  /**
   * The sites the container is placed on, `null` when it is on every site.
   * Read from its `visibleTo`; an unscoped container is on no site (`[]`).
   */
  siteIds?: string[] | null
}

export interface ContainerOptions {
  options: ContainerOption[]
  /** The org holds more matching containers than the ceiling offers. */
  truncated: boolean
  /** The read has answered — false while it is still settling or disabled. */
  ready: boolean
}

/**
 * The picker's shape, from a ceilinged read of one kind's containers.
 *
 * One mapping for both hooks below, so a container reads the same on a
 * site's picker and on the organization's. The name is read from the field
 * the owner declares, falling back to the id.
 */
export function containerOptionsFrom(
  data: ReadonlyArray<Record<string, unknown>> | null | undefined,
  declared: Pick<PluginContainerKind, 'nameField'> | null,
  ready: boolean,
): ContainerOptions {
  const rows = declared ? (data ?? []) : []
  const truncated = rows.length > CONTAINER_OPTION_CEILING
  const nameField = declared?.nameField ?? ''
  const live = rows
    .slice(0, CONTAINER_OPTION_CEILING)
    // A container its owner retired is not one a record may be filed under.
    // The owner's own table filters the same field for the same reason.
    .filter((row) => !row['deletedAt'])
  return {
    options: live
      .map((row) => {
        const visibleTo = Array.isArray(row['visibleTo'])
          ? (row['visibleTo'] as string[])
          : []
        return {
          value: String(row['$id']),
          label: String(row[nameField] ?? row['$id']),
          siteIds: isOrgWideScope(visibleTo)
            ? null
            : hostIdsFromScope(visibleTo),
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    truncated,
    ready,
  }
}

/**
 * THE CONTAINERS OF ONE KIND A SITE OFFERS, for a picker on some other
 * record's page.
 *
 * Lives here rather than in the plugin that keeps the kind because the
 * console app may not import a feature plugin — a screen's detail page is an
 * app route — and the form, contact and lead surfaces that file records are
 * other plugins again. The kind is declared by its owner
 * (`plugin-manager/plugin-containers.ts`); this reads where the declaration
 * says, and a kind no plugin keeps settles as ready with nothing to offer.
 *
 * ## The org's containers, as this site sees them
 *
 * Containers belong to the organization (`orgs/{orgId}/{orgCollection}`),
 * and each is placed on some of its sites by its `visibleTo`. A site's
 * picker offers the ones placed on it: `'org'` (every site) or
 * `host:{hostId}`, which is `scopeTokensForHost`. The clause is also what
 * makes the read provable for a collaborator scoped to this site — the rules
 * evaluate `visibleTo` per document on a list, and an unfiltered query is
 * refused whole rather than narrowed.
 *
 * The org comes from the `hostIndex` lookup. Nothing is read until it
 * answers, and a host with no org settles as ready with nothing.
 *
 * ## It is OFF unless a caller asks
 *
 * `enabled` defaults to false. The picker this feeds sits on a record's own
 * page beside fields a reader came for; charging every open of a form, a
 * screen or a contact for fifty container documents they may not touch is
 * the read-on-mount this console refuses. The callers turn it on when their
 * editing surface opens.
 *
 * ## Ordered on the document name
 *
 * `collectionCeiling`, for the reason it exists: a container's own dates are
 * optional, so ordering on one would not mis-sort the picker, it would DROP
 * the containers that have none. The labels are sorted by name here, over the
 * whole ceiling rather than a slice of it, which is the one case sorting a
 * window is honest. It is also the one ordering the automatic single-field
 * index on `visibleTo` serves beside `array-contains-any`, so the query
 * needs no composite index.
 */
export function useSiteContainerOptions(
  kind: string,
  hostId: string | undefined,
  options?: { enabled?: boolean },
): ContainerOptions {
  const declared = useMemo(() => pluginContainerKind(kind), [kind])
  const enabled = options?.enabled ?? false
  const firestore = useFirestore()
  const org = useHostOrgIdState(enabled && declared ? hostId : undefined)
  const orgId = org.orgId
  const collectionName = declared?.orgCollection ?? ''
  // Memoised: a listener dependency, and a fresh array each render would
  // reopen the subscription every time.
  const tokens = useMemo(
    () => (hostId ? scopeTokensForHost(hostId) : null),
    [hostId],
  )
  const { data, status } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      enabled && collectionName && hostId && orgId && tokens
        ? collectionCeiling(
            query(
              collection(firestore, 'orgs', orgId, collectionName),
              where('visibleTo', 'array-contains-any', tokens),
            ),
            CONTAINER_OPTION_CEILING,
          )
        : null,
    [firestore, hostId, orgId, tokens, enabled, collectionName],
    { idField: '$id' },
  )

  const ready =
    enabled &&
    Boolean(hostId) &&
    (!declared || (org.loaded && (orgId ? status !== 'loading' : true)))
  return useMemo(
    () => containerOptionsFrom(orgId ? data : NO_ROWS, declared, ready),
    [data, orgId, declared, ready],
  )
}

/**
 * THE ORGANIZATION'S CONTAINERS OF ONE KIND, for a picker on an org-level
 * record — a lead on the org's Leads page, an outbound sequence.
 *
 * Every live container, whichever sites it is placed on: the records these
 * pickers file belong to the organization, and so does the container. The
 * read is unfiltered because the surfaces that call it are the org-level
 * hubs, whose readers are org-wide members — the rules admit them to every
 * container, and a `visibleTo` clause would only need the org's whole site
 * list and still miss a site it did not carry. Each option carries its
 * `siteIds`, for a caller that wants to say where a container runs.
 *
 * Off unless a caller asks, and ceilinged and ordered, for the reasons
 * {@link useSiteContainerOptions} gives.
 */
export function useOrgContainerOptions(
  kind: string,
  orgId: string | null | undefined,
  options?: { enabled?: boolean },
): ContainerOptions {
  const declared = useMemo(() => pluginContainerKind(kind), [kind])
  const enabled = options?.enabled ?? false
  const firestore = useFirestore()
  const collectionName = declared?.orgCollection ?? ''
  const { data, status } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      enabled && collectionName && orgId
        ? collectionCeiling(
            collection(firestore, 'orgs', orgId, collectionName),
            CONTAINER_OPTION_CEILING,
          )
        : null,
    [firestore, orgId, enabled, collectionName],
    { idField: '$id' },
  )

  const ready = enabled && Boolean(orgId) && (!declared || status !== 'loading')
  return useMemo(() => containerOptionsFrom(data, declared, ready), [data, declared, ready])
}
