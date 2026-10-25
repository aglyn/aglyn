package com.aglyn.plugins.ai

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The AI plugin's native registration: its spec screens (jobs, credits,
 * per-member use, and the staffOrg and staffUser zones), their links, the
 * site's "AI jobs" quick action, what it adds to the site's setup pages, and Create with AI beside the create action of
 * Pages, Templates, Layouts, Forms and Components. The ids are the ones plugins.config.json declares under
 * `ai.mobile.contributes`.
 */
fun registerAINative(registrar: NativePluginRegistrar) {
  SpecScreens.register(AiScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
  registrar.quickAction("ai.open", "AI jobs", "auto_awesome", 60, requiresSite = true, screen = "ai.jobs")
  // Setup → Business profile draws this in the console's `hostBusinessProfile` slot.
  // Setup → SEO draws this in the console's `hostSeo` slot, under the SEO check.
  registrar.widget("ai.seo-audit", title = "SEO fixes", order = 80, size = WidgetSize.FULL, requiresSite = true, slot = "hostSeo") { context ->
    AiSeoAuditCard(context)
  }
  registrar.widget("ai.seo-start", title = "The listing your answers describe", order = 90, size = WidgetSize.FULL, requiresSite = true, slot = "hostSeo") { context ->
    AiSiteSeoStartCard(context)
  }
  registrar.widget("ai.site-memory", title = "What Aglyn AI learned", order = 100, size = WidgetSize.FULL, requiresSite = true, slot = "hostBusinessProfile") { context ->
    AiSiteMemoryCard(context)
  }
  // Create with AI: the brief and the job it starts, and the entry in each list's create zone (the console's
  // `hostScreens`, `hostTemplates`, `hostLayouts`, `hostForms` and `hostComponents` widgets).
  registrar.screen(AI_CREATE_SCREEN, "Create with AI", requiresSite = true, icon = "auto_awesome") { context, params ->
    AiCreateScreen(context, AiCreateKind.of(params["kind"]), params["jobId"], params["brief"])
  }
  // Home's "Needs you" line, and the AI panel the shell docks beside every screen (a sheet on phones).
  registrar.widget("ai.needs-you", title = "Needs you", order = 40, requiresSite = true, slot = "homeNeedsYou") { context -> AiNeedsYouWidget(context) }
  registrar.widget("ai.assist-panel", title = "Assist", order = 10, slot = ASSIST_PANEL_SLOT) { context -> AssistPanel(context) }
  // "Ask AI about these numbers" (the console's `hostDashboard` and `orgDashboard` tiles): on a site's Home and Analytics,
  // and on the workspace's Home; on a plan without the AI add-on the same tile opens the add-on's offer.
  registrar.widget("ai.insight-ask", title = "Ask AI about these numbers", order = 900, size = WidgetSize.HALF, requiresSite = true) { context ->
    AiInsightTile(context, AiInsightSurface.ANALYTICS)
  }
  registrar.widget("ai.org-insight-ask", title = "Ask AI about these numbers", order = 900, size = WidgetSize.HALF, slot = "orgDashboard") { context ->
    AiInsightTile(context, AiInsightSurface.WORKSPACE)
  }
  AiCreateKind.entries.forEach { kind ->
    registrar.widget(kind.widgetId, title = "Create with AI", order = 10, requiresSite = true, slot = kind.slot) { context ->
      AiCreateButton(context, kind)
    }
  }
}
