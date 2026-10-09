// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Roles that may write entries and collections (`hostRoleCanWrite`); publishing needs `contentPublishRoles`.
private let contentWriteRoles: Set<String> = ["admin", "editor", "author"]
private let contentPublishRoles: Set<String> = ["admin", "editor"]

/// A moment in UTC, the way the entry editor states times.
func formatUTC(_ date: Date) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(identifier: "UTC")
  formatter.dateFormat = "yyyy-MM-dd HH:mm"
  return formatter.string(from: date) + " UTC"
}

/// What the content screen's sheet is asking for.
private enum ContentDialog: Identifiable {
  case newCollection
  case settings(String)
  case categories(String)
  case deleteCollection(String)
  case newEntry(String)
  case schedule(String, ContentEntry)
  case publishedDate(String, ContentEntry)
  case deleteEntry(String, ContentEntry)

  var id: String {
    switch self {
    case .newCollection: "new-collection"
    case .settings(let id): "settings-\(id)"
    case .categories(let id): "categories-\(id)"
    case .deleteCollection(let id): "delete-collection-\(id)"
    case .newEntry(let id): "new-entry-\(id)"
    case .schedule(_, let entry): "schedule-\(entry.id)"
    case .publishedDate(_, let entry): "published-date-\(entry.id)"
    case .deleteEntry(_, let entry): "delete-entry-\(entry.id)"
    }
  }
}

/// What the content screens share: who is asking, the writes, the one runner
/// whose notice and refusals they all show.
private struct ContentEnv {
  let context: NativePluginContext
  let hostID: String
  let api: ContentAPI
  let runner: ActionRunner
  let canWrite: Bool
  let canPublish: Bool
  let routing: SiteRouting
  let open: (ContentDialog) -> Void
}

/// A site's content as the console's Content page shows it: pick a
/// collection, then its entries beside the picked one in a wide window —
/// search, the status filter, create, edit every field, publish, schedule,
/// re-date, view on the site and delete — and the collection's own settings,
/// categories and pages.
struct ContentScreen: View {
  let context: NativePluginContext
  var initialCollection: String?
  var initialEntry: String?
  @State private var collectionsLive = LiveQuery()
  @State private var host = LiveDocument()
  @State private var runner = ActionRunner(roleHint: "an author, editor or admin")
  @State private var dialog: ContentDialog?
  @State private var picked: String?
  @State private var selection: String?
  @State private var seeded = false

  var body: some View {
    Group {
      if let hostID = context.hostID {
        content(hostID)
          .task(id: hostID) { await collectionsLive.bind(context.firestore, FirestoreQuery(["hosts", hostID, "collections"], limit: 50)) }
          .task(id: hostID) { await host.bind(context.firestore, ["hosts", hostID]) }
      } else {
        AglynEmptyState("Pick a site first", systemImage: SiteSymbols.site)
      }
    }
    .navigationTitle("Content")
  }

  @ViewBuilder
  private func content(_ hostID: String) -> some View {
    switch collectionsLive.state {
    case .loading:
      List { SkeletonRows(count: 8) }.aglynListBackground()
    case .failed:
      AglynEmptyState("Could not load this site's content", systemImage: SiteSymbols.error, message: "Check the connection and try again.")
    case .ready(let docs):
      let collections = sortedCollections(docs)
      let current = collections.first { $0.id == picked || $0.slug == picked } ?? collections.first
      let env = makeEnv(hostID)
      Group {
        if let current {
          CollectionEntries(env: env, collection: current, collections: collections, picked: $picked, selection: $selection)
            .id(current.id)
        } else {
          AglynEmptyState(
            "No collections yet", systemImage: "doc.richtext", message: "A collection holds posts or articles, each with its own page on your site."
          ) {
            Button("New collection") { dialog = .newCollection }
              .buttonStyle(.borderedProminent)
              .disabled(!env.canWrite)
              .accessibilityIdentifier("add-collection")
          }
        }
      }
      .onAppear {
        if !seeded {
          seeded = true
          picked = initialCollection
          selection = initialEntry.flatMap { $0 == "new" ? nil : $0 }
        }
      }
      .sheet(item: $dialog) { dialog in
        ContentDialogSheet(env: env, dialog: dialog, collections: collections, onCollection: { picked = $0 }, onEntry: { selection = $0 }) {
          self.dialog = nil
        }
      }
    }
  }

