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

import {
  pluginFigureChange,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { scopedToHost } from '@aglyn/tenant-data-admin/server/organizations'
import { Timestamp } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * The people the CRM gained over a window, as a figure table another plugin
 * or the platform reads by id (AGL-3867): the weekly summary's "new leads"
 * and "new contacts" lines, and an insight's answer to "are we getting more
 * leads?".
 *
 * An organization reader, like the deal readers: with a site, only the
 * records shared with that site (`scopedToHost`, the predicate the rules
 * evaluate); with none, the workspace's. Each figure is one `count()`
 * aggregation over the window, so a busy CRM costs the same as a quiet one,
 * and no record — let alone a name or an address — ever reaches the table.
 *
 * A lead is counted on the day it was first seen (`firstSeenAtMs`), a contact
 * on the day its record was created (`createdAt`), which are the fields the
 * Leads and Contacts lists sort their newest by. Both are served by the
 * `visibleTo` composites the index file already carries.
 */

type Firestore = FirebaseFirestore.Firestore

const WINDOWS: readonly number[] = [7, 14, 30, 90]

function scoped(collection: FirebaseFirestore.CollectionReference, hostId: string | null) {
  return hostId ? scopedToHost(collection, hostId) : collection
}

async function countLeads(
  firestore: Firestore,
  orgId: string,
  hostId: string | null,
  startMs: number,
  endMs: number,
): Promise<number> {
  const leads = firestore.collection('orgs').doc(orgId).collection('leads')
  const snapshot = await scoped(leads, hostId)
    .where('firstSeenAtMs', '>=', startMs)
    .where('firstSeenAtMs', '<', endMs)
    .count()
    .get()
  return snapshot.data().count
}

async function countContacts(
  firestore: Firestore,
  orgId: string,
  hostId: string | null,
  startMs: number,
  endMs: number,
): Promise<number> {
  const contacts = firestore.collection('orgs').doc(orgId).collection('contacts')
  const snapshot = await scoped(contacts, hostId)
    .where('createdAt', '>=', Timestamp.fromMillis(startMs))
    .where('createdAt', '<', Timestamp.fromMillis(endMs))
    .count()
    .get()
  return snapshot.data().count
}

export function crmPeopleFigureReader(firestore: () => Firestore): PluginFigureReader {
  return {
    id: 'crm.people',
    label: 'New leads and contacts',
    description:
      'How many leads were first seen and how many contacts were added over the window, against the window before.',
    scope: 'org',
    windows: WINDOWS,
    feature: 'crm',
    read: async (request) => {
      if (!WINDOWS.includes(request.days)) {
        return { ok: false, status: 400, error: 'That window is not one new leads and contacts are read over' }
      }
      const db = firestore()
      const { current, previous } = pluginFigureWindows(request.now, request.days)
      const [leads, leadsBefore, contacts, contactsBefore] = await Promise.all([
        countLeads(db, request.orgId, request.hostId, current.startMs, current.endMs),
        countLeads(db, request.orgId, request.hostId, previous.startMs, previous.endMs),
        countContacts(db, request.orgId, request.hostId, current.startMs, current.endMs),
        countContacts(db, request.orgId, request.hostId, previous.startMs, previous.endMs),
      ])
      return {
        ok: true,
        table: {
          title: 'New leads and contacts',
          source: { label: 'CRM', path: 'crm' },
          period: { from: current.from, to: current.to, days: request.days },
          columns: [
            { key: 'figure', label: 'Figure', kind: 'text' },
            { key: 'current', label: 'This window', kind: 'count' },
            { key: 'previous', label: 'Window before', kind: 'count' },
            { key: 'change', label: 'Change', kind: 'change' },
          ],
          rows: [
            { figure: 'New leads', current: leads, previous: leadsBefore, change: pluginFigureChange(leads, leadsBefore) },
            {
              figure: 'New contacts',
              current: contacts,
              previous: contactsBefore,
              change: pluginFigureChange(contacts, contactsBefore),
            },
          ],
          omitted: 0,
          notes: ['A lead is counted on the day it was first seen, a contact on the day it was added.'],
        },
      }
    },
  }
}

/** Registers the reader from the console surface, where insight jobs and the weekly summary run. */
export function registerPeopleFigureReader(firestore: () => Firestore): void {
  registerPluginFigureReader(crmPeopleFigureReader(firestore), { pluginId: BUNDLE_ID })
}
