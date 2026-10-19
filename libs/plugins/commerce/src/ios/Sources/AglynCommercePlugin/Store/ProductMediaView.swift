// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import Observation
import SwiftUI

/// Makes a file private for paid delivery, as the console's `usePaidMediaAttach` does: where else it is used, the author's
/// confirmation in the console's words, then the library's own private switch.
@MainActor
@Observable
final class PaidMediaProtector {
  var question: PaidMediaQuestion?
  /// A refusal or a warning the person should read.
  var note: String?
  @ObservationIgnored private var answer: CheckedContinuation<Bool, Never>?

  private func ask(_ question: PaidMediaQuestion) async -> Bool {
    await withCheckedContinuation { continuation in
      self.question = question
      answer = continuation
    }
  }

  func respond(_ yes: Bool) {
    question = nil
    answer?.resume(returning: yes)
    answer = nil
  }

  private func body(_ scope: String, _ fields: [String: JSONValue]) -> JSONValue {
    .object(paidMediaScopeBody(scope).mapValues { JSONValue.string($0) }.merging(fields) { _, new in new })
  }

  /// Asks where else the file is used: the places beside this product, and how far the scan got.
  private func uses(scope: String, mediaID: String, hostID: String, productID: String, api: ConsoleAPIClient) async -> (
    [PaidMediaReference], PaidMediaUsageCheck
  ) {
    do {
      let answer = try await api.request(
        "/api/media/references", method: .post, body: body(scope, ["mediaId": .string(mediaID)]))
      let all = (answer?["references"]?.arrayValue ?? []).map { entry in
        PaidMediaReference(
          kind: entry["kind"]?.stringValue ?? "", id: entry["id"]?.stringValue ?? "", name: entry["name"]?.stringValue ?? "",
          hostID: entry["hostId"]?.stringValue ?? "", collectionID: entry["collectionId"]?.stringValue)
      }
      return (usesBesideProduct(all, hostID: hostID, productID: productID), answer?["complete"] == .bool(true) ? .full : .partial)
    } catch {
      // Said in the confirmation instead: "we could not check" is not "nothing uses it".
      return ([], .failed)
    }
  }

  /// True when the file is private now. `adding` is whether it is on its way into the product, for the words of a refusal.
  func protect(
    scope: String, mediaID: String, kind: PaidMediaKind, adding: Bool, hostID: String, productID: String, api: ConsoleAPIClient
  ) async -> Bool {
    note = nil
    let (others, checked) = await uses(scope: scope, mediaID: mediaID, hostID: hostID, productID: productID, api: api)
    let confirmed = await ask(
      PaidMediaQuestion(title: kind.title, message: paidMediaConfirmation(others: others, checked: checked, kind: kind)))
    guard confirmed else { return false }
    do {
      let answer = try await api.request(
        "/api/media/folders", method: .post,
        body: body(scope, ["action": "set-private", "mediaId": .string(mediaID), "private": .bool(true)]))
      if answer?["rawUrlCleared"] == .bool(false) {
        note =
          "The video is private, but an old public download link to it could not be confirmed dead. Make it private again from the media library to retry."
      }
      return true
    } catch {
      let reason = (error as? ConsoleAPIError)?.message ?? "Could not make the video private"
      note = "\(reason). \(adding ? kind.notAdded : kind.unusable)"
      return false
    }
  }
}

/// What the library picker is asked for.
private enum ProductMediaChoice: String, Identifiable {
  case image, file, video
  var id: String { rawValue }
  var kind: String? {
    switch self {
    case .image: "image"
    case .file: nil
    case .video: "video"
    }
  }
  var allowPrivate: Bool { self != .image }
  var paid: PaidMediaKind? {
    switch self {
    case .image: nil
    case .file: .download
    case .video: .video
    }
  }
}

private struct VersionEdit: Identifiable {
  let id: Int
  var text: String
}

/// A product's images and, for a digital product, its paid downloads and members videos: the console's editor sections,
/// saved through the product route as the whole stored product with the one list changed.
struct ProductMediaScreen: View {
  let context: NativePluginContext
  let productID: String
  @State private var model = ProductMediaModel()
  @State private var protector = PaidMediaProtector()
  @State private var source: PickSource?
  @State private var choice: ProductMediaChoice?
  @State private var versionEdit: VersionEdit?
  @State private var limitText = ""
  @State private var working: String?
  @FocusState private var limitFocused: Bool

  private var hostID: String { context.hostID ?? "" }
  private var api: ProductWriteAPI { ConsoleProductWriteAPI(api: context.api) }

