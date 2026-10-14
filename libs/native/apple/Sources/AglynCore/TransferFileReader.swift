// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * Reading a file the way the console's Upload step does, enough of it to show the person how it reads: the port of
 * `libs/aglyn-transfer-ui/src/lib/transfer-file.ts` (`detectEncoding`, `decodeBytes`, `detectFormat`, `detectDelimiter`,
 * `parseDelimited`, `detectHeaderRow`, `parseTransferText`, `detectTransferFileSettings`, `formatBytes`), replayed from
 * `libs/native/contracts/transfer-file-cases.json` (the Kotlin kit holds the same port). Every guess is shown and can be
 * changed; the server reads the file again under the settings the person confirmed.
 */

public enum TransferEncoding: String, CaseIterable, Identifiable, Sendable {
  case utf8 = "utf-8"
  case utf16le = "utf-16le"
  case utf16be = "utf-16be"
  case windows1252 = "windows-1252"

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .utf8: "UTF-8"
    case .utf16le: "UTF-16 (little-endian)"
    case .utf16be: "UTF-16 (big-endian)"
    case .windows1252: "Western (Windows-1252)"
    }
  }
}

/// The cell separators a CSV may use, with the words the console's picker has for each.
public let transferDelimiters: [(value: String, label: String)] = [
  (",", "Comma"), (";", "Semicolon"), ("\t", "Tab"), ("|", "Vertical bar"),
]

/// How a file reads: the person confirms these.
public struct TransferFileSettings: Equatable, Sendable {
  public var format: TransferFormat
  public var encoding: TransferEncoding
  /// The cell separator of a CSV.
  public var delimiter: String
  /// The first row of a CSV names the columns.
  public var headerRow: Bool

  public init(format: TransferFormat, encoding: TransferEncoding = .utf8, delimiter: String = ",", headerRow: Bool = true) {
    self.format = format
    self.encoding = encoding
    self.delimiter = delimiter
    self.headerRow = headerRow
  }
}

/// A file read under settings: its column names and rows.
public struct TransferParsedFile: Equatable, Sendable {
  public var headers: [String]
  public var rows: [[JSONValue]]
  /// The first rows as the preview shows them, a cell as one line of text.
  public var shown: [[String]]
  /// Why the file could not be read under these settings.
  public var error: String?

  public init(headers: [String] = [], rows: [[JSONValue]] = [], shown: [[String]] = [], error: String? = nil) {
    self.headers = headers
    self.rows = rows
    self.shown = shown
    self.error = error
  }
}

public enum TransferFileReader {
  /// The rows the preview shows.
  public static let previewRows = 5

  // MARK: Encoding

  /// The encoding a byte-order mark names, or a strict UTF-8 read, or Windows-1252.
  public static func detectEncoding(_ bytes: Data) -> TransferEncoding {
    let head = [UInt8](bytes.prefix(3))
    if head.starts(with: [0xEF, 0xBB, 0xBF]) { return .utf8 }
    if head.starts(with: [0xFF, 0xFE]) { return .utf16le }
    if head.starts(with: [0xFE, 0xFF]) { return .utf16be }
    return String(data: bytes, encoding: .utf8) != nil ? .utf8 : .windows1252
  }

  /// The bytes as text in `encoding`, with any byte-order mark dropped. A byte that is not valid in the encoding is read as
  /// the replacement character, as a browser's decoder does.
  public static func decode(_ bytes: Data, as encoding: TransferEncoding) -> String {
    var text: String
    switch encoding {
    case .utf8: text = String(decoding: bytes, as: UTF8.self)
    case .utf16le: text = String(data: bytes, encoding: .utf16LittleEndian) ?? String(decoding: bytes, as: UTF8.self)
    case .utf16be: text = String(data: bytes, encoding: .utf16BigEndian) ?? String(decoding: bytes, as: UTF8.self)
    case .windows1252: text = String(data: bytes, encoding: .windowsCP1252) ?? String(data: bytes, encoding: .isoLatin1) ?? ""
    }
    if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
    return text
  }

  // MARK: Format and layout

