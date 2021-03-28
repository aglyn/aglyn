import { Ref, ReactNode } from 'react'
import useNodeProperty from './use-node-property'


export function useTagName (initialState = null): [string, Ref<any>, ReactNode] {
  const [tagName, ref, node] = useNodeProperty('tagName', initialState)
  return [tagName, ref, node]
}

export default useTagName