  var body: some View {
    Group {
      if !model.ready {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      } else if model.failed {
        AglynEmptyState("Could not load this product", systemImage: "exclamationmark.triangle")
      } else if model.doc == nil {
        AglynEmptyState("This product is not here", systemImage: "shippingbox", message: "It may have been deleted.")
      } else {
        content(model.draft)
      }
    }
    .navigationTitle("Images and files")
    .aglynScreenTitle("Images and files")
    .task(id: "\(hostID):\(productID)") { model.start(context.firestore, hostID: context.hostID, productID: productID) }
    .onDisappear { model.stop() }
    .aglynMediaPicker($source, multiple: true) { files in upload(files) }
    .sheet(item: $choice) { which in
      MediaChooserSheet(context: context, kind: which.kind, allowPrivate: which.allowPrivate) { chosen in choose(which, chosen) }
    }
    .alert(
      protector.question?.title ?? "",
      isPresented: Binding(get: { protector.question != nil }, set: { if !$0 { protector.respond(false) } }),
      presenting: protector.question
    ) { _ in
      Button("Make private") { protector.respond(true) }
      Button("Cancel", role: .cancel) { protector.respond(false) }
    } message: { question in
      Text(question.message)
    }
    .alert(
      "Version", isPresented: Binding(get: { versionEdit != nil }, set: { if !$0 { versionEdit = nil } })
    ) {
      TextField("Version", text: Binding(get: { versionEdit?.text ?? "" }, set: { versionEdit?.text = String($0.prefix(20)) }))
      Button("Save") {
        if let edit = versionEdit { Task { await apply(.setVersion(edit.id, edit.text)) } }
        versionEdit = nil
      }
      Button("Cancel", role: .cancel) { versionEdit = nil }
    }
  }

  private func content(_ draft: ProductMediaDraft) -> some View {
    List {
      if let message = model.message ?? protector.note {
        Section { AglynNotice(message, tone: .warning).listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
      }
      if let working {
        Section { Label(working, systemImage: "arrow.up.circle") }
      }
      Section {
        ForEach(Array(draft.images.enumerated()), id: \.offset) { index, reference in
          HStack(spacing: AglynSpace.two) {
            AglynRemoteImage(
              mediaPreviewURL(reference, origin: context.api.origin, hostID: context.hostID, width: 160), systemImage: "photo"
            )
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
            .accessibilityHidden(true)
            Text(index == 0 ? "Main image" : "Image \(index + 1)")
            Spacer()
            Button(role: .destructive) {
              Task { await apply(.removeImage(index)) }
            } label: {
              Image(systemName: "minus.circle.fill")
            }
            .buttonStyle(.borderless)
            .disabled(model.busy)
            .accessibilityLabel("Remove image \(index + 1)")
          }
          .accessibilityIdentifier("product-image-\(index)")
        }
        Menu {
          ForEach(PickSource.available) { option in
            Button { source = option } label: { Label(option.label, systemImage: option.systemImage) }
          }
          Button { choice = .image } label: { Label("Choose from media", systemImage: "photo.stack") }
        } label: {
          Label("Add image", systemImage: "plus")
        }
        .disabled(model.busy || working != nil)
        .accessibilityIdentifier("product-add-image")
      } header: {
        Text("Images")
      } footer: {
        Text("The first image is the product's main one. New pictures are added to this site's media library.")
      }
      if draft.isDigital { delivery(draft) }
    }
    .aglynListBackground()
    .onAppear { limitText = draft.downloadLimit.map(String.init) ?? "" }
  }

  @ViewBuilder
  private func delivery(_ draft: ProductMediaDraft) -> some View {
    Section {
      ForEach(draft.files) { file in
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          HStack {
            Text(file.version.isEmpty ? file.fileName : "\(file.fileName) · v\(file.version)").lineLimit(1)
            Spacer()
            PaidMediaChip(context: context, value: file.url, kind: .download, protect: { await protect(file.url, .download) })
          }
          HStack {
            Button("Version") { versionEdit = VersionEdit(id: file.id, text: file.version) }
            Spacer()
            Button("Remove", role: .destructive) { Task { await apply(.removeFile(file.id)) } }
          }
          .buttonStyle(.borderless)
          .disabled(model.busy)
        }
        .accessibilityIdentifier("product-file-\(file.id)")
      }
      Button { choice = .file } label: { Label("Add file (media library)", systemImage: "doc.badge.plus") }
        .disabled(model.busy)
        .accessibilityIdentifier("product-add-file")
      TextField("Download limit", text: $limitText, prompt: Text("Unlimited"))
        .focused($limitFocused)
        .onSubmit { commitLimit(draft) }
        .onChange(of: limitFocused) { _, focused in if !focused { commitLimit(draft) } }
        #if os(iOS)
          .keyboardType(.numberPad)
        #endif
        .accessibilityIdentifier("product-download-limit")
    } header: {
      Text("Digital delivery")
    } footer: {
      Text("Attempts per order. Buyers always download the current files — uploading a new version re-delivers to everyone.")
    }
    Section {
      ForEach(draft.videos) { video in
        HStack {
          Label(video.title.isEmpty ? video.url : video.title, systemImage: "film").lineLimit(1)
          Spacer()
          PaidMediaChip(context: context, value: video.url, kind: .video, protect: { await protect(video.url, .video) })
          Button(role: .destructive) {
            Task { await apply(.removeVideo(video.id)) }
          } label: {
            Image(systemName: "minus.circle.fill")
          }
          .buttonStyle(.borderless)
          .disabled(model.busy)
          .accessibilityLabel("Remove video")
        }
        .accessibilityIdentifier("product-video-\(video.id)")
      }
      Button { choice = .video } label: { Label("Add members video", systemImage: "film") }
        .disabled(model.busy)
        .accessibilityIdentifier("product-add-video")
    } header: {
      Text("Members videos")
    }
  }