  private static func trimmed(_ text: String) -> String {
    text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}")))
  }

  /// `text.split(/\r?\n/)`: a line ends at a line feed, and a carriage return just before it goes with it.
  private static func lines(_ text: String) -> [String] {
    var out: [String] = []
    var current = String.UnicodeScalarView()
    for scalar in text.unicodeScalars {
      if scalar == "\n" {
        if current.last == "\r" { current.removeLast() }
        out.append(String(current))
        current = String.UnicodeScalarView()
      } else {
        current.append(scalar)
      }
    }
    out.append(String(current))
    return out
  }

  /// The format a file name or its text says it is.
  public static func detectFormat(fileName: String, text: String) -> TransferFormat {
    let name = fileName.lowercased()
    if name.hasSuffix(".ndjson") || name.hasSuffix(".jsonl") { return .ndjson }
    if name.hasSuffix(".json") { return .json }
    var start = Substring(text)
    while let first = start.unicodeScalars.first, first.properties.isWhitespace || first == "\u{FEFF}" { start = start.dropFirst() }
    if start.hasPrefix("[") { return .json }
    if start.hasPrefix("{") {
      let filled = lines(String(start)).filter { !trimmed($0).isEmpty }
      return filled.count > 1 && filled.allSatisfy({ trimmed($0).hasPrefix("{") }) ? .ndjson : .json
    }
    return .csv
  }

  /// Separators counted per line, outside quotes, over the first lines.
  private static func separatorCounts(_ text: String, _ delimiter: Unicode.Scalar, lines limit: Int = 10) -> [Int] {
    var counts: [Int] = []
    var count = 0
    var quoted = false
    for char in text.unicodeScalars {
      if counts.count >= limit { break }
      if char == "\"" {
        quoted.toggle()
      } else if !quoted && char == delimiter {
        count += 1
      } else if !quoted && char == "\n" {
        counts.append(count)
        count = 0
      }
    }
    if counts.count < limit && count > 0 { counts.append(count) }
    return counts
  }

  /// The separator the lines agree on: the one found on every sampled line the same number of times, the most of them; else
  /// the most frequent; else a comma.
  public static func detectDelimiter(_ text: String) -> String {
    var best = (delimiter: ",", score: 0)
    for entry in transferDelimiters {
      guard let scalar = entry.value.unicodeScalars.first else { continue }
      let counts = separatorCounts(text, scalar)
      guard let first = counts.first, first != 0 else { continue }
      let steady = counts.allSatisfy { $0 == first }
      let score = (steady ? 1000 : 0) + first
      if score > best.score { best = (entry.value, score) }
    }
    return best.delimiter
  }

  /// Delimited text as rows of cells (quotes, doubled quotes and line breaks inside quotes).
  public static func parseDelimited(_ text: String, delimiter: String = ",") -> [[String]] {
    let separator = delimiter.unicodeScalars.first ?? ","
    let chars = Array(text.unicodeScalars)
    var rows: [[String]] = []
    var row: [String] = []
    var cell = String.UnicodeScalarView()
    var quoted = false
    var at = 0
    while at < chars.count {
      let char = chars[at]
      if quoted {
        if char == "\"" && at + 1 < chars.count && chars[at + 1] == "\"" {
          cell.append("\"")
          at += 1
        } else if char == "\"" {
          quoted = false
        } else {
          cell.append(char)
        }
        at += 1
        continue
      }
      if char == "\"" && cell.isEmpty {
        quoted = true
      } else if char == separator {
        row.append(String(cell))
        cell = String.UnicodeScalarView()
      } else if char == "\n" || char == "\r" {
        if char == "\r" && at + 1 < chars.count && chars[at + 1] == "\n" { at += 1 }
        row.append(String(cell))
        rows.append(row)
        row = []
        cell = String.UnicodeScalarView()
      } else {
        cell.append(char)
      }
      at += 1
    }
    if !cell.isEmpty || !row.isEmpty {
      row.append(String(cell))
      rows.append(row)
    }
    return rows.filter { cells in cells.contains { !trimmed($0).isEmpty } }
  }

  private static let dataLike = try! NSRegularExpression(
    pattern: #"^[-+]?[0-9.,\s$€£%]+$|@|^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{1,4}$|^(?:true|false)$"#, options: [.caseInsensitive])

  /// Whether the first line names the columns: every cell filled, no two alike, none that looks like data (a number, an
  /// email, a date) while a later line has data in that column.
  public static func detectHeaderRow(_ rows: [[String]]) -> Bool {
    guard let first = rows.first, !first.isEmpty else { return false }
    let cells = first.map(trimmed)
    if cells.contains(where: \.isEmpty) { return false }
    if Set(cells.map { $0.lowercased() }).count != cells.count { return false }
    return !cells.contains { cell in
      dataLike.firstMatch(in: cell, options: [], range: NSRange(cell.startIndex..., in: cell)) != nil
    }
  }

  // MARK: Records

  /// A JSON value that keeps the order its object keys came in, which a dictionary cannot.
  private indirect enum Ordered {
    case object([(key: String, value: Ordered)])
    case array([Ordered])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    var json: JSONValue {
      switch self {
      case .object(let pairs): .object(Dictionary(pairs.map { ($0.key, $0.value.json) }, uniquingKeysWith: { _, last in last }))
      case .array(let items): .array(items.map(\.json))
      case .string(let text): .string(text)
      case .number(let number): .number(number)
      case .bool(let flag): .bool(flag)
      case .null: .null
      }
    }

    /// `JSON.stringify`, keys in the order they came.
    var compact: String {
      switch self {
      case .object(let pairs): "{" + pairs.map { "\(TransferFileReader.quote($0.key)):\($0.value.compact)" }.joined(separator: ",") + "}"
      case .array(let items): "[" + items.map(\.compact).joined(separator: ",") + "]"
      case .string(let text): TransferFileReader.quote(text)
      case .number(let number): TransferFileReader.number(number)
      case .bool(let flag): flag ? "true" : "false"
      case .null: "null"
      }
    }
  }

  fileprivate static func quote(_ text: String) -> String {
    var out = "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      default:
        if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
      }
    }
    return out + "\""
  }

  fileprivate static func number(_ value: Double) -> String {
    value == value.rounded() && abs(value) < 1e15 ? String(Int64(value)) : String(value)
  }

  private struct JSONFailure: Error {}

  /// A minimal JSON reader that keeps key order and refuses what `JSON.parse` refuses.
  private struct Reader {
    let chars: [Unicode.Scalar]
    var at = 0

    init(_ text: String) { chars = Array(text.unicodeScalars) }

    mutating func skip() {
      while at < chars.count, chars[at] == " " || chars[at] == "\t" || chars[at] == "\n" || chars[at] == "\r" { at += 1 }
    }

    mutating func document() throws -> Ordered {
      skip()
      let document = try value()
      skip()
      guard at == chars.count else { throw JSONFailure() }
      return document
    }

    mutating func value() throws -> Ordered {
      skip()
      guard at < chars.count else { throw JSONFailure() }
      switch chars[at] {
      case "{":
        at += 1
        var pairs: [(key: String, value: Ordered)] = []
        skip()
        if at < chars.count, chars[at] == "}" { at += 1; return .object([]) }
        while true {
          skip()
          let key = try string()
          skip()
          guard at < chars.count, chars[at] == ":" else { throw JSONFailure() }
          at += 1
          let member = try value()
          if let seen = pairs.firstIndex(where: { $0.key == key }) { pairs[seen].value = member } else { pairs.append((key, member)) }
          skip()
          guard at < chars.count else { throw JSONFailure() }
          if chars[at] == "," { at += 1; continue }
          if chars[at] == "}" { at += 1; return .object(pairs) }
          throw JSONFailure()
        }
      case "[":
        at += 1
        var items: [Ordered] = []
        skip()
        if at < chars.count, chars[at] == "]" { at += 1; return .array([]) }
        while true {
          items.append(try value())
          skip()
          guard at < chars.count else { throw JSONFailure() }
          if chars[at] == "," { at += 1; continue }
          if chars[at] == "]" { at += 1; return .array(items) }
          throw JSONFailure()
        }
      case "\"": return .string(try string())
      case "t": try literal("true"); return .bool(true)
      case "f": try literal("false"); return .bool(false)
      case "n": try literal("null"); return .null
      default: return .number(try number())
      }
    }

    mutating func literal(_ word: String) throws {
      for scalar in word.unicodeScalars {
        guard at < chars.count, chars[at] == scalar else { throw JSONFailure() }
        at += 1
      }
    }

    private func isDigit(_ index: Int) -> Bool { index < chars.count && chars[index].value >= 48 && chars[index].value <= 57 }

    mutating func number() throws -> Double {
      let start = at
      if at < chars.count, chars[at] == "-" { at += 1 }
      guard isDigit(at) else { throw JSONFailure() }
      if chars[at] == "0" { at += 1 } else { while isDigit(at) { at += 1 } }
      if at < chars.count, chars[at] == "." {
        at += 1
        guard isDigit(at) else { throw JSONFailure() }
        while isDigit(at) { at += 1 }
      }
      if at < chars.count, chars[at] == "e" || chars[at] == "E" {
        at += 1
        if at < chars.count, chars[at] == "+" || chars[at] == "-" { at += 1 }
        guard isDigit(at) else { throw JSONFailure() }
        while isDigit(at) { at += 1 }
      }
      var text = String.UnicodeScalarView()
      text.append(contentsOf: chars[start..<at])
      guard let value = Double(String(text)) else { throw JSONFailure() }
      return value
    }

    mutating func string() throws -> String {
      guard at < chars.count, chars[at] == "\"" else { throw JSONFailure() }
      at += 1
      var units: [UInt16] = []
      while at < chars.count {
        let char = chars[at]
        at += 1
        if char == "\"" { return String(decoding: units, as: UTF16.self) }
        if char.value < 0x20 { throw JSONFailure() }
        guard char == "\\" else {
          units.append(contentsOf: String(Character(char)).utf16)
          continue
        }
        guard at < chars.count else { throw JSONFailure() }
        let escaped = chars[at]
        at += 1
        switch escaped {
        case "\"", "\\", "/": units.append(UInt16(escaped.value))
        case "b": units.append(0x08)
        case "f": units.append(0x0C)
        case "n": units.append(0x0A)
        case "r": units.append(0x0D)
        case "t": units.append(0x09)
        case "u":
          guard at + 4 <= chars.count else { throw JSONFailure() }
          var code: UInt16 = 0
          for _ in 0..<4 {
            guard let digit = Character(chars[at]).hexDigitValue else { throw JSONFailure() }
            code = code &* 16 &+ UInt16(digit)
            at += 1
          }
          units.append(code)
        default: throw JSONFailure()
        }
      }
      throw JSONFailure()
    }
  }

  /// A cell as one line of text (the console's `displayTransferValue`).
  private static func display(_ value: Ordered) -> String {
    switch value {
    case .null: return "—"
    case .string(let text): return text.isEmpty ? "—" : text
    case .array(let items): return items.isEmpty ? "—" : items.map(display).joined(separator: ", ")
    case .bool(let flag): return flag ? "Yes" : "No"
    case .number(let number): return TransferFileReader.number(number)
    case .object: return value.compact
    }
  }

  private static func records(_ text: String, _ format: TransferFormat) throws -> (headers: [String], objects: [[(key: String, value: Ordered)]]) {
    var all: [Ordered] = []
    if format == .ndjson {
      for line in lines(text) where !trimmed(line).isEmpty {
        var reader = Reader(line)
        all.append(try reader.document())
      }
    } else {
      var reader = Reader(text)
      let parsed = try reader.document()
      if case .array(let items) = parsed { all = items } else { all = [parsed] }
    }
    var headers: [String] = []
    var objects: [[(key: String, value: Ordered)]] = []
    for record in all {
      guard case .object(let pairs) = record else { continue }
      objects.append(pairs)
      for pair in pairs where !headers.contains(pair.key) { headers.append(pair.key) }
    }
    return (headers, objects)
  }

  /// The text under the settings, as headers and rows.
  public static func parse(_ text: String, _ settings: TransferFileSettings) -> TransferParsedFile {
    if settings.format == .json || settings.format == .ndjson {
      guard let read = try? records(text, settings.format) else {
        return TransferParsedFile(error: "This is not valid \(settings.format == .json ? "JSON" : "NDJSON").")
      }
      let cells = read.objects.map { pairs in
        read.headers.map { header in pairs.first { $0.key == header }?.value ?? Ordered.string("") }
      }
      return TransferParsedFile(
        headers: read.headers,
        rows: cells.map { row in
          row.map { (cell: Ordered) -> JSONValue in
            if case .null = cell { return .string("") }
            return cell.json
          }
        },
        shown: cells.prefix(previewRows).map { $0.map(display) })
    }
    let parsed = parseDelimited(text, delimiter: settings.delimiter)
    let width = parsed.map(\.count).max() ?? 0
    let headers = (0..<width).map { column -> String in
      guard settings.headerRow else { return "Column \(column + 1)" }
      let name = parsed.first.flatMap { column < $0.count ? trimmed($0[column]) : nil } ?? ""
      return name.isEmpty ? "Column \(column + 1)" : name
    }
    let body = settings.headerRow ? Array(parsed.dropFirst()) : parsed
    return TransferParsedFile(
      headers: headers, rows: body.map { $0.map(JSONValue.string) },
      shown: body.prefix(previewRows).map { row in (0..<width).map { column in column < row.count && !row[column].isEmpty ? row[column] : "—" } })
  }

  /// Every guess at once, for a file just chosen or pasted.
  public static func detectSettings(fileName: String, text: String, encoding: TransferEncoding = .utf8) -> TransferFileSettings {
    let format = detectFormat(fileName: fileName, text: text)
    guard format == .csv else { return TransferFileSettings(format: format, encoding: encoding) }
    let delimiter = detectDelimiter(text)
    let sample = String(decoding: Array(text.utf16.prefix(20_000)), as: UTF16.self)
    return TransferFileSettings(
      format: format, encoding: encoding, delimiter: delimiter, headerRow: detectHeaderRow(parseDelimited(sample, delimiter: delimiter)))
  }

  /// A byte count as a person reads it.
  public static func formatBytes(_ bytes: Int) -> String {
    func oneDecimal(_ value: Double) -> String { String(format: "%.1f", floor(value * 10 + 0.5) / 10) }
    if bytes < 1024 { return "\(bytes) B" }
    if bytes < 1024 * 1024 { return "\(oneDecimal(Double(bytes) / 1024)) KB" }
    return "\(oneDecimal(Double(bytes) / (1024 * 1024))) MB"
  }
}
