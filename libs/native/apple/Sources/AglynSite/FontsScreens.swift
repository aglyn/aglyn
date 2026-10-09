// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

public enum FontJobStep: Equatable, Sendable {
  case queued, checking, saving, installed, failed

  public var label: String {
    switch self {
    case .queued: "Waiting"
    case .checking: "Checking the license"
    case .saving: "Saving to your media library"
    case .installed: "Installed"
    case .failed: "Failed"
    }
  }
}

/// One file on its way in.
public struct FontJob: Identifiable, Equatable, Sendable {
  public let id = UUID()
  public let fileName: String
  public let bytes: Int
  public var step: FontJobStep
  public var family: String?
  public var weightLabel: String?
  public var replaced = false
  public var warnings: [String] = []
  public var error: String?
}

/// The installer's state: the installed families and the files going in. Files
/// are installed one at a time, so two files for the same slot dropped
/// together never both see no face there and store two copies.
@MainActor
@Observable
public final class FontInstallerModel {
  public private(set) var installed: LiveValue<[InstalledFont]> = .loading
  public private(set) var jobs: [FontJob] = []
  public private(set) var running = false
  public var error: String?
  public var notice: String?

  @ObservationIgnored private var api: FontsAPI?
  @ObservationIgnored private var queue: [(id: UUID, file: PickedFile)] = []

  public init() {}

  public func start(_ api: FontsAPI) async {
    self.api = api
    do {
      installed = .ready(try await api.installed())
    } catch is CancellationError {
    } catch {
      installed = .failed((error as? ConsoleAPIError)?.message ?? "Your fonts could not be loaded.")
    }
  }

  public func add(_ files: [PickedFile]) {
    for file in files {
      let job = FontJob(fileName: file.name, bytes: file.size, step: isFontFileName(file.name) ? .queued : .failed)
      var added = job
      if !isFontFileName(file.name) { added.error = "This is not a font file. Upload a .woff2, .woff, .ttf or .otf file." }
      jobs.insert(added, at: 0)
      if added.step == .queued { queue.append((added.id, file)) }
    }
    runQueue()
  }

  public func dismiss(_ id: UUID) { jobs.removeAll { $0.id == id } }

  private func patch(_ id: UUID, _ change: (inout FontJob) -> Void) {
    if let index = jobs.firstIndex(where: { $0.id == id }) { change(&jobs[index]) }
  }

  private func runQueue() {
    guard !running, let api else { return }
    running = true
    Task { @MainActor in
      defer { running = false }
      while !queue.isEmpty {
        let (id, file) = queue.removeFirst()
        do {
          patch(id) { $0.step = .checking }
          let prepared = try await api.prepare(file)
          patch(id) {
            $0.step = .saving
            $0.family = prepared.family
            $0.weightLabel = prepared.weightLabel
            $0.warnings = prepared.warnings
          }
          let plan = try await api.plan(prepared)
          let stored = try await api.store(prepared, plan: plan)
          installed = .ready(try await api.install(prepared, mediaID: stored.mediaID, version: stored.version))
          patch(id) {
            $0.step = .installed
            $0.replaced = stored.replaced
          }
        } catch {
          patch(id) {
            $0.step = .failed
            $0.error = (error as? ConsoleAPIError)?.message ?? "The font could not be installed. Try again."
          }
        }
      }
    }
  }

  /// Runs one change to the installed families and shows what it left.
  public func change(_ success: String? = nil, _ block: @escaping @Sendable (FontsAPI) async throws -> [InstalledFont]) {
    guard let api else { return }
    error = nil
    notice = nil
    Task { @MainActor in
      do {
        installed = .ready(try await block(api))
        notice = success
      } catch is CancellationError {
      } catch {
        self.error = (error as? ConsoleAPIError)?.message ?? "That did not go through. Check the connection and try again."
      }
    }
  }
}

/// A site's own fonts: the installed families with their role, category and
/// files, and the file chooser that adds more. Part of Setup > Theme.
struct FontInstallerCard: View {
  let context: NativePluginContext
  let hostID: String
  let canEdit: Bool
  @State private var model = FontInstallerModel()
  @State private var pickSource: PickSource?
  @State private var removing: InstalledFont?

