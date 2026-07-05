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

import {
  ICON_VARIANT_HOST,
  ICON_VARIANT_HOST_GROUP,
} from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { Typography } from '@mui/material'
import { collection, query, where } from 'firebase/firestore'
import { useFirestore, useFirestoreCollectionData, useUser } from 'reactfire'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import AuthenticatedLayout from '../../components/layouts/authenticated.layout'
import DashboardLayout from '../../components/layouts/dashboard.layout'
import MainLayout from '../../components/layouts/main.layout'
import { buildRoute, Route } from '../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../constants/shared'

function HostInfoItem({ label, value }) {
  return (
    <>
      <Typography component="div">
        <Typography
          variant="caption"
          sx={{
            display: "inline",
            textTransform: 'uppercase'
          }}>
          <b>{label}:</b>
        </Typography>{' '}
        <Typography
          variant="body1"
          sx={[{
            display: "inline"
          }, (theme) => {
            const tv = (theme as any).vars || theme
            return {
              bgcolor: `rgba(${tv.palette.tertiary.lightChannel} / 0.18)`,
              border: `1px solid rgba(${tv.palette.tertiary.lightChannel} / 0.72)`,
              borderRadius: '0.3em',
              px: 0.5,
              py: 0.15,
              wordBreak: 'break-word',
              fontSize: '0.8rem',
            }
          }]}>
          {value || <i>{'None'}</i>}
        </Typography>
      </Typography>
    </>
  );
}

function Hosts() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const ref = collection(firestore, 'hosts')
  const hostsQuery = query(ref, where(`admins.${user.uid}`, '==', true))
  const { data } = useFirestoreCollectionData(hostsQuery, { idField: '$id' })

  return (
    <>
      <NextPageTitle screen={'Settings'} />
      <DashboardLayout
        navTabItems={[]}
        breadcrumbItems={[
          {
            children: 'Hosts',
            href: buildRoute(Route.MANAGE_ACCOUNT_SETTINGS),
          },
        ]}
        header={{
          children: 'All Hosts',
          icon: { path: ICON_VARIANT_HOST_GROUP.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              ...(data || []).map((host) => ({
                size: {
                  xs: 12,
                  md: 4,
                },
                children: (
                  <CardDisplay
                    contentGutterX
                    contentGutterY
                    contentBordered="bottom"
                    HeaderProps={{
                      avatar: (
                        <MdiIcon
                          color="secondary"
                          fontSize="large"
                          path={ICON_VARIANT_HOST.path}
                        />
                      ),
                      slotProps: {
                        title: {
                          // variant: 'h6',
                          noWrap: true,
                          sx: {
                            // Function callbacks and textOverflow must live
                            // inside sx — passing them as direct Typography
                            // props causes React DOM attribute warnings in v9.
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            fontSize: ({ typography }) =>
                              typography.subtitle1.fontSize,
                            fontWeight: ({ typography }) =>
                              typography.h6.fontWeight,
                          },
                        },
                        subheader: {
                          sx: {
                            fontSize: ({ typography }) =>
                              typography.caption.fontSize,
                          },
                        },
                      },
                    }}
                    subheader={host?.$id}
                    header={host?.displayName}
                    actions={
                      <>
                        <AppLink
                          componentVariant="button"
                          href={`https://${
                            host?.cname || `${host?.subdomain}.aglyn.app`
                          }`}
                          target={'_blank'}
                          rel={'nofollow'}
                        >
                          {'Visit'}
                        </AppLink>
                        <AppLink
                          componentVariant="button"
                          href={buildRoute(Route.HOST_DASHBOARD, {
                            hostId: host.$id,
                          })}
                        >
                          {'Manage'}
                        </AppLink>
                      </>
                    }
                  >
                    <Typography color="textSecondary" component="div">
                      <HostInfoItem
                        label={'Aglyn Domain'}
                        value={`${host?.subdomain}.aglyn.app`}
                      />
                      <HostInfoItem
                        label={'Custom Domain'}
                        value={host?.cname}
                      />
                    </Typography>
                  </CardDisplay>
                ),
              })),
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
Hosts.displayName = 'Page:Hosts'
Hosts.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Hosts',
      enableAppBarElevation: true,
    },
  },
]

export default Hosts
