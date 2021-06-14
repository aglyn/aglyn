/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/router'


export type RouteProperties = {
  shallow: boolean
}
export type ChangeError = {
  cancelled: boolean,
  [any: string]: any,
}
export type AnyCallback = (...args: any[]) => void
export type BeforeHistoryChangeCallback = (asPath: string, routeProps: RouteProperties) => void
export type HashChangeStartCallback = (asPath: string, routeProps: RouteProperties) => void
export type HashChangeCompleteCallback = (asPath: string, routeProps: RouteProperties) => void
export type RouterChangeStartCallback = (asPath: string, routeProps: RouteProperties) => void
export type RouterChangeCompleteCallback = (asPath: string, routeProps: RouteProperties) => void
export type RouterChangeErrorCallback = (error: ChangeError, asPath: string, routeProps: RouteProperties) => void

export enum NextRouterEvent {
  HASH_CHANGE_START = 'hashChangeStart',
  HASH_CHANGE_COMPLETE = 'hashChangeComplete',
  ROUTE_CHANGE_START = 'routeChangeStart',
  ROUTE_CHANGE_COMPLETE = 'routeChangeComplete',
  ROUTE_CHANGE_ERROR = 'routeChangeError',
  BEFORE_HISTORY_CHANGE = 'beforeHistoryChange',
}

export interface EventCallbacks {
  [NextRouterEvent.BEFORE_HISTORY_CHANGE]: BeforeHistoryChangeCallback,
  [NextRouterEvent.HASH_CHANGE_START]: HashChangeStartCallback,
  [NextRouterEvent.HASH_CHANGE_COMPLETE]: HashChangeCompleteCallback,
  [NextRouterEvent.ROUTE_CHANGE_START]: RouterChangeStartCallback,
  [NextRouterEvent.ROUTE_CHANGE_COMPLETE]: RouterChangeCompleteCallback,
  [NextRouterEvent.ROUTE_CHANGE_ERROR]: RouterChangeErrorCallback,
  [eventId: string]: AnyCallback
}

type EventParamType = [id: keyof EventCallbacks, callback: EventCallbacks[keyof EventCallbacks]]
export const useRouterEvent = (events: EventParamType[]) => {
  const router = useRouter()
  useEffect(() => {
    events.map(([id, callback]) => router.events.on(id as string, callback))
    return () => {
      events.map(([id, callback]) => router.events.off(id as string, callback))
    }
  }, [router.events])
}
export const useOnBeforeHistoryChange = (callback: EventCallbacks[NextRouterEvent.BEFORE_HISTORY_CHANGE]) => {
  useRouterEvent([[NextRouterEvent.BEFORE_HISTORY_CHANGE, callback]])
}
export const useOnHashChangeStart = (callback: EventCallbacks[NextRouterEvent.HASH_CHANGE_START]) => {
  useRouterEvent([[NextRouterEvent.HASH_CHANGE_START, callback]])
}
export const useOnHashChangeComplete = (callback: EventCallbacks[NextRouterEvent.HASH_CHANGE_COMPLETE]) => {
  useRouterEvent([[NextRouterEvent.HASH_CHANGE_COMPLETE, callback]])
}
export const useOnRouteChangeStart = (callback: EventCallbacks[NextRouterEvent.ROUTE_CHANGE_START]) => {
  useRouterEvent([[NextRouterEvent.ROUTE_CHANGE_START, callback]])
}
export const useOnRouteChangeComplete = (callback: EventCallbacks[NextRouterEvent.ROUTE_CHANGE_COMPLETE]) => {
  useRouterEvent([[NextRouterEvent.ROUTE_CHANGE_COMPLETE, callback]])
}
export const useOnRouteChangeError = (callback: EventCallbacks[NextRouterEvent.ROUTE_CHANGE_ERROR]) => {
  useRouterEvent([[NextRouterEvent.ROUTE_CHANGE_ERROR, callback]])
}
