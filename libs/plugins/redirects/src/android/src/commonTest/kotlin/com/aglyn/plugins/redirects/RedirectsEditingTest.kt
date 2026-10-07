package com.aglyn.plugins.redirects

import com.aglyn.contracts.HostRedirect
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDelete
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeWrites(var answer: RedirectCheck) : RedirectsWriteApi {
  val calls = mutableListOf<String>()
  val written = mutableListOf<Map<String, Any?>>()
  var fail: Throwable? = null
  override suspend fun check(draft: RedirectDraft): RedirectCheck { calls += "check ${draft.id} ${draft.source}"; fail?.let { throw it }; return answer }
  override suspend fun create(fields: Map<String, Any?>) { calls += "create"; written += fields }
  override suspend fun update(id: String, fields: Map<String, Any?>) { calls += "update $id"; written += fields }
  override suspend fun setEnabled(id: String, enabled: Boolean) { calls += "enabled $id $enabled" }
  override suspend fun delete(id: String) { calls += "delete $id" }
  override suspend fun announce(source: String?) { calls += "announce $source" }
}

private val READY = RedirectCheck.Ready("/old", "/new", 301, "exact", null)

class RedirectsEditingTest {
  @Test
  fun aNewRuleIsCheckedThenCreatedThroughTheRouteAndAnnounced() = runTest {
    val api = FakeWrites(READY)
    val editor = RedirectsEditor(api, "u1", this)
    editor.add()
    editor.change(editor.draft!!.copy(source = "old", destination = "/new", statusCode = 301))
    editor.save()
    advanceUntilIdle()
    assertEquals(listOf("check null old", "create", "announce /old"), api.calls)
    assertEquals(
      mapOf("source" to "/old", "destination" to "/new", "statusCode" to 301L, "kind" to "exact", "priority" to 100L, "enabled" to true),
      api.written.single(),
    )
    assertNull(editor.draft)
    assertEquals("Redirect saved. It is live within about 30 seconds.", editor.notice)
  }

  @Test
  fun aRefusalKeepsTheEditorOpenInThePagesWords() = runTest {
    val api = FakeWrites(RedirectCheck.Refused("That destination's address looks like another company's website, so it can't be used"))
    val editor = RedirectsEditor(api, "u1", this)
    editor.add()
    editor.save()
    advanceUntilIdle()
    assertEquals(listOf("check null "), api.calls)
    assertEquals("That destination's address looks like another company's website, so it can't be used", editor.error)
    assertTrue(editor.draft != null)
  }

  @Test
  fun anEditKeepsTheRuleOffAndStampsOrClearsTheApproval() = runTest {
    val row = RedirectRow("r1", HostRedirect(source = "/was", destination = "/x", statusCode = 302, enabled = false))
    val api = FakeWrites(RedirectCheck.Ready("/old", "https://elsewhere.example/", 302, "exact", "/old is a published page — the redirect takes precedence"))
    val editor = RedirectsEditor(api, "u1", this)
    editor.edit(row)
    editor.save()
    advanceUntilIdle()
    assertEquals(listOf("check r1 /was", "update r1", "announce /old", "announce /was"), api.calls)
    assertEquals(false, api.written.single()["enabled"])
    assertEquals("u1", api.written.single()["externalDestinationApprovedBy"])
    assertEquals("/old is a published page — the redirect takes precedence", editor.notice)

    val internal = redirectSaveFields(RedirectDraft(id = "r1"), READY, "u1")
    assertEquals(FirestoreDelete, internal["externalDestinationApprovedBy"])
    assertFalse("externalDestinationApprovedBy" in redirectSaveFields(RedirectDraft(), READY, "u1"))
  }

  @Test
  fun theSwitchAndDeleteWriteAndAnnounce() = runTest {
    val row = RedirectRow("r1", HostRedirect(source = "/a", destination = "/b", statusCode = 302))
    val api = FakeWrites(READY)
    val editor = RedirectsEditor(api, "u1", this)
    editor.toggle(row, false)
    advanceUntilIdle()
    editor.askDelete(row)
    editor.confirmDelete()
    advanceUntilIdle()
    assertEquals(listOf("enabled r1 false", "announce /a", "delete r1", "announce /a"), api.calls)
    assertEquals("/a no longer redirects.", editor.notice)
  }

  @Test
  fun aRouteRefusalIsShownInItsWords() = runTest {
    val api = FakeWrites(READY).apply { fail = ConsoleApiError("Changing a redirect needs a publishing role — ask an editor or admin", 403, null) }
    val editor = RedirectsEditor(api, "u1", this)
    editor.add()
    editor.save()
    advanceUntilIdle()
    assertEquals("Changing a redirect needs a publishing role — ask an editor or admin", editor.error)
  }

  @Test
  fun anOutsideDestinationIsAnythingButASitePath() {
    assertFalse(isExternalRedirectDestination("/pricing"))
    assertTrue(isExternalRedirectDestination("//evil.example"))
    assertTrue(isExternalRedirectDestination("https://elsewhere.example"))
    assertTrue(isExternalRedirectDestination(""))
  }
}
