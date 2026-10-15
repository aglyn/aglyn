// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The import's Upload step apart from its drawing (the Kotlin kit's `TransferUploadDraft` holds the same): a file or pasted
 * rows, read here to show how they read (format, encoding, separator and header row guessed, shown and changeable), and
 * refused before anything is sent when the file is larger, or longer, than the import takes.
 */

/// What an import takes: the console's `resource.limits` and `resource.formats`.
public struct TransferUploadLimits: Equatable, Sendable {
  /// The most bytes a file may carry: the resource's `limits.maxBytes`, else the console's CSV upload ceiling.
  public var maxBytes: Int
  public var maxRows: Int?
  public var formats: [TransferFormat]

  /// The ceiling a resource without its own `limits.maxBytes` gets in the console (`CSV_UPLOAD_MAX_CHARACTERS`).
  public static let defaultMaxBytes = 8_000_000

  public init(maxBytes: Int = Self.defaultMaxBytes, maxRows: Int? = nil, formats: [TransferFormat] = [.csv]) {
    self.maxBytes = maxBytes
    self.maxRows = maxRows
    self.formats = formats.isEmpty ? [.csv] : formats
  }
}

public struct TransferUploadDraft: Equatable, Sendable {
  public let fileName: String
  /// The size of the file as chosen, in bytes (the pasted text's, for rows pasted).
  public let bytes: Int
  /// The file's bytes, kept so a different encoding can be tried; nil for pasted rows.
  public let raw: Data?
  public private(set) var text: String
  public private(set) var settings: TransferFileSettings
  /// The file was larger than the import takes, so it was not read.
  public let unread: Bool
  public private(set) var parsed: TransferParsedFile?

  /// The name rows pasted are given.
  public static let pastedName = "Pasted rows"

  private init(fileName: String, bytes: Int, raw: Data?, text: String, settings: TransferFileSettings, unread: Bool) {
    self.fileName = fileName
    self.bytes = bytes
    self.raw = raw
    self.text = text
    self.settings = settings
    self.unread = unread
    self.parsed = unread ? nil : TransferFileReader.parse(text, settings)
  }

  /// A chosen file: refused unread when it is larger than `maxBytes`, else decoded under the encoding its bytes suggest, with
  /// the format, separator and header row guessed.
  public static func file(name: String, data: Data, maxBytes: Int) -> TransferUploadDraft {
    guard data.count <= maxBytes else {
      return TransferUploadDraft(fileName: name, bytes: data.count, raw: nil, text: "", settings: TransferFileSettings(format: .csv), unread: true)
    }
    let encoding = TransferFileReader.detectEncoding(data)
    let text = TransferFileReader.decode(data, as: encoding)
    return TransferUploadDraft(
      fileName: name, bytes: data.count, raw: data, text: text,
      settings: TransferFileReader.detectSettings(fileName: name, text: text, encoding: encoding), unread: false)
  }

  /// Rows pasted in.
  public static func pasted(_ text: String) -> TransferUploadDraft {
    TransferUploadDraft(
      fileName: pastedName, bytes: text.utf8.count, raw: nil, text: text,
      settings: TransferFileReader.detectSettings(fileName: "", text: text), unread: false)
  }

  /// The same file read in another format.
  public func changing(format: TransferFormat) -> TransferUploadDraft { with { $0.format = format } }

  /// The same file read under another separator.
  public func changing(delimiter: String) -> TransferUploadDraft { with { $0.delimiter = delimiter } }

  /// The same file with its first row naming the columns, or not.
  public func changing(headerRow: Bool) -> TransferUploadDraft { with { $0.headerRow = headerRow } }

  /// The same bytes decoded under another encoding (a file's bytes only).
  public func changing(encoding: TransferEncoding) -> TransferUploadDraft {
    guard let raw else { return self }
    return TransferUploadDraft(
      fileName: fileName, bytes: bytes, raw: raw, text: TransferFileReader.decode(raw, as: encoding),
      settings: { var changed = settings; changed.encoding = encoding; return changed }(), unread: false)
  }

  private func with(_ change: (inout TransferFileSettings) -> Void) -> TransferUploadDraft {
    guard !unread else { return self }
    var changed = settings
    change(&changed)
    return TransferUploadDraft(fileName: fileName, bytes: bytes, raw: raw, text: text, settings: changed, unread: false)
  }

  private static func count(_ n: Int, _ noun: String) -> String { "\(n.formatted()) \(n == 1 ? noun : noun + "s")" }

  /// `name · size`, and how many rows and columns it reads as.
  public var summary: String {
    var line = "\(fileName) · \(TransferFileReader.formatBytes(bytes))"
    if let parsed, parsed.error == nil {
      line += " · \(Self.count(parsed.rows.count, "row")), \(Self.count(parsed.headers.count, "column"))"
    }
    return line
  }

  /// What stops this file being uploaded, in the console's words (empty when nothing does).
  public func blockers(_ limits: TransferUploadLimits) -> [String] {
    var out: [String] = []
    if bytes > limits.maxBytes {
      out.append("This file is \(TransferFileReader.formatBytes(bytes)); this import takes at most \(TransferFileReader.formatBytes(limits.maxBytes)).")
    }
    if let parsed, let maxRows = limits.maxRows, parsed.rows.count > maxRows {
      out.append(
        "This file has \(Self.count(parsed.rows.count, "row")); this import takes at most \(maxRows.formatted()). Split it and import the rest separately.")
    }
    if let error = parsed?.error { out.append(error) }
    if let parsed, parsed.error == nil, bytes <= limits.maxBytes, parsed.rows.isEmpty { out.append("This file has no rows to import.") }
    if !unread, !limits.formats.contains(settings.format) {
      out.append("This import does not take \(Self.formatName(settings.format)).")
    }
    return out
  }

  /// The words the console uses for a format in its refusals and picker.
  public static func formatName(_ format: TransferFormat) -> String {
    switch format {
    case .csv: "CSV"
    case .json: "JSON"
    case .ndjson: "NDJSON"
    }
  }

  /// What the upload sends once nothing blocks it; nil until then. A CSV also says its separator and whether the first row names
  /// the columns.
  public func value(_ limits: TransferUploadLimits) -> JSONValue? {
    guard !unread, parsed != nil, blockers(limits).isEmpty else { return nil }
    var value: [String: JSONValue] = [
      "fileName": .string(fileName), "text": .string(text), "bytes": .number(Double(bytes)), "format": .string(settings.format.wire),
    ]
    if settings.format == .csv {
      value["delimiter"] = .string(settings.delimiter)
      value["headerRow"] = .bool(settings.headerRow)
    }
    return .object(value)
  }
}
