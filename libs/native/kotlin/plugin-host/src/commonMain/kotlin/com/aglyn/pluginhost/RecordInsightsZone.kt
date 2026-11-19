package com.aglyn.pluginhost

import androidx.compose.runtime.staticCompositionLocalOf

/** The zone a CRM record's page hosts for what other plugins read about the record (the console's `recordInsights`). */
const val RECORD_INSIGHTS_ZONE = "recordInsights"

/** A task a widget proposes for the record (the console's `ConsoleProposedTask`); the record's own task editor opens with it. */
data class ProposedTask(
  val title: String,
  val notes: String,
  /** `call`, `email`, `meeting` or `todo`. */
  val kind: String,
  /** `low`, `normal` or `high`. */
  val priority: String,
  val dueInDays: Int,
)

/** One of an open deal's stages, as the record page names them. */
data class RecordStage(val id: String, val name: String)

/**
 * What a CRM record's page hands the widgets in its `recordInsights` zone (the console's `ConsoleRecordInsightsZoneProps`):
 * which record it is, and the writes the page makes for them, each only where the page can make it. Nothing a widget
 * proposes is saved until the person saves it in the page's own editor.
 */
class RecordInsightsZone(
  val hostId: String?,
  val orgId: String?,
  /** `contact`, `company`, `deal` or `lead`. */
  val recordKind: String,
  val recordId: String,
  val name: String,
  /** An open deal's stages and the one it is in; null on any other record. */
  val stages: List<RecordStage>? = null,
  val stageId: String? = null,
  /** Opens the record's task editor filled with the task (null where the record has no tasks, a lead's); the key is the job's. */
  val proposeTask: ((task: ProposedTask, key: String) -> Unit)? = null,
  /** Asks to move an open deal to a stage, as its stage card does (null on any other record). */
  val proposeStage: ((stageId: String, key: String) -> Unit)? = null,
)

/** A CRM record page's zone, while one of its widgets is drawn; null anywhere else. */
val LocalRecordInsightsZone = staticCompositionLocalOf<RecordInsightsZone?> { null }
