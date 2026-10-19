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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { useMerchantPayments, type MerchantPaymentsStatus } from '@aglyn/tenant-feature-instance'
import { Box, Button, Card, Chip, Stack, Typography } from '@mui/material'
import type { AiStoreFinishLink } from './ai-job-links'

/** What the Payments step says once the workspace's Stripe answer is in. */
type PaymentsAnswer = Pick<MerchantPaymentsStatus, 'state' | 'ready' | 'blocked' | 'reason'>

export interface AiStoreFinishCardProps {
  steps: readonly AiStoreFinishLink[]
  /**
   * The store's site, so the Payments step reads whether its workspace can
   * already take payments (AGL-3982). Without one the step reads as still to
   * do, as it always did.
   */
  hostId?: string | null
}

/**
 * "Finish your store" (AGL-3676), on a store start's done page: the store,
 * its account, cart and policy pages are built, so this lists only what the
 * owner does next — connect payments, review the products and prices, set
 * shipping and tax, fill in the policies — each with the console page it is
 * done on.
 *
 * The Payments step is not a guess (AGL-3982): a workspace whose Stripe
 * account already takes payments sees it done, and one that connected but
 * has not finished sees what Stripe still needs.
 */
export function AiStoreFinishCard({ steps, hostId }: AiStoreFinishCardProps) {
  return hostId ? <StoreFinishWithPayments steps={steps} hostId={hostId} /> : <StoreFinishList steps={steps} payments={null} />
}

function StoreFinishWithPayments({ steps, hostId }: { steps: readonly AiStoreFinishLink[]; hostId: string }) {
  const payments = useMerchantPayments(hostId)
  return <StoreFinishList steps={steps} payments={payments.settled ? payments : null} />
}

/** The Payments step as the workspace's Stripe account stands; any other step as it is. */
function stepAsItStands(step: AiStoreFinishLink, payments: PaymentsAnswer | null): AiStoreFinishLink & { done?: boolean } {
  if (step.id !== 'payments' || !payments) return step
  if (payments.ready) {
    return {
      ...step,
      title: 'Payments connected',
      text: 'Stripe is connected, so your store can take payments and pay you out.',
      action: 'Open Payments',
      done: true,
    }
  }
  if (payments.blocked && payments.reason && payments.state !== 'not-connected') {
    return { ...step, text: payments.reason, action: 'Open Payments' }
  }
  return step
}

function StoreFinishList({ steps, payments }: { steps: readonly AiStoreFinishLink[]; payments: PaymentsAnswer | null }) {
  return (
    <Card variant="outlined" component="section" aria-labelledby="ai-store-finish-heading" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
      <Typography id="ai-store-finish-heading" variant="h6" component="h2">
        {'Finish your store'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {'Your storefront, account, cart and policy pages are built. Here is what is left before you sell:'}
      </Typography>
      <Stack component="ol" spacing={2} sx={{ m: 0, mt: 2, pl: 2.5 }}>
        {steps.map((listed) => {
          const step = stepAsItStands(listed, payments)
          return (
            <Box component="li" key={step.id}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="subtitle2" component="p">
                      {step.title}
                    </Typography>
                    {step.done ? <Chip size="small" color="success" variant="outlined" label="Done" /> : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {step.text}
                  </Typography>
                </Box>
                {step.href ? (
                  <Button
                    variant={step.done ? 'text' : 'outlined'}
                    size="small"
                    component={AppLink}
                    href={step.href}
                    sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}
                  >
                    {step.action}
                  </Button>
                ) : null}
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Card>
  )
}

export default AiStoreFinishCard
