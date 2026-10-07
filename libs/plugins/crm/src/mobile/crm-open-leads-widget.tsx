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
 * Open leads (AGL-3622): how many leads are new, nurturing or working
 * under the picked site (or the whole workspace for an org-wide member) —
 * one count aggregate over the Leads list's own Open query, so the number
 * is the rows the list opens on and the same index serves it.
 */

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { listQueryConstraints } from '@aglyn/mobile-core'
import type { MobileWidgetProps } from '@aglyn/mobile-plugin-host'
import { Button, Skeleton, Text } from '@aglyn/mobile-ui'
import { planListQuery } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { collection, type Firestore, getCountFromServer, query } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { crmDefaultStatus, crmListSpec } from './crm-lists'
import { CRM_SCOPE_GAP_COPY, crmSuiteIncluded, crmSuiteLockedCopy, isCrmMobileScope } from './crm-mobile-scope'
import { CRM_LIST_SCREENS } from './screen-ids'
import { useCrmMobileScope } from './use-crm-mobile-scope'

export default function CrmOpenLeadsWidget({ context }: MobileWidgetProps) {
  const { scope, org } = useCrmMobileScope(context.firestore, context.orgId, context.hostId, context.uid)
  const included = crmSuiteIncluded(org)
  const spec = useMemo(
    () =>
      isCrmMobileScope(scope) && included === true
        ? crmListSpec({
            kind: 'leads',
            scope,
            uid: context.uid,
            filters: { status: crmDefaultStatus('leads'), mine: false },
            search: [],
          })
        : null,
    [included, scope, context.uid],
  )
  const key = spec ? JSON.stringify({ path: spec.path, request: spec.ask.request }) : null
  const [state, setState] = useState<{ key: string; count: number | null; error: boolean } | null>(null)
  useEffect(() => {
    if (!spec || !key || !spec.enabled) return
    let active = true
    const plan = planListQuery(spec.ask.reader, spec.ask.request, nameSearchNormalizers)
    const [first, ...rest] = spec.path
    getCountFromServer(query(collection(context.firestore as Firestore, first, ...rest), ...listQueryConstraints(plan)))
      .then((snapshot) => {
        if (active) setState({ key, count: snapshot.data().count, error: false })
      })
      .catch(() => {
        if (active) setState({ key, count: null, error: true })
      })
    return () => {
      active = false
    }
    // The spec is keyed by its path and request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.firestore, key])

  if (included === false) return <Text tone="secondary">{crmSuiteLockedCopy().title}</Text>
  if (!isCrmMobileScope(scope) && scope !== 'loading') return <Text tone="secondary">{CRM_SCOPE_GAP_COPY[scope].title}</Text>
  const current = state && state.key === key ? state : null
  if (!current) return <Skeleton height={36} />
  if (current.error) return <Text tone="secondary">Could not count open leads.</Text>
  return (
    <>
      <Text variant="title" testID="crm-open-leads-count">
        {current.count}
      </Text>
      <Text tone="secondary">{current.count === 1 ? 'open lead' : 'open leads'}</Text>
      <Button title="View" variant="text" onPress={() => context.navigate(CRM_LIST_SCREENS.leads)} />
    </>
  )
}
