// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

/// A tree the console's encoder made: root -> n1 (text "Hi {{name}}", size 16), as base64 msgpack.
private let treeBytes =
  "gqRyb290g6MkaWSkcm9vdKtjb21wb25lbnRJZKNkaXalbm9kZXORom4xom4xg6MkaWSibjGrY29tcG9uZW50SWSkdGV4dKVwcm9wc4KoY2hpbGRyZW6rSGkge3tuYW1lfX2kc2l6ZRA="

private final class TemplatesTransport: HTTPTransport, @unchecked Sendable {
  var sent: [(path: String, body: [String: Any])] = []

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    sent.append((request.url?.path ?? "", body))
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    return (Data(#"{"id":"made1","path":"/pricing"}"#.utf8), response)
  }
}

private final class DocsReader: FirestoreReader, @unchecked Sendable {
  let docs: [String: FirestoreDocument]
  init(_ docs: [String: FirestoreDocument] = [:]) { self.docs = docs }
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    onChange(.success([]))
    return NoListener()
  }
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    onChange(.success(docs[path.joined(separator: "/")]))
    return NoListener()
  }
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

private final class RecordingWriter: FirestoreWriter, @unchecked Sendable {
  var merges: [(path: [String], data: [String: Any])] = []
  func merge(_ path: [String], _ data: [String: Any]) async throws { merges.append((path, data)) }
}

@MainActor
final class TemplatesTests: XCTestCase {
  private func template(_ id: String = "t1", _ fields: [String: Any] = [:]) -> FirestoreDocument {
    FirestoreDocument(id: id, data: ["displayName": "Pricing", "kind": "page", "nodes": treeBytes].merging(fields) { _, new in new })
  }

  private func api(_ transport: TemplatesTransport, docs: [String: FirestoreDocument] = [:], writer: RecordingWriter = RecordingWriter())
    -> (templates: TemplatesAPI, pages: PagesAPI)
  {
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    return (
      TemplatesAPI(api: client, reader: DocsReader(docs), writer: writer, hostID: "h"),
      PagesAPI(api: client, writer: writer, hostID: "h")
    )
  }

  private func data(_ call: (path: String, body: [String: Any])) -> [String: Any] { call.body["data"] as? [String: Any] ?? [:] }

  func testReadsATemplateWhicheverFormItsTreeIsStoredIn() throws {
    let content = try XCTUnwrap(
      TemplateContent(
        template("t1", ["placeholders": [["name": "name"], ["name": "prop.title"], ["name": "city", "label": "Your city", "defaultValue": "Austin"]]])))
    XCTAssertEqual(Set(content.nodes?.keys ?? [:].keys), ["root", "n1"])
    // A {{prop.*}} token is bound to a property the template carries, never asked for.
    XCTAssertEqual(
      content.placeholders,
      [TemplatePlaceholder(name: "name", label: "name", defaultValue: ""), TemplatePlaceholder(name: "city", label: "Your city", defaultValue: "Austin")])
    XCTAssertEqual(content.kind, "page")
    // A plain map (an older template) is the tree already; a deleted template is gone.
    XCTAssertEqual(Set(TemplateContent(template("t2", ["nodes": ["a": ["$id": "a"]]]))?.nodes?.keys ?? [:].keys), ["a"])
    XCTAssertNil(TemplateContent(template("t3", ["deletedAt": Date()])))
  }

  func testMakesAComponentFromATemplateWithItsPlaceholdersFilled() async throws {
    let transport = TemplatesTransport()
    let email = try XCTUnwrap(
      TemplateContent(template("t1", ["kind": "component", "componentKind": "email", "rootId": "root", "placeholders": [["name": "name"]]])))
    let id = try await api(transport).templates.useComponent(email, name: " Greeting ", values: ["name": "Ada"])
    XCTAssertEqual(id, "made1")
    let call = try XCTUnwrap(transport.sent.first)
    XCTAssertEqual(call.path, "/api/hosts/resources")
    XCTAssertEqual(call.body["resource"] as? String, "reusableComponent")
    let fields = data(call)
    XCTAssertEqual(fields["displayName"] as? String, "Greeting")
    XCTAssertEqual(fields["kind"] as? String, "email")
    XCTAssertEqual(fields["rootId"] as? String, "root")
    let nodes = fields["nodes"] as? [String: Any]
    let props = (nodes?["n1"] as? [String: Any])?["props"] as? [String: Any]
    XCTAssertEqual(props?["children"] as? String, "Hi Ada")
  }

  func testMakesALayoutWithItsFirstVersion() async throws {
    let transport = TemplatesTransport()
    let layout = try XCTUnwrap(TemplateContent(template("t1", ["kind": "layout", "props": [["name": "title"]]])))
    let id = try await api(transport).templates.useLayout(layout, name: "Shop frame", values: [:])
    XCTAssertEqual(transport.sent.map(\.path), ["/api/hosts/resources", "/api/hosts/versions"])
    let (resource, version) = (transport.sent[0].body, transport.sent[1].body)
    XCTAssertEqual(resource["id"] as? String, id)
    XCTAssertEqual((resource["data"] as? [String: Any])?["versionId"] as? String, version["id"] as? String)
    XCTAssertEqual(version["kind"] as? String, "layout")
    XCTAssertEqual(version["parentId"] as? String, id)
    XCTAssertEqual(((version["data"] as? [String: Any])?["props"] as? [Any])?.count, 1)
  }

