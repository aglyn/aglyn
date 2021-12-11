/**
 * @license
 * Copyright 2021 Aglyn LLC
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

// export type MetaElemElementProps = MetaHTMLAttributes<HTMLMetaElement>
export type MetaElemElementProps = JSX.IntrinsicElements['meta']
export type MakeMetaElementsConfig = [
  name: MetaElemElementProps['name'],
  content: MetaElemElementProps['content'],
  other?: MetaElemElementProps
][]

export function makeMetaElements(items: MakeMetaElementsConfig): JSX.Element[] {
  return items.map((item, i) => {
    const [name, content, other] = item
    const {id, key, ...rest} = {...other}
    return (
      <meta
        key={key ?? id ?? i}
        id={id}
        name={name}
        content={content}
        {...rest}
      />
    )
  })
}
export default makeMetaElements