  private func makeEnv(_ hostID: String) -> ContentEnv {
    ContentEnv(
      context: context, hostID: hostID,
      api: ContentAPI(api: context.api, writer: context.writer, reader: context.firestore, hostID: hostID), runner: runner,
      canWrite: contentWriteRoles.contains(context.siteRole ?? ""), canPublish: contentPublishRoles.contains(context.siteRole ?? ""),
      routing: SiteRouting(host: host.state.value ?? nil), open: { dialog = $0 })
  }
}

private func entryTone(_ status: String) -> AglynTone {
  switch status {
  case "published": .success
  case "scheduled": .info
  default: .neutral
  }
}

private struct CollectionEntries: View {
  let env: ContentEnv
  let collection: ContentCollection
  let collections: [ContentCollection]
  @Binding var picked: String?
  @Binding var selection: String?
  @State private var model = EntryListModel()
  @State private var searchText = ""

  private var isAdmin: Bool { env.context.siteRole == "admin" }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection {
              EntryEditor(env: env, collection: collection, entryID: selection, model: model).id(selection)
            } else {
              AglynEmptyState("Pick an entry to edit it here", systemImage: "doc.richtext")
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
          .navigationDestination(item: $selection) { id in
            EntryEditor(env: env, collection: collection, entryID: id, model: model).id(id)
          }
      }
    }
    .task(id: collection.id) { model.start(env.context.firestore, hostID: env.hostID, collectionID: collection.id) }
    .onDisappear { model.stop() }
    .searchable(text: $searchText, prompt: "Search titles")
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          env.open(.newEntry(collection.id))
        } label: {
          Label("New entry", systemImage: "plus")
        }
        .disabled(!env.canWrite)
        .keyboardShortcut("n", modifiers: .command)
        .accessibilityIdentifier("add-entry")
      }
      ToolbarItem(placement: .secondaryAction) {
        Menu {
          Button("New collection", systemImage: "plus") { env.open(.newCollection) }.disabled(!env.canWrite)
          Button("Collection settings", systemImage: "gearshape") { env.open(.settings(collection.id)) }.disabled(!env.canWrite)
          Button("Categories", systemImage: "tag") { env.open(.categories(collection.id)) }.disabled(!env.canWrite)
          Button("Delete collection", systemImage: "trash", role: .destructive) { env.open(.deleteCollection(collection.id)) }
            .disabled(!isAdmin)
        } label: {
          Label("Collection", systemImage: "ellipsis.circle")
        }
        .accessibilityIdentifier("collection-menu")
      }
    }
  }

  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      Picker("Collection", selection: Binding(get: { collection.id }, set: { picked = $0 })) {
        ForEach(collections) { Text("\($0.name) (/\($0.slug))").tag($0.id) }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.top, AglynSpace.one)
      .accessibilityIdentifier("collection-picker")
      AglynChipRow(
        [AglynChipOption("all", "All")] + ContractValues.shared.entryStatusOptions.map { AglynChipOption($0.value, $0.label) },
        selected: model.status ?? "all"
      ) { model.status = $0 == "all" ? nil : $0 }
      if let notice = env.runner.notice {
        AglynNotice(notice, tone: .success) { env.runner.clear() }.padding(.horizontal, AglynSpace.two)
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
      AglynEmptyState("Could not load entries", systemImage: SiteSymbols.error, message: message) {
        Button("Try again") { model.refresh() }
      }
    case .ready(let rows) where rows.isEmpty:
      let filtered = !model.search.isEmpty || model.status != nil
      AglynEmptyState(
        filtered ? "No entries match" : "No entries yet", systemImage: "doc.richtext",
        message: filtered ? "Try another search." : "Write the first \(collection.name.lowercased()) entry.")
    case .ready(let rows):
      if selectable {
        List(selection: $selection) {
          ForEach(rows) { entry in
            entryRow(entry).tag(entry.id).aglynListRow().accessibilityIdentifier("entry-\(entry.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more entries") { model.loadMore() } }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .refreshable { model.refresh() }
        .aglynListBackground()
        .accessibilityIdentifier("entries-list")
      } else {
        List {
          ForEach(rows) { entry in
            Button {
              selection = entry.id
            } label: {
              entryRow(entry)
            }
            .buttonStyle(.plain)
            .aglynListRow()
            .accessibilityIdentifier("entry-\(entry.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more entries") { model.loadMore() } }
        }
        .refreshable { model.refresh() }
        .aglynListBackground()
        .accessibilityIdentifier("entries-list")
      }
    }
  }

  private func entryRow(_ entry: ContentEntry) -> some View {
    let parts: [String?] = ["/\(collection.slug)/\(entry.slug)", entry.updatedAt.map { "edited " + relativeTime($0) }]
    return AglynRow(entry.title, subtitle: parts.compactMap { $0 }.joined(separator: " · "), systemImage: "doc.richtext") {
      StatusChip(entryStatusLabel(entry.status), tone: entryTone(entry.status))
    }
  }
}

