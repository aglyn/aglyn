import { nanoid } from 'nanoid'

/**
 * Create a tiny, secure, URL-friendly, unique string ID with nanoid
 *
 * Collision Probability Examples:
 * - (Ids @ 5-len/1000/hr) ==> ~5 hours needed, to have a 1% probability of at least one collision.
 * - (Ids @ 10-len/1000/hr) ==> ~17 years needed, to have a 1% probability of at least one collision.
 * - (Ids @ 11-len/1000/hr) ==> ~139 years needed, to have a 1% probability of at least one collision.
 * - (Ids @ 12-len/1000/hr) ==> ~1,000(1k) years needed, to have a 1% probability of at least one collision.
 *
 * @param {number} [ln] the character length of the ID (defaults to 11)
 */
export const createUid = (ln = 11) => {
  return nanoid(ln)
}
