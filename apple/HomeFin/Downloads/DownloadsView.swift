import HomeFinKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Download / downloading / downloaded, for a film or an episode.
struct DownloadButton: View {
    enum Style { case wide, icon }

    var item: Item
    var style: Style
    @Environment(AppModel.self) private var model
    @State private var confirmDelete = false

    private var record: DownloadRecord? { model.downloads.record(item.id) }

    var body: some View {
        Button(action: tap) {
            switch style {
            case .wide:
                HStack(spacing: 10) {
                    glyph(size: 20)
                    Text(wideTitle)
                }
                .frame(maxWidth: .infinity)
            case .icon:
                glyph(size: 22).frame(width: 40, height: 40)
            }
        }
        .modifier(DownloadButtonChrome(style: style))
        .confirmationDialog("Delete this download?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Download", role: .destructive) { model.downloads.delete(item.id) }
            if record?.state == .finished {
                Button("Play") { model.play(record?.playableItem ?? item) }
            }
        }
        .accessibilityLabel(wideTitle)
        .animation(Theme.spring, value: record?.state)
    }

    private var wideTitle: String {
        switch record?.state {
        case .finished: return "Downloaded"
        case .downloading, .queued: return "Downloading \(Int((record?.fraction ?? 0) * 100))%"
        case .failed: return "Download Failed: Try Again"
        case nil: return item.isEpisode ? "Download \(item.episodeCode ?? "Episode")" : "Download"
        }
    }

    @ViewBuilder private func glyph(size: CGFloat) -> some View {
        switch record?.state {
        case .finished:
            Image(systemName: "arrow.down.circle.fill").font(.system(size: size)).foregroundStyle(Color(hex: "#2f80ed"))
                .transition(.scale.combined(with: .opacity))
        case .downloading, .queued:
            ZStack {
                Circle().stroke(Color.white.opacity(0.25), lineWidth: 2.5)
                Circle().trim(from: 0, to: max(0.03, record?.fraction ?? 0))
                    .stroke(Color.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                RoundedRectangle(cornerRadius: 1.5).fill(.white).frame(width: size * 0.3, height: size * 0.3)
            }
            .frame(width: size, height: size)
            .animation(.linear(duration: 0.3), value: record?.fraction)
        case .failed:
            Image(systemName: "exclamationmark.arrow.circlepath").font(.system(size: size)).foregroundStyle(Color(hex: "#e87c03"))
        case nil:
            Image(systemName: "arrow.down.to.line").font(.system(size: size, weight: .medium))
        }
    }

    private func tap() {
        switch record?.state {
        case .finished, .downloading, .queued:
            confirmDelete = true
        case .failed, nil:
            guard let jellyfin = model.jellyfin else { return }
            let preferences = model.preferences
            if record?.state == .failed { model.downloads.delete(item.id) }
            Task {
                await model.downloads.download(item, jellyfin: jellyfin, quality: preferences.downloadQuality,
                                               wifiOnly: preferences.downloadOnWifiOnly)
            }
        }
    }

    private struct DownloadButtonChrome: ViewModifier {
        var style: Style

        func body(content: Content) -> some View {
            if style == .wide {
                content.buttonStyle(GlassPillButtonStyle(height: 48))
            } else {
                content.buttonStyle(PressScaleStyle()).foregroundStyle(.white)
            }
        }
    }
}

/// "Download Season 1": the episodes of the season shown that aren't downloaded yet.
struct SeasonDownloadButton: View {
    var episodes: [Item]
    @Environment(AppModel.self) private var model

    private var missing: [Item] { episodes.filter { model.downloads.record($0.id) == nil } }

    var body: some View {
        ActionButton(title: missing.isEmpty ? "Downloaded" : "Download\n\(missing.count) Episode\(missing.count == 1 ? "" : "s")",
                     symbol: missing.isEmpty ? "arrow.down.circle.fill" : "arrow.down.to.line") {
            guard let jellyfin = model.jellyfin, !missing.isEmpty else { return }
            let preferences = model.preferences
            let queue = missing
            Task {
                await model.downloads.download(episodes: queue, jellyfin: jellyfin, quality: preferences.downloadQuality,
                                               wifiOnly: preferences.downloadOnWifiOnly)
            }
        }
    }
}

/// Netflix's Downloads: what's on this device, grouped by series, with space used.
struct DownloadsView: View {
    var showsClose: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false

    private var records: [DownloadRecord] { model.downloads.records(for: model.userId) }

    /// Films on their own; episodes gathered under their series.
    private var groups: [(id: String, title: String, records: [DownloadRecord])] {
        var order: [String] = []
        var map: [String: (title: String, records: [DownloadRecord])] = [:]
        for record in records {
            let key = record.item.seriesId ?? record.id
            if map[key] == nil {
                order.append(key)
                map[key] = (record.series?.name ?? record.item.seriesName ?? record.item.name ?? "", [])
            }
            map[key]?.records.append(record)
        }
        return order.compactMap { key in map[key].map { (id: key, title: $0.title, records: $0.records.sorted(by: Self.episodeOrder)) } }
    }