// MARK: - Entry editor

private struct EntryEditor: View {
  let env: ContentEnv
  let collection: ContentCollection
  let entryID: String
  let model: EntryListModel
  @Environment(\.openURL) private var openURL
  @State private var live = LiveDocument()
  @State private var authors = LiveQuery()

  var body: some View {
    Group {
      switch live.state {
      case .loading:
        List { SkeletonRows(count: 8) }.aglynListBackground()
      case .failed:
        AglynEmptyState("Could not load this entry", systemImage: SiteSymbols.error, message: "Check the connection and try again.")
      case .ready(nil):
        AglynEmptyState("This entry is gone", systemImage: "doc.richtext")
      case .ready(let doc?):
        EntryForm(
          env: env, collection: collection, entry: ContentEntry(doc),
          authors: (authors.state.value ?? []).map(ContentAuthor.init).sorted { $0.name.lowercased() < $1.name.lowercased() },
          model: model, openURL: { openURL($0) })
      }
    }
    .navigationTitle("Entry")
    .task(id: entryID) {
      await live.bind(env.context.firestore, ["hosts", env.hostID, "collections", collection.id, "entries", entryID])
    }
    .task(id: env.hostID) { await authors.bind(env.context.firestore, FirestoreQuery(["hosts", env.hostID, "authors"], limit: 100)) }
  }
}

private struct EntryForm: View {
  let env: ContentEnv
  let collection: ContentCollection
  let entry: ContentEntry
  let authors: [ContentAuthor]
  let model: EntryListModel
  let openURL: (URL) -> Void
  @State private var draft: EntryDraft
  @State private var saver = ActionRunner(roleHint: "an author, editor or admin")

  init(
    env: ContentEnv, collection: ContentCollection, entry: ContentEntry, authors: [ContentAuthor], model: EntryListModel,
    openURL: @escaping (URL) -> Void
  ) {
    self.env = env
    self.collection = collection
    self.entry = entry
    self.authors = authors
    self.model = model
    self.openURL = openURL
    _draft = State(initialValue: EntryDraft(entry))
  }

  private var stored: EntryDraft { EntryDraft(entry) }
  private var titleError: String? { draft.title.trimmed.isEmpty ? "Required" : nil }
  private var slugError: String? { draft.effectiveSlug.isEmpty ? "Add a title or an address" : nil }

