package com.aglyn.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Where one invitation's join stands. */
enum class InviteJoinStatus {
  /** Being accepted. */
  JOINING,

  /** Accepted: the person is a member now. */
  JOINED,

  /** The server did not let it finish yet: shown as "almost ready". */
  WAITING,
}

/** The invitations found for the account and where each one's join stands. */
data class InviteJoinState(val invites: List<PendingInvite> = emptyList(), val statuses: Map<String, InviteJoinStatus> = emptyMap()) {
  /** The invitations being joined right now ("Joining Acme…"). */
  val joining: List<PendingInvite> get() = invites.filter { statuses[it.id] == InviteJoinStatus.JOINING }

  /** The invitations whose join the server has not let finish ("Your access to Acme is almost ready"). */
  val waiting: List<PendingInvite> get() = invites.filter { statuses[it.id] == InviteJoinStatus.WAITING }
}

/**
 * Invitations join on their own (AGL-4023, standing): once the account exists and its address is confirmed, every invitation
 * waiting for it is accepted through the console's own `POST /api/orgs/invites` `accept`, the way the console's
 * `InviteAutoAcceptProvider` does on every load. Nobody is asked to accept or decline. The server keeps its checks (a
 * confirmed address, the seat quota, the sign-in lockout on a hand-off); a join it refuses is shown as "almost ready", never
 * with a reason or a choice, because the refusal is the inviter's to fix and the inviter has been told. Each invitation is
 * tried once per signed-in account a session; the next session tries a refused one again. Never during a support session.
 */
class InviteAutoJoin(
  private val list: suspend () -> List<PendingInvite>,
  private val accept: suspend (PendingInvite) -> Unit,
) {
  /** Joins through the console's routes, as the console does. */
  constructor(service: SignUpService) : this({ service.pendingInvites() }, { service.answer(it, accept = true) })

  private val mutable = MutableStateFlow(InviteJoinState())
  val state: StateFlow<InviteJoinState> = mutable
  private val lock = Mutex()
  private val attempted = mutableSetOf<String>()
  private var forUid: String? = null

  /**
   * Reads [uid]'s invitations and accepts each one not tried yet this session; answers the workspaces joined, so the caller
   * can open one. Does nothing during a support session.
   */
  suspend fun run(uid: String, impersonating: Boolean): List<String> {
    if (impersonating) return emptyList()
    return lock.withLock {
      if (forUid != uid) {
        forUid = uid
        attempted.clear()
        mutable.value = InviteJoinState()
      }
      val found = list()
      mutable.value = InviteJoinState(found, mutable.value.statuses)
      val joined = mutableListOf<String>()
      for (invite in found) {
        if (!attempted.add(invite.id)) continue
        mutable.value = mutable.value.copy(statuses = mutable.value.statuses + (invite.id to InviteJoinStatus.JOINING))
        val status = try {
          accept(invite)
          joined += invite.orgId
          InviteJoinStatus.JOINED
        } catch (error: CancellationException) {
          throw error
        } catch (_: Throwable) {
          InviteJoinStatus.WAITING
        }
        mutable.value = mutable.value.copy(statuses = mutable.value.statuses + (invite.id to status))
      }
      joined
    }
  }
}
