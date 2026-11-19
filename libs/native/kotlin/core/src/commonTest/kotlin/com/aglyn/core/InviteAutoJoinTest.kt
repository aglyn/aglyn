package com.aglyn.core

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Invitations join on their own (AGL-4023): accepted once the account is in use, never asked about. */
class InviteAutoJoinTest {
  private val acme = PendingInvite("i1", "o1", "Acme Builders", "editor", handoff = false)
  private val north = PendingInvite("i2", "o2", "North Studio", "admin", handoff = true)

  private class Calls {
    val accepted = mutableListOf<String>()
    var refuse = setOf<String>()
  }

  private fun join(invites: List<PendingInvite>, calls: Calls) = InviteAutoJoin(
    list = { invites },
    accept = { invite ->
      if (invite.id in calls.refuse) throw IllegalStateException("still being set up")
      calls.accepted += invite.id
    },
  )

  @Test
  fun everyInvitationIsAcceptedWithoutAsking() = runTest {
    val calls = Calls()
    val auto = join(listOf(acme, north), calls)
    assertEquals(listOf("o1", "o2"), auto.run("u1", impersonating = false))
    assertEquals(listOf("i1", "i2"), calls.accepted)
    assertEquals(mapOf("i1" to InviteJoinStatus.JOINED, "i2" to InviteJoinStatus.JOINED), auto.state.value.statuses)
  }

  @Test
  fun aRefusedJoinWaitsQuietlyAndIsTriedAgainOnlyForAnotherAccount() = runTest {
    val calls = Calls().apply { refuse = setOf("i2") }
    val auto = join(listOf(acme, north), calls)
    auto.run("u1", impersonating = false)
    assertEquals(listOf("i2"), auto.state.value.waiting.map { it.id })
    calls.refuse = emptySet()
    assertEquals(emptyList(), auto.run("u1", impersonating = false), "each invitation is tried once a session")
    assertEquals(listOf("o2"), auto.run("u2", impersonating = false).filter { it == "o2" })
  }

  /** With several invitations, the newest is the one a person is opened into; the rest join where they stand (AGL-4047). */
  @Test
  fun onlyTheNewestInvitationOpens() = runTest {
    val older = PendingInvite("i1", "o1", "Acme", "editor", handoff = false, createdAtMs = 1_000)
    val newer = PendingInvite("i2", "o2", "North", "admin", handoff = false, createdAtMs = 2_000)
    val auto = join(listOf(older, newer), Calls())
    assertEquals(listOf("o2", "o1"), auto.run("u1", impersonating = false), "both join, newest first")
    assertEquals("o2", auto.opens)
    assertEquals(listOf("i2", "i1"), auto.state.value.invites.map { it.id })
  }

  @Test
  fun aRefusedNewestOpensNothing() = runTest {
    val older = PendingInvite("i1", "o1", "Acme", "editor", handoff = false, createdAtMs = 1_000)
    val newer = PendingInvite("i2", "o2", "North", "admin", handoff = false, createdAtMs = 2_000)
    val auto = join(listOf(older, newer), Calls().apply { refuse = setOf("i2") })
    assertEquals(listOf("o1"), auto.run("u1", impersonating = false))
    assertNull(auto.opens, "an older invitation joins where the person stands")
  }

  /** First-run provisioning reads this so the gap after a join never looks like no invitation and no workspace. */
  @Test
  fun joiningOrJoinedHoldsProvisioningAndARefusalDoesNot() = runTest {
    val auto = join(listOf(acme), Calls())
    assertFalse(auto.state.value.joinedOrJoining)
    auto.run("u1", impersonating = false)
    assertTrue(auto.state.value.joinedOrJoining)

    val waiting = join(listOf(acme), Calls().apply { refuse = setOf("i1") })
    waiting.run("u1", impersonating = false)
    assertFalse(waiting.state.value.joinedOrJoining, "a refused join is no reason to hold the workspace back")
  }

  @Test
  fun aSupportSessionNeverJoinsForTheCustomer() = runTest {
    val calls = Calls()
    val auto = join(listOf(acme), calls)
    assertEquals(emptyList(), auto.run("u1", impersonating = true))
    assertTrue(calls.accepted.isEmpty())
  }
}