  var body: some View {
    Form {
      header
      entryCard
      mediaCard
      searchCard
      Section("Details") {
        AglynDetailRow("Published", value: entry.publishedAt.map(formatUTC), placeholder: "Not published")
        AglynDetailRow("Updated", value: entry.updatedAt.map { relativeTime($0) })
        AglynDetailRow("Entry id", value: entry.id)
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .onChange(of: stored) { _, next in draft = next }
    .accessibilityIdentifier("entry-editor")
  }

  private var header: some View {
    Section {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.title).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
          Text("/\(collection.slug)/\(entry.slug)").font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        Spacer()
        Menu {
          Button("Schedule…", systemImage: "clock") { env.open(.schedule(collection.id, entry)) }
            .disabled(!env.canPublish || entry.status == "published")
          Button("Edit published date…", systemImage: "calendar") { env.open(.publishedDate(collection.id, entry)) }
            .disabled(!env.canPublish || entry.publishedAt == nil)
          Button("Delete", systemImage: "trash", role: .destructive) { env.open(.deleteEntry(collection.id, entry)) }
            .disabled(!env.canWrite)
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel("Entry actions")
      }
      HStack(spacing: AglynSpace.one) {
        StatusChip(entryStatusLabel(entry.status), tone: entryTone(entry.status))
        if entry.status == "scheduled", let at = entry.publishAt { StatusChip("Goes live \(formatUTC(at))", tone: .info) }
      }
      publishButtons
      if !env.canPublish {
        Text("Publishing needs the editor or admin role; you can save drafts.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      if stored != draft {
        Text("Save your changes before publishing.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      if let error = env.runner.error { AglynNotice(error, tone: .error) { env.runner.clear() } }
    }
  }

  @ViewBuilder
  private var publishButtons: some View {
    if entry.status == "published" {
      HStack {
        Button("Unpublish") {
          env.runner.run("Entry unpublished.") {
            try await env.api.setPublished(collection.id, entry: entry, publish: false)
            await env.api.announce(collection.id, slugs: [entry.slug])
          }
        }
        .disabled(!env.canPublish || env.runner.busy)
        .accessibilityIdentifier("entry-unpublish")
        if let url = livePageURL(env.routing, livePath: "/\(collection.slug)/\(entry.slug)").flatMap(URL.init(string:)) {
          Button {
            openURL(url)
          } label: {
            Label("View on site", systemImage: "arrow.up.right.square")
          }
        }
      }
      .buttonStyle(.bordered)
    } else {
      Button(entry.status == "scheduled" ? "Publish now" : "Publish") {
        if !entry.hasByline {
          env.runner.error = entryBylineRequiredMessage
        } else {
          env.runner.run("Entry published.") {
            try await env.api.setPublished(collection.id, entry: entry, publish: true)
            await env.api.announce(collection.id, slugs: [entry.slug])
          }
        }
      }
      .buttonStyle(.borderedProminent)
      .disabled(!env.canPublish || env.runner.busy || stored != draft)
      .accessibilityIdentifier("entry-publish")
    }
  }

  private var titleBinding: Binding<String> {
    Binding(
      get: { draft.title },
      set: { title in
        // The address follows the title until it is published or typed.
        let follow = entry.publishedAt == nil && (draft.slug.isEmpty || draft.slug == contentSlug(draft.title))
        draft.title = title
        if follow { draft.slug = contentSlug(title) }
      })
  }

  private var entryCard: some View {
    AglynFormCard(
      "Entry", dirty: draft != stored, canSave: env.canWrite && titleError == nil && slugError == nil, busy: saver.busy,
      error: saver.error, notice: saver.notice,
      onDiscard: { draft = stored; saver.clear() },
      onSave: save
    ) {
      AglynCountedField("Title", text: titleBinding, required: true, error: titleError, enabled: env.canWrite)
        .accessibilityIdentifier("entry-title")
      AglynCountedField(
        "Address", text: $draft.slug, error: slugError, supporting: "/\(collection.slug)/\(draft.effectiveSlug)", enabled: env.canWrite)
      AglynCountedField(
        "Excerpt", text: $draft.excerpt, multiline: true, supporting: "The summary lists and search results show", enabled: env.canWrite)
      Picker("Category", selection: Binding(get: { draft.categoryID ?? "" }, set: { draft.categoryID = $0.isEmpty ? nil : $0 })) {
        Text("No category").tag("")
        ForEach(collection.categories) { Text($0.name).tag($0.id) }
      }
      .disabled(!env.canWrite)
      if let legacy = entry.legacyCategory, draft.categoryID == nil {
        AglynHelperText("Was “\(legacy)” — pick its category")
      }
      TagsField(tags: $draft.tags, enabled: env.canWrite)
      Picker("Author", selection: Binding(get: { draft.authorID ?? "" }, set: setAuthor)) {
        Text("Custom byline").tag("")
        ForEach(authors) { Text($0.name).tag($0.id) }
      }
      .disabled(!env.canWrite)
      if draft.authorID == nil {
        AglynCountedField(
          "Byline", text: $draft.authorName, supporting: "The name published under this entry", enabled: env.canWrite)
      }
      AglynCountedField(
        "Body", text: $draft.body, multiline: true, supporting: "Markdown: # headings, **bold**, [links](https://…)",
        enabled: env.canWrite)
    }
  }

  private func setAuthor(_ id: String) {
    draft.authorID = id.isEmpty ? nil : id
    if !id.isEmpty { draft.authorName = authors.first { $0.id == id }?.name ?? "" }
  }

  private func save() {
    let (draft, entry, collection) = (draft, entry, collection)
    saver.run("Saved.") {
      let slug = draft.effectiveSlug
      if try await env.api.slugTaken(collection.id, slug: slug, exceptID: entry.id) {
        throw ConsoleAPIError(status: 0, message: "Another entry already uses /\(collection.slug)/\(slug)")
      }
      try await env.api.saveEntry(collection.id, id: entry.id, draft: draft)
      if entry.isLive {
        var slugs = [entry.slug]
        if slug != entry.slug { slugs.append(slug) }
        await env.api.announce(collection.id, slugs: slugs)
      }
    }
  }

  private var mediaCard: some View {
    Section {
      AglynCountedField(
        "Cover image", text: $draft.coverImage, placeholder: "https://… or media:{id}", keyboard: .url, enabled: env.canWrite)
      AglynCountedField(
        "Cover image description", text: $draft.coverImageAlt, enabled: env.canWrite && !draft.coverImage.trimmed.isEmpty)
      AglynCountedField(
        "Cover video", text: $draft.coverVideo, placeholder: "https://… or media:{id}", keyboard: .url, enabled: env.canWrite)
      AglynCountedField(
        "Video length (seconds)",
        text: Binding(get: { draft.coverVideoDuration }, set: { draft.coverVideoDuration = $0.filter(\.isNumber) }),
        keyboard: .number, enabled: env.canWrite && !draft.coverVideo.trimmed.isEmpty)
      Text("Save the entry card to keep media changes.").font(AglynFont.caption).foregroundStyle(.secondary)
    } header: {
      Text("Media")
    }
  }

  private var searchCard: some View {
    Section {
      AglynCountedField(
        "SEO title", text: $draft.seoTitle,
        error: draft.seoTitle.count > entrySeoTitleWarn ? "Search results cut titles past \(entrySeoTitleWarn) characters" : nil,
        supporting: "\(draft.seoTitle.count)/\(entrySeoTitleWarn); empty uses the title", enabled: env.canWrite)
      AglynCountedField(
        "SEO description", text: $draft.seoDescription, multiline: true,
        error: draft.seoDescription.count > entrySeoDescriptionWarn
          ? "Search results cut descriptions past \(entrySeoDescriptionWarn) characters" : nil,
        supporting: "\(draft.seoDescription.count)/\(entrySeoDescriptionWarn); empty uses the excerpt", enabled: env.canWrite)
    } header: {
      Text("Search")
    }
  }
}

/// An entry's tags as chips with a field that adds one on Return.
private struct TagsField: View {
  @Binding var tags: [String]
  let enabled: Bool
  @State private var text = ""

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Text("Tags").font(AglynFont.caption).foregroundStyle(.secondary)
      if !tags.isEmpty {
        FlowChips(tags: tags) { tag in tags.removeAll { $0 == tag } }
      }
      TextField("Add a tag", text: $text)
        .onSubmit(add)
        .disabled(!enabled)
        .accessibilityIdentifier("tag-input")
    }
  }

  private func add() {
    let tag = text.trimmed
    text = ""
    if !tag.isEmpty, !tags.contains(tag) { tags.append(tag) }
  }
}

private struct FlowChips: View {
  let tags: [String]
  let remove: (String) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(tags, id: \.self) { tag in
          Button {
            remove(tag)
          } label: {
            HStack(spacing: 4) {
              Text(tag)
              Image(systemName: "xmark.circle.fill").imageScale(.small)
            }
            .font(AglynFont.subheadline)
            .padding(.horizontal, AglynSpace.oneAndHalf)
            .padding(.vertical, AglynSpace.half)
            .background(AglynColor.tint.opacity(0.12), in: Capsule())
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Remove tag \(tag)")
        }
      }
    }
  }
}

