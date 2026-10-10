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
import { Box, Button, Card, Stack, Typography } from '@mui/material'
import type { AiStoreFinishLink } from './ai-job-links'

/**
 * "Finish your store" (AGL-3676), on a store start's done page: the store,
 * its account, cart and policy pages are built, so this lists only what the
 * owner does next — connect payments, review the products and prices, set
 * shipping and tax, fill in the policies — each with the console page it is
 * done on.
 */
export function AiStoreFinishCard({ steps }: { steps: readonly AiStoreFinishLink[] }) {
  return (
    <Card variant="outlined" component="section" aria-labelledby="ai-store-finish-heading" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
      <Typography id="ai-store-finish-heading" variant="h6" component="h2">
        {'Finish your store'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {'Your storefront, account, cart and policy pages are built. Here is what is left before you sell:'}
      </Typography>
      <Stack component="ol" spacing={2} sx={{ m: 0, mt: 2, pl: 2.5 }}>
        {steps.map((step) => (
          <Box component="li" key={step.id}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" component="p">
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.text}
                </Typography>
              </Box>
              {step.href ? (
                <Button variant="outlined" size="small" component={AppLink} href={step.href} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
                  {step.action}
                </Button>
              ) : null}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Card>
  )
}

export default AiStoreFinishCard
