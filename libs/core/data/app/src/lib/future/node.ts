/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { BundleId, ComponentId } from '@aglyn/core-data-foundation'

export type NodeId = string

export interface NodeSchema<P = JSX.AnyProps> {
  $id: NodeId
  componentId: string
  bundleId?: BundleId
  parentId?: NodeId
  sx?: JSX.SxProps
  props?: P
  nodes?: NodeId[]
}

export default class Node<P = JSX.AnyProps> {
  public schema: NodeSchema<P>

  public get $id(): NodeId {
    return this.schema.$id
  }
  public set $id(value: NodeId) {
    this.schema.$id = value
  }

  public get componentId(): ComponentId {
    return this.schema.componentId
  }
  public set componentId(value: ComponentId) {
    this.schema.componentId = value
  }

  public get bundleId(): BundleId {
    return this.schema.bundleId
  }
  public set bundleId(value: BundleId) {
    this.schema.bundleId = value
  }

  public get parentId(): NodeId {
    return this.schema.parentId
  }
  public set parentId(value: NodeId) {
    this.schema.parentId = value
  }

  public get sx(): JSX.SxProps {
    return this.schema.sx
  }
  public set sx(value: JSX.SxProps) {
    this.schema.sx = value
  }

  public get props(): P {
    return this.schema.props
  }
  public set props(value: P) {
    this.schema.props = value
  }

  public get nodes(): NodeId[] {
    return this.schema.nodes
  }
  public set nodes(value: NodeId[]) {
    this.schema.nodes = value
  }

  constructor(schema: NodeSchema<P>) {
    this.schema = {
      $id: schema.$id,
      componentId: schema.componentId,
      bundleId: schema.bundleId,
      parentId: schema.parentId,
      sx: Array.isArray(schema.sx) ? [...schema.sx] : [],
      props: { ...schema.props },
      nodes: Array.isArray(schema.nodes) ? [...schema.nodes] : [],
    }
  }

  public toJSON(): NodeSchema<P> {
    return {
      $id: this.$id,
      componentId: this.componentId,
      bundleId: this.bundleId,
      parentId: this.parentId,
      sx: this.sx,
      props: this.props,
      nodes: this.nodes,
    }
  }
}
