// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The events plugin's one rule for what an event stores (event-write.ts),
// ported once and held to the console's answers by the function cases.

/// Why an event cannot be written as given, or nil when it can.
public func eventWriteProblem(title: String, startsAtMs: Int) -> String? {
  if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "An event needs a title." }
  if startsAtMs == 0 { return "An event needs a start time." }
  return nil
}

/// The end an event stores: the one given when it is after the start, else the default duration.
public func eventEndsAtMs(startsAtMs: Int, endsAtMs: Int?) -> Int {
  if let endsAtMs, endsAtMs > startsAtMs { return endsAtMs }
  return startsAtMs + Int(ContractValues.shared.eventDefaultDurationMs)
}

/// A status as typed, folded to one an event may hold, or nil.
public func eventStatusOf(_ value: Any?) -> EventStatus? {
  switch (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
  case "draft": .draft
  case "published": .published
  default: nil
  }
}

private func capped(_ value: String?, _ max: Int) -> String {
  let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.utf16.count > max ? String(trimmed.utf16.prefix(max)) ?? trimmed : trimmed
}

/// The stored form of an event; `clearBlank` makes a blank optional field delete the stored one.
public func eventWrite(_ input: EventWriteInput, clearBlank: Bool = false) -> EventWrite? {
  if eventWriteProblem(title: input.title, startsAtMs: input.startsAtMs) != nil { return nil }
  let values = ContractValues.shared
  var remove: [EventRemovableField] = []
  func optional(_ value: String?, _ max: Int, _ field: EventRemovableField) -> String? {
    let text = capped(value, max)
    if !text.isEmpty { return text }
    if clearBlank { remove.append(field) }
    return nil
  }
  let location = optional(input.location, values.eventLocationMaxLength, .location)
  let organizer = optional(input.organizer, values.eventOrganizerMaxLength, .organizer)
  let description = optional(input.description, values.eventDescriptionMaxLength, .description)
  let cover = optional(input.coverImage, Int.max, .coverImage)
  let alt = capped(input.coverImageAlt, values.eventCoverAltMaxLength)
  let keepAlt = cover != nil && !alt.isEmpty
  if !keepAlt { remove.append(.coverImageAlt) }
  return EventWrite(
    fields: EventStoredFields(
      coverImage: cover, coverImageAlt: keepAlt ? alt : nil, description: description,
      endsAtMs: eventEndsAtMs(startsAtMs: input.startsAtMs, endsAtMs: input.endsAtMs), location: location,
      organizer: organizer, startsAtMs: input.startsAtMs, status: input.status,
      title: capped(input.title, values.eventTitleMaxLength)),
    remove: remove)
}
