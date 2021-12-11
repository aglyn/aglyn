import objectDeepMerge, {
  all as objectDeepMergeMany,
  Options as ObjectDeepMergeOptions,
} from 'deepmerge'

export type {ObjectDeepMergeOptions }
export { objectDeepMerge, objectDeepMergeMany }

// export function objectDeepMerge<T>(x: Partial<T>, y: Partial<T>, options?: DeepMergeOptions): T
// export function objectDeepMerge<T1, T2>(x: Partial<T1>, y: Partial<T2>, options?: DeepMergeOptions): T1 & T2
// export function objectDeepMerge<T, K extends keyof any>(objects: Record<K, T>[], options?: Options): object
// export function objectDeepMerge<T>(objects: Partial<T>[], options?: Options): T
