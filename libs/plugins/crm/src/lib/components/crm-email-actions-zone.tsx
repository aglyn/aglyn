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
import {
  CRM_RECORD_EMAIL_ACTIONS_ZONE,
  type CrmRecordEmailActionsZoneProps,
} from './crm-email-actions-zone-token'

/*
 * The `crmRecordEmailActions` zone a contact's and a lead's header host
 * before Send email (AGL-4020). The token and its props live in
 * `./crm-email-actions-zone-token`, which the plugin's register module
 * declares without loading this component.
 */
export {
  CRM_RECORD_EMAIL_ACTIONS_ZONE,
  type CrmEmailActionsRecordKind,
  type CrmRecordEmailActionsZoneProps,
} from './crm-email-actions-zone-token'

type CrmRecordEmailActionsZoneInput = Omit<CrmRecordEmailActionsZoneProps, 'orgId'> & { org?: CrmOrgDoc }

/** One control among the header's own: the zone is `bare`, so no wrapper. */
export function CrmRecordEmailActionsZone(props: CrmRecordEmailActionsZoneInput) {
  const Slot = useConsoleWidgetSlot()
  // Outside the console shell, or for a record with no address, there is
  // nothing to draw and nothing below is read.
  return Slot && props.email ? <HostedEmailActionsZone {...props} Slot={Slot} /> : null
}
CrmRecordEmailActionsZone.displayName = 'CrmRecordEmailActionsZone'

function HostedEmailActionsZone(
  props: CrmRecordEmailActionsZoneInput & { Slot: ConsoleWidgetSlotRenderer },
) {
  const { Slot } = props
  const { orgId } = useCrmScope({ hostId: props.hostId, org: props.org })
  const zone: CrmRecordEmailActionsZoneProps = {
    hostId: props.hostId,
    orgId: orgId ?? undefined,
    kind: props.kind,
    recordId: props.recordId,
    name: props.name,
    email: props.email,
  }
  return <Slot slot={CRM_RECORD_EMAIL_ACTIONS_ZONE.id} {...zone} />
}
