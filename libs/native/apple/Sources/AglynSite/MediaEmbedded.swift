// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

// What a file carries inside itself (the console's "Inside the file" in File info, AGL-3331): the camera, exposure,
// date taken, place, rights and the rest, as `POST /api/media/metadata` read them from the bytes, grouped as the console
// groups them, and "Remove location from file", which erases the GPS position from the file itself. The values are the
// machine form every writer agrees on (`media-embedded-fields.ts`); `embeddedFieldDisplay` is the one place they are
// dressed for a person. Editing the other fields stays in the console for now. The Kotlin kit's MediaEmbedded.kt.

/// `MEDIA_EMBEDDED_METADATA_VERSION`: a stored record of another version is read again rather than shown.
public let mediaEmbeddedMetadataVersion = 1

/// The types a reader exists for (`READABLE_TYPES`); a file of any other type has no "Inside the file".
public let mediaEmbeddedReadableTypes: Set<String> = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif", "image/avif",
  "image/svg+xml", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", "video/mp4", "video/quicktime", "video/webm",
]

public func embeddedMetadataReadable(_ contentType: String) -> Bool {
  let bare = contentType.lowercased().split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
  return mediaEmbeddedReadableTypes.contains(bare)
}

/// `MEDIA_EMBEDDED_GROUP_ORDER` with `MEDIA_EMBEDDED_GROUP_LABELS`.
public let mediaEmbeddedGroups: [(id: String, label: String)] = [
  ("description", "Description"), ("rights", "Rights"), ("location", "Location"), ("capture", "Camera"),
  ("document", "Document"), ("technical", "Technical"), ("other", "Other embedded fields"),
]

public struct MediaEmbeddedField: Equatable, Sendable, Identifiable {
  public let key: String
  public let label: String
  public let group: String
  public let value: String?
  public let values: [String]?
  public let editable: Bool
  public var id: String { key }

  public init(key: String, label: String, group: String, value: String? = nil, values: [String]? = nil, editable: Bool = false) {
    self.key = key
    self.label = label
    self.group = group
    self.value = value
    self.values = values
    self.editable = editable
  }

  init?(_ raw: Any?) {
    guard let map = raw as? [String: Any], let key = map["key"] as? String, !key.isEmpty else { return nil }
    self.init(
      key: key, label: map["label"] as? String ?? key, group: map["group"] as? String ?? "other", value: map["value"] as? String,
      values: (map["values"] as? [Any])?.compactMap { $0 as? String }, editable: map["editable"] as? Bool ?? false)
  }
}

/// `embeddedMetadata` on a media document, or the route's answer.
public struct MediaEmbeddedRecord: Equatable, Sendable {
  public let version: Int
  public let format: String?
  public let fields: [MediaEmbeddedField]
  public let writable: Bool
  public let readOnlyReason: String?
  public let truncated: Bool
  public let contentSha256: String?

  public init(
    version: Int = mediaEmbeddedMetadataVersion, format: String?, fields: [MediaEmbeddedField], writable: Bool,
    readOnlyReason: String? = nil, truncated: Bool = false, contentSha256: String? = nil
  ) {
    self.version = version
    self.format = format
    self.fields = fields
    self.writable = writable
    self.readOnlyReason = readOnlyReason
    self.truncated = truncated
    self.contentSha256 = contentSha256
  }

  /// From a Firestore map or a decoded JSON object; nil for anything without a `fields` list.
  public init?(_ raw: Any?) {
    guard let map = raw as? [String: Any], let fields = map["fields"] as? [Any] else { return nil }
    let number = { (value: Any?) in (value as? NSNumber)?.intValue ?? (value as? Int) ?? 0 }
    self.init(
      version: number(map["version"]), format: map["format"] as? String, fields: fields.compactMap(MediaEmbeddedField.init),
      writable: map["writable"] as? Bool ?? false, readOnlyReason: map["readOnlyReason"] as? String,
      truncated: map["truncated"] as? Bool ?? false, contentSha256: map["contentSha256"] as? String)
  }

