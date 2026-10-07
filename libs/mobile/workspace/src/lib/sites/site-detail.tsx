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

import { describeHostStatus, publishedScreenCount } from '@aglyn/aglyn/app-utils/host-status'
import { mobileBrandName, useWorkspace } from '@aglyn/mobile-core'
import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, Card, Chip, EmptyState, Field, Screen, Skeleton, Text } from '@aglyn/mobile-ui'
import { Linking, View } from 'react-native'
import { formatDay, titleCase } from '../shared/format'
import {
  hostDisplayDomain,
  hostPlatformDomain,
  siteConsolePaths,
  siteLiveUrl,
  siteName,
  statusTone,
  type HostDoc,
} from './site-model'
import { useHostDoc, useScreenDoc, useSiteMembership } from './use-sites'

/*==========================================
 * ONE SITE.
 *
 * What the console's Sites card and the site's dashboard header say about a
 * site: its status, its addresses, the reader's role on it. Editing happens
 * in the Besigner, which opens in the authenticated console view on the
 * site's home page (the same `SCREEN_BESIGNER` route the console's Pages
 * list opens), or on the Pages list when there is no home page with a saved
 * version to open. Publishing happens there too: the console publishes from
 * the Besigner and the Pages list with its own batches, through no route a
 * native screen could call, so this screen offers no publish of its own.
 *=========================================*/

export function SiteDetail({ hostId, context }: { hostId: string; context: MobilePluginContext }) {
  const workspace = useWorkspace()
  const host = useHostDoc(context.firestore, hostId)
  const membership = useSiteMembership(context.firestore, context.uid, hostId)
  const homeScreenId = host.data?.defaultHomeScreenId ?? null
  const home = useScreenDoc(context.firestore, hostId, homeScreenId)

  if (!host.ready) {
    return (
      <View style={{ padding: 16, gap: 12 }} testID="site-detail-loading">
        <Skeleton height={28} width="60%" />
        <Skeleton height={16} />
        <Skeleton height={16} width="80%" />
      </View>
    )
  }
  if (host.error || !host.data) {
    return (
      <EmptyState
        icon="warning-outline"
        title="This site could not be opened"
        body="You may no longer have access to it."
      />
    )
  }

  const site = host.data as HostDoc
  const status = describeHostStatus(site)
  const published = publishedScreenCount(site)
  const subdomain = site.subdomain ?? ''
  const paths = context.orgSlug && subdomain ? siteConsolePaths(context.orgSlug, subdomain) : null
  const liveUrl = siteLiveUrl(site)
  const homeVersion = home.data?.versionId
  const lastPublished = formatDay(home.data?.publishedAt)
  const role = membership.data?.role
  const picked = context.hostId === hostId

  return (
    <Screen>
      <Card
        title={siteName(site)}
        actions={<Chip testID="site-status" label={status.label} tone={statusTone(status)} />}
      >
        <Text tone="secondary">{status.detail}</Text>
        <Field label="Address" value={hostDisplayDomain(site) ?? 'None'} testID="site-address" />
        <Field label={`${mobileBrandName()} address`} value={hostPlatformDomain(site) ?? 'None'} />
        <Field label="Custom domain" value={site.cname || 'None'} />
        <Field label="Published pages" value={String(published)} />
        {lastPublished ? <Field label="Home page last published" value={lastPublished} /> : null}
        {role ? <Field label="Your role" value={titleCase(role)} /> : null}
      </Card>

      <Card
        title="Pages"
        actions={
          paths ? (
            <Button
              testID="site-open-besigner"
              title="Open in the Besigner"
              variant="text"
              icon="brush-outline"
              onPress={() =>
                context.openConsolePath(
                  homeScreenId && homeVersion ? paths.besigner(homeScreenId, homeVersion) : paths.pages,
                  'absolute',
                )
              }
            />
          ) : null
        }
      >
        <Text tone="secondary">
          {homeScreenId && homeVersion
            ? 'Edit and publish the home page in the Besigner, or open every page of the site.'
            : 'Pick a page to edit and publish in the Besigner.'}
        </Text>
        {paths ? (
          <Button
            testID="site-open-pages"
            title="All pages"
            variant="outlined"
            icon="documents-outline"
            onPress={() => context.openConsolePath(paths.pages, 'absolute')}
          />
        ) : null}
      </Card>

      <Card
        title="Live site"
        actions={
          liveUrl ? (
            <Button
              testID="site-view-live"
              title="View live site"
              variant="text"
              icon="open-outline"
              onPress={() => void Linking.openURL(liveUrl)}
            />
          ) : null
        }
      >
        <Text tone="secondary">
          {published > 0 ? 'Visitors see the published pages.' : 'Visitors see the placeholder until a page is published.'}
        </Text>
      </Card>

      {picked ? (
        <Text tone="secondary" testID="site-is-picked">
          The app is working on this site.
        </Text>
      ) : (
        <Button
          testID="site-pick"
          title="Work on this site in the app"
          icon="swap-horizontal-outline"
          onPress={() => workspace.selectSite(hostId)}
        />
      )}
      {paths ? (
        <Button
          title="Site dashboard in the console"
          variant="text"
          icon="speedometer-outline"
          onPress={() => context.openConsolePath(paths.dashboard, 'absolute')}
        />
      ) : null}
    </Screen>
  )
}
