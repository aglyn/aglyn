import EventEmitter from 'events'
import type DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'


const PKG_VERSION = JSON.stringify(process.env.PKG_VERSION ?? 'N/A')
const PRODUCTION = process.env.NODE_ENV === 'production'


export enum RestrictType {
  NONE,
  LIMIT    = 'limit',
  DISALLOW = 'disallow',
}
export enum ScEvent {
  INSTANCE_CREATED = 'site_core.created-instance'
}
export enum ScElementType {
  TAG_NAME = 'tagName',
  SITE_COMPONENT = 'comp',
}

export type ScComponentResolveProps = <T>(...args: T[]) => Partial<ScElementProps> | void
export type ScComponentPropsSchema = DdfSchema
export type ScComponentNestingRestriction = [RestrictType, string[]]

export type ScElementProps = Record<string, unknown>


export interface ScComponent {
  _id: string
  ClassFn: any
  name: string
  title?: string
  subtitle?: string
  description?: string
  icon?: string
  resolveProps?: ScComponentResolveProps
  defaultProps?: Partial<ScElementProps>
  propsSchema?: ScComponentPropsSchema
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
    restrictChildren?: ScComponentNestingRestriction
    restrictParents?: ScComponentNestingRestriction
  }
}

export interface ScElement {
  _id: string
  comp?: ScComponent | string
  children?: ScElement[]
  props: ScElementProps
  temp?: boolean
  parent?: string
  name?: string
}

export class SiteCore {

  public static readonly version: string = PKG_VERSION
  public static readonly production: boolean = PRODUCTION
  public static readonly event: EventEmitter = new EventEmitter()

  private static instance: SiteCore
  private static components: Map<string, [
    options: Omit<ScComponent, 'ClassFn'>,
    ClassFn: Pick<ScComponent, 'ClassFn'>
  ]> = new Map()


  /**
   * Get the currently living singleton instance
   * @throws
   * @returns {SiteCore} instance
   */
  public static getInstance(): SiteCore {
    if (this.instance instanceof SiteCore) {
      return this.instance
    }
    throw new Error('Instance doesn\'t exist! You must call createInstance(...) first!')
  }

  /**
   * Creates a new singleton instance of SiteCore
   * @throws
   */
  public static createInstance() {
    if (this.instance instanceof SiteCore) {
      throw new Error('Instance exist! You have already created an instance.')
    }
    this.instance = new SiteCore()
    this.event.emit(ScEvent.INSTANCE_CREATED)
  }





}

export function siteCore() {
  return 'site-core'
}
