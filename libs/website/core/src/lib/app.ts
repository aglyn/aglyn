/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { Component, ModuleMap } from './core'
import { EventFlag, PKG_VERSION } from './const'
import EventEmitter from 'events'


export class App {
  public static readonly VERSION: string = PKG_VERSION
  public static event: EventEmitter = new EventEmitter()
  public static modules: ModuleMap = new Map()
  public readonly CREATED = new Date().toUTCString()
  private static instance?: App
  private constructor() {/*empty*/}

  public static getInstance(): App {
    if (this.instance instanceof this) {
      return this.instance
    }
    this.instance = new this()
    this.event.emit(EventFlag.INSTANCE_CREATED, this, this.instance)
    return this.instance
  }

  public static init(): App {
    return this.getInstance()
  }

  public static setModule(props: { $id: string; declarations: Component[] }) {
    const { $id, declarations } = props
    const module = { $id, declarations }
    this.modules.set($id, module)
    this.event.emit(EventFlag.SET_MODULE, this, module)
    return this
  }

  public static getComponent(props: { moduleId: string; componentId: string }) {
    const { moduleId, componentId } = props
    return this.modules.get(moduleId)?.declarations.find((m) => m.$id === componentId)
  }

  public static setComponent(props: {
    moduleId: string
    $id: string
    ctor: Component['ctor']
    metadata?: Component['metadata']
  }) {
    const { moduleId, $id, ctor, metadata } = props
    const module = this.modules.get(moduleId) ?? { $id: moduleId, declarations: [] }
    let component
    if (module.declarations.some((i) => i.$id === $id)) {
      component = module.declarations.find((i) => i.$id === $id)
    }
    component = { ...component, $id, ctor, metadata }
    module.declarations.push(component)
    this.modules.set(moduleId, module)
    this.event.emit(EventFlag.SET_COMPONENT, this, module)
    return this
  }
}

export function app() {
  return
}