  func testMakesAPageAndPublishesItAtAnAddressNobodyHolds() async throws {
    let transport = TemplatesTransport()
    let page = try XCTUnwrap(TemplateContent(template("t1", ["seo": ["title": "Pricing"], "description": "Plans"])))
    var taken: Set<String> = ["pricing"]
    let (templates, pages) = api(transport)
    let used = try await templates.usePage(page, name: "Pricing", slug: "pricing", values: [:], taken: &taken, pages: pages)
    XCTAssertEqual(used.slug, "pricing-2")
    XCTAssertEqual(used.requestedSlug, "pricing")
    XCTAssertEqual(taken, ["pricing", "pricing-2"])
    XCTAssertEqual(transport.sent.map(\.path), ["/api/hosts/resources", "/api/hosts/versions", "/api/hosts/pages"])
    XCTAssertEqual(transport.sent[0].body["resource"] as? String, "screen")
    XCTAssertEqual(((data(transport.sent[0])["seo"]) as? [String: Any])?["title"] as? String, "Pricing")
    XCTAssertEqual(data(transport.sent[1])["displayName"] as? String, "Initial version")
    XCTAssertEqual(transport.sent[2].body["action"] as? String, "publish")
    XCTAssertEqual(transport.sent[2].body["slug"] as? String, "pricing-2")
  }

  func testAStarterSiteTakesTheRootBackFromThePlaceholderHome() async throws {
    let transport = TemplatesTransport()
    let writer = RecordingWriter()
    let host = FirestoreDocument(
      id: "h", data: ["defaultHomeScreenId": "home0", "screens": ["home0": "/", "about0": "about"]])
    let (templates, pages) = api(transport, docs: ["hosts/h": host], writer: writer)
    func page(_ id: String, _ name: String, _ slug: String, _ order: Int) throws -> TemplateContent {
      try XCTUnwrap(TemplateContent(template(id, ["displayName": name, "slug": slug, "source": ["starterId": "s", "starterOrder": order]])))
    }
    let bundle = [try page("a", "Home", "home", 0), try page("b", "About", "about", 1), try page("c", "Search", "search", 2)]
    let result = try await templates.useBundle(bundle, pages: pages)
    // The first page takes the root once the placeholder lets go of it; a slug the site cannot serve is named, not made.
    XCTAssertEqual(result.made.map(\.slug), ["/", "about-2"])
    XCTAssertEqual(result.skipped.count, 1)
    XCTAssertTrue(result.skipped[0].hasPrefix("\"Search\" — "))
    XCTAssertEqual(transport.sent.first { $0.path == "/api/hosts/pages" }?.body["action"] as? String, "unpublish")
    XCTAssertEqual(writer.merges.first?.path, ["hosts", "h"])
  }

  func testSavesAComponentAsATemplateDeclaringTheNamesItAsksFor() async throws {
    let transport = TemplatesTransport()
    let source = TemplateSource(
      kind: "component", nodes: ["n": ["$id": "n", "props": ["children": "{{name}} {{var:abc}} {{prop.title}}"]]], rootID: "n",
      componentKind: "email")
    let count = try await api(transport).templates.saveAsTemplate(source, name: "  Greeting  ", description: " A hello ")
    XCTAssertEqual(count, 1)
    let call = try XCTUnwrap(transport.sent.first)
    XCTAssertEqual(call.body["resource"] as? String, "template")
    let fields = data(call)
    XCTAssertEqual(fields["displayName"] as? String, "Greeting")
    XCTAssertEqual(fields["description"] as? String, "A hello")
    XCTAssertEqual(fields["componentKind"] as? String, "email")
    XCTAssertEqual((fields["placeholders"] as? [[String: Any]])?.first?["name"] as? String, "name")
    // Nothing to capture is said, not saved.
    var empty = source
    empty.nodes = [:]
    do {
      _ = try await api(transport).templates.saveAsTemplate(empty, name: "x", description: "")
      XCTFail("an empty tree is not saved")
    } catch let error as ConsoleAPIError {
      XCTAssertTrue(error.message.hasPrefix("Nothing to save yet"))
    }
  }

  func testReadsAPagesTreeAndItsAddressFromItsCurrentVersion() async throws {
    let docs: [String: FirestoreDocument] = [
      "hosts/h/screens/p1": FirestoreDocument(id: "p1", data: ["seo": ["title": "About"]]),
      "hosts/h/screens/p1/versions/v1": FirestoreDocument(id: "v1", data: ["nodes": treeBytes]),
      "hosts/h": FirestoreDocument(id: "h", data: ["screens": ["p1": "about"]]),
    ]
    let templates = api(TemplatesTransport(), docs: docs).templates
    let found = try await templates.pageSource("p1", versionID: "v1")
    let source = try XCTUnwrap(found)
    XCTAssertEqual(source.slug, "about")
    XCTAssertEqual(Set(source.nodes.keys), ["root", "n1"])
    XCTAssertEqual(source.seo?["title"] as? String, "About")
    let none = try await templates.pageSource("p1", versionID: nil)
    XCTAssertNil(none)
    let missing = try await templates.layoutSource("l1", versionID: "v9")
    XCTAssertNil(missing)
  }

  func testRefusesAnAddressTheSiteCannotServe() {
    XCTAssertNil(pageAddressProblem(slug: "pricing", name: "Pricing"))
    XCTAssertNil(pageAddressProblem(slug: "", name: "Pricing"))
    XCTAssertTrue(pageAddressProblem(slug: "a/b", name: "x")!.hasPrefix("A slug is one path segment"))
    XCTAssertTrue(pageAddressProblem(slug: "search", name: "x")!.contains("reserved"))
  }
}
