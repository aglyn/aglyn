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

/**
 * Hosts any registered plugin screen by id (AGL-3620). The shell never
 * imports a plugin: it looks the screen up in the registry, sets the title,
 * asks for a site first when the screen needs one, and lazy-loads it.
 */

import { useWorkspace } from '@aglyn/mobile-core'
import {
  getMobileScreen,
  useMobileContributions,
  useMobilePluginContext,
  type MobileParams,
} from '@aglyn/mobile-plugin-host'
import { Button, EmptyState, Screen } from '@aglyn/mobile-ui'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { LazyContribution } from '../shell/lazy-contribution'
import type { RootStackParams } from '../shell/navigation-ref'

export function PluginScreenHost({
  screenId,
  params,
  setTitle = true,
}: {
  screenId: string
  params?: MobileParams
  setTitle?: boolean
}) {
  // Re-read on registry changes: a deep link can land before its plugin loads.
  useMobileContributions()
  const screen = getMobileScreen(screenId)
  const context = useMobilePluginContext()
  const workspace = useWorkspace()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>()

  // A link into another workspace or site switches to it, as the console's
  // URL does; a slug the person is not a member of changes nothing.
  const orgSlug = params?.['orgSlug']
  const hostSlug = params?.['hostSlug']
  // Once per link: a switch the person makes afterwards is theirs to keep.
  const applied = useRef({ org: false, site: false })
  useEffect(() => {
    if (!orgSlug || applied.current.org) return
    const org = workspace.orgs.find((candidate) => candidate.slug === orgSlug)
    if (!org) return
    applied.current.org = true
    if (org.id !== workspace.org?.id) workspace.selectOrg(org.id)
  }, [orgSlug, workspace])
  useEffect(() => {
    if (!hostSlug || applied.current.site || (orgSlug && workspace.org?.slug !== orgSlug)) return
    const site = workspace.sites.find((candidate) => candidate.subdomain === hostSlug)
    if (!site) return
    applied.current.site = true
    if (site.id !== workspace.site?.id) workspace.selectSite(site.id)
  }, [hostSlug, orgSlug, workspace])

  useLayoutEffect(() => {
    if (setTitle && screen) navigation.setOptions({ title: screen.title })
  }, [navigation, screen, setTitle])

  if (!screen) {
    return (
      <Screen>
        <EmptyState icon="construct-outline" title="This screen is not available" body="Update the app to open it." />
      </Screen>
    )
  }
  if (screen.requiresSite && !workspace.site) {
    return (
      <Screen>
        <EmptyState
          icon="globe-outline"
          title="Pick a site first"
          action={<Button title="Choose a site" onPress={() => navigation.navigate('Switcher')} />}
        />
      </Screen>
    )
  }
  return (
    <LazyContribution
      // A new site is a new screen: nothing from the last site's state survives.
      key={`${screen.id}:${workspace.site?.id ?? ''}`}
      id={screen.id}
      load={screen.load}
      props={{ params: params ?? {}, context }}
    />
  )
}

export function PluginScreenRoute({ route }: { route: { params: RootStackParams['PluginScreen'] } }) {
  return <PluginScreenHost screenId={route.params.screenId} params={route.params.params} />
}
