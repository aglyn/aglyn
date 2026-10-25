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

import { raiseOperatorAlert } from '@aglyn/tenant-data-admin'
import type { DomainRegistrationDoc } from '../model/registration'
import type { DomainAlertKind } from './lifecycle'

/** The operator alert each lifecycle alert raises, from `alert-definitions.ts`. */
const TYPE: Record<DomainAlertKind, string> = {
  refundFailed: 'domains.refundFailed',
  orderStuck: 'domains.orderStuck',
  renewalFailedAtRegistrar: 'domains.renewalFailedAtRegistrar',
  renewalUnpaid: 'domains.renewalUnpaid',
  orphanRegistration: 'domains.orphanRegistration',
  disputed: 'domains.disputed',
  transferStuck: 'domains.transferStuck',
  swapRollbackFailed: 'domains.swapRollbackFailed',
}

/** Raises one alert, deduped per name. Never throws. */
export async function raiseDomainAlert(
  kind: DomainAlertKind,
  registration: Pick<DomainRegistrationDoc, 'domain' | 'orgId' | 'hostId'>,
  reason: string,
): Promise<void> {
  await raiseOperatorAlert(TYPE[kind], {
    dedupeKey: `${kind}:${registration.domain}`,
    context: {
      domain: registration.domain,
      orgId: registration.orgId || 'none',
      reason,
    },
    ...(registration.orgId ? { orgId: registration.orgId } : {}),
    ...(registration.hostId ? { hostId: registration.hostId } : {}),
  }).catch(() => undefined)
}

