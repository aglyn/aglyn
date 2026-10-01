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

import { hostRoleFor, isOrgWideMember, memberCanSee } from '@aglyn/aglyn/app-utils/organizations'
import { ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'

/**
 * The datasets an insight question may name (AGL-2915), with their fields:
 * what the model picks a dataset breakdown from.
 *
 * The datasets are the data plugin's, so they are listed through the
 * `dataset` index it publishes (AGL-3080), never read from its collection:
 * where no plugin keeps datasets, there are none to name. Narrowed to a site,
 * the index answers only the datasets shared with it. Who may see which is the
 * platform's own rule over the scope tokens each dataset carries
 * (`memberCanSee`), applied for the member who asked — with no member, only
 * datasets shared with every site. The figures themselves are read by the
 * data plugin's own figure readers, under the same rule.
 */

type Firestore = FirebaseFirestore.Firestore

/** Datasets a catalog lists: the dataset summary's window. */
export const AI_DATASET_CATALOG_LIMIT = 50

/** A dataset a question may name, with its fields, as the read prompt lists it. */
export interface AiDatasetCatalogEntry {
  id: string
  name: string
  fields: Array<{ id: string; name: string; type: string }>
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function fieldsOf(value: unknown): AiDatasetCatalogEntry['fields'] {
  return (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [])
    .map((field) => ({ id: text(field?.['id']), name: text(field?.['name']), type: text(field?.['type']) || 'text' }))
    .filter((field) => field.id)
    .map((field) => ({ ...field, name: field.name || field.id }))
}

/** The datasets a request may read, with their fields, by name. */
export async function aiDatasetCatalog(
  firestore: Firestore,
  request: { orgId: string; hostId: string | null; uid: string | null },
): Promise<AiDatasetCatalogEntry[]> {
  const datasets = pluginRecordIndex('dataset')
  if (!datasets) return []
  const [{ records }, memberSnapshot] = await Promise.all([
    datasets.index.list({ orgId: request.orgId, hostId: request.hostId, limit: AI_DATASET_CATALOG_LIMIT }),
    request.uid
      ? firestore.collection('orgs').doc(request.orgId).collection('members').doc(request.uid).get()
      : Promise.resolve(null),
  ])
  const member = memberSnapshot?.exists ? (memberSnapshot.data() as Partial<AglynOrgMember>) : null
  if (request.uid && !member) return []
  if (request.hostId && member && !isOrgWideMember(member) && hostRoleFor(member, request.hostId) === null) {
    return []
  }
  return records
    .filter((record) => {
      const visibleTo = Array.isArray(record.facts['visibleTo']) ? (record.facts['visibleTo'] as string[]) : []
      return member ? memberCanSee(member, visibleTo) : visibleTo.includes(ORG_SCOPE_TOKEN)
    })
    .map((record) => ({ id: record.id, name: record.name, fields: fieldsOf(record.facts['fields']) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
