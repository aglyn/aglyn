'use client'

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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next'
import { Alert, Button, CircularProgress, Stack } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import PhoneCallsSection from './phone-calls-section'
import PhoneInboxSection from './phone-inbox-section'
import PhoneSettingsSection from './phone-settings-section'
import PhoneSetupSection from './phone-setup-section'
import { usePhoneApi, type PhoneApi, type PhoneStatus, PhoneRouteError } from './use-phone-api'

export type PhoneConsoleSectionId = 'inbox' | 'calls' | 'setup' | 'settings'

export interface PhoneSectionProps {
  api: PhoneApi
  status: PhoneStatus
  reload(): Promise<void>
  sites: ReadonlyArray<{ id: string; name: string; subdomain: string | null }>
  basePath: string
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; status: PhoneStatus }
  | { state: 'refused'; error: PhoneRouteError }

/**
 * The Phone hub (AGL-4251): Inbox, Calls, Setup and Settings at
 * `/[orgSlug]/phone/<section>`. The shell has already answered the release
 * flag, the entitlement and `phone.use`; this page reads the workspace's
 * status once and hands it to the section.
 */
export function PhoneConsolePage(props: ConsolePluginPageProps) {
  const { section, sections, basePath } = props
  const orgId = props.orgMount?.orgId ?? null
  const api = usePhoneApi(orgId)
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  const reload = useCallback(async () => {
    if (!api) return
    try {
      setLoaded({ state: 'ready', status: await api.status() })
    } catch (error) {
      setLoaded({
        state: 'refused',
        error: error instanceof PhoneRouteError ? error : new PhoneRouteError(String(error), 'unreachable', 0),
      })
    }
  }, [api])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!section || !sections?.length || !basePath) return null
  const sites = (props.orgMount?.hosts ?? []).map((host) => ({ id: host.id, name: host.name, subdomain: host.subdomain ?? null }))

  let body
  if (!api || loaded.state === 'loading') {
    body = (
      <Stack sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Stack>
    )
  } else if (loaded.state === 'refused') {
    body = loaded.error.reason === 'entitlement' && props.orgMount ? (
      <Alert
        severity="info"
        action={
          <Button href={`/${props.orgMount.orgSlug}/billing#addons`} size="small">
            Open Billing
          </Button>
        }
      >
        Phone is a $15 a month add-on: a business number with texts and calls, answered by your team. Add it on Billing.
      </Alert>
    ) : (
      <Alert severity="error">{loaded.error.message}</Alert>
    )
  } else {
    const sectionProps: PhoneSectionProps = { api, status: loaded.status, reload, sites, basePath }
    body = (() => {
      switch (section as PhoneConsoleSectionId) {
        case 'inbox':
          return <PhoneInboxSection {...sectionProps} />
        case 'calls':
          return <PhoneCallsSection {...sectionProps} />
        case 'setup':
          return <PhoneSetupSection {...sectionProps} />
        case 'settings':
          return <PhoneSettingsSection {...sectionProps} />
        default:
          return null
      }
    })()
  }

  return (
    <HubSections sections={sections} wide={section === 'inbox'}>
      {body}
    </HubSections>
  )
}
PhoneConsolePage.displayName = 'PhoneConsolePage'

export default PhoneConsolePage
