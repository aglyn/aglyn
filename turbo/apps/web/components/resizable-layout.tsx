/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import type {
  PanelGroupProps} from 'react-resizable-panels';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'

export type ResizableLayoutProps = Partial<PanelGroupProps>

export default function ResizableLayout(props: ResizableLayoutProps) {
  const { children, ...rest } = props
  return (
    <PanelGroup direction="horizontal" {...rest}>
      <Panel style={{ minHeight: 100 }}>left</Panel>
      <PanelResizeHandle style={{ background: 'red', width: 10 }} />
      <Panel>
        <PanelGroup direction="vertical">
          <Panel>top</Panel>
          <PanelResizeHandle />
          <Panel>
            <PanelGroup direction="horizontal">
              <Panel>left</Panel>
              <PanelResizeHandle />
              <Panel>right</Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle />
      <Panel>right</Panel>
    </PanelGroup>
  )
}
