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

import type { ClosureNoticesRead } from '@aglyn/aglyn/plugin-manager/plugin-closure-notices'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  AlertTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import type { User } from 'firebase/auth'
import { useEffect, useState } from 'react'

/**
 * WHAT A CLOSURE WILL CHANGE, said before the confirm (AGL-4038).
 *
 * The delete-workspace and close-account screens draw this above their
 * confirm. It asks `/api/closure-notices` what the plugins say the closure
 * will change — a hardware order canceled and refunded, say — and draws each
 * notice in the plugin's own words, with what it applies to. It never holds
 * the confirm back: a notice is information, and the closure goes ahead
 * whatever it says.
 *
 * A notice that could not be read is said out loud, so a missing warning
 * never reads as nothing to warn about. Nothing at all to say draws nothing.
 */
export const CLOSURE_NOTICES_UNAVAILABLE =
  'Some details of what this changes could not be checked right now. Try again in a moment before you confirm.'

export interface ClosureNoticesProps {
  user: User | null | undefined
  subject: 'workspace' | 'account'
  /** The workspace, for `subject: 'workspace'`. */
  orgId?: string | null
}

export function ClosureNotices({ user, subject, orgId }: ClosureNoticesProps) {
  const [read, setRead] = useState<ClosureNoticesRead | null>(null)
  const uid = user?.uid ?? ''
  useEffect(() => {
    if (!user || (subject === 'workspace' && !orgId)) return
    let active = true
    const query = subject === 'workspace' ? `subject=workspace&orgId=${encodeURIComponent(String(orgId))}` : 'subject=account'
    void (async () => {
      let answer: ClosureNoticesRead
      try {
        const response = await authorizedFetch(user, `/api/closure-notices?${query}`)
        const body = (await response.json().catch(() => null)) as ClosureNoticesRead | null
        answer =
          response.ok && Array.isArray(body?.notices)
            ? { notices: body.notices, unavailable: Array.isArray(body.unavailable) ? body.unavailable : [] }
            : { notices: [], unavailable: ['closure-notices'] }
      } catch {
        answer = { notices: [], unavailable: ['closure-notices'] }
      }
      if (active) setRead(answer)
    })()
    return () => {
      active = false
    }
    // The user object changes identity on every token refresh; its uid does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, subject, orgId])

  if (!read || (!read.notices.length && !read.unavailable.length)) return null
  return (
    <Stack spacing={1.5} data-closure-notices="">
      {read.notices.map((notice) => (
        <Alert key={`${notice.pluginId}:${notice.id}`} severity={notice.severity}>
          <AlertTitle>{notice.title}</AlertTitle>
          <Typography variant="body2">{notice.body}</Typography>
          <List dense disablePadding>
            {notice.items.map((item) => (
              <ListItem
                key={item.id}
                disableGutters
                secondaryAction={item.amount ? <Typography variant="body2">{item.amount}</Typography> : undefined}
              >
                <ListItemText primary={item.primary} secondary={item.secondary} />
              </ListItem>
            ))}
          </List>
        </Alert>
      ))}
      {read.unavailable.length ? <Alert severity="info">{CLOSURE_NOTICES_UNAVAILABLE}</Alert> : null}
    </Stack>
  )
}

export default ClosureNotices
