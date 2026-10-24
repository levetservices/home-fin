import Foundation
import HomeFinKit
import Network
import Observation

/// Netflix's App Settings, kept in UserDefaults.
@MainActor
@Observable
final class Preferences {
    /// Netflix's "Mobile Data Usage".
    enum MobileData: String, CaseIterable, Identifiable {
        case automatic, wifiOnly, saveData, maximum

        var id: String { rawValue }
        var title: String {
            switch self {
            case .automatic: return "Automatic"
            case .wifiOnly: return "Wi-Fi Only"
            case .saveData: return "Save Data"
            case .maximum: return "Maximum Data"
            }
        }
        var detail: String {
            switch self {
            case .automatic: return "Balances data use and video quality."
            case .wifiOnly: return "Only streams when you're on Wi-Fi."
            case .saveData: return "Watch about 6 hours per GB."
            case .maximum: return "Uses as much data as needed for the best quality."
            }
        }
    }

    /// Streaming quality on Wi-Fi, in bits per second (0 = Auto).
    static let wifiQualities: [(title: String, bitrate: Int)] = [
        ("Auto", 0), ("Best: up to 4K", 40_000_000), ("High: 1080p", 20_000_000),
        ("Medium: 1080p", 8_000_000), ("Low: 720p", 3_000_000)
    ]

    private let defaults = UserDefaults.standard

    var mobileData: MobileData {
        didSet { defaults.set(mobileData.rawValue, forKey: "homefin.mobileData") }
    }
    var wifiBitrate: Int {
        didSet { defaults.set(wifiBitrate, forKey: "homefin.maxBitrate") }
    }
    var downloadQuality: DownloadQuality {
        didSet { defaults.set(downloadQuality.rawValue, forKey: "homefin.downloadQuality") }
    }
    var downloadOnWifiOnly: Bool {
        didSet { defaults.set(downloadOnWifiOnly, forKey: "homefin.downloadWifiOnly") }
    }

    init() {
        mobileData = MobileData(rawValue: defaults.string(forKey: "homefin.mobileData") ?? "") ?? .automatic
        wifiBitrate = defaults.integer(forKey: "homefin.maxBitrate")
        downloadQuality = DownloadQuality(rawValue: defaults.string(forKey: "homefin.downloadQuality") ?? "") ?? .standard
        downloadOnWifiOnly = defaults.object(forKey: "homefin.downloadWifiOnly") as? Bool ?? true
    }

    /// The streaming cap for the connection we're on (nil = as good as it gets).
    func maxBitrate(onMobileData: Bool) -> Int? {
        guard onMobileData else { return wifiBitrate == 0 ? nil : wifiBitrate }
        switch mobileData {
        case .automatic: return 4_000_000
        case .saveData: return 1_500_000
        case .maximum, .wifiOnly: return wifiBitrate == 0 ? nil : wifiBitrate
        }
    }
}

/// Whether we're online, and whether the connection costs money (mobile data, a hotspot).
@MainActor
@Observable
final class NetworkStatus {
    private(set) var isOnline = true
    private(set) var isExpensive = false
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            let expensive = path.isExpensive || path.isConstrained
            Task { @MainActor in
                self?.isOnline = online
                self?.isExpensive = expensive
            }
        }
        monitor.start(queue: DispatchQueue(label: "homefin.network"))
    }
}
