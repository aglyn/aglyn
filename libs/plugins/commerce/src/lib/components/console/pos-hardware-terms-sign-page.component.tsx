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

import type { ConsolePublicPageProps } from '@aglyn/aglyn'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { Box, Button, Container, GlobalStyles, Stack, Typography } from '@mui/material'
import {
  posHardwareTermsAddress,
  POS_HARDWARE_TERMS_SECTIONS,
  POS_HARDWARE_TERMS_SUMMARY,
} from '../../model/pos-hardware-terms'

/**
 * `/kiosk/commerce/hardware-terms-sign` (AGL-4038): the sign that stands
 * where the platform sells card readers in person, for when the buyer can't
 * accept the terms of sale on a screen (Terms 4.28): which terms the sale is
 * made under, where to read them, and that paying is agreeing. A public page
 * with nothing on it but the published terms' address and summary, so the
 * register opens it in a new tab and prints it. Only the sign prints.
 */
export function PosHardwareTermsSignPage(_props: ConsolePublicPageProps) {
  const address = posHardwareTermsAddress()
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.paper', py: { xs: 2, sm: 6 } }}>
      <GlobalStyles styles={{ '@media print': { '.no-print': { display: 'none !important' } } }} />
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Stack direction="row" className="no-print" sx={{ justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={() => window.print()}>
              {'Print'}
            </Button>
          </Stack>
          <Typography variant="h3" component="h1">
            {`Card reader hardware sold here is sold by ${PLATFORM_BRAND_NAME} under its Terms of Sale`}
          </Typography>
          <Typography variant="h5" component="p">
            {`The Terms are at ${address}, Sections ${POS_HARDWARE_TERMS_SECTIONS}. By paying for card reader hardware here, you agree to those terms for that purchase.`}
          </Typography>
          <Typography variant="h6" component="h2">
            {'In short'}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 4, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {POS_HARDWARE_TERMS_SUMMARY.map((line) => (
              <Typography key={line} component="li" variant="body1">
                {line}
              </Typography>
            ))}
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default PosHardwareTermsSignPage
