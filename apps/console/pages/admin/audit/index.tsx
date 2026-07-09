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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import adminNavTabItems from '../../../constants/admin-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import useFirestoreCollection from '../../../hooks/use-firestore-collection'

/**
 * Staff audit log viewer (AGL-203): every admin mutation writes an
 * append-only `adminAudit` entry (AGL-42) — this page finally makes them
 * readable: newest first, client-side filtering over actor/action/target,
 * expandable before/after diffs. Read access is staff-only in rules; the
 * page also hides itself without the claim, matching the tenants page.
 */
const AdminAudit: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void (user as any)
      ?.getIdTokenResult?.()
      .then((result: any) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

  const { data: entryDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'adminAudit'),
        orderBy('at', 'desc'),
        limit(200),
      ),
    [firestore],
    { idField: '$id' },
  )

  const [filter, setFilter] = useState('')
  const entries = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const all = entryDocs ?? []
    if (!term) return all
    return all.filter((entry: any) =>
      [entry.actorUid, entry.action, entry.target]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [entryDocs, filter])

  const [expanded, setExpanded] = useState<string | null>(null)

  // Compliance export (AGL-206): CSV of the current filter.
  const handleExport = () => {
    const escape = (value: unknown) => {
      const text =
        typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value ?? '')
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const rows = [
      ['at', 'actorUid', 'action', 'target', 'before', 'after'],
      ...entries.map((entry: any) => [
        entry.at?.seconds
          ? new Date(entry.at.seconds * 1000).toISOString()
          : '',
        entry.actorUid,
        entry.action,
        entry.target,
        entry.before,
        entry.after,
      ]),
    ]
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'admin-audit.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <NextPageTitle screen={'Audit – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_AUDIT)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_TENANTS) },
          { children: 'Audit log', href: buildRoute(Route.ADMIN_AUDIT) },
        ]}
        header={{
          children: 'Audit Log',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="error">
              {'This area requires the staff role.'}
            </Alert>
          ) : (
            <CardDisplay
              header={'Admin actions'}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="Filter (actor, action, target)"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    sx={{ width: 360 }}
                  />
                  <Button
                    size="small"
                    onClick={handleExport}
                    disabled={!entries.length}
                  >
                    {'Export CSV'}
                  </Button>
                </Stack>
                {entries.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {'No audit entries match.'}
                  </Typography>
                ) : (
                  entries.map((entry: any) => (
                    <Stack
                      key={entry.$id}
                      spacing={0.5}
                      sx={{
                        cursor: 'pointer',
                        borderBottom: 1,
                        borderColor: 'divider',
                        pb: 1,
                      }}
                      onClick={() =>
                        setExpanded((previous) =>
                          previous === entry.$id ? null : entry.$id,
                        )
                      }
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip label={entry.action} size="small" />
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {entry.target}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 'auto' }}
                        >
                          {`${entry.actorUid} · ${
                            entry.at?.seconds
                              ? new Date(
                                  entry.at.seconds * 1000,
                                ).toLocaleString()
                              : '—'
                          }`}
                        </Typography>
                      </Stack>
                      {expanded === entry.$id ? (
                        <Typography
                          component="pre"
                          variant="caption"
                          sx={{
                            m: 0,
                            p: 1,
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            overflowX: 'auto',
                          }}
                        >
                          {JSON.stringify(
                            { before: entry.before, after: entry.after },
                            null,
                            2,
                          )}
                        </Typography>
                      ) : null}
                    </Stack>
                  ))
                )}
              </Stack>
            </CardDisplay>
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminAudit.displayName = 'Page:AdminAudit'
AdminAudit.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Audit – Staff' } },
]

export default AdminAudit