  @discardableResult
  private func apply(_ edit: ProductMediaEdit) async -> Bool {
    await model.apply(edit, api: api, hostID: hostID, productID: productID)
  }

  private func commitLimit(_ draft: ProductMediaDraft) {
    guard let parsed = downloadLimitFromText(limitText) else {
      limitText = draft.downloadLimit.map(String.init) ?? ""
      return
    }
    guard parsed != draft.downloadLimit else { return }
    Task { await apply(.setDownloadLimit(parsed)) }
  }

  /// The Make private button on a stored file that is still public.
  private func protect(_ value: String, _ kind: PaidMediaKind) async -> Bool {
    guard case .asset(let scope, let mediaID) = paidMediaSource(value) else { return false }
    return await protector.protect(
      scope: scope, mediaID: mediaID, kind: kind, adding: false, hostID: hostID, productID: productID, api: context.api)
  }

  /// A file picked from the library: an image goes in as it is, a download or a video is made private first.
  private func choose(_ which: ProductMediaChoice, _ chosen: ChosenMedia) {
    Task {
      guard let kind = which.paid else {
        await apply(.addImages([chosen.reference]))
        return
      }
      guard let reference = formatMediaRef(scope: chosen.scope.cdnScope, mediaId: chosen.item.id) else {
        model.message = kind.choose
        return
      }
      if !chosen.item.isPrivate {
        let madePrivate = await protector.protect(
          scope: chosen.scope.cdnScope, mediaID: chosen.item.id, kind: kind, adding: true, hostID: hostID, productID: productID,
          api: context.api)
        guard madePrivate else { return }
      }
      switch which {
      case .file: await apply(.addFile(url: reference, fileName: chosen.item.fileName))
      case .video: await apply(.addVideo(url: reference, title: chosen.item.fileName))
      case .image: break
      }
    }
  }

  /// Photos taken or picked on the device go to this site's library by the library's own upload route, then onto the product.
  private func upload(_ files: [PickedFile]) {
    guard !hostID.isEmpty else { return }
    Task {
      var references: [String] = []
      let library = MediaAPI(api: context.api, scope: .site(hostID: hostID))
      for (index, file) in files.enumerated() {
        guard file.mimeType.lowercased().hasPrefix("image/") else {
          model.message = "\(file.name) is not a picture, so it was not added."
          continue
        }
        working = files.count == 1 ? "Uploading \(file.name)…" : "Uploading \(index + 1) of \(files.count)…"
        do {
          if let id = try await library.upload(file, folderID: nil), let reference = formatMediaRef(scope: hostID, mediaId: id) {
            references.append(reference)
          }
        } catch {
          model.message = (error as? ConsoleAPIError)?.message ?? "\(file.name) could not be uploaded."
          break
        }
      }
      working = nil
      if !references.isEmpty { await apply(.addImages(references)) }
    }
  }
}

/// Whether a stored paid file can be delivered, with the button that fixes a public one (the console's `PaidMediaProtection`).
private struct PaidMediaChip: View {
  let context: NativePluginContext
  let value: String
  let kind: PaidMediaKind
  let protect: () async -> Bool
  @State private var status = PaidMediaStatus()

  var body: some View {
    HStack(spacing: AglynSpace.one) {
      switch status.state {
      case .privateFile: StatusChip("Private", tone: .success)
      case .publicFile:
        StatusChip("Public", tone: .warning)
        Button("Make private") { Task { _ = await protect() } }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("make-private")
      case .missing: StatusChip("Not in the media library", tone: .error)
      case .external: StatusChip("Hosted elsewhere")
      case .malformed: StatusChip("Cannot be played", tone: .error)
      case .checking, .unknown: EmptyView()
      }
    }
    .task(id: value) { status.start(context.firestore, value: value) }
    .onDisappear { status.stop() }
  }
}
