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

import { _isStrEmpty, _isUndOrNull } from '@aglyn/shared-util-tools'
import arraySafe from '@aglyn/shared-util-tools/array/array-safe'
import { makeAutoObservable } from 'mobx'
import { BehaviorSubject } from 'rxjs'
import { map } from 'rxjs/operators'

export type PageTitleObject = {
  number?
  screen?
  suffix?
  separator?
}

export class PageTitle {
  public separator?: string = '–'
  public page?: number = 1
  public view?: string = 'Page Title'
  public area?: string = ''
  public prefix?: string = ''
  public suffix?: string = 'My App'

  public get value(): string {
    let title = `${this.view}`

    if (this.page > 1) title = `${title} (Page ${this.page})`

    return [this.prefix, title, this.area, this.suffix]
      .filter(Boolean)
      .join(` ${this.separator} `)
  }

  constructor() {
    makeAutoObservable(this)
  }

  public setPage(page?: number) {
    this.page = page || 1
    return this
  }

  public setView(view?: string) {
    this.view = view || ''
    return this
  }

  public setArea(area?: string) {
    this.area = area || ''
    return this
  }

  public setPrefix(prefix?: string) {
    this.prefix = prefix || ''
    return this
  }

  public setSuffix(suffix?: string) {
    this.suffix = suffix || ''
    return this
  }

  public toString(): string {
    return this.value
  }
}

export const $title = new PageTitle()

let _values: PageTitleObject = { suffix: 'My App' }
export const $_screenObj = new BehaviorSubject<PageTitleObject>({
  suffix: 'My App',
})
export const $pageTitle = $_screenObj.pipe(map(buildScreenTitle))

function buildScreenTitle(values: PageTitleObject): string {
  const { number, screen, suffix, separator } = buildValues(values)

  const newTitle = arraySafe(screen, [screen])
    .concat(!number ? null : ` - Page ${number}`, suffix)
    .filter((i) => !_isUndOrNull(i) && !_isStrEmpty(i))
    .join(separator || ' – ')

  return newTitle
}

function buildValues(values?: PageTitleObject): PageTitleObject {
  return (_values = {
    number: values.number ?? _values.number,
    screen: values.screen || _values.screen,
    suffix: values.suffix || _values.suffix,
    separator: values.separator || _values.separator,
  })
}

export function setScreenName(screen, number?): void {
  $_screenObj.next(buildValues({ screen, number }))
}
export function setScreenSeparator(separator): void {
  $_screenObj.next(buildValues({ separator }))
}
export function setScreenSuffix(suffix): void {
  $_screenObj.next(buildValues({ suffix }))
}
export function setScreenNumber(number?): void {
  $_screenObj.next(buildValues({ number }))
}
export function setScreenTitle(values: PageTitleObject): void {
  $_screenObj.next(buildValues(values))
}
