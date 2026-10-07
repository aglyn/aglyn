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

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { EmptyState } from '@aglyn/mobile-ui'
import type { CrmListKind } from './crm-lists'
import { CrmRecordDetail } from './crm-record-detail'

/*
 * One CRM record as its own screen (AGL-3622): pushed from a list on a
 * phone, and opened by the console's record address or a notification.
 */

/**
 * The site a link names, when it is not the picked one. A notification
 * stores a host-link (`/{hostId}/crm/leads/{id}`), whose first segment is
 * the site's id and reaches the link as `orgSlug` with no `hostSlug`; the
 * console's own address (`/{org}/hosts/{site}/crm/…`) names the picked
 * site, and an org address (`/{org}/crm/…`, or `/org/crm/…` from a
 * notification at the organization level) names none.
 */
export function linkedCrmSite(
  params: MobileScreenProps['params'],
  context: Pick<MobileScreenProps['context'], 'orgSlug'>,
): string | null {
  const first = params['orgSlug']
  if (!first || params['hostSlug'] || first === context.orgSlug || first === 'org') return null
  return first
}

function CrmRecordScreen({ params, context, kind }: MobileScreenProps & { kind: CrmListKind }) {
  const id = params['recordId']
  if (!id) return <EmptyState icon="warning-outline" title="This link names no record" />
  return <CrmRecordDetail kind={kind} id={id} context={context} hostId={linkedCrmSite(params, context)} />
}

export const LeadScreen = (props: MobileScreenProps) => <CrmRecordScreen {...props} kind="leads" />
export const ContactScreen = (props: MobileScreenProps) => <CrmRecordScreen {...props} kind="contacts" />
export const CompanyScreen = (props: MobileScreenProps) => <CrmRecordScreen {...props} kind="companies" />
export const DealScreen = (props: MobileScreenProps) => <CrmRecordScreen {...props} kind="deals" />
