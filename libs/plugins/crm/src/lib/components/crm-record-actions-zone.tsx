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
  type ConsoleWidgetSlotRenderer,
  useConsoleWidgetSlot,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { useCrmScope, type CrmOrgDoc } from '../hooks/use-crm-scope'
import { CRM_RECORD_ACTIONS_ZONE, type CrmRecordActionsZoneProps } from './crm-record-actions-zone-token'

/*
 * The `crmRecordActions` zone a contact's header hosts among its actions
 * (AGL-4098). The token and its props live in
 * `./crm-record-actions-zone-token`, which the plugin's register module
 * declares without loading this component.
 */
export { CRM_RECORD_ACTIONS_ZONE, type CrmRecordActionsZoneProps } from './crm-record-actions-zone-token'

type CrmRecordActionsZoneInput = Omit<CrmRecordActionsZoneProps, 'orgId'> & { org?: CrmOrgDoc }

/** One control among the header's own: the zone is `bare`, so no wrapper. */
export function CrmRecordActionsZone(props: CrmRecordActionsZoneInput) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? <HostedRecordActionsZone {...props} Slot={Slot} /> : null
}
CrmRecordActionsZone.displayName = 'CrmRecordActionsZone'

function HostedRecordActionsZone(props: CrmRecordActionsZoneInput & { Slot: ConsoleWidgetSlotRenderer }) {
  const { Slot } = props
  const { orgId } = useCrmScope({ hostId: props.hostId, org: props.org })
  const zone: CrmRecordActionsZoneProps = {
    hostId: props.hostId,
    orgId: orgId ?? undefined,
    kind: props.kind,
    recordId: props.recordId,
    name: props.name,
    email: props.email,
    phone: props.phone,
    company: props.company,
  }
  return <Slot slot={CRM_RECORD_ACTIONS_ZONE.id} {...zone} />
}
