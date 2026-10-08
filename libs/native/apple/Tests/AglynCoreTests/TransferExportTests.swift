// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// The export: the fields route's answer, the export body, and the file the route hands back.
final class TransferExportTests: XCTestCase {
  private final class FileTransport: HTTPTransport, @unchecked Sendable {
    var sent: [URLRequest] = []
    var status = 200
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
      sent.append(request)
      let headers = [
        "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"contact-submissions.csv\"",
        "X-Aglyn-Export-Rows": "12",
      ]
      let body = status == 200 ? Data("a,b\n".utf8) : Data(#"{"error":"Pick at least one field."}"#.utf8)
      return (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!)
    }
  }

  func testDecodesTheFieldsAnswer() {
    let fields = TransferFields.decode([
      "groups": [["id": "answers", "label": "Answers"]],
      "fields": [["id": "email", "label": "Email", "group": "answers"], ["label": "no id"], ["id": "createdAt"]],
    ])
    XCTAssertEqual(fields.groups, [TransferFieldGroupInfo(id: "answers", label: "Answers")])
    XCTAssertEqual(fields.fields.map(\.id), ["email", "createdAt"])
    XCTAssertEqual(fields.fields.last?.label, "createdAt")
  }

  func testDownloadsTheFileWithItsNameAndRowCount() async throws {
    let transport = FileTransport()
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "tok" }, transport: transport)
    let transfer = TransferAPI(api: client, orgID: "o1")
    let file = try await transfer.export(
      resource: "forms.submissions", hostID: "h1", fieldIDs: ["email"], scope: ["kind": "all"], format: .csv)
    XCTAssertEqual(file.name, "contact-submissions.csv")
    XCTAssertEqual(file.header("x-aglyn-export-rows"), "12")
    XCTAssertEqual(String(decoding: file.data, as: UTF8.self), "a,b\n")
    let request = try XCTUnwrap(transport.sent.first)
    XCTAssertEqual(request.url?.absoluteString, "https://console.test/api/transfer/export")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    let body = try XCTUnwrap(JSONValue.decode(request.httpBody ?? Data()))
    XCTAssertEqual(body["bom"], true)
    XCTAssertEqual(body["format"], "csv")
    XCTAssertEqual(body["fieldIds"], ["email"])
    XCTAssertEqual(body["orgId"], "o1")
  }

  func testARefusedExportThrowsTheRoutesWords() async {
    let transport = FileTransport()
    transport.status = 400
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "tok" }, transport: transport)
    do {
      _ = try await client.download("/api/transfer/export", body: [:])
      XCTFail("expected a refusal")
    } catch let error as ConsoleAPIError {
      XCTAssertEqual(error.status, 400)
      XCTAssertEqual(error.message, "Pick at least one field.")
    } catch {
      XCTFail("\(error)")
    }
  }

  func testReadsAFileNameFromContentDisposition() {
    XCTAssertEqual(DownloadedFile.fileName(fromDisposition: "attachment; filename=\"a b.csv\""), "a b.csv")
    XCTAssertEqual(DownloadedFile.fileName(fromDisposition: "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.json"), "résumé.json")
    XCTAssertNil(DownloadedFile.fileName(fromDisposition: "inline"))
    XCTAssertNil(DownloadedFile.fileName(fromDisposition: nil))
  }
}
