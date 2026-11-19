package com.aglyn.plugins.eventscalendar

import kotlin.test.Test
import kotlin.test.assertEquals

/** The Events page's Import and Export: the hub's import on this site's events, and an export of every event. */
class EventsTransferTest {
  @Test
  fun importOpensTheHubImportOnThisSitesEvents() {
    assertEquals("core.settings.data.import", CORE_DATA_IMPORT_SCREEN)
    assertEquals(mapOf("resource" to "events", "hostId" to "h1"), eventsImportParams("h1"))
    assertEquals(mapOf("resource" to "events"), eventsImportParams(null))
  }

  @Test
  fun exportCoversEveryEventOfTheSite() {
    assertEquals("events", EVENTS_TRANSFER_RESOURCE)
    assertEquals("Export Events", EVENTS_EXPORT_TITLE)
    assertEquals(mapOf<String, Any?>("kind" to "all"), EVENTS_EXPORT_SCOPE)
  }
}
