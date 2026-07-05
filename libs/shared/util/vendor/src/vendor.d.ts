declare module 'hoist-non-react-statics' {
  import { ComponentType } from 'react'
  function hoistNonReactStatics<T extends ComponentType<any>, S extends ComponentType<any>>(
    target: T,
    source: S,
    blacklist?: Record<string, boolean>,
  ): T & S
  export = hoistNonReactStatics
}

declare module 'mout/object/deepFillIn' {
  function deepFillIn<T extends object>(target: T, ...sources: Partial<T>[]): T
  export = deepFillIn
}

declare module 'nanoid-dictionary' {
  export const lowercase: string
  export const uppercase: string
  export const numbers: string
  export const alphanumeric: string
  export const nolookalikes: string
  export const nolookalikesSafe: string
}
