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

import { Stack } from '@mui/material'
import LoyaltyMembersCard from './loyalty-members-card.component'
import LoyaltyProgramCard from './loyalty-program-card.component'

/** What `commercePromotions` hands a widget: the site. */
export interface LoyaltyPromotionsWidgetProps {
  hostId: string
  orgId?: string
}

/**
 * Rewards under the store's Promotions (AGL-3640), beside its discounts and
 * gift cards: the program, then its members.
 */
export function LoyaltyPromotionsWidget(props: LoyaltyPromotionsWidgetProps) {
  return (
    <Stack spacing={3}>
      <LoyaltyProgramCard hostId={props.hostId} />
      <LoyaltyMembersCard hostId={props.hostId} />
    </Stack>
  )
}

export default LoyaltyPromotionsWidget
