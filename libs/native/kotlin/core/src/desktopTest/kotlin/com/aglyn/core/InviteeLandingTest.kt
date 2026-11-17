// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The network specs run on real time (`runBlocking`): the invitation check's deadline is real, and `runTest`'s virtual clock
// would let it lapse before the mocked console answers.

/**
 * An invitee who signs up lands in the invited workspace, with no workspace of their own (AGL-4047, the console's
 * `invitee-lands-in-invited-workspace.spec.tsx`, #2706). The Apple kit's InviteeLandingTests asserts the same.
 */
class InviteeLandingTest {
  private val invited = """{"invites":[{"${'$'}id":"i1","orgId":"o1","orgName":"North Studio","role":"editor"}]}"""
  private val none = """{"invites":[]}"""

  private class RecordingWriter : FirestoreWriter {
    val merges = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun merge(path: String, data: Map<String, Any?>) {
      merges += path to data
    }
  }

  /** `users/u1` holding the name the sign-up form took. */
  private class HeldName : FirestoreReader {
    private val held = mapOf("name" to "Acme", "nameWasTyped" to true, "provider" to "password", "createdAtMs" to 1_800_000_000_000L - 1000)
    override suspend fun get(path: String) = FirestoreDoc("u1", "users/u1", mapOf(SignUpService.FIELD to held)).takeIf { it.path == path }
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private class Rig(answers: List<Pair<HttpStatusCode, String>>, silentInvites: Boolean = false) {
    val paths = mutableListOf<String>()
    val bodies = mutableListOf<String>()
    val writer = RecordingWriter()
    val signUp: SignUpService

    init {
      val queue = answers.toMutableList()
      val json = headersOf(HttpHeaders.ContentType, "application/json")
      val http = HttpClient(MockEngine { request ->
        paths += request.url.encodedPath
        bodies += String(request.body.toByteArray())
        if (silentInvites && request.url.encodedPath == "/api/orgs/invites") delay(10_000)
        val (status, body) = when {
          silentInvites && request.url.encodedPath == "/api/orgs/create" -> HttpStatusCode.OK to """{"orgId":"o9","slug":"acme"}"""
          queue.isEmpty() -> HttpStatusCode.OK to "{}"
          else -> queue.removeAt(0)
        }
        respond(body, status, json)
      })
      val api = ConsoleApiClient("https://console.test", http, { "tok" }, sleep = {}, maxAttempts = 1)
      signUp = SignUpService(api, writer, HeldName(), now = { 1_800_000_000_000 }, writesDeadlineMs = 1_000)
    }
  }

  // First run (the console's home provisioning)

  @Test
  fun anInviteesFirstRunCreatesNothingAndLeavesTheHeldNameUnclaimed(): Unit = runBlocking {
    val rig = Rig(listOf(HttpStatusCode.OK to invited))
    var claimed = false
    val settled = rig.signUp.settleFirstRun("u1", listOf("password"), joiningAnInvite = false) { claimed = true }
    assertEquals(FirstRunSettlement.Invited, settled)
    assertEquals(listOf("/api/orgs/invites"), rig.paths, "nothing is created")
    assertTrue(rig.writer.merges.isEmpty(), "the held name is left for a withdrawn invitation")
    assertFalse(claimed, "an invitee never sees 'Setting up your workspace…'")
  }

  @Test
  fun nothingIsCreatedInTheGapAfterTheAutomaticJoinAccepted(): Unit = runBlocking {
    // The accepted invitation has left the server's list, and its membership has not reached the workspace list yet.
    val rig = Rig(listOf(HttpStatusCode.OK to none))
    assertEquals(FirstRunSettlement.Invited, rig.signUp.settleFirstRun("u1", listOf("password"), joiningAnInvite = true))
    assertEquals(emptyList(), rig.paths)
    assertTrue(rig.writer.merges.isEmpty())
  }

  @Test
  fun withNoInvitationTheNamedWorkspaceIsCreatedAsBefore(): Unit = runBlocking {
    val rig = Rig(listOf(HttpStatusCode.OK to none, HttpStatusCode.OK to """{"orgId":"o9","slug":"acme"}"""))
    var claimed = false
    val settled = rig.signUp.settleFirstRun("u1", listOf("password"), joiningAnInvite = false) { claimed = true }
    assertEquals(FirstRunSettlement.Created("acme", null), settled)
    assertEquals(listOf("/api/orgs/invites", "/api/orgs/create"), rig.paths)
    assertEquals("""{"name":"Acme"}""", rig.bodies[1])
    assertTrue(claimed)
    assertEquals(listOf<Pair<String, Map<String, Any?>>>("users/u1" to mapOf(SignUpService.FIELD to null)), rig.writer.merges.toList())
  }

  // The verified sign-up door (Google)

  @Test
  fun aVerifiedDoorCreatesNothingWhenAnInvitationIsWaiting(): Unit = runBlocking {
    val rig = Rig(listOf(HttpStatusCode.OK to invited))
    assertNull(rig.signUp.provisionVerifiedSignUp("Ada Lovelace"))
    assertEquals(listOf("/api/orgs/invites"), rig.paths)
  }

  @Test
  fun aVerifiedDoorWithNoInvitationProvisionsAsBefore(): Unit = runBlocking {
    val rig = Rig(listOf(HttpStatusCode.OK to none, HttpStatusCode.OK to """{"orgId":"o9","slug":"ada"}"""))
    assertEquals("ada", rig.signUp.provisionVerifiedSignUp("Ada Lovelace")?.slug)
    assertEquals(listOf("/api/orgs/invites", "/api/orgs/create"), rig.paths)
  }

  @Test
  fun aRefusedOrSilentCheckProvisionsAsBefore(): Unit = runBlocking {
    val refused = Rig(listOf(HttpStatusCode.InternalServerError to """{"error":"x"}""", HttpStatusCode.OK to """{"orgId":"o9","slug":"ada"}"""))
    assertEquals("ada", refused.signUp.provisionVerifiedSignUp("Ada")?.slug)

    val silent = Rig(emptyList(), silentInvites = true)
    assertEquals("acme", silent.signUp.provisionVerifiedSignUp("Ada", deadlineMs = 50)?.slug, "the deadline, not the route, decides")
  }

  // Several invitations: the newest opens

  @Test
  fun invitationsReadNewestFirstWithUndatedOnesAfter() {
    val old = PendingInvite("old", "o1", null, null, handoff = false, createdAtMs = 1_000)
    val new = PendingInvite("new", "o2", null, null, handoff = false, createdAtMs = 2_000)
    val undatedA = PendingInvite("a", "o3", null, null, handoff = false)
    val undatedB = PendingInvite("b", "o4", null, null, handoff = false)
    assertEquals(listOf("new", "old", "a", "b"), newestInvitesFirst(listOf(undatedA, old, undatedB, new)).map { it.id })
    assertEquals(listOf("a", "b"), newestInvitesFirst(listOf(undatedA, undatedB)).map { it.id }, "an answer without dates is unchanged")
    assertEquals("new", latestInvite(listOf(old, new))?.id)
    assertNull(latestInvite(emptyList()))
  }

  @Test
  fun readsWhenEachInvitationWasSent(): Unit = runBlocking {
    val rig = Rig(listOf(HttpStatusCode.OK to """{"invites":[{"${'$'}id":"i2","orgId":"o2","createdAtMs":2000},{"${'$'}id":"i1","orgId":"o1"}]}"""))
    assertEquals(listOf(2000L, null), rig.signUp.pendingInvites().map { it.createdAtMs })
  }
}