// MARK: - Sheets

private struct ContentDialogSheet: View {
  let env: ContentEnv
  let dialog: ContentDialog
  let collections: [ContentCollection]
  let onCollection: (String) -> Void
  let onEntry: (String) -> Void
  let close: () -> Void
  @State private var screens = LiveQuery()

  private var screenOptions: [TemplateScreen] { templateScreens(screens.state.value ?? []) }

  var body: some View {
    Group {
      switch dialog {
      case .newCollection:
        NewCollectionSheet(env: env, screens: screenOptions, onCollection: onCollection, close: close)
      case .settings(let id):
        if let collection = collections.first(where: { $0.id == id }) {
          CollectionSettingsSheet(env: env, collection: collection, screens: screenOptions, close: close)
        }
      case .categories(let id):
        if let collection = collections.first(where: { $0.id == id }) {
          CategoriesSheet(env: env, collection: collection, close: close)
        }
      case .deleteCollection(let id):
        if let collection = collections.first(where: { $0.id == id }) {
          AglynActionSheet(
            "Delete \(collection.name)?", message: "A collection can only be deleted once it holds no entries and no published page uses it.",
            confirmLabel: "Delete collection", destructive: true, busy: env.runner.busy, error: env.runner.error, onCancel: close,
            onConfirm: {
              env.runner.run("\(collection.name) was deleted.", onDone: close) { try await env.api.deleteCollection(collection.id) }
            }
          ) { EmptyView() }
        }
      case .newEntry(let id):
        if let collection = collections.first(where: { $0.id == id }) {
          NewEntrySheet(env: env, collection: collection, onEntry: onEntry, close: close)
        }
      case .schedule(let collectionID, let entry):
        ScheduleSheet(env: env, collectionID: collectionID, entry: entry, close: close)
      case .publishedDate(let collectionID, let entry):
        PublishedDateSheet(env: env, collectionID: collectionID, entry: entry, close: close)
      case .deleteEntry(let collectionID, let entry):
        AglynActionSheet(
          "Delete this entry?", message: "“\(entry.title)” will be permanently deleted.", confirmLabel: "Delete", destructive: true,
          busy: env.runner.busy, error: env.runner.error, onCancel: close,
          onConfirm: {
            env.runner.run("Entry deleted.", onDone: close) {
              try await env.api.deleteEntry(collectionID, id: entry.id)
              if entry.isLive { await env.api.announce(collectionID, slugs: [entry.slug]) }
            }
          }
        ) { EmptyView() }
      }
    }
    .task(id: env.hostID) { await screens.bind(env.context.firestore, FirestoreQuery(["hosts", env.hostID, "screens"], limit: 200)) }
    .onAppear { env.runner.clear() }
  }
}

