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
 * Renders a plugin's lazily loaded screen or widget (AGL-3620). Each
 * contribution's module is fetched the first time it is shown, never at
 * launch, and a failure is contained to that contribution.
 */

import { EmptyState, Skeleton } from '@aglyn/mobile-ui'
import type { LazyComponent } from '@aglyn/mobile-plugin-host'
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { View } from 'react-native'

const cache = new Map<string, ComponentType<any>>()

function lazyFor<P>(id: string, load: LazyComponent<P>): ComponentType<P> {
  let component = cache.get(id)
  if (!component) {
    component = lazy(load)
    cache.set(id, component)
  }
  return component as ComponentType<P>
}

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function LazyContribution<P extends object>({
  id,
  load,
  props,
  compact,
}: {
  id: string
  load: LazyComponent<P>
  props: P
  compact?: boolean
}) {
  const Loaded = lazyFor(id, load)
  return (
    <Boundary
      fallback={
        <EmptyState
          icon="warning-outline"
          title="This part of the app could not load"
          body="Check your connection and open it again."
        />
      }
    >
      <Suspense
        fallback={
          <View style={{ gap: 8, padding: compact ? 0 : 16 }}>
            <Skeleton height={20} width="60%" />
            <Skeleton height={16} />
            <Skeleton height={16} width="80%" />
          </View>
        }
      >
        <Loaded {...props} />
      </Suspense>
    </Boundary>
  )
}
