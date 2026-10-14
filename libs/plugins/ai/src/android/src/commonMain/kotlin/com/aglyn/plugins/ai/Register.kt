package com.aglyn.plugins.ai

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The AI plugin's native registration: its spec screens (jobs, credits,
 * per-member use, and the staffOrg and staffUser zones), their links, the
 * site's "AI jobs" quick action and what it adds to the site's setup pages. The ids are the ones plugins.config.json
 * declares under `ai.mobile.contributes`.
 */
fun registerAINative(registrar: NativePluginRegistrar) {
  SpecScreens.register(AiScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
  registrar.quickAction("ai.open", "AI jobs", "auto_awesome", 60, requiresSite = true, screen = "ai.jobs")
  // Setup → Business profile draws this in the console's `hostBusinessProfile` slot.
  // Setup → SEO draws this in the console's `hostSeo` slot, under the SEO check.
  registrar.widget("ai.seo-start", title = "The listing your answers describe", order = 90, size = WidgetSize.FULL, requiresSite = true, slot = "hostSeo") { context ->
    AiSiteSeoStartCard(context)
  }
  registrar.widget("ai.site-memory", title = "What Aglyn AI learned", order = 100, size = WidgetSize.FULL, requiresSite = true, slot = "hostBusinessProfile") { context ->
    AiSiteMemoryCard(context)
  }
}