  /// `embeddedMetadataIsCurrent`: this reader's version, and read from the bytes the document now holds.
  public func isCurrent(contentSha256 documentSha: String?) -> Bool {
    version == mediaEmbeddedMetadataVersion && (documentSha == nil || contentSha256 == documentSha)
  }

  /// The location, when the file carries one.
  public var gps: MediaEmbeddedField? { fields.first { $0.key == "gps" } }

  /// The fields in the console's group order, empty groups left out.
  public var groups: [(label: String, fields: [MediaEmbeddedField])] {
    mediaEmbeddedGroups.compactMap { group in
      let found = fields.filter { $0.group == group.id }
      return found.isEmpty ? nil : (group.label, found)
    }
  }
}

/// A field's value for a person (`embeddedFieldDisplay`): lists joined, dates in the reader's style, the place as
/// degrees, the rating as stars.
public func embeddedFieldDisplay(_ field: MediaEmbeddedField, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
  if let values = field.values { return values.joined(separator: ", ") }
  let value = field.value ?? ""
  switch field.key {
  case "createdAt", "modifiedAt":
    let dateOnly = value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    guard let date = parseEmbeddedDate(value, dateOnly: dateOnly, timeZone: timeZone) else { return value }
    var style = Date.FormatStyle(date: .abbreviated, time: dateOnly ? .omitted : .shortened, locale: locale)
    style.timeZone = timeZone
    return date.formatted(style)
  case "gps":
    let parts = value.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard parts.count == 2, let lat = parts[0], let lon = parts[1], lat.isFinite, lon.isFinite else { return value }
    let part = { (n: Double, positive: String, negative: String) in
      String(format: "%.5f° %@", abs(n), n < 0 ? negative : positive)
    }
    return "\(part(lat, "N", "S")), \(part(lon, "E", "W"))"
  case "rating":
    guard let stars = Int(value) else { return value }
    if stars == -1 { return "Rejected" }
    guard (0...5).contains(stars) else { return value }
    return String(repeating: "★", count: stars) + String(repeating: "☆", count: 5 - stars)
  default:
    return value
  }
}

/// An ISO date as the console's `new Date` reads it: a zone when it has one, local time when it does not, and a
/// date-only value at local noon so it stays on its own day west of Greenwich.
func parseEmbeddedDate(_ value: String, dateOnly: Bool, timeZone: TimeZone) -> Date? {
  let text = dateOnly ? value + "T12:00:00" : value
  let zoned = text.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil
  for format in ["yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX", "yyyy-MM-dd'T'HH:mm:ssXXXXX", "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
    guard format.hasSuffix("XXXXX") == zoned else { continue }
    let parser = DateFormatter()
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.timeZone = timeZone
    parser.dateFormat = format
    if let date = parser.date(from: text) { return date }
  }
  return nil
}

/// What a write into the file answered.
public struct MediaEmbeddedWrite: Equatable, Sendable {
  public let record: MediaEmbeddedRecord?
  /// Nothing in the file needed to change.
  public let unchanged: Bool
}

extension MediaAPI {
  /// Reads the details inside the file; the server keeps what it read, so the next open needs no read.
  public func readEmbedded(_ mediaID: String) async throws -> MediaEmbeddedRecord? {
    let answer = try await api.request("/api/media/metadata", method: .post, body: body(["mediaId": mediaID, "action": "read"]))
    return MediaEmbeddedRecord(answer?["embeddedMetadata"]?.foundation)
  }

  /// Erases the GPS position from the file itself — what every page serves and every download carries. Names the
  /// digest it was shown, so a file replaced meanwhile is a 409 rather than an overwrite.
  public func removeLocation(_ mediaID: String, expectedSha256: String?) async throws -> MediaEmbeddedWrite {
    let answer = try await api.request(
      "/api/media/metadata", method: .post,
      body: body(["mediaId": mediaID, "action": "write", "patch": ["gps": NSNull()], "expectedSha256": expectedSha256]))
    return MediaEmbeddedWrite(
      record: MediaEmbeddedRecord(answer?["embeddedMetadata"]?.foundation), unchanged: answer?["unchanged"]?.boolValue == true)
  }
}

