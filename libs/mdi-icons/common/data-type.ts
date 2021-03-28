export type Key = string

export namespace Normal {
  export type KeyList<K extends keyof any = string> = K[]
  export type KeysFromList<List> = List extends KeyList<infer K> ? K : never
  export type Keys<K = Key> = K extends KeyList ? KeysFromList<K> : K extends Key ? K : never

  export type Lookup<T, K extends keyof any = Key> = Record<K, T>
  export type Values<T> = T extends Lookup<infer U> ? U : never
}
