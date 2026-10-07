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

import type { PluginPersonErasureRequest } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  eraseFunnelPerson,
  identifyJourneyFromEvent,
  recordEmailEngagementSteps,
  type EngagementEvent,
} from './journey-people'

/**
 * The person-facing paths on the platform's Admin SDK (AGL-3605): what the
 * server declarations load with the first event that needs one, so a boot
 * pays for the registrations and nothing else.
 */

const firestore = () => firebaseAdmin.app().firestore()

export const identifyJourney = (
  hostId: string,
  event: string,
  context: Parameters<typeof identifyJourneyFromEvent>[3],
) => identifyJourneyFromEvent(firestore(), hostId, event, context)

export const recordEmailEngagement = (hostId: string, events: readonly EngagementEvent[]) =>
  recordEmailEngagementSteps(firestore(), hostId, events)

export const eraseFunnelPersonOnPlatform = (request: PluginPersonErasureRequest) =>
  eraseFunnelPerson(firestore(), request)
