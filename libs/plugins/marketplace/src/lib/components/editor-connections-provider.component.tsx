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
  EditorPluginConnectionsContext,
  type EditorPluginConnections,
} from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import type { PluginConnectionSiteRecord } from '@aglyn/aglyn/app-utils/plugin-connection-records'
import { registerRepeatSource } from '@aglyn/aglyn/app-utils/repeat-sources'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  editorPluginConnections,
  syncingConnectionsOf,
  type EditorListingConnections,
  type EditorRealmInstall,
} from '../model/editor-connections'
import { PLUGIN_CONNECTIONS_API_ROUTES } from '../model/plugin-connections'
import { connectionRepeatSource } from '../repeat/connection-repeat-source'

/** The console's editor surfaces: the Besigner and Preview of any document. */
const EDITOR_PATH = /\/(besigner|preview)(\/|$)/

export interface EditorConnectionsProviderProps {
  orgId?: string | null
  hostId?: string | null
  children?: ReactNode
  /** Test seam: the console path. */
  pathname?: string
  /** Test seam: reads the site's realm installs, pins and records. */
  load?: (input: { orgId: string; hostId: string }) => Promise<EditorPluginConnections | undefined>
}

type Fetcher = (path: string) => Promise<Response>

/** A pin of `listingId` on the site, else the workspace's. */
async function readPin(firestore: Firestore, hostId: string, orgId: string, listingId: string): Promise<unknown> {
  for (const path of [['hosts', hostId, 'installs', listingId], ['orgs', orgId, 'installs', listingId]] as const) {
    try {
      const snapshot = await getDoc(doc(firestore, path[0], path[1], path[2], path[3]))
      if (snapshot.exists()) return snapshot.data()
    } catch {
      // A pin this member cannot read is one the editor does without.
    }
  }
  return null
}

/** The record of one connection, or `null` quietly: no key, no plan, no sync yet. */
async function readRecord(
  fetcher: Fetcher,
  input: { hostId: string; listingId: string; connectionId: string },
): Promise<PluginConnectionSiteRecord | null> {
  try {
    const response = await fetcher(`/api/${PLUGIN_CONNECTIONS_API_ROUTES.record}?${new URLSearchParams(input).toString()}`)
    if (!response.ok) return null
    const answer = (await response.json().catch(() => null)) as { record?: Record<string, unknown> | null } | null
    const record = answer?.record
    if (!record || typeof record !== 'object') return null
    return {
      fields: (record['fields'] ?? {}) as PluginConnectionSiteRecord['fields'],
      items: (Array.isArray(record['items']) ? record['items'] : []) as PluginConnectionSiteRecord['items'],
      syncedAtMs: Number(record['syncedAtMs']) || 0,
    }
  } catch {
    return null
  }
}

/** Everything the editor is handed for one site, read once. */
export async function loadEditorPluginConnections(
  deps: { firestore: Firestore; fetcher: Fetcher },
  input: { orgId: string; hostId: string },
): Promise<EditorPluginConnections | undefined> {
  let installs: EditorRealmInstall[]
  try {
    const response = await deps.fetcher(`/api/orgs/realm-plugins?${new URLSearchParams(input).toString()}`)
    if (!response.ok) return undefined
    installs = (((await response.json()) as { installs?: EditorRealmInstall[] }).installs ?? []).filter(
      (install) => typeof install?.listingId === 'string' && install.listingId,
    )
  } catch {
    return undefined
  }
  const listings: EditorListingConnections[] = []
  for (const install of installs) {
    const pin = (await readPin(deps.firestore, input.hostId, input.orgId, install.listingId)) as { manifest?: unknown } | null
    const connections = syncingConnectionsOf(pin?.manifest)
    if (connections.length) listings.push({ listingId: install.listingId, connections })
  }
  if (!listings.length) return undefined
  const records: Record<string, Record<string, PluginConnectionSiteRecord>> = {}
  await Promise.all(
    listings.flatMap((listing) =>
      listing.connections.map(async (connection) => {
        const record = await readRecord(deps.fetcher, {
          hostId: input.hostId,
          listingId: listing.listingId,
          connectionId: connection.id,
        })
        if (record) (records[listing.listingId] ??= {})[connection.id] = record
      }),
    ),
  )
  return editorPluginConnections({ installs, listings, records })
}

/**
 * The site's declared connections, for the editor (AGL-4196): registered as a
 * console provider, active only on the Besigner and Preview, where the
 * canvas hands each signed element its record and the binding picker lists
 * each record's fields by name. A refusal (no site key, no plan) or a failed
 * read leaves the context empty: elements read `null`, as on a site that has
 * not connected.
 */
export function EditorConnectionsProvider(props: EditorConnectionsProviderProps) {
  const { orgId, hostId, children } = props
  const routerPath = usePathname()
  const pathname = props.pathname ?? routerPath ?? ''
  const firestore = useFirestore()
  const { data: user } = useUser()
  const [value, setValue] = useState<EditorPluginConnections | undefined>(undefined)
  const active = Boolean(orgId && hostId && EDITOR_PATH.test(pathname))
  const load = props.load
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''

  useEffect(() => {
    if (!active || !orgId || !hostId || (!load && !uid)) {
      setValue(undefined)
      return undefined
    }
    let live = true
    const read =
      load ?? ((input) => loadEditorPluginConnections({ firestore, fetcher: (path) => authorizedFetch(user as never, path) }, input))
    void read({ orgId, hostId })
      .then((next) => {
        if (live) setValue(next)
      })
      .catch(() => {
        if (live) setValue(undefined)
      })
    return () => {
      live = false
    }
    // `user` churns with token refreshes; the member, the site and the surface name the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, orgId, hostId, uid, firestore, load])

  // The repeat source follows the site (AGL-4212): its picker lists this
  // site's connections, and its token menu their fields. Put back to the
  // site-less source when the editor closes, as the registrar left it.
  useEffect(() => {
    if (!value?.repeatables?.length) return undefined
    registerRepeatSource(connectionRepeatSource(value))
    return () => {
      registerRepeatSource(connectionRepeatSource())
    }
  }, [value])

  return <EditorPluginConnectionsContext.Provider value={value}>{children}</EditorPluginConnectionsContext.Provider>
}
EditorConnectionsProvider.displayName = 'EditorConnectionsProvider'

export default EditorConnectionsProvider
