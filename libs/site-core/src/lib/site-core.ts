import EventEmitter from 'events'
import type DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'


export type SiteElementProps = Record<string, unknown>
export type SiteComponentResolveProps = <T>(...args: T[]) => Partial<SiteElementProps> | void
export type SiteComponentPropsSchema = DdfSchema
export type SiteComponentNestingRestriction = [
  RestrictionType,
  SiteComponent['id'][]
]

export enum RestrictionType {
  LIMIT    = 'limit',
  DISALLOW = 'disallow',
}

export interface SiteComponent {
  id: string
  name: string
  title?: string
  subtitle?: string
  description?: string
  icon?: string
  resolveProps?: SiteComponentResolveProps
  defaultProps?: Partial<SiteElementProps>
  propsSchema?: SiteComponentPropsSchema
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
    restrictChildren?: SiteComponentNestingRestriction
    restrictParents?: SiteComponentNestingRestriction
  }
}

export interface SiteElement {
  id: string
  component: {
    type?: 'dom' | 'sc'
    cid?: SiteComponent['id']
    tagName?: string
  }
  children?: SiteElement[]
  props: SiteElementProps
  name?: string
  temp?: boolean
  pid?: SiteElement['id'] /* Parent SiteElement ID */
}

export class SiteCore {
  public static version: string
  private static event: EventEmitter = new EventEmitter()
}

export function siteCore() {
  return 'site-core'
}