private struct ScreenPicker: View {
  let title: String
  let options: [TemplateScreen]
  let none: String
  @Binding var selection: String
  var enabled = true

  var body: some View {
    Picker(title, selection: $selection) {
      Text(none).tag("")
      ForEach(options) { Text($0.kind == "template" ? "\($0.name) · Entry template" : $0.name).tag($0.id) }
    }
    .disabled(!enabled)
  }
}

private struct NewCollectionSheet: View {
  let env: ContentEnv
  let screens: [TemplateScreen]
  let onCollection: (String) -> Void
  let close: () -> Void
  @State private var name = ""
  @State private var slug = ""
  @State private var listScreen = ""
  @State private var entryScreen = ""

  private var effective: String { contentSlug(slug).isEmpty ? contentSlug(name) : contentSlug(slug) }

  var body: some View {
    AglynActionSheet(
      "New collection", message: "Its entries live at /\(effective.isEmpty ? "address" : effective)/… on your site.",
      confirmLabel: "Create", confirmEnabled: !name.trimmed.isEmpty && isCollectionSlug(effective), busy: env.runner.busy,
      error: env.runner.error, onCancel: close,
      onConfirm: {
        let (name, effective, list, entry) = (name, effective, listScreen, entryScreen)
        env.runner.run("\(name.trimmed) was created.", onDone: close) {
          let id = try await env.api.createCollection(
            name: name, slug: effective, listScreenID: list.isEmpty ? nil : list, entryScreenID: entry.isEmpty ? nil : entry)
          onCollection(id)
        }
      }
    ) {
      TextField("Name", text: $name).accessibilityIdentifier("collection-name")
      TextField(contentSlug(name).isEmpty ? "blog" : contentSlug(name), text: $slug)
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
        #endif
      ScreenPicker(title: "List page", options: screens, none: "None yet", selection: $listScreen)
      ScreenPicker(title: "Entry page", options: screens, none: "None yet", selection: $entryScreen)
    }
  }
}

