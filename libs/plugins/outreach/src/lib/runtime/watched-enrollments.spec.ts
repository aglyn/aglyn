/**
 * The sync job's watched enrollments, read once per run (AGL-4121): one
 * organization read answers every mailbox and the possible-reply step, and a
 * write to an enrollment sends the next reader back to Firestore.
 */
import { watchedEnrollmentsOfOrg, type WatchedEnrollmentDoc } from './watched-enrollments'

const doc = (id: string, mailboxId: string): WatchedEnrollmentDoc => ({
  id,
  get: (field: string) => (field === 'mailboxId' ? mailboxId : undefined),
})

/** Ordered as Firestore orders the window query: by last send, then by path. */
const stored = [doc('e1', 'mb-a'), doc('e2', 'mb-b'), doc('e3', 'mb-a'), doc('e4', 'mb-c')]

function harness() {
  const calls: string[] = []
  const reads = {
    org: jest.fn(async () => {
      calls.push('org')
      return stored
    }),
    mailbox: jest.fn(async (mailboxId: string) => {
      calls.push(`mailbox:${mailboxId}`)
      return stored.filter((entry) => entry.get('mailboxId') === mailboxId)
    }),
  }
  return { calls, reads, watched: watchedEnrollmentsOfOrg(reads) }
}

const ids = (docs: WatchedEnrollmentDoc[]) => docs.map((entry) => entry.id)

describe('watchedEnrollmentsOfOrg', () => {
  it('reads nothing until a mailbox asks', () => {
    const { calls } = harness()
    expect(calls).toEqual([])
  })

  it('answers every mailbox and the possible-reply step from one organization read in a quiet run', async () => {
    const { calls, watched } = harness()
    expect(ids(await watched.forMailbox('mb-a'))).toEqual(['e1', 'e3'])
    expect(ids(await watched.forOrg())).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(ids(await watched.forMailbox('mb-b'))).toEqual(['e2'])
    expect(ids(await watched.forMailbox('mb-c'))).toEqual(['e4'])
    expect(ids(await watched.forMailbox('mb-none'))).toEqual([])
    expect(calls).toEqual(['org'])
  })

  it('gives each mailbox exactly what the narrow query would, in its order', async () => {
    const { reads, watched } = harness()
    for (const mailboxId of ['mb-a', 'mb-b', 'mb-c']) {
      expect(ids(await watched.forMailbox(mailboxId))).toEqual(ids(await reads.mailbox(mailboxId)))
    }
  })

  it('after a write, the next mailbox reads its own with the narrow query', async () => {
    const { calls, watched } = harness()
    await watched.forMailbox('mb-a')
    watched.touched()
    expect(ids(await watched.forMailbox('mb-b'))).toEqual(['e2'])
    expect(calls).toEqual(['org', 'mailbox:mb-b'])
  })

  it('after a write, the possible-reply step reads the organization again, and that read is held', async () => {
    const { calls, watched } = harness()
    await watched.forMailbox('mb-a')
    watched.touched()
    await watched.forOrg()
    await watched.forMailbox('mb-c')
    await watched.forOrg()
    expect(calls).toEqual(['org', 'org'])
  })

  it('does not hold a failed read', async () => {
    const { reads, watched } = harness()
    reads.org.mockRejectedValueOnce(new Error('unavailable'))
    await expect(watched.forMailbox('mb-a')).rejects.toThrow('unavailable')
    expect(ids(await watched.forMailbox('mb-a'))).toEqual(['e1', 'e3'])
    expect(reads.org).toHaveBeenCalledTimes(2)
  })
})
