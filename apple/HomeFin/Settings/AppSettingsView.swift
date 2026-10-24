import HomeFinKit
import SwiftUI

/// Netflix's App Settings: Video Playback, Downloads (with the storage bar) and About.
struct AppSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDeleteAll = false

    var body: some View {
        @Bindable var preferences = model.preferences
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    section("Video Playback")
                    NavigationLink {
                        ChoiceList(title: "Mobile Data Usage", options: Preferences.MobileData.allCases.map { (value: $0, title: $0.title, detail: Optional($0.detail)) },
                                   selection: $preferences.mobileData)
                    } label: {
                        row("cellularbars", "Mobile Data Usage", detail: preferences.mobileData.title, chevron: true)
                    }
                    NavigationLink {
                        ChoiceList(title: "Streaming Quality on Wi-Fi",
                                   options: Preferences.wifiQualities.map { (value: $0.bitrate, title: $0.title, detail: String?.none) },
                                   selection: $preferences.wifiBitrate)
                    } label: {
                        row("wifi", "Streaming Quality on Wi-Fi",
                            detail: Preferences.wifiQualities.first { $0.bitrate == preferences.wifiBitrate }?.title ?? "Auto", chevron: true)
                    }

                    section("Downloads")
                    Toggle(isOn: $preferences.downloadOnWifiOnly) {
                        row("wifi", "Wi-Fi Only", detail: nil, chevron: false)
                    }
                    .toggleStyle(.switch)
                    .tint(Color(hex: "#2f80ed"))
                    .padding(.trailing, 4)
                    NavigationLink {
                        ChoiceList(title: "Video Quality", options: DownloadQuality.allCases.map { (value: $0, title: $0.title, detail: Optional($0.detail)) },
                                   selection: $preferences.downloadQuality)
                    } label: {
                        row("rectangle.split.2x1", "Video Quality", detail: preferences.downloadQuality.title, chevron: true)
                    }
                    Button { confirmDeleteAll = true } label: {
                        row("trash", "Delete All Downloads", detail: nil, chevron: false)
                    }
                    .disabled(model.downloads.records(for: model.userId).isEmpty)
                    StorageBar(used: model.downloads.bytesUsed(for: model.userId))
                        .padding(.vertical, 12)

                    section("About")
                    row("server.rack", model.serverName, detail: model.server?.host(), chevron: false)
                    row("info.circle", "Version", detail: ProfilesSheet.version, chevron: false)
                    if let server = model.server {
                        Link(destination: server) {
                            row("safari", "Open Home Fin in a Browser", detail: nil, chevron: true)
                        }
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 40)
            }
            .navigationTitle("App Settings")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            .confirmationDialog("Delete all downloads on this device?", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                Button("Delete All Downloads", role: .destructive) { model.downloads.deleteAll(userId: model.userId) }
            }
        }
        .foregroundStyle(.white)
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 22, weight: .bold))
            .padding(.top, 24)
            .padding(.bottom, 6)
    }

    private func row(_ symbol: String, _ title: String, detail: String?, chevron: Bool) -> some View {
        HStack(spacing: 18) {
            Image(systemName: symbol).font(.system(size: 20)).frame(width: 30).foregroundStyle(Theme.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 17))
                if let detail { Text(detail).font(.system(size: 14)).foregroundStyle(Theme.secondary) }
            }
            Spacer()
            if chevron { Image(systemName: "chevron.right").font(.system(size: 16, weight: .semibold)) }
        }
        .frame(minHeight: 58)
        .contentShape(Rectangle())
    }
}

/// A list of options with a check by the chosen one (Mobile Data Usage, Video Quality …).
struct ChoiceList<Value: Hashable>: View {
    var title: String
    var options: [(value: Value, title: String, detail: String?)]
    @Binding var selection: Value

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(options.indices, id: \.self) { index in
                    let option = options[index]
                    Button {
                        withAnimation(Theme.spring) { selection = option.value }
                    } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.title).font(.system(size: 17, weight: .medium))
                                if let detail = option.detail {
                                    Text(detail).font(.system(size: 14)).foregroundStyle(Theme.secondary)
                                }
                            }
                            Spacer()
                            Image(systemName: selection == option.value ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22))
                                .foregroundStyle(selection == option.value ? Color(hex: "#2f80ed") : Theme.tertiary)
                                .contentTransition(.symbolEffect(.replace))
                        }
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: "#2b2b2b")))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(Theme.gutter)
        }
        .navigationTitle(title)
        .inlineNavigationTitle()
        .foregroundStyle(.white)
        .background(Color(hex: "#1c1c1c").ignoresSafeArea())
    }
}
