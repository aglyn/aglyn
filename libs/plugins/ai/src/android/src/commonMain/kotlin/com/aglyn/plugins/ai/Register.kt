package com.aglyn.plugins.ai

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The AI plugin's native registration: its spec screens (jobs, credits,
 * per-member use, and the staffOrg and staffUser zones), their links, and
 * the site's "AI jobs" quick action. The ids are the ones plugins.config.json
 * declares under `ai.mobile.contributes`.
 */
fun registerAINative(registrar: NativePluginRegistrar) {
  SpecScreens.register(AiScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
  registrar.quickAction("ai.open", "AI jobs", "auto_awesome", 60, requiresSite = true, screen = "ai.jobs")
}
