/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import type DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import EventEmitter from 'events'

const PKG_VERSION = JSON.stringify(process.env.PKG_VERSION ?? 'N/A')
const PRODUCTION = process.env.NODE_ENV === 'production'

const websiteEmitter = new EventEmitter()

export enum WebsiteEvent {
  INSTANCE_CREATED = 'site.created-singleton-instance',
  COMPONENT_REGISTERED = 'site.registered-site-component',
}


export class Website {
  private static instance?: Website

  public static readonly version: string = PKG_VERSION
  public static readonly production: boolean = PRODUCTION
  public static readonly development: boolean = !Website.production
  public static readonly event: EventEmitter = websiteEmitter

  /**
   * Get the currently living singleton instance of Website
   * @throws
   * @returns {Website} instance
   */
  public static getInstance(): Website {
    if (Website.instance instanceof Website) {
      return Website.instance
    }
    throw new Error("Instance doesn't exist! You must call createInstance(...) first!")
  }

  /**
   * Creates a new singleton instance of Website
   * @throws
   */
  public static createInstance() {
    if (Website.instance instanceof Website) {
      throw new Error('Instance exist! You have already created an instance.')
    }
    Website.instance = new Website()
    Website.event.emit(WebsiteEvent.INSTANCE_CREATED, Website.instance)
  }

}

export namespace Website {

  export const siteComponents: SiteComponent.MappedComponents = new Map()
  export namespace SiteComponent {

    export enum RestrictType {
      LIMIT = 'limit',
      DISALLOW = 'disallow',
    }

    export type AnyProps = Record<string, unknown>
    export type MappedComponents = Map<string, ComponentModel>

    export interface Component {
      _id: string
      ClassFn?: any
      name: string
      description?: string
      title?: string
      subtitle?: string
      icon?: any
      defaultProps?: Partial<AnyProps>
      propsSchema?: DdfSchema
      resolveProps?: <T>(...args: T[]) => Partial<AnyProps> | void
      options?: {
        disableActions?: boolean
        disableBadge?: boolean
        disableCopying?: boolean
        disableDragging?: boolean
        disableDropping?: boolean
        disableEditing?: boolean
        disableNesting?: boolean
        disableOutline?: boolean
        disableRemoving?: boolean
        disableSelecting?: boolean
        restrictChildren?: [type: RestrictType, ids: string[]]
        restrictParents?: [type: RestrictType, ids: string[]]
      }
    }

    class ComponentModel {
      public static readonly event: EventEmitter = websiteEmitter
      constructor(public config: Component) {}
    }

    /**
     * Builds and registers a {@link ComponentModel} instance from the provided
     * [@link Component] options
     * @throws
     * @param {Component['ClassFn']} component
     * @param {Component} options
     * @return {ComponentModel} Reference to the newly created model
     */
    export function registerWebsiteComponent(component: Component['ClassFn'], options: Component): ComponentModel {
      const { _id, ...opts } = options
      if (siteComponents.has(_id)) {
        throw new Error(`Site component with same ID(${_id}) already exists!`)
      }
      const model = new ComponentModel({
        ...opts,
        ClassFn: component,
        _id,
      })
      siteComponents.set(_id, model)
      Website.event.emit(WebsiteEvent.COMPONENT_REGISTERED, Website, model)
      return model
    }
  }



  export interface Element {
    _id: string
    component?: SiteComponent.Component | string
    children?: Element[]
    props: SiteComponent.AnyProps
    temp?: boolean
    parent?: string
    name?: string
    description?: string
  }

}


export function site() {
  return 'site'
}
