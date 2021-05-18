/** Allows conditional typing ype alias */
export type Conditional<X, T, A, B = never> = X extends T ? A : B

/** If X extends true then Y */
export type IF<X, Y> = Conditional<X, true, Y>

/** Plain old dictionary of key(K)-value(T) pairs with string signatures */
export type KV<T = unknown, K extends string = string> = Record<K, T>

/** The index signature type of T */
export type KeyOf<T> = keyof T

/** The index value type of T  */
export type IndexOf<T, K extends KeyOf<T> = KeyOf<T>> = T[K]

/** ========== AUTH ============ */
export type UserClaims = {
  admin?: boolean
  role?: string
}

export type User = {
  id?: string
  email: string
  birthday?: number
  firstName?: string
  lastName?: string
  middleInitial?: string
  role?: string
}

export type Permission = {
  id?: string
  name: string
  comments?: string
}

export type Role = {
  id?: string
  name: {
    singular: string
    plural: string
  }
  permissions: {
    [K in Permission['id']]: true
  }
}
