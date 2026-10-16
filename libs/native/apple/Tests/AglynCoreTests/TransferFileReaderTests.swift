// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// Reading a chosen or pasted file as the console's Upload step reads it, replayed from the cases the console's own
/// `transfer-file.ts` answers (`libs/native/contracts/transfer-file-cases.json`; the Kotlin kit replays the same file).
final class TransferFileReaderTests: XCTestCase {
  private func cases() throws -> JSONValue {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../../contracts/transfer-file-cases.json").standardizedFileURL
    return try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
  }

  private func list(_ value: JSONValue?) -> [JSONValue] { value?.arrayValue ?? [] }

  private func texts(_ file: JSONValue) -> [String: String] {
    var out: [String: String] = [:]
    if case .object(let record)? = file["texts"] { for (key, value) in record { out[key] = value.stringValue ?? "" } }
    return out
  }

  private func settings(_ value: JSONValue?) -> TransferFileSettings {
    TransferFileSettings(
      format: value?["format"]?.stringValue.flatMap(TransferFormat.init(rawValue:)) ?? .csv,
      encoding: value?["encoding"]?.stringValue.flatMap(TransferEncoding.init(rawValue:)) ?? .utf8,
      delimiter: value?["delimiter"]?.stringValue ?? ",", headerRow: value?["headerRow"]?.boolValue ?? true)
  }

  func testTheFormatTheSeparatorAndTheHeaderRowAreGuessedAsTheConsoleGuessesThem() throws {
    let file = try cases()
    let text = texts(file)
    for one in list(file["detectFormat"]) {
      let name = one["fileName"]?.stringValue ?? "", key = one["text"]?.stringValue ?? ""
      XCTAssertEqual(
        TransferFileReader.detectFormat(fileName: name, text: text[key] ?? "").rawValue, one["result"]?.stringValue, "\(name) \(key)")
    }
    for one in list(file["detectDelimiter"]) {
      let key = one["text"]?.stringValue ?? ""
      XCTAssertEqual(TransferFileReader.detectDelimiter(text[key] ?? ""), one["result"]?.stringValue, key)
    }
    for one in list(file["detectHeaderRow"]) {
      let key = one["text"]?.stringValue ?? ""
      let rows = TransferFileReader.parseDelimited(text[key] ?? "", delimiter: one["delimiter"]?.stringValue ?? ",")
      XCTAssertEqual(TransferFileReader.detectHeaderRow(rows), one["result"]?.boolValue, key)
    }
    for one in list(file["detectSettings"]) {
      let name = one["fileName"]?.stringValue ?? "", key = one["text"]?.stringValue ?? ""
      let got = TransferFileReader.detectSettings(
        fileName: name, text: text[key] ?? "", encoding: one["encoding"]?.stringValue.flatMap(TransferEncoding.init(rawValue:)) ?? .utf8)
      XCTAssertEqual(got, settings(one["result"]), "\(name) \(key)")
    }
  }

  func testCellsRecordsAndSizesReadAsTheConsoleReadsThem() throws {
    let file = try cases()
    let text = texts(file)
    for one in list(file["parseDelimited"]) {
      let key = one["text"]?.stringValue ?? "", delimiter = one["delimiter"]?.stringValue ?? ","
      let want = list(one["result"]).map { list($0).compactMap(\.stringValue) }
      XCTAssertEqual(TransferFileReader.parseDelimited(text[key] ?? "", delimiter: delimiter), want, "\(key) \(delimiter)")
    }
    XCTAssertGreaterThan(list(file["parse"]).count, 30)
    for one in list(file["parse"]) {
      let key = one["text"]?.stringValue ?? ""
      let got = TransferFileReader.parse(text[key] ?? "", settings(one["settings"]))
      let want = one["result"]
      XCTAssertEqual(got.headers, list(want?["headers"]).compactMap(\.stringValue), "\(key) \(String(describing: one["settings"]))")
      XCTAssertEqual(got.rows, list(want?["rows"]).map { list($0) }, "\(key) \(String(describing: one["settings"]))")
      XCTAssertEqual(got.error, want?["error"]?.stringValue, key)
    }
    for one in list(file["formatBytes"]) {
      XCTAssertEqual(TransferFileReader.formatBytes(Int(one["bytes"]?.numberValue ?? 0)), one["result"]?.stringValue)
    }
  }

  func testThePreviewShowsFiveRowsAsTheConsoleShowsACell() {
    let csv = "name,note\n" + (1...8).map { "r\($0),\($0 % 2 == 0 ? "" : "x")" }.joined(separator: "\n")
    let parsed = TransferFileReader.parse(csv, TransferFileSettings(format: .csv))
    XCTAssertEqual(parsed.rows.count, 8)
    XCTAssertEqual(parsed.shown.count, 5)
    XCTAssertEqual(parsed.shown[1], ["r2", "—"])
    let json = TransferFileReader.parse(
      #"[{"b":true,"a":["x","y"],"n":null,"o":{"z":1,"y":[2]}}]"#, TransferFileSettings(format: .json))
    XCTAssertEqual(json.headers, ["b", "a", "n", "o"])  // keys in the order the file gives them
    XCTAssertEqual(json.shown, [["Yes", "x, y", "—", #"{"z":1,"y":[2]}"#]])
  }

  func testTheEncodingIsGuessedFromTheBytesAndChosenBytesReadUnderAnother() {
    XCTAssertEqual(TransferFileReader.detectEncoding(Data([0xEF, 0xBB, 0xBF, 0x61])), .utf8)
    XCTAssertEqual(TransferFileReader.detectEncoding(Data([0xFF, 0xFE, 0x61, 0x00])), .utf16le)
    XCTAssertEqual(TransferFileReader.detectEncoding(Data([0xFE, 0xFF, 0x00, 0x61])), .utf16be)
    XCTAssertEqual(TransferFileReader.detectEncoding(Data("café".utf8)), .utf8)
    let latin = Data([0x63, 0x61, 0x66, 0xE9])  // "café" as Windows-1252
    XCTAssertEqual(TransferFileReader.detectEncoding(latin), .windows1252)
    XCTAssertEqual(TransferFileReader.decode(latin, as: .windows1252), "café")
    XCTAssertEqual(TransferFileReader.decode(Data([0xEF, 0xBB, 0xBF, 0x61, 0x62]), as: .utf8), "ab")  // the mark is dropped
    XCTAssertEqual(TransferFileReader.decode(Data([0xFF, 0xFE, 0x61, 0x00, 0x62, 0x00]), as: .utf16le), "ab")
    XCTAssertEqual(TransferFileReader.decode(Data([0xFE, 0xFF, 0x00, 0x61, 0x00, 0x62]), as: .utf16be), "ab")
    // The same bytes under the wrong encoding read as something else, which is why the person can change it.
    XCTAssertEqual(TransferFileReader.decode(latin, as: .utf8), "caf\u{FFFD}")
    XCTAssertEqual(TransferFileReader.decode(Data("€".utf8), as: .windows1252), "â‚¬")
  }
}
