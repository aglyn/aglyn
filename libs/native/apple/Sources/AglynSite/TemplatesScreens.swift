// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The words for one template kind.
private func noun(_ kind: String) -> String {
  switch kind {
  case "component": "component"
  case "layout": "layout"
  default: "page"
  }
}

/// Where a made component, layout or page opens: its own list, with it picked.
public func templateUseDestination(kind: String, id: String) -> (screen: String, params: [String: String]) {
  switch kind {
  case "component": (ArtifactKind.component.screen, ["id": id])
  case "layout": (ArtifactKind.layout.screen, ["id": id])
  default: ("site.pages", ["page": id])
  }
}

/// The templates of one kind to start from, the console's "Start from a
/// template" gallery: this site's saved, installed and starter templates, one
/// tap to choose. A starter site is one row that makes all its pages.
struct TemplateGallerySheet: View {
  let context: NativePluginContext
  let hostID: String
  let kind: String
  let onChoose: (ArtifactRow) -> Void
  let close: () -> Void
  @State private var model = ArtifactListModel()
  @State private var searchText = ""

  var body: some View {
    NavigationStack {
      Group {
        switch model.rows {
        case .loading:
          List { SkeletonRows(count: 5) }
        case .failed(let message):
          AglynEmptyState("Could not load templates", systemImage: SiteSymbols.error, message: message) {
            Button("Try again") { model.refresh() }
          }
        case .ready(let rows) where rows.isEmpty:
          AglynEmptyState(
            model.search.isEmpty ? "No \(noun(kind)) templates yet" : "No templates match", systemImage: ArtifactKind.template.systemImage,
            message: model.search.isEmpty ? "Save one from an existing \(noun(kind)), or start blank." : "Try another search.")
        case .ready(let rows):
          List {
            ForEach(rows) { row in
              Button {
                onChoose(row)
              } label: {
                AglynRow(
                  row.isStarterBundle ? row.starterName ?? row.name : row.name, subtitle: row.description ?? "No description",
                  systemImage: ArtifactKind.template.systemImage
                ) {
                  StatusChip(row.isStarterBundle ? "Starter site" : templateSourceLabel(row.sourceType))
                }
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("template-\(row.id)")
            }
            if model.hasMore { AglynLoadMoreRow("Show more templates") { model.loadMore() } }
          }
          .accessibilityIdentifier("template-gallery-list")
        }
      }
      .navigationTitle("Start from a \(noun(kind)) template")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .searchable(text: $searchText, prompt: "Search templates")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close) } }
    }
    .aglynSheetMinimumSize(width: 420, height: 480)
    .task {
      model.start(context.firestore, kind: .template, hostID: hostID)
      model.kindFilter = kind
    }
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .onDisappear { model.stop() }
    .accessibilityIdentifier("template-gallery")
  }
}

private enum TemplateLoad {
  case loading
  case gone
  case ready([TemplateContent])
}

/// Use this template: name it, give a page its address, fill in what it asks
/// for, and it becomes a page, component or layout of this site; the template
/// stays in the library. A starter site makes all of its pages.
struct UseTemplateSheet: View {
  let context: NativePluginContext
  let hostID: String
  let row: ArtifactRow
  let onDone: (_ kind: String, _ id: String) -> Void
  let close: () -> Void
  @State private var runner = ActionRunner()
  @State private var load = TemplateLoad.loading
  @State private var name = ""
  @State private var slug = ""
  @State private var values: [String: String] = [:]

  private var templates: TemplatesAPI {
    TemplatesAPI(api: context.api, reader: context.firestore, writer: context.writer, hostID: hostID)
  }
  private var pages: PagesAPI { PagesAPI(api: context.api, writer: context.writer, hostID: hostID) }

  var body: some View {
    Group {
      switch load {
      case .loading:
        AglynActionSheet("Use this template", confirmLabel: "Create", confirmEnabled: false, busy: false, error: nil, onCancel: close, onConfirm: {}) {
          ProgressView()
        }
      case .gone:
        AglynActionSheet(
          "Use this template", message: "This template is gone or could not be read.", confirmLabel: "Close", busy: false, error: nil,
          onCancel: close, onConfirm: close
        ) { EmptyView() }
      case .ready(let pagesOfTemplate):
        form(pagesOfTemplate)
      }
    }
    .task(id: row.id) {
      do {
        var found: [TemplateContent] = []
        if let starterID = row.starterID { found = try await templates.bundlePages(starterID) }
        if found.isEmpty, let single = try await templates.load(row.id) { found = [single] }
        guard let first = found.first else {
          load = .gone
          return
        }
        name = first.name
        slug = first.slug ?? normalizeScreenSlug(first.name) ?? "page"
        values = Dictionary(uniqueKeysWithValues: first.placeholders.map { ($0.name, $0.defaultValue) })
        load = .ready(found)
      } catch {
        load = .gone
      }
    }
  }