private struct CollectionSettingsSheet: View {
  let env: ContentEnv
  let collection: ContentCollection
  let screens: [TemplateScreen]
  let close: () -> Void
  @State private var name = ""
  @State private var slug = ""

  var body: some View {
    AglynActionSheet(
      "\(collection.name) settings", confirmLabel: "Save name and address",
      confirmEnabled: !name.trimmed.isEmpty && isCollectionSlug(slug) && (name != collection.name || slug != collection.slug),
      busy: env.runner.busy, error: env.runner.error, onCancel: close,
      onConfirm: {
        let (name, slug) = (name, slug)
        env.runner.run("Saved.") { try await env.api.renameCollection(collection.id, name: name, slug: slug) }
      }
    ) {
      TextField("Name", text: $name)
      LabeledContent("Address") {
        HStack(spacing: 2) {
          Text("/").foregroundStyle(.secondary)
          TextField("Address", text: Binding(get: { slug }, set: { slug = contentSlug($0).isEmpty ? $0.lowercased() : contentSlug($0) }))
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
        }
      }
      ScreenPicker(
        title: "List page", options: screens, none: "None",
        selection: Binding(
          get: { collection.listScreenID ?? "" },
          set: { id in env.runner.run("List page saved.") { try await env.api.setListScreen(collection.id, screenID: id.isEmpty ? nil : id) } }),
        enabled: !env.runner.busy)
      ScreenPicker(
        title: "Entry page", options: screens, none: "None",
        selection: Binding(
          get: { collection.entryScreenID ?? "" },
          set: { id in env.runner.run("Entry page saved.") { try await env.api.setEntryScreen(collection.id, screenID: id.isEmpty ? nil : id) } }),
        enabled: !env.runner.busy)
      Picker(
        "Structured data type",
        selection: Binding(
          get: { collection.schemaType ?? ContractValues.shared.contentSchemaTypeDefault.rawValue },
          set: { type in env.runner.run("Saved.") { try await env.api.setSchemaType(collection.id, type) } })
      ) {
        ForEach(ContractValues.shared.contentSchemaTypeOptions, id: \.value) { Text($0.label).tag($0.value) }
      }
      .disabled(env.runner.busy)
      AglynSwitchRow("Keep entries out of site search", isOn: collection.excludeFromSearch, enabled: !env.runner.busy) { on in
        env.runner.run("Saved.") { try await env.api.setExcludeFromSearch(collection.id, on) }
      }
      if let notice = env.runner.notice { AglynNotice(notice, tone: .success) }
    }
    .onAppear {
      name = collection.name
      slug = collection.slug
    }
  }
}

private struct CategoriesSheet: View {
  let env: ContentEnv
  let collection: ContentCollection
  let close: () -> Void
  @State private var categories: [ContentCategory] = []
  @State private var newName = ""

