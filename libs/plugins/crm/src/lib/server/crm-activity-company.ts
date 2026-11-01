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

import { CRM_COLLECTIONS, type CrmActivityLink } from '@aglyn/aglyn/app-utils/crm'
import {
  type CrmActivityCompanySources,
  resolveCrmActivityCompany,
  type StampedCrmActivityLink,
} from '../model/crm-activity-link'

/**
 * `link` with its Account stamped, for a writer on the server (AGL-4123): the
 * one rollup of `model/crm-activity-link.ts`, over the Admin SDK's reads. A
 * writer that already read the deal or the contact hands it over in `sources`
 * and pays for neither. Never throws; see `resolveCrmActivityCompany`.
 */
export function crmActivityLinkWithCompany<Link extends CrmActivityLink>(
  orgRef: FirebaseFirestore.DocumentReference,
  link: Link,
  sources: CrmActivityCompanySources = {},
): Promise<StampedCrmActivityLink<Link>> {
  const read = async (collection: string, id: string) =>
    (await orgRef.collection(collection).doc(id).get()).data() ?? null
  return resolveCrmActivityCompany(link, sources, {
    deal: (id) => read(CRM_COLLECTIONS.deals, id),
    contact: (id) => read('contacts', id),
  })
}