  @ViewBuilder
  private func form(_ found: [TemplateContent]) -> some View {
    let first = found[0]
    let bundle = row.isStarterBundle && found.count > 1
    let kindNoun = noun(first.kind)
    let addressProblem = first.kind == "page" && !bundle ? pageAddressProblem(slug: slug, name: name) : nil
    AglynActionSheet(
      "Use this template",
      message: bundle
        ? "Adds the \(found.count) pages of \(row.starterName ?? row.name), published at their addresses. The template stays in your library."
        : first.kind == "page"
          ? "Creates a new page from this template and publishes it at the address below. The template stays in your library."
          : "Creates a new \(kindNoun) from this template. The template stays in your library.",
      confirmLabel: bundle ? "Add \(found.count) pages" : "Create \(kindNoun)",
      confirmEnabled: (bundle || !name.trimmed.isEmpty) && addressProblem == nil, busy: runner.busy, error: runner.error, onCancel: close,
      onConfirm: {
        let name = name
        let slug = slug
        let values = values
        runner.run {
          if bundle {
            let result = try await templates.useBundle(found, pages: pages)
            guard let first = result.made.first else {
              throw templateProblem(result.skipped.isEmpty ? "No page could be added." : result.skipped.joined(separator: "; "))
            }
            onDone("page", first.screenID)
          } else {
            let id: String
            switch first.kind {
            case "component": id = try await templates.useComponent(first, name: name, values: values)
            case "layout": id = try await templates.useLayout(first, name: name, values: values)
            default:
              var taken = try await templates.takenAddresses()
              id = try await templates.usePage(first, name: name, slug: slug, values: values, taken: &taken, pages: pages).screenID
            }
            onDone(first.kind, id)
          }
        }
      }
    ) {
      if !bundle {
        AglynCountedField("\(kindNoun.prefix(1).uppercased() + kindNoun.dropFirst()) name", text: $name, max: 200)
        if first.kind == "page" {
          AglynCountedField(
            "Slug", text: $slug, error: addressProblem,
            supporting: "/" + (normalizeScreenSlug(slug) ?? normalizeScreenSlug(name) ?? "page").drop { $0 == "/" })
        }
        if !first.placeholders.isEmpty {
          Text("This template asks for:").font(AglynFont.caption).foregroundStyle(.secondary)
          ForEach(first.placeholders, id: \.name) { placeholder in
            AglynCountedField(
              placeholder.label, text: Binding(get: { values[placeholder.name] ?? "" }, set: { values[placeholder.name] = $0 }))
          }
        }
      }
    }
  }
}

/// Save as template: a copy of a page, component or layout to start new ones
/// from; the original is untouched and the template stays out of the live site
/// until it is used. `load` reads what to capture when the person confirms.
struct SaveAsTemplateSheet: View {
  let context: NativePluginContext
  let hostID: String
  let kind: String
  let defaultName: String
  let load: (TemplatesAPI) async throws -> TemplateSource?
  let onSaved: (String) -> Void
  let close: () -> Void
  @State private var runner = ActionRunner()
  @State private var name = ""
  @State private var description = ""

  var body: some View {
    AglynActionSheet(
      "Save as template",
      message: "Saves a copy of this \(noun(kind)) to your templates. The original is untouched, and the template stays out of your live site until you use it.",
      confirmLabel: "Save template", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error, onCancel: close,
      onConfirm: {
        let name = name
        let description = description
        runner.run {
          let templates = TemplatesAPI(api: context.api, reader: context.firestore, writer: context.writer, hostID: hostID)
          guard let source = try await load(templates) else {
            throw templateProblem("Nothing to save yet — publish this first, then save it as a template.")
          }
          let placeholders = try await templates.saveAsTemplate(source, name: name, description: description)
          onSaved(
            placeholders > 0
              ? "Saved “\(name.trimmed)” with \(placeholders) placeholder\(placeholders == 1 ? "" : "s") to fill in when it is used."
              : "Saved “\(name.trimmed)” to your templates.")
        }
      }
    ) {
      AglynCountedField("Template name", text: $name, max: 200)
      AglynCountedField("Description (optional)", text: $description, max: 500, multiline: true)
    }
    .onAppear { name = defaultName }
  }
}
