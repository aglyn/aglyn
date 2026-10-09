// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import XCTest

@testable import AglynSite

/// A transport that answers each route from a table and records what was sent.
final class FontsTransport: HTTPTransport, @unchecked Sendable {
  var answers: [String: (Int, String)] = [:]
  var sent: [URLRequest] = []

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.append(request)
    let path = request.url?.path ?? ""
    let op = (request.httpBody.flatMap { JSONValue.decode($0) })?["op"]?.stringValue
    let key = op.map { "\(path)#\($0)" } ?? path
    let (status, body) = answers[key] ?? answers[path] ?? (200, "{}")
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (Data(body.utf8), response)
  }
}

final class FontsTests: XCTestCase {
  private let prepared = #"""
    {"face":{"family":"Acme Sans","subfamily":"Regular","weight":400,"style":"normal","category":"sans-serif",
     "metrics":{"unitsPerEm":1000,"ascent":900,"descent":-200,"lineGap":0,"xWidthAvg":500},
     "contentHash":"abcd","fileName":"acme-sans-400.woff2","bytesIn":4000,"bytesOut":1200,"warnings":["Subset to latin"],
     "license":{"embedding":"installable"},"unicodeRange":"U+0000-00FF"},"woff2":"d09GMg=="}
    """#

  private func api(_ transport: FontsTransport) -> FontsAPI {
    FontsAPI(api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport), hostID: "h1")
  }

  func testNamesTheFilesTheInstallerTakes() {
    XCTAssertTrue(isFontFileName("Inter.WOFF2"))
    XCTAssertTrue(isFontFileName("a.ttf"))
    XCTAssertFalse(isFontFileName("photo.png"))
    XCTAssertFalse(isFontFileName("ttf"))
    XCTAssertEqual(fontFileSize(512), "512 B")
    XCTAssertEqual(fontFileSize(2048), "2 KB")
    XCTAssertEqual(fontFileSize(3 * 1024 * 1024 / 2), "1.5 MB")
  }

  func testReadsAPreparedFaceAndKeepsOnlyWhatAThemeRecords() throws {
    let font = try XCTUnwrap(PreparedFont(JSONValue.decode(Data(prepared.utf8))))
    XCTAssertEqual(font.family, "Acme Sans")
    XCTAssertEqual(font.weightLabel, "400")
    XCTAssertEqual(font.warnings, ["Subset to latin"])
    XCTAssertEqual(font.woff2, Data(base64Encoded: "d09GMg=="))
    XCTAssertEqual(Set(font.installable.objectKeys), ["family", "weight", "style", "category", "metrics", "unicodeRange"])
    XCTAssertNil(PreparedFont(.object(["face": .object([:])])))
    XCTAssertNil(PreparedFont(nil))
  }

  func testRefusesWhatIsNotAFontOrIsTooBigWithoutAskingTheServer() async {
    let transport = FontsTransport()
    do {
      _ = try await api(transport).prepare(PickedFile(name: "a.png", mimeType: "image/png", data: Data([1])))
      XCTFail("a picture is not a font")
    } catch {
      XCTAssertTrue((error as? ConsoleAPIError)?.message.contains("not a font") == true)
    }
    do {
      _ = try await api(transport).prepare(PickedFile(name: "a.ttf", mimeType: "font/ttf", data: Data(count: fontUploadMaxBytes + 1)))
      XCTFail("too big")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.status, 413)
    }
    XCTAssertTrue(transport.sent.isEmpty)
  }

  func testInstallsAFileThroughPrepareStoreAndTheTheme() async throws {
    let transport = FontsTransport()
    transport.answers["/api/fonts/prepare"] = (200, prepared)
    transport.answers["/api/fonts/theme#plan"] = (200, #"{"plan":{"mode":"upload"}}"#)
    transport.answers["/api/media/upload"] = (200, #"{"mediaId":"m9"}"#)
    transport.answers["/api/fonts/theme#install"] = (
      200,
      #"{"ok":true,"fonts":[{"family":"Acme Sans","category":"sans-serif","roles":["body"],"faces":[{"weight":400,"style":"normal","label":"400","mediaId":"m9"}]}]}"#
    )
    let service = api(transport)
    let font = try await service.prepare(PickedFile(name: "acme.ttf", mimeType: "font/ttf", data: Data([1, 2, 3])))
    let plan = try await service.plan(font)
    XCTAssertEqual(plan, .upload)
    let stored = try await service.store(font, plan: plan)
    XCTAssertEqual(stored.mediaID, "m9")
    XCTAssertEqual(stored.version, "abcd")
    XCTAssertFalse(stored.replaced)
    let fonts = try await service.install(font, mediaID: stored.mediaID, version: stored.version)
    XCTAssertEqual(fonts, [InstalledFont(family: "Acme Sans", category: "sans-serif", roles: [.body], faces: [InstalledFace(weight: 400, weightMax: nil, style: "normal", label: "400")])])
    let prepareRequest = transport.sent[0]
    XCTAssertEqual(prepareRequest.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
    XCTAssertEqual(prepareRequest.url?.absoluteString, "https://console.test/api/fonts/prepare?hostId=h1")
    let upload = JSONValue.decode(transport.sent[2].httpBody ?? Data())
    XCTAssertEqual(upload?["hostId"]?.stringValue, "h1")
    XCTAssertEqual(upload?["contentType"]?.stringValue, "font/woff2")
    XCTAssertEqual(upload?["data"]?.stringValue, "d09GMg==")
  }

  func testReplacesTheFileAFaceAlreadyPointsAtAndUploadsAnewWhenItLeftTheLibrary() async throws {
    let transport = FontsTransport()
    transport.answers["/api/media/replace"] = (200, #"{"contentHash":"ffff"}"#)
    let font = try XCTUnwrap(PreparedFont(JSONValue.decode(Data(prepared.utf8))))
    let replaced = try await api(transport).store(font, plan: .replace(mediaID: "m1"))
    XCTAssertEqual(replaced.mediaID, "m1")
    XCTAssertEqual(replaced.version, "ffff")
    XCTAssertTrue(replaced.replaced)
    transport.answers["/api/media/replace"] = (404, #"{"error":"gone"}"#)
    transport.answers["/api/media/upload"] = (200, #"{"mediaId":"m2"}"#)
    let anew = try await api(transport).store(font, plan: .replace(mediaID: "m1"))
    XCTAssertEqual(anew.mediaID, "m2")
    XCTAssertFalse(anew.replaced)
    XCTAssertNil(JSONValue.decode(transport.sent.last?.httpBody ?? Data())?["mediaId"])
  }

  func testPlansAReplaceWhenTheThemeHoldsTheSlot() async throws {
    let transport = FontsTransport()
    transport.answers["/api/fonts/theme#plan"] = (200, #"{"plan":{"mode":"replace","mediaId":"m1","scope":"h1"}}"#)
    let font = try XCTUnwrap(PreparedFont(JSONValue.decode(Data(prepared.utf8))))
    let plan = try await api(transport).plan(font)
    XCTAssertEqual(plan, .replace(mediaID: "m1"))
  }

  func testSendsEachChangeAsOneNamedOperation() async throws {
    let transport = FontsTransport()
    let service = api(transport)
    _ = try await service.setRole("Acme Sans", .headings)
    _ = try await service.setCategory("Acme Sans", "serif")
    _ = try await service.remove(face: InstalledFace(weight: 700, weightMax: nil, style: "italic", label: "700 italic"), of: "Acme Sans")
    _ = try await service.remove(family: "Acme Sans")
    let bodies = transport.sent.compactMap { $0.httpBody.flatMap { JSONValue.decode($0) } }
    XCTAssertEqual(bodies.map { $0["op"]?.stringValue }, ["role", "category", "remove-face", "remove-family"])
    XCTAssertEqual(bodies[0]["role"]?.stringValue, "headings")
    XCTAssertEqual(bodies[1]["category"]?.stringValue, "serif")
    XCTAssertEqual(bodies[2]["face"]?["style"]?.stringValue, "italic")
    XCTAssertEqual(bodies[2]["face"]?["weight"]?.numberValue, 700)
    XCTAssertTrue(transport.sent.allSatisfy { $0.url?.query == "hostId=h1" })
  }
}

extension JSONValue {
  fileprivate var objectKeys: [String] {
    if case .object(let record) = self { return Array(record.keys) }
    return []
  }
}
