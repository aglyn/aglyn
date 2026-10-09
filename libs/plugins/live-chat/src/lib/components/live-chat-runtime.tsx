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

import type { SiteRuntimeProps } from '@aglyn/aglyn/plugin-manager/site-runtime'
import { usePageIdle } from '@aglyn/aglyn/app-utils/page-idle'
import {
  readStoredVisitorConsent,
  VISITOR_CONSENT_CHANGED_EVENT,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import CircularProgress from '@mui/material/CircularProgress'
import Fab from '@mui/material/Fab'
import SvgIcon from '@mui/material/SvgIcon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LIVE_CHAT_PAGE_PROP, LIVE_CHAT_SESSION_KEY_PREFIX } from '../constants'
import {
  liveChatLoadedProvider,
  loadLiveChat,
  removeLiveChat,
  setLiveChatVisible,
} from '../loader'
import { liveChatProvider } from '../model/providers'
import { readLiveChatSlice, type LiveChatSlice } from '../model/settings'

/** Material Design Icons `chat` (Apache-2.0), inline so the site chunk pulls no icon set. */
const CHAT_ICON_PATH =
  'M12,3C17.5,3 22,6.58 22,11C22,15.42 17.5,19 12,19C10.76,19 9.57,18.82 8.47,18.5C5.55,21 2,21 2,21C4.33,18.67 4.7,17.1 4.75,15.5C3.05,14.07 2,12.13 2,11C2,6.58 6.5,3 12,3Z'

type Phase = 'idle' | 'loading' | 'ready'
type LoadedBy = 'press' | 'session' | 'page'

const sessionKey = (hostId: string | undefined) => `${LIVE_CHAT_SESSION_KEY_PREFIX}${hostId ?? ''}`

function readSessionMark(hostId: string | undefined): boolean {
  try {
    return window.sessionStorage.getItem(sessionKey(hostId)) === '1'
  } catch {
    return false
  }
}

function writeSessionMark(hostId: string | undefined): void {
  try {
    window.sessionStorage.setItem(sessionKey(hostId), '1')
  } catch {
    // A tab that cannot store keeps the chat for this page only.
  }
}

/**
 * The site runtime (AGL-3698): a launcher button where the merchant's chat
 * will be, and the vendor's widget only once someone asks for it.
 *
 * ## What loads, and when
 *
 * Nothing at first render: the launcher itself waits for the page to load
 * and go idle (`usePageIdle`, the gate the analytics tags use), so it costs
 * neither LCP nor TBT, and before that the page carries only this small
 * component. The vendor's script loads on exactly three occasions:
 *
 * 1. **A press.** The visitor asked for the chat, so it loads and opens.
 * 2. **The same visitor, later in the tab.** A visitor who pressed it keeps
 *    the chat on the next page they open in the tab (a session-storage mark),
 *    so a conversation is not cut off by a full page load.
 * 3. **"Load with the page"**, where the merchant turned it on — once the
 *    page is idle, and only for a visitor whose recorded consent grants
 *    analytics. A withdrawal takes it back off the page. This is the rule
 *    the Video element's "Load the player with the page" follows (AGL-2962):
 *    the vendor's visitor tracking and storage before anyone asked are not
 *    strictly necessary, so they wait for a yes.
 *
 * A page the merchant excluded gets no slice from the enricher, and a loaded
 * widget is hidden there and shown again where the chat belongs.
 *
 * Never on the console: the besigner preview hands runtimes no page props of
 * this plugin's, so there is nothing to render there.
 */
export function LiveChatRuntime({ hostId, page }: SiteRuntimeProps) {
  const slice = readLiveChatSlice(page?.[LIVE_CHAT_PAGE_PROP])
  const idle = usePageIdle()
  const [phase, setPhase] = useState<Phase>('idle')
  const loadedBy = useRef<LoadedBy | null>(null)
  const sliceKey = slice ? `${slice.provider}:${slice.publicKey}` : ''

  const load = useCallback(
    (current: LiveChatSlice, by: LoadedBy, open: boolean) => {
      if (!loadedBy.current || by === 'press') loadedBy.current = by
      setPhase((value) => (value === 'ready' ? value : 'loading'))
      loadLiveChat(current, { open })
        .then(() => setPhase('ready'))
        .catch((error: unknown) => {
          loadedBy.current = null
          setPhase('idle')
          console.warn('[live-chat]', (error as Error)?.message ?? error)
        })
    },
    [],
  )

  // A widget already on the page (a client-side navigation): show it here,
  // or hide it on a page the chat does not belong on.
  useEffect(() => {
    const loaded = liveChatLoadedProvider()
    if (!loaded) return
    if (slice && loaded === slice.provider) {
      setLiveChatVisible(loaded, true)
      setPhase('ready')
    } else {
      setLiveChatVisible(loaded, false)
    }
    // sliceKey stands for the slice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceKey])

  // The visitor asked for the chat earlier in this tab.
  useEffect(() => {
    if (!slice || !idle || loadedBy.current) return
    if (readSessionMark(hostId)) load(slice, 'session', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceKey, idle, hostId, load])

  // "Load with the page": idle, and an analytics grant on record.
  useEffect(() => {
    if (!slice?.loadWithPage || !idle) return undefined
    const sync = () => {
      const granted = readStoredVisitorConsent(hostId ?? '')?.analytics === true
      if (granted) {
        if (!loadedBy.current) load(slice, 'page', false)
        return
      }
      if (loadedBy.current === 'page') {
        removeLiveChat(slice.provider)
        loadedBy.current = null
        setPhase('idle')
      }
    }
    sync()
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceKey, slice?.loadWithPage, idle, hostId, load])

  const press = useCallback(() => {
    if (!slice) return
    writeSessionMark(hostId)
    load(slice, 'press', true)
  }, [slice, hostId, load])

  if (!slice || !idle || phase === 'ready') return null
  const provider = liveChatProvider(slice.provider)
  const loading = phase === 'loading'
  return (
    <Fab
      color="primary"
      aria-label={loading ? 'Opening chat' : 'Chat with us'}
      title={`Chat with us (opens ${provider?.label ?? 'the chat'})`}
      aria-busy={loading || undefined}
      disabled={loading}
      onClick={press}
      data-live-chat-launcher={slice.provider}
      sx={(theme) => ({
        position: 'fixed',
        zIndex: theme.zIndex.fab,
        bottom: theme.spacing(slice.position === 'left' ? 8 : 3),
        ...(slice.position === 'left' ? { left: theme.spacing(3) } : { right: theme.spacing(3) }),
      })}
    >
      {loading ? (
        <CircularProgress size={24} color="inherit" />
      ) : (
        <SvgIcon>
          <path d={CHAT_ICON_PATH} />
        </SvgIcon>
      )}
    </Fab>
  )
}

export default LiveChatRuntime
