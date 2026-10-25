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

import { Alert, Box, Button, Container, Paper, Stack, Typography } from '@mui/material'
import { WaiverSignFlow } from './waiver-sign-flow.component'
import { useWindowSigning } from './use-window-signing'

export interface HandOverScreenProps {
  hostId: string
  waiverId: string
  canCollect: boolean
  onExit: () => void
}

/**
 * The tablet staff hand over at the window (AGL-4042): a staff member opens
 * it from the Waivers page, turns the tablet to the rider, and the rider
 * signs. The signing is staff's own request, so the record names who handed
 * it over; after each signing the screen offers the next signer, and only
 * the exit button leaves it.
 */
export function HandOverScreen(props: HandOverScreenProps) {
  const submit = useWindowSigning(props.hostId)
  if (!props.canCollect) {
    return (
      <Alert severity="info" action={<Button onClick={props.onExit}>{'Back'}</Button>}>
        {'Taking signatures at the window needs the Collect waivers permission.'}
      </Alert>
    )
  }
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {'Hand the tablet to the rider. Take it back when the screen says signed.'}
        </Typography>
        <Button onClick={props.onExit}>{'Done signing'}</Button>
      </Stack>
      <Container maxWidth="sm" disableGutters>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <WaiverSignFlow
            hostId={props.hostId}
            waiverId={props.waiverId}
            mode="at_window"
            submit={submit}
            doneActions={(reset) => (
              <Box>
                <Button variant="contained" size="large" onClick={reset} fullWidth>
                  {'Next signer'}
                </Button>
              </Box>
            )}
          />
        </Paper>
      </Container>
    </Stack>
  )
}

export default HandOverScreen
