import { FT } from './dod'

/**
 * Name fields
 */
export type Name = FT.Text | {
  singular?: FT.Text
  plural?: FT.Text
}