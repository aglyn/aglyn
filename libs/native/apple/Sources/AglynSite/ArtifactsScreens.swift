// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Roles that may create and change a site's components, layouts and templates (`hostRoleCanWrite`).
private let artifactWriteRoles: Set<String> = ["admin", "editor", "author"]

/// The slot a plugin fills to publish a site's component or layout (the console's `hostArtifactPublish`).
public let artifactPublishSlot = "hostArtifactPublish"

/// What a list's sheet is asking for.
private enum ArtifactDialog: Identifiable {
  case create
  case details(ArtifactRow)
  case duplicate(ArtifactRow)
  case delete(ArtifactRow, siblings: [ArtifactRow])
  case deleteBundle(lead: ArtifactRow, pages: [ArtifactRow])
  /// The templates of this list's kind to start a new one from.
  case gallery
  /// Use this template: a page, component or layout (or a starter site's pages) made from it.
  case use(ArtifactRow)
  case saveTemplate(ArtifactRow)

  var id: String {
    switch self {
    case .create: "create"
    case .details(let row): "details-\(row.id)"
    case .duplicate(let row): "duplicate-\(row.id)"
    case .delete(let row, _): "delete-\(row.id)"
    case .deleteBundle(let lead, _): "delete-bundle-\(lead.id)"
    case .gallery: "gallery"
    case .use(let row): "use-\(row.id)"
    case .saveTemplate(let row): "save-template-\(row.id)"
    }
  }
}

/// A site's components, layouts or templates as the console lists them, the
/// picked one beside the list in a wide window: search, the kind filter,
/// create, edit the details (and a layout's parent), duplicate, delete, the
/// versions and what uses it, and the Besigner for the design itself.
struct ArtifactsScreen: View {
  let context: NativePluginContext
  let kind: ArtifactKind
  var initialID: String?
  @State private var model = ArtifactListModel()
  @State private var quota = ArtifactQuotaModel()
  @State private var runner = ActionRunner()
  @State private var dialog: ArtifactDialog?
  @State private var selection: String?
  @State private var searchText = ""
  @State private var seeded = false

  private var canEdit: Bool { artifactWriteRoles.contains(context.siteRole ?? "") }

  var body: some View {
    Group {
      if let hostID = context.hostID {
        let api = ArtifactsAPI(api: context.api, writer: context.writer, hostID: hostID, kind: kind)
        WideLayoutReader { wide in
          if wide {
            HStack(spacing: 0) {
              list(selectable: true, hostID: hostID).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
              Divider()
              Group {
                if let selection {
                  ArtifactDetail(context: context, hostID: hostID, kind: kind, id: selection, api: api, runner: runner, canEdit: canEdit) {
                    dialog = $0
                  }
                  .id(selection)
                } else {
                  AglynSelectionPlaceholder("No \(kind.singular) selected", systemImage: kind.systemImage)
                }
              }
              .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
          } else {
            list(selectable: false, hostID: hostID)
              .aglynPushDestination(item: $selection) { id in
                ArtifactDetail(context: context, hostID: hostID, kind: kind, id: id, api: api, runner: runner, canEdit: canEdit) {
                  dialog = $0
                }
                .id(id)
              }
          }
        }
        .task(id: hostID) { model.start(context.firestore, kind: kind, hostID: hostID) }
        .task(id: hostID) { await quota.loadPlan(api: context.api, kind: kind, hostID: hostID) }
        .task(id: rowsSignature) { await quota.recount(context.firestore, kind: kind, hostID: hostID) }
        .sheet(item: $dialog) { dialog in
          ArtifactDialogSheet(
            context: context, hostID: hostID, kind: kind, dialog: dialog, api: api, runner: runner,
            onCreated: { selection = $0 }, onDeleted: { id in if selection == id { selection = nil } },
            onOpen: { self.dialog = $0 }
          ) { self.dialog = nil }
        }
      } else {
        AglynEmptyState("Pick a site first", systemImage: SiteSymbols.site)
      }
    }
    .navigationTitle(kind.title)
    .aglynScreenTitle(kind.title)
    .aglynSearchable(text: $searchText, prompt: "Search \(kind.title.lowercased())")
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .aglynPrimaryAction(
      id: "add-\(kind.singular)", "New \(kind.singular)", systemImage: "plus", enabled: canEdit, shortcut: KeyboardShortcut("n", modifiers: .command)
    ) {
      runner.clear()
      dialog = .create
    }
    .aglynScreenToolbar(id: "artifacts-\(kind.singular)") {
      if kind != .template {
        AglynSecondaryActions {
          Button {
            runner.clear()
            dialog = .gallery
          } label: {
            Label("From a template", systemImage: "square.grid.2x2")
          }
          .disabled(!canEdit)
          .accessibilityIdentifier("from-template-\(kind.singular)")
        }
      }
      // Create with AI and anything else a plugin puts beside New (the console's zone for this list).
      SlotWidgets(context: context, slot: kind.createZone, placement: .header)
    }
    .onAppear {
      if !seeded {
        seeded = true
        selection = initialID
      }
    }
    .onDisappear { model.stop() }
  }

  /// What the count is re-asked on: the rows the window holds, which a create or a delete changes.
  private var rowsSignature: String {
    (model.rows.value ?? []).map(\.id).joined(separator: ",")
  }

  /// The plan's count for this list and the header sort, above the rows (the console prints both above its table).
  private func listHeader() -> some View {
    HStack(spacing: AglynSpace.one) {
      AglynQuotaReadout(
        ready: quota.ready, used: quota.count ?? model.rows.value?.count ?? 0, limit: quota.limit, noun: kind.singular
      )
      .accessibilityIdentifier("\(kind.singular)-quota")
      Spacer()
      sortMenu
    }
    .aglynContentEdges()
    .padding(.vertical, AglynSpace.one)
  }

  private var sortMenu: some View {
    Menu {
      Button {
        model.sort = nil
      } label: {
        if model.sort == nil { Label("Default order", systemImage: "checkmark") } else { Text("Default order") }
      }
      ForEach(artifactSortChoices(kind), id: \.self) { choice in
        Button {
          model.sort = choice
        } label: {
          if model.sort == choice {
            Label(artifactSortLabel(choice), systemImage: "checkmark")
          } else {
            Text(artifactSortLabel(choice))
          }
        }
      }
    } label: {
      Label("Sort", systemImage: "arrow.up.arrow.down").foregroundStyle(model.sort == nil ? Color.secondary : AglynColor.tint)
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .accessibilityLabel("Sort")
    .accessibilityIdentifier("sort-\(kind.collection)")
  }

  private func list(selectable: Bool, hostID: String) -> some View {
    VStack(spacing: 0) {
      listHeader()
      ForEach(model.notices, id: \.self) { notice in
        Text(notice).font(AglynFont.caption).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .aglynContentEdges()
      }
      if !kind.kindChoices.isEmpty {
        AglynChipRow(kind.kindChoices.map { AglynChipOption($0.value ?? "all", $0.label) }, selected: model.kindFilter ?? "all") {
          model.kindFilter = $0 == "all" ? nil : $0
        }
      }
      if dialog == nil, let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }.aglynContentEdges()
      }
      rows(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    switch model.rows {
    case .loading:
      List { SkeletonRows(count: 6) }.aglynListBackground()
    case .failed(let message):
      AglynEmptyState("Could not load \(kind.title.lowercased())", systemImage: SiteSymbols.error, message: message) {
        Button("Try again") { model.refresh() }
      }
    case .ready(let rows) where rows.isEmpty:
      let filtered = !model.search.isEmpty || model.kindFilter != nil
      AglynEmptyState(
        filtered ? "No \(kind.title.lowercased()) match" : "No \(kind.title.lowercased()) yet", systemImage: kind.systemImage,
        message: filtered ? "Try another search." : kind.emptyMessage
      ) {
        if !filtered { SlotWidgets(context: context, slot: kind.createZone) }
      }
    case .ready(let rows):
      if selectable {
        List {
          ForEach(rows) { row in
            ArtifactListRow(kind: kind, row: row).aglynSelectableRow(row.id, selection: $selection)
              .accessibilityIdentifier("\(kind.singular)-\(row.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more \(kind.title.lowercased())") { model.loadMore() } }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .refreshable { model.refresh() }
        .aglynSelectableListStyle()
        .aglynSelectionKeys(rows.map(\.id), selection: $selection)
        .accessibilityIdentifier("\(kind.collection)-list")
      } else {
        List {
          ForEach(rows) { row in
            Button {
              selection = row.id
            } label: {
              ArtifactListRow(kind: kind, row: row)
            }
            .buttonStyle(.aglynRow)
            .aglynListRow()
            .accessibilityIdentifier("\(kind.singular)-\(row.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more \(kind.title.lowercased())") { model.loadMore() } }
        }
        .refreshable { model.refresh() }
        .aglynListBackground()
        .accessibilityIdentifier("\(kind.collection)-list")
      }
    }
  }
}

private func rowSupporting(_ kind: ArtifactKind, _ row: ArtifactRow) -> String {
  let lead: String? =
    switch kind {
    case .component: "Used in \(componentPlacementLabel(row.kind).lowercased())s"
    case .template: templateKindLabel(row.kind)
    case .layout: nil
    }
  let text = [lead, row.description].compactMap { $0 }.joined(separator: " · ")
  return text.isEmpty ? "No description" : text
}

private struct ArtifactListRow: View {
  let kind: ArtifactKind
  let row: ArtifactRow

  var body: some View {
    AglynRow(row.isStarterBundle ? row.starterName ?? row.name : row.name, subtitle: rowSupporting(kind, row), systemImage: kind.systemImage) {
      if kind == .template {
        StatusChip(row.isStarterBundle ? "Starter bundle" : templateSourceLabel(row.sourceType))
      } else if row.versionID == nil {
        StatusChip("No version yet")
      }
    }
  }
}

// MARK: - Detail

private struct ArtifactDetail: View {
  let context: NativePluginContext
  let hostID: String
  let kind: ArtifactKind
  let id: String
  let api: ArtifactsAPI
  let runner: ActionRunner
  let canEdit: Bool
  let open: (ArtifactDialog) -> Void
  @State private var live = LiveDocument()
  @State private var versions = LiveQuery()
  @State private var siblings = LiveQuery()
  @State private var parent = LiveDocument()

  var body: some View {
    Group {
      switch live.state {
      case .loading:
        List { SkeletonRows(count: 6) }.aglynListBackground()
      case .failed:
        AglynEmptyState("Could not load this \(kind.singular)", systemImage: SiteSymbols.error, message: "Check the connection and try again.")
      case .ready(nil):
        AglynEmptyState("This \(kind.singular) is gone", systemImage: kind.systemImage)
      case .ready(let doc?):
        if let row = ArtifactRow(doc) {
          detail(row)
        } else {
          AglynEmptyState("This \(kind.singular) is gone", systemImage: kind.systemImage)
        }
      }
    }
    .navigationTitle(kind.title)
    .aglynScreenTitle(kind.title)
    .task(id: id) { await live.bind(context.firestore, ["hosts", hostID, kind.collection, id]) }
    .task(id: id) {
      guard kind.versionKind != nil else { return }
      await versions.bind(context.firestore, FirestoreQuery(["hosts", hostID, kind.collection, id, "versions"], limit: 100))
    }
  }

  private func pages(_ row: ArtifactRow) -> [ArtifactRow] {
    (siblings.state.value ?? []).compactMap(ArtifactRow.init).sorted { ($0.starterOrder ?? .max) < ($1.starterOrder ?? .max) }
  }

  private func detail(_ row: ArtifactRow) -> some View {
    let loadedVersions = (versions.state.value ?? []).map(ArtifactVersion.init)
    let bundle = pages(row)
    return Form {
      Section {
        header(row, versions: loadedVersions, bundle: bundle)
      }
      Section("Details") {
        if kind == .layout {
          AglynDetailRow(
            "Renders inside", value: parent.state.value.flatMap { $0?.string("displayName") } ?? row.parentLayoutID,
            placeholder: "Nothing — it is the outermost layout")
        }
        AglynDetailRow("Updated", value: row.updatedAt.map { relativeTime($0) })
        AglynDetailRow("Created", value: row.createdAt.map { relativeTime($0) })
        AglynDetailRow("ID", value: row.id)
      }
      if row.isStarterBundle { starterBundle(row, bundle: bundle) }
      if kind.versionKind != nil {
        versionsCard(row)
        UsedByCard(api: api, row: row)
      }
    }
    .formStyle(.aglynGrouped)
    .aglynListBackground()
    .task(id: row.parentLayoutID) {
      guard kind == .layout, let parentID = row.parentLayoutID else { return }
      await parent.bind(context.firestore, ["hosts", hostID, "layouts", parentID])
    }
    .task(id: row.starterID) {
      guard let starterID = row.starterID else { return }
      await siblings.bind(
        context.firestore,
        FirestoreQuery(["hosts", hostID, "templates"], equals: [(field: "source.starterId", value: starterID)], limit: 100))
    }
    .accessibilityIdentifier("\(kind.singular)-detail")
  }

  @ViewBuilder
  private func header(_ row: ArtifactRow, versions loaded: [ArtifactVersion], bundle: [ArtifactRow]) -> some View {
    HStack {
      Text(row.name).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
      Spacer()
      Menu {
        Button("Edit details", systemImage: "pencil") { open(.details(row)) }.disabled(!canEdit)
        if !row.isStarterBundle { Button("Duplicate", systemImage: "square.on.square") { open(.duplicate(row)) }.disabled(!canEdit) }
        if kind != .template { Button("Save as template", systemImage: "bookmark") { open(.saveTemplate(row)) }.disabled(!canEdit) }
        // Publishing is the marketplace's (the console's `hostArtifactPublish` zone): offered only where a plugin fills the
        // zone, opening its form with what this is and what it is called.
        if kind != .template, !context.slotWidgets(artifactPublishSlot).isEmpty {
          Button("Publish to marketplace", systemImage: "storefront") {
            context.navigate(
              kind == .component ? "marketplace.publishComponent" : "marketplace.publishLayout",
              ["id": row.id, "name": row.name, "description": row.description ?? ""])
          }
        }
        Button(row.isStarterBundle ? "Delete bundle" : "Delete", systemImage: "trash", role: .destructive) {
          open(row.isStarterBundle ? .deleteBundle(lead: row, pages: bundle.isEmpty ? [row] : bundle) : .delete(row, siblings: []))
        }
        .disabled(!canEdit)
      } label: {
        Image(systemName: "ellipsis.circle")
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
      .accessibilityLabel("Actions")
    }
    HStack(spacing: AglynSpace.one) {
      switch kind {
      case .component: StatusChip("Used in \(componentPlacementLabel(row.kind).lowercased())s", tone: .info)
      case .template:
        StatusChip(templateKindLabel(row.kind), tone: .info)
        StatusChip(templateSourceLabel(row.sourceType))
      case .layout: EmptyView()
      }
    }
    if let description = row.description { Text(description).font(AglynFont.subheadline).foregroundStyle(.secondary) }
    HStack {
      Button {
        edit(row, versions: loaded)
      } label: {
        Label("Edit in the Besigner", systemImage: "wand.and.stars")
      }
      .buttonStyle(.aglynProminent)
      .disabled(runner.busy || (kind != .template && versions.state.isLoading) || (!canEdit && versionToOpen(row, versions: loaded) == nil))
      .accessibilityIdentifier("artifact-edit-besigner")
      let preview = artifactBesignerPath(kind, id: row.id, versionID: row.versionID, preview: true)
      Button {
        if let preview { context.openBesigner(preview) }
      } label: {
        Label("Preview", systemImage: "eye")
      }
      .buttonStyle(.aglynSecondary)
      .disabled(preview == nil)
      .accessibilityIdentifier("artifact-preview")
      if kind == .template {
        Button {
          open(.use(row))
        } label: {
          Label(row.isStarterBundle ? "Use this starter site" : "Use this template", systemImage: "plus")
        }
        .buttonStyle(.aglynSecondary)
        .disabled(!canEdit)
        .accessibilityIdentifier("use-template")
      }
    }
    if let error = runner.error { AglynNotice(error, tone: .error) { runner.clear() } }
  }

  private func edit(_ row: ArtifactRow, versions loaded: [ArtifactVersion]) {
    if kind == .template {
      if let path = artifactBesignerPath(kind, id: row.id, versionID: nil) { context.openBesigner(path) }
      return
    }
    runner.run {
      let versionID = try await api.ensureVersion(row, versions: loaded)
      if let path = artifactBesignerPath(kind, id: row.id, versionID: versionID) { context.openBesigner(path) }
    }
  }

  private func starterBundle(_ lead: ArtifactRow, bundle: [ArtifactRow]) -> some View {
    Section("Starter bundle") {
      if bundle.isEmpty { Text("Loading the bundle's pages…").foregroundStyle(.secondary) }
      ForEach(bundle) { page in
        AglynRow(page.name, subtitle: page.description, systemImage: "doc.text") {
          HStack(spacing: AglynSpace.one) {
            Button("Open") {
              if let path = artifactBesignerPath(kind, id: page.id, versionID: nil) { context.openBesigner(path) }
            }
            .buttonStyle(.borderless)
            Button("Delete", role: .destructive) { open(.delete(page, siblings: bundle)) }
              .buttonStyle(.borderless)
              .disabled(!canEdit)
          }
        }
        .accessibilityIdentifier("starter-page-\(page.id)")
      }
      if let name = lead.starterName {
        Text("\(bundle.count) pages from \(name)").font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func versionsCard(_ row: ArtifactRow) -> some View {
    Section("Versions") {
      switch versions.state {
      case .loading: SkeletonRows(count: 2)
      case .failed: Text("Versions could not be loaded.").foregroundStyle(.secondary)
      case .ready(let docs):
        let rows = sortedVersions(docs.map(ArtifactVersion.init))
        if rows.isEmpty {
          Text("No saved versions yet. Edit it in the Besigner to make the first.").foregroundStyle(.secondary)
        }
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, version in
          let parts: [String?] = [
            version.createdAt.map { "Saved " + relativeTime($0) },
            version.updatedAt.flatMap { $0 == version.createdAt ? nil : "edited " + relativeTime($0) },
          ]
          AglynRow(version.name ?? "Version \(rows.count - index)", subtitle: parts.compactMap { $0 }.joined(separator: " · "), systemImage: "clock.arrow.circlepath") {
            HStack(spacing: AglynSpace.one) {
              if version.id == row.versionID { StatusChip("Current", tone: .success) }
              Button("Open") {
                if let path = artifactBesignerPath(kind, id: row.id, versionID: version.id) { context.openBesigner(path) }
              }
              .buttonStyle(.borderless)
            }
          }
          .accessibilityIdentifier("artifact-version-\(version.id)")
        }
      }
    }
  }
}

private struct UsedByCard: View {
  let api: ArtifactsAPI
  let row: ArtifactRow
  @State private var state: LiveValue<ArtifactUsage?> = .loading

  var body: some View {
    Section("Used by") {
      switch state {
      case .loading: SkeletonRows(count: 2)
      case .failed: Text("Where it is used could not be checked.").foregroundStyle(.secondary)
      case .ready(let usage):
        let found = usage?.dependents ?? []
        if found.isEmpty {
          Text(usage?.complete == true ? "Nothing uses it yet." : "Nothing found so far; the check could not read everything.")
            .foregroundStyle(.secondary)
        }
        ForEach(found) { item in
          AglynRow(item.name, subtitle: dependentLabel(item.type), systemImage: item.type == "screen" ? "doc.text" : "square.on.square.dashed")
        }
      }
    }
    .task(id: row.id) {
      do {
        state = .ready(try await api.usage(row))
      } catch is CancellationError {
      } catch {
        state = .failed("")
      }
    }
  }
}

// MARK: - Sheets

private struct ArtifactDialogSheet: View {
  let context: NativePluginContext
  let hostID: String
  let kind: ArtifactKind
  let dialog: ArtifactDialog
  let api: ArtifactsAPI
  let runner: ActionRunner
  let onCreated: (String) -> Void
  let onDeleted: (String) -> Void
  let onOpen: (ArtifactDialog) -> Void
  let close: () -> Void

  var body: some View {
    Group {
      switch dialog {
      case .gallery:
        TemplateGallerySheet(context: context, hostID: hostID, kind: kind == .layout ? "layout" : "component", onChoose: { onOpen(.use($0)) }, close: close)
      case .use(let row):
        UseTemplateSheet(context: context, hostID: hostID, row: row, onDone: { usedKind, id in
          close()
          let destination = templateUseDestination(kind: usedKind, id: id)
          context.navigate(destination.screen, destination.params)
        }, close: close)
      case .saveTemplate(let row):
        SaveAsTemplateSheet(
          context: context, hostID: hostID, kind: kind == .layout ? "layout" : "component", defaultName: row.name,
          load: { templates in
            kind == .layout ? try await templates.layoutSource(row.id, versionID: row.versionID) : try await templates.componentSource(row.id)
          },
          onSaved: { message in
            runner.notice = message
            close()
          }, close: close)
      case .create:
        CreateArtifactSheet(kind: kind, api: api, runner: runner, onCreated: onCreated, close: close)
      case .details(let row):
        ArtifactDetailsSheet(context: context, hostID: hostID, kind: kind, row: row, api: api, runner: runner, close: close)
      case .duplicate(let row):
        DuplicateSheet(row: row, api: api, runner: runner, onCreated: onCreated, close: close)
      case .deleteBundle(let lead, let pages):
        AglynActionSheet(
          "Delete \(lead.starterName ?? lead.name)?",
          message: "All \(pages.count) pages of this starter bundle leave the library. Pages already made from them keep their design.",
          confirmLabel: "Delete bundle", destructive: true, busy: runner.busy, error: runner.error, onCancel: close,
          onConfirm: {
            runner.run("The bundle was deleted.", onDone: close) {
              try await api.deleteBundle(pages)
              onDeleted(lead.id)
            }
          }
        ) { EmptyView() }
      case .delete(let row, let siblings):
        AglynActionSheet(
          "Delete \(row.name)?", message: deleteWords(row, siblings), confirmLabel: "Delete", destructive: true, busy: runner.busy,
          error: runner.error, onCancel: close,
          onConfirm: {
            runner.run("\(row.name) was deleted.", onDone: close) {
              if siblings.isEmpty {
                try await api.delete(row.id)
              } else {
                try await api.deleteBundlePage(row, siblings: siblings, wasLead: row.libraryRow)
              }
              onDeleted(row.id)
            }
          }
        ) { EmptyView() }
      }
    }
    .onAppear { runner.clear() }
  }

  private func deleteWords(_ row: ArtifactRow, _ siblings: [ArtifactRow]) -> String {
    if siblings.count > 1 { return "This page leaves the starter bundle; the others stay." }
    if kind == .template { return "Pages already made from it keep their design." }
    return "Pages that use it stop showing it. Check “Used by” first."
  }
}

private struct CreateArtifactSheet: View {
  let kind: ArtifactKind
  let api: ArtifactsAPI
  let runner: ActionRunner
  let onCreated: (String) -> Void
  let close: () -> Void
  @State private var name = ""
  @State private var description = ""
  @State private var subKind = ""
  @State private var starter = "header"

  private var message: String {
    switch kind {
    case .component: "Design it in the Besigner. A block for emails can start as a Header or a Footer."
    case .layout: "It starts with the slot pages appear in; design the rest in the Besigner."
    case .template: "It starts blank; design it in the Besigner, then start new pages from it."
    }
  }

  var body: some View {
    AglynActionSheet(
      "New \(kind.singular)", message: message, confirmLabel: "Create", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy,
      error: runner.error, onCancel: close,
      onConfirm: {
        let (name, description, sub) = (name, description, subKind.isEmpty ? defaultSubKind : subKind)
        runner.run("\(name.trimmed) was created.", onDone: close) {
          onCreated(try await api.create(name: name, description: description, subKind: sub, starter: starter))
        }
      }
    ) {
      VStack(alignment: .leading) {
        TextField("Name", text: Binding(get: { name }, set: { name = $0.capped(artifactNameMax) })).accessibilityIdentifier("artifact-name")
        AglynCharacterCount(name.count, of: artifactNameMax)
      }
      VStack(alignment: .leading) {
        TextField("Description (optional)", text: Binding(get: { description }, set: { description = $0.capped(artifactDescriptionMax) }))
        AglynCharacterCount(description.count, of: artifactDescriptionMax)
      }
      switch kind {
      case .component:
        Picker("Used in", selection: Binding(get: { subKind.isEmpty ? defaultSubKind : subKind }, set: { subKind = $0 })) {
          Text("Pages").tag("site")
          Text("Emails").tag("email")
        }
        if (subKind.isEmpty ? defaultSubKind : subKind) == "email" {
          Picker("Start with", selection: $starter) {
            Text("Header — your logo and company name").tag("header")
            Text("Footer — your address, and why people get your emails").tag("footer")
            Text("Blank — start with nothing").tag("blank")
          }
          Text("Change anything you like after.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      case .template:
        Picker("Kind", selection: Binding(get: { subKind.isEmpty ? defaultSubKind : subKind }, set: { subKind = $0 })) {
          ForEach(ContractValues.shared.templateKindOptions, id: \.value) { Text($0.label).tag($0.value) }
        }
      case .layout:
        EmptyView()
      }
    }
  }

  private var defaultSubKind: String { kind == .component ? "site" : kind == .template ? "page" : "" }
}

private struct ArtifactDetailsSheet: View {
  let context: NativePluginContext
  let hostID: String
  let kind: ArtifactKind
  let row: ArtifactRow
  let api: ArtifactsAPI
  let runner: ActionRunner
  let close: () -> Void
  @State private var name = ""
  @State private var description = ""
  @State private var parent = ""
  @State private var icon: ComponentIcon?
  @State private var choosingIcon = false
  @State private var layouts = LiveQuery()

  private var parents: [ArtifactRow] {
    guard kind == .layout else { return [] }
    return nestableParents(of: row.id, in: (layouts.state.value ?? []).compactMap(ArtifactRow.init))
  }

  var body: some View {
    AglynActionSheet(
      "Edit details", confirmLabel: "Save", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error, onCancel: close,
      onConfirm: {
        let (name, description, parent) = (name, description, parent)
        let iconWrite: [String: Any]? = kind == .component && icon?.id != row.icon?.id ? (icon?.stored ?? [:]) : nil
        runner.run("Saved.", onDone: close) {
          try await api.saveDetails(
            row.id, name: name, description: description, parentLayoutID: parent.isEmpty ? nil : parent,
            setParent: kind == .layout && (parent.isEmpty ? nil : parent) != row.parentLayoutID, icon: iconWrite)
        }
      }
    ) {
      TextField("Name", text: Binding(get: { name }, set: { name = $0.capped(artifactNameMax) })).accessibilityIdentifier("details-name")
      TextField("Description", text: Binding(get: { description }, set: { description = $0.capped(artifactDescriptionMax) }))
      if kind == .component {
        ComponentIconField(icon: icon, onChoose: { choosingIcon = true }, onClear: { icon = nil })
      }
      if kind == .layout {
        Picker("Renders inside", selection: $parent) {
          Text("Nothing (outermost layout)").tag("")
          ForEach(parents) { Text($0.name).tag($0.id) }
        }
        AglynHelperText("Pages using this layout are wrapped in that one too.")
      }
    }
    .onAppear {
      name = row.name
      description = row.description ?? ""
      parent = row.parentLayoutID ?? ""
      icon = row.icon
    }
    .sheet(isPresented: $choosingIcon) {
      ComponentIconPicker(
        api: context.api, current: icon, onPick: { icon = $0; choosingIcon = false }, close: { choosingIcon = false })
    }
    .task(id: hostID) {
      guard kind == .layout else { return }
      await layouts.bind(context.firestore, FirestoreQuery(["hosts", hostID, "layouts"], order: [.init("__name__")], limit: 100))
    }
  }
}

private struct DuplicateSheet: View {
  let row: ArtifactRow
  let api: ArtifactsAPI
  let runner: ActionRunner
  let onCreated: (String) -> Void
  let close: () -> Void
  @State private var name = ""

  var body: some View {
    AglynActionSheet(
      "Duplicate \(row.name)", confirmLabel: "Duplicate", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy,
      error: runner.error, onCancel: close,
      onConfirm: {
        let name = name
        runner.run("Copy added.", onDone: close) {
          if let id = try await api.duplicate(sourceID: row.id, name: name) { onCreated(id) }
        }
      }
    ) {
      TextField("Name of the copy", text: Binding(get: { name }, set: { name = $0.capped(duplicateNameMax) }))
    }
    .onAppear { name = String((duplicateNamePrefix + row.name).prefix(duplicateNameMax)) }
  }
}
