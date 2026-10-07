package com.aglyn.contracts

/*
 * The events plugin's one rule for what an event stores (`event-write.ts`),
 * ported once and held to the console's answers by the function cases, so
 * the app's editor stores exactly what the Events page's dialog stores.
 */

/** Why an event cannot be written as given, or null when it can. */
fun eventWriteProblem(title: String, startsAtMs: Long): String? = when {
  title.trim().isEmpty() -> "An event needs a title."
  startsAtMs == 0L -> "An event needs a start time."
  else -> null
}

/** The end an event stores: the one given when it is after the start, else the default duration. */
fun eventEndsAtMs(startsAtMs: Long, endsAtMs: Long?): Long =
  if (endsAtMs != null && endsAtMs > startsAtMs) endsAtMs else startsAtMs + Contracts.eventDefaultDurationMs.toLong()

/** A status as typed, folded to one an event may hold, or null. */
fun eventStatusOf(value: Any?): EventStatus? = when ((value as? String)?.trim()?.lowercase()) {
  "draft" -> EventStatus.DRAFT
  "published" -> EventStatus.PUBLISHED
  else -> null
}

private fun capped(value: String?, max: Long): String = (value ?: "").trim().let { if (it.length > max) it.take(max.toInt()) else it }

/** The stored form of an event; [clearBlank] makes a blank optional field delete the stored one. */
fun eventWrite(input: EventWriteInput, clearBlank: Boolean = false): EventWrite {
  eventWriteProblem(input.title, input.startsAtMs)?.let { throw IllegalArgumentException(it) }
  val remove = mutableListOf<EventRemovableField>()
  fun optional(value: String?, max: Long, field: EventRemovableField): String? {
    val text = capped(value, max)
    if (text.isNotEmpty()) return text
    if (clearBlank) remove += field
    return null
  }
  val location = optional(input.location, Contracts.eventLocationMaxLength, EventRemovableField.LOCATION)
  val organizer = optional(input.organizer, Contracts.eventOrganizerMaxLength, EventRemovableField.ORGANIZER)
  val description = optional(input.description, Contracts.eventDescriptionMaxLength, EventRemovableField.DESCRIPTION)
  val cover = optional(input.coverImage, Long.MAX_VALUE, EventRemovableField.COVER_IMAGE)
  val alt = capped(input.coverImageAlt, Contracts.eventCoverAltMaxLength)
  val keepAlt = cover != null && alt.isNotEmpty()
  if (!keepAlt) remove += EventRemovableField.COVER_IMAGE_ALT
  return EventWrite(
    fields = EventStoredFields(
      coverImage = cover,
      coverImageAlt = if (keepAlt) alt else null,
      description = description,
      endsAtMs = eventEndsAtMs(input.startsAtMs, input.endsAtMs),
      location = location,
      organizer = organizer,
      startsAtMs = input.startsAtMs,
      status = input.status,
      title = capped(input.title, Contracts.eventTitleMaxLength),
    ),
    remove = remove,
  )
}
