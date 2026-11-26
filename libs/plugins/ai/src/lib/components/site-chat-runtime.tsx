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

import { usePageIdle } from '@aglyn/aglyn/app-utils/page-idle'
import type { SiteRuntimeProps } from '@aglyn/aglyn/plugin-manager/site-runtime'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Fab from '@mui/material/Fab'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { readSiteChatSlice, SITE_CHAT_PAGE_PROP } from '../model/site-chat'

const SiteChatPanel = lazy(() => import('./site-chat-panel'))

/** Material Design Icons `message-text` and `close` (Apache-2.0), inline. */
const CHAT_ICON =
  'M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M6,9H18V11H6M14,14H6V12H14M18,8H6V6H18'
const CLOSE_ICON =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z'

const OPENING_SEEN_KEY = 'aglyn:site-chat:opening:'
const OPENING_DELAY_MS = 4_000

function readMark(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeMark(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // A browser that cannot store shows the opening message once per page.
  }
}

/**
 * The site chat's launcher (AGL-4250). Nothing at first render: the button
 * waits for the page to load and go idle, so it costs the page neither its
 * first paint nor its interactivity, and the panel's code loads only when a
 * visitor opens it. Same origin, no third-party script.
 *
 * The owner's opening message, where there is one, rises beside the button
 * once per visitor a few seconds after the page settles; dismissing it or
 * opening the chat retires it on this browser.
 */
export function SiteChatRuntime({ hostId, page }: SiteRuntimeProps) {
  const slice = readSiteChatSlice(page?.[SITE_CHAT_PAGE_PROP])
  const idle = usePageIdle()
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const openingKey = `${OPENING_SEEN_KEY}${hostId ?? ''}`

  useEffect(() => {
    if (!slice?.openingMessage || !idle || open || readMark(openingKey)) return undefined
    const timer = window.setTimeout(() => setOpening(true), OPENING_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [slice?.openingMessage, idle, open, openingKey])

  const retireOpening = useCallback(() => {
    setOpening(false)
    writeMark(openingKey)
  }, [openingKey])

  const launch = useCallback(() => {
    retireOpening()
    setOpen(true)
  }, [retireOpening])

  if (!slice || !idle || !hostId) return null
  const side = slice.position === 'left' ? { left: 24 } : { right: 24 }
  return (
    <>
      {opening && !open ? (
        <Paper
          elevation={6}
          role="status"
          data-site-chat-opening=""
          sx={(theme) => ({
            position: 'fixed',
            zIndex: theme.zIndex.fab,
            bottom: 96,
            ...side,
            maxWidth: 'min(320px, calc(100vw - 48px))',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'flex-start',
          })}
        >
          <ButtonBase onClick={launch} sx={{ textAlign: 'left', p: 2, borderRadius: 3, flex: 1 }}>
            <Typography variant="body2">{slice.openingMessage}</Typography>
          </ButtonBase>
          <IconButton size="small" aria-label="Dismiss" onClick={retireOpening} sx={{ m: 0.5 }}>
            <SvgIcon fontSize="small">
              <path d={CLOSE_ICON} />
            </SvgIcon>
          </IconButton>
        </Paper>
      ) : null}
      {open ? (
        <Suspense fallback={null}>
          <SiteChatPanel hostId={hostId} slice={slice} onClose={() => setOpen(false)} />
        </Suspense>
      ) : (
        <Box sx={(theme) => ({ position: 'fixed', zIndex: theme.zIndex.fab, bottom: 24, ...side })}>
          <Fab color="primary" aria-label="Chat with us" onClick={launch} data-site-chat-launcher="">
            <SvgIcon>
              <path d={CHAT_ICON} />
            </SvgIcon>
          </Fab>
        </Box>
      )}
    </>
  )
}

export default SiteChatRuntime
