package com.aglyn.core

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
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

  @Test
  fun aSupportSessionNeverJoinsForTheCustomer() = runTest {
    val calls = Calls()
    val auto = join(listOf(acme), calls)
    assertEquals(emptyList(), auto.run("u1", impersonating = true))
    assertTrue(calls.accepted.isEmpty())
  }
}