  var body: some View {
    Section {
      Text("Upload your own fonts: .woff2, .woff, .ttf or .otf, up to \(fontUploadMaxBytes / 1024 / 1024) MB each. A font that forbids embedding is refused.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        .aglynTask(id: hostID) {
          await model.start(FontsAPI(api: context.api, hostID: hostID))
        }
        .background(Color.clear.sheet(item: $removing) { font in removeSheet(font) })
      if let error = model.error { AglynNotice(error, tone: .error) { model.error = nil } }
      if let notice = model.notice { AglynNotice(notice, tone: .success) { model.notice = nil } }
      installedRows
      Button {
        pickSource = .files
      } label: {
        Label("Add font files", systemImage: "plus")
      }
      .disabled(!canEdit)
      .aglynMediaPicker($pickSource, multiple: true) { files in model.add(files) }
      .accessibilityIdentifier("add-font-files")
      ForEach(model.jobs) { job in jobRow(job) }
    } header: {
      Text("Your fonts")
    }
  }

  @ViewBuilder
  private var installedRows: some View {
    switch model.installed {
    case .loading:
      SkeletonRows(count: 1)
    case .failed(let message):
      Text(message).foregroundStyle(.secondary)
    case .ready(let fonts):
      if fonts.isEmpty { Text("None yet. Add a font file to use it in your theme.").foregroundStyle(.secondary) }
      ForEach(fonts) { font in fontRow(font) }
    }
  }

  private func fontRow(_ font: InstalledFont) -> some View {
    DisclosureGroup {
      ForEach(font.faces) { face in
        HStack {
          Text(face.label).monospacedDigit()
          Spacer()
          Button(role: .destructive) {
            model.change("Removed that file.") { try await $0.remove(face: face, of: font.family) }
          } label: {
            Image(systemName: "trash")
          }
          .buttonStyle(.borderless)
          .disabled(!canEdit)
          .accessibilityLabel("Remove \(face.label) of \(font.family)")
        }
      }
    } label: {
      AglynRow(
        font.family,
        subtitle: ([font.category.flatMap { c in fontCategories.first { $0.value == c }?.label ?? c }].compactMap { $0 }
          + [font.faces.count == 1 ? "1 file" : "\(font.faces.count) files"]).joined(separator: " · ")
      ) {
        HStack(spacing: AglynSpace.half) {
          ForEach(font.roles, id: \.self) { StatusChip($0.label, tone: .info) }
          Menu {
            ForEach(FontRole.allCases, id: \.self) { role in
              Button(font.roles.contains(role) ? "Used for \(role.label.lowercased())" : "Use for \(role.label.lowercased())",
                systemImage: font.roles.contains(role) ? "checkmark" : "textformat") {
                model.change("\(font.family) is set for \(role.label.lowercased()).") { try await $0.setRole(font.family, role) }
              }
              .disabled(!canEdit || font.roles.contains(role))
            }
            Menu("Category") {
              ForEach(fontCategories, id: \.value) { category in
                Button(category.label, systemImage: font.category == category.value ? "checkmark" : "") {
                  model.change("Saved.") { try await $0.setCategory(font.family, category.value) }
                }
                .disabled(!canEdit)
              }
            }
            Button("Remove font", systemImage: "trash", role: .destructive) { removing = font }.disabled(!canEdit)
          } label: {
            Image(systemName: "ellipsis.circle")
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .accessibilityLabel("Actions for \(font.family)")
        }
      }
    }
    .accessibilityIdentifier("font-\(font.family)")
  }

  private func jobRow(_ job: FontJob) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text(job.family.map { "\($0) \(job.weightLabel ?? "")" } ?? job.fileName).lineLimit(1)
        Spacer()
        switch job.step {
        case .checking, .saving: ProgressView().controlSize(.small)
        case .installed: StatusChip(job.replaced ? "Replaced" : "Installed", tone: .success)
        case .failed: StatusChip("Failed", tone: .error)
        case .queued: StatusChip("Waiting")
        }
        if job.step == .installed || job.step == .failed {
          Button {
            model.dismiss(job.id)
          } label: {
            Image(systemName: "xmark")
          }
          .buttonStyle(.borderless)
          .accessibilityLabel("Dismiss")
        }
      }
      Text(job.error ?? "\(job.step.label) · \(fontFileSize(job.bytes))")
        .font(AglynFont.caption).foregroundStyle(job.error == nil ? Color.secondary : AglynColor.error)
      ForEach(job.warnings, id: \.self) { Text($0).font(AglynFont.caption).foregroundStyle(AglynColor.warning) }
    }
    .accessibilityElement(children: .combine)
  }

  private func removeSheet(_ font: InstalledFont) -> some View {
    AglynActionSheet(
      "Remove \(font.family)?",
      message: "Text styles using it go back to what they inherit. The files stay in your media library.",
      confirmLabel: "Remove", destructive: true, busy: false, error: nil, onCancel: { removing = nil },
      onConfirm: {
        removing = nil
        model.change("Removed \(font.family).") { try await $0.remove(family: font.family) }
      }
    ) { EmptyView() }
  }
}
