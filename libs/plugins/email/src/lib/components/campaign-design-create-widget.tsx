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

import {
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { useCallback, useState } from 'react'
import { createEmailScreen } from '../utils/create-email-screen'

/** What the campaign owner's design-create zone hands a widget. */
export interface CampaignDesignCreateWidgetProps {
  hostId: string
  name?: string
  onCreated: (design: { screenId: string; versionId: string }) => void
  onError: (error: unknown) => void
}

/**
 * A design for ONE email, without making the author think in templates.
 *
 * The data model has one shape for a design — a `kind: 'email'` screen, the
 * document the template picker lists — so this mints one, named after the
 * email it belongs to: the name is the only thing that tells one design from
 * another in that picker. What happens next is the composer's: it records the
 * choice on the campaign and opens the editor.
 */
export function CampaignDesignCreateWidget(
  props: CampaignDesignCreateWidgetProps,
) {
  const { hostId, name, onCreated, onError } = props
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const [busy, setBusy] = useState(false)
  const handleClick = useCallback(async () => {
    setBusy(true)
    try {
      onCreated(
        await createEmailScreen(
          hostId,
          createHostResource,
          createHostVersion,
          name,
        ),
      )
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }, [hostId, name, createHostResource, createHostVersion, onCreated, onError])
  return (
    <Button size="small" disabled={busy} onClick={() => void handleClick()}>
      {'Design this email'}
    </Button>
  )
}

export default CampaignDesignCreateWidget