/// "Inside the file": the details the file carries, grouped, with Remove location from file where the file can take it.
struct MediaEmbeddedSection: View {
  let item: MediaItem
  let api: MediaAPI
  let canEdit: Bool
  @State private var read: MediaEmbeddedRecord?
  @State private var loading = false
  @State private var loadError: String?
  @State private var confirmRemove = false
  @State private var saving = false
  @State private var notice: (String, AglynTone)?

  /// The stored record when it still describes these bytes, else what this sheet read.
  private var record: MediaEmbeddedRecord? {
    if let stored = item.embedded, stored.isCurrent(contentSha256: item.contentSha256) { return stored }
    return read
  }

  var body: some View {
    if embeddedMetadataReadable(item.contentType) {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        Text("Inside the file").font(AglynFont.caption).foregroundStyle(.secondary)
        if let record {
          recordView(record)
        } else if loading {
          Text("Reading the details inside the file…").font(AglynFont.caption).foregroundStyle(.secondary)
          ProgressView().progressViewStyle(.linear)
        } else if let loadError {
          Text(loadError).font(AglynFont.caption).foregroundStyle(AglynColor.error)
        } else if !canEdit {
          Text("The details inside this file have not been read yet.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if let notice { AglynNotice(notice.0, tone: notice.1) }
      }
      .accessibilityIdentifier("media-embedded")
      .task(id: "\(item.id):\(item.contentSha256 ?? "")") { await readIfNeeded() }
      .confirmationDialog("Remove the location from this file?", isPresented: $confirmRemove, titleVisibility: .visible) {
        Button("Remove location", role: .destructive) { Task { await removeLocation() } }
      } message: {
        Text(
          "The GPS position is erased from the file itself, so pages that show it and anyone who downloads it no longer "
            + "get it. It cannot be put back afterwards.")
      }
    }
  }

  @ViewBuilder
  private func recordView(_ record: MediaEmbeddedRecord) -> some View {
    if record.fields.isEmpty {
      Text("This file carries no details of its own.").font(AglynFont.subheadline).foregroundStyle(.secondary)
    }
    ForEach(record.groups, id: \.label) { group in
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Text(group.label.uppercased()).font(AglynFont.caption).foregroundStyle(.secondary)
        ForEach(group.fields) { field in
          HStack(alignment: .firstTextBaseline, spacing: AglynSpace.three) {
            Text(field.label).font(AglynFont.caption).foregroundStyle(.secondary).frame(width: 104, alignment: .leading)
            Text(embeddedFieldDisplay(field)).font(AglynFont.subheadline).textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
    if let gps = record.gps, gps.editable, canEdit {
      Button(saving ? "Removing…" : "Remove location from file", role: .destructive) { confirmRemove = true }
        .buttonStyle(.aglynSecondary)
        .disabled(saving)
        .accessibilityIdentifier("media-remove-location")
    }
    if let reason = record.readOnlyReason {
      Text(reason).font(AglynFont.caption).foregroundStyle(.secondary)
    }
    if record.truncated {
      Text("Some long values are shortened here and cannot be edited from this panel.")
        .font(AglynFont.caption).foregroundStyle(.secondary)
    }
  }

  /// The backfill, as the console's drawer does it: a file with no current record is read the first time it is
  /// opened, by someone who may write to the library (the read stores what it found).
  private func readIfNeeded() async {
    guard record == nil, canEdit, !loading else { return }
    loading = true
    loadError = nil
    defer { loading = false }
    do {
      read = try await api.readEmbedded(item.id)
      if read == nil { read = MediaEmbeddedRecord(format: nil, fields: [], writable: false) }
    } catch {
      loadError = (error as? LocalizedError)?.errorDescription ?? "Reading the file failed"
    }
  }

  private func removeLocation() async {
    saving = true
    notice = nil
    defer { saving = false }
    do {
      let answer = try await api.removeLocation(item.id, expectedSha256: item.contentSha256)
      if let record = answer.record { read = record }
      notice = answer.unchanged ? ("Nothing in the file needed to change", .info) : ("Saved into the file", .success)
    } catch {
      notice = ((error as? LocalizedError)?.errorDescription ?? "Saving into the file failed", .error)
    }
  }
}
