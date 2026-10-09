package com.aglyn.plugins.ai

import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class AiNativeTest {
  private val declared = mapOf(
    "screens" to listOf("ai.jobs", "ai.job", "ai.credits", "ai.member", "ai.staffOrg", "ai.staffUser", "ai.signals"),
    "quickActions" to listOf("ai.open"),
    "deepLinks" to listOf("ai.jobs.link", "ai.job.link", "ai.signals.link"),
  )

  @Test
  fun registersExactlyWhatItDeclaresAndItsLinksResolve() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("ai", declared, ::registerAINative)))
    assertEquals(emptyList(), result.failed)
    val target = DeepLinks.resolve("/acme/hosts/shop/ai-jobs/j1", registry.deepLinks())
    assertIs<NativeLinkTarget.Screen>(target)
    assertEquals("ai.job", target.screen)
    assertEquals("j1", target.params["jobId"])
  }
}