  var body: some View {
    AglynActionSheet(
      "Categories", message: "Entries can be filed under one category each.", confirmLabel: "Save",
      confirmEnabled: categories != collection.categories && categories.allSatisfy { !$0.name.trimmed.isEmpty },
      busy: env.runner.busy, error: env.runner.error, onCancel: close,
      onConfirm: {
        let categories = categories
        env.runner.run("Categories saved.", onDone: close) { try await env.api.setCategories(collection.id, categories) }
      }
    ) {
      ForEach($categories) { $category in
        HStack {
          TextField(category.id, text: $category.name)
          Button(role: .destructive) {
            categories.removeAll { $0.id == category.id }
          } label: {
            Image(systemName: "trash")
          }
          .buttonStyle(.borderless)
          .accessibilityLabel("Remove \(category.name)")
        }
      }
      HStack {
        TextField("New category", text: $newName).accessibilityIdentifier("new-category")
        Button {
          categories.append(ContentCategory(id: newCategoryID(newName, existing: categories), name: newName.trimmed))
          newName = ""
        } label: {
          Image(systemName: "plus.circle.fill")
        }
        .buttonStyle(.borderless)
        .disabled(newName.trimmed.isEmpty || categories.count >= collectionCategoriesMax)
        .accessibilityLabel("Add category")
      }
    }
    .onAppear { categories = collection.categories }
  }
}

private struct NewEntrySheet: View {
  let env: ContentEnv
  let collection: ContentCollection
  let onEntry: (String) -> Void
  let close: () -> Void
  @State private var title = ""

  var body: some View {
    let slug = contentSlug(title)
    AglynActionSheet(
      "New \(collection.name) entry", message: "It starts as a draft at /\(collection.slug)/\(slug.isEmpty ? "…" : slug).",
      confirmLabel: "Create draft", confirmEnabled: !slug.isEmpty, busy: env.runner.busy, error: env.runner.error, onCancel: close,
      onConfirm: {
        let title = title
        env.runner.run("Draft created.", onDone: close) {
          if try await env.api.slugTaken(collection.id, slug: slug, exceptID: nil) {
            throw ConsoleAPIError(status: 0, message: "Another entry already uses /\(collection.slug)/\(slug)")
          }
          let id = try await env.api.createEntry(collection.id, title: title, slug: slug)
          onEntry(id)
        }
      }
    ) {
      TextField("Title", text: $title).accessibilityIdentifier("entry-new-title")
    }
  }
}

private struct ScheduleSheet: View {
  let env: ContentEnv
  let collectionID: String
  let entry: ContentEntry
  let close: () -> Void
  @State private var at = Date().addingTimeInterval(3600)

  var body: some View {
    AglynActionSheet(
      "Schedule \(entry.title)",
      message: "It goes live on its own at that time (times are UTC). Scheduled publishing is part of the Business plan.",
      confirmLabel: "Schedule", confirmEnabled: isFuture(at) && env.canPublish && entry.hasByline, busy: env.runner.busy,
      error: env.runner.error ?? (entry.hasByline ? nil : entryBylineRequiredMessage), onCancel: close,
      onConfirm: {
        let time = at
        env.runner.run("Scheduled for \(formatUTC(time)).", onDone: close) {
          try await env.api.schedule(collectionID, entry: entry, at: time)
          await env.api.announce(collectionID, slugs: [entry.slug])
        }
      }
    ) {
      DatePicker("Goes live", selection: $at)
      if !isFuture(at) { AglynHelperText("Pick a future time", isError: true) }
    }
  }
}

private struct PublishedDateSheet: View {
  let env: ContentEnv
  let collectionID: String
  let entry: ContentEntry
  let close: () -> Void
  @State private var at = Date()

  var body: some View {
    AglynActionSheet(
      "Published date", message: "The date the entry shows. It cannot be in the future — schedule it instead.", confirmLabel: "Save",
      confirmEnabled: !isFuture(at) && env.canPublish, busy: env.runner.busy, error: env.runner.error, onCancel: close,
      onConfirm: {
        let time = at
        env.runner.run("Published date saved.", onDone: close) {
          try await env.api.setPublishedDate(collectionID, entry: entry, at: time)
          if entry.isLive { await env.api.announce(collectionID, slugs: [entry.slug]) }
        }
      }
    ) {
      DatePicker("Published", selection: $at)
    }
    .onAppear { at = entry.publishedAt ?? Date() }
  }
}