    private static func episodeOrder(_ a: DownloadRecord, _ b: DownloadRecord) -> Bool {
        (a.item.parentIndexNumber ?? 0, a.item.indexNumber ?? 0) < (b.item.parentIndexNumber ?? 0, b.item.indexNumber ?? 0)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if records.isEmpty {
                    empty
                } else {
                    ForEach(groups, id: \.id) { group in
                        VStack(alignment: .leading, spacing: 12) {
                            if group.records.first?.item.isEpisode == true {
                                Text(group.title).font(.system(size: 19, weight: .bold))
                            }
                            ForEach(group.records) { record in
                                DownloadRow(record: record, editing: editing)
                            }
                        }
                    }
                    storage
                }
            }
            .padding(Theme.gutter)
            .animation(Theme.spring, value: records.map(\.id))
        }
        .homeFinBackground()
        .foregroundStyle(.white)
        .navigationTitle("Downloads")
        .inlineNavigationTitle()
        .toolbar {
            if showsClose {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            if !records.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Button(editing ? "Done" : "Edit") { withAnimation(Theme.spring) { editing.toggle() } }
                }
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 18) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 80, weight: .thin))
                .foregroundStyle(Theme.secondary)
                .padding(.top, 60)
            Text("Never be without Home Fin").font(.system(size: 22, weight: .bold))
            Text("Download films and series to watch offline: on a plane, on the train, anywhere.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            if showsClose {
                Button("Find Something to Download") { dismiss() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var storage: some View {
        StorageBar(used: model.downloads.bytesUsed(for: model.userId))
            .padding(.top, 10)
    }
}

/// One download: artwork (saved on the device), title, size or progress; tap to play.
struct DownloadRow: View {
    var record: DownloadRecord
    var editing: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 14) {
            Button { play() } label: {
                Artwork(url: model.downloads.artwork(for: record), placeholder: record.item.name)
                    .frame(width: 130, height: 73)
                    .overlay {
                        if record.state == .finished { PlayCircle(size: 32) }
                    }
                    .overlay(alignment: .bottom) {
                        if record.positionSeconds > 0, record.item.runtimeSeconds > 0 {
                            ProgressBar(value: record.positionSeconds / record.item.runtimeSeconds).padding(.horizontal, 5).padding(.bottom, 4)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .buttonStyle(CardButtonStyle())
            .disabled(record.state != .finished)
            VStack(alignment: .leading, spacing: 4) {
                Text(record.item.isEpisode ? "\(record.item.indexNumber.map { "\($0). " } ?? "")\(record.item.name ?? "")" : (record.item.name ?? ""))
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(2)
                Text(detail).font(.system(size: 13)).foregroundStyle(record.state == .failed ? Color(hex: "#e87c03") : Theme.secondary)
            }
            Spacer(minLength: 0)
            if editing {
                Button {
                    model.downloads.delete(record.id)
                } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).frame(width: 36, height: 36)
                        .glass(in: Circle(), tint: Theme.brand.opacity(0.6), interactive: true)
                }
                .buttonStyle(PressScaleStyle())
                .transition(.scale.combined(with: .opacity))
            } else {
                DownloadButton(item: record.item, style: .icon)
            }
        }
    }

    private var detail: String {
        switch record.state {
        case .finished:
            let size = ByteCountFormatter.string(fromByteCount: record.bytesWritten, countStyle: .file)
            let runtime = record.item.runTimeTicks != nil ? record.item.runtimeSeconds.runtimeText + " | " : ""
            return runtime + size
        case .downloading, .queued:
            return "Downloading… \(Int(record.fraction * 100))%"
        case .failed:
            return "Download failed. Tap the icon to try again."
        }
    }

    private func play() {
        model.play(record.playableItem)
    }
}

/// "iPhone: Used / Home Fin / Free" across the bottom of Downloads and App Settings.
struct StorageBar: View {
    var used: Int64

    private var capacity: (total: Int64, free: Int64) {
        let values = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey])
        return (Int64(values?.volumeTotalCapacity ?? 0), values?.volumeAvailableCapacityForImportantUsage ?? 0)
    }

    var body: some View {
        let (total, free) = capacity
        let other = max(0, total - free - used)
        VStack(alignment: .leading, spacing: 8) {
            Text(deviceName).font(.system(size: 15)).foregroundStyle(Theme.secondary)
            GeometryReader { proxy in
                let width = proxy.size.width
                let scale = total > 0 ? width / CGFloat(total) : 0
                HStack(spacing: 0) {
                    Rectangle().fill(Color(hex: "#555555")).frame(width: CGFloat(other) * scale)
                    Rectangle().fill(Color(hex: "#2f80ed")).frame(width: max(used > 0 ? 2 : 0, CGFloat(used) * scale))
                    Rectangle().fill(Color(hex: "#e5e5e5"))
                }
            }
            .frame(height: 16)
            HStack {
                legend(Color(hex: "#555555"), "Used")
                Spacer()
                legend(Color(hex: "#2f80ed"), "Home Fin · \(ByteCountFormatter.string(fromByteCount: used, countStyle: .file))")
                Spacer()
                legend(Color(hex: "#e5e5e5"), "Free · \(ByteCountFormatter.string(fromByteCount: free, countStyle: .file))")
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.secondary)
        }
    }

    private var deviceName: String {
        #if os(iOS)
        return UIDevice.current.model
        #else
        return "This Mac"
        #endif
    }

    private func legend(_ colour: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            Rectangle().fill(colour).frame(width: 10, height: 10)
            Text(text).lineLimit(1)
        }
    }
}
