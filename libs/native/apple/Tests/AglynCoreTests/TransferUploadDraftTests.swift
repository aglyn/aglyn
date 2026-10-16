// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// The import's Upload step apart from its drawing: how a chosen or pasted file reads, what changing a setting does, and what
/// stops it being uploaded.
final class TransferUploadDraftTests: XCTestCase {
  private let limits = TransferUploadLimits(maxBytes: 200, maxRows: 3, formats: [.csv, .json])

  func testAFileIsReadUnderTheEncodingItsBytesSuggestAndItsLayoutIsGuessed() {
    let draft = TransferUploadDraft.file(name: "people.csv", data: Data("name;city\nAna;Köln\nBo;Wien\n".utf8), maxBytes: 200)
    XCTAssertEqual(draft.settings, TransferFileSettings(format: .csv, encoding: .utf8, delimiter: ";", headerRow: true))
    XCTAssertEqual(draft.parsed?.headers, ["name", "city"])
    XCTAssertEqual(draft.parsed?.shown, [["Ana", "Köln"], ["Bo", "Wien"]])
    XCTAssertEqual(draft.summary, "people.csv · 28 B · 2 rows, 2 columns")
    XCTAssertEqual(draft.blockers(limits), [])
    XCTAssertEqual(
      draft.value(limits),
      ["fileName": "people.csv", "text": "name;city\nAna;Köln\nBo;Wien\n", "bytes": 28, "format": "csv", "delimiter": ";", "headerRow": true])
  }

  func testAnotherEncodingReadsTheSameBytesAnotherWayAndTheOtherSettingsStay() {
    let latin = Data("name,city\nAna,Cologne\u{E9}\n".unicodeScalars.map { UInt8($0.value) })  // 0xE9 alone is not UTF-8
    var draft = TransferUploadDraft.file(name: "latin.csv", data: latin, maxBytes: 200)
    XCTAssertEqual(draft.settings.encoding, .windows1252)
    XCTAssertEqual(draft.parsed?.shown, [["Ana", "Cologneé"]])
    draft = draft.changing(delimiter: ";")
    XCTAssertEqual(draft.parsed?.headers, ["name,city"])  // the separator the person chose, not the guess
    draft = draft.changing(encoding: .utf8)
    XCTAssertEqual(draft.settings.delimiter, ";")
    XCTAssertEqual(draft.settings.encoding, .utf8)
    XCTAssertTrue(draft.text.contains("\u{FFFD}"))
    draft = draft.changing(delimiter: ",").changing(headerRow: false)
    XCTAssertEqual(draft.parsed?.headers, ["Column 1", "Column 2"])
    XCTAssertEqual(draft.parsed?.rows.count, 2)  // the first row is data now
  }

  func testPastedRowsAreReadLikeAFileWithoutAnEncodingToChoose() {
    let draft = TransferUploadDraft.pasted("email\tname\nana@x.co\tAna\n")
    XCTAssertEqual(draft.fileName, "Pasted rows")
    XCTAssertNil(draft.raw)
    XCTAssertEqual(draft.settings.delimiter, "\t")
    XCTAssertEqual(draft.changing(encoding: .windows1252), draft)  // nothing to decode again
    XCTAssertEqual(draft.parsed?.headers, ["email", "name"])
  }

  func testAFileTheImportCannotTakeIsRefusedInTheConsolesWords() {
    // Too big: refused unread.
    let big = TransferUploadDraft.file(name: "huge.csv", data: Data(repeating: 97, count: 2_048), maxBytes: 200)
    XCTAssertTrue(big.unread)
    XCTAssertNil(big.parsed)
    XCTAssertEqual(big.blockers(limits), ["This file is 2.0 KB; this import takes at most 200 B."])
    XCTAssertNil(big.value(limits))
    XCTAssertEqual(big.changing(format: .json), big)
    // Too long.
    let long = TransferUploadDraft.pasted("a,b\n1,2\n3,4\n5,6\n7,8\n")
    XCTAssertEqual(long.blockers(limits), ["This file has 4 rows; this import takes at most 3. Split it and import the rest separately."])
    // Nothing in it, or not valid in the format it was read as.
    XCTAssertEqual(TransferUploadDraft.pasted("a,b\n").blockers(limits), ["This file has no rows to import."])
    XCTAssertEqual(TransferUploadDraft.pasted("[1,").blockers(limits), ["This is not valid JSON."])
    // A format the import does not take.
    XCTAssertEqual(TransferUploadDraft.pasted("{\"a\":1}\n{\"a\":2}\n").blockers(limits), ["This import does not take NDJSON."])
    // The choice can be changed to one it takes.
    XCTAssertEqual(TransferUploadDraft.pasted("{\"a\":1}\n{\"a\":2}\n").changing(format: .csv).blockers(limits), [])
    // A JSON value carries no separator or header row.
    XCTAssertEqual(
      TransferUploadDraft.pasted("[{\"a\":1}]").value(limits),
      ["fileName": "Pasted rows", "text": "[{\"a\":1}]", "bytes": 9, "format": "json"])
  }
}
