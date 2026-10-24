import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Download quality from App Settings (Netflix's Standard / Higher).
public enum DownloadQuality: String, Codable, CaseIterable, Sendable {
    case standard, higher

    public var title: String { self == .standard ? "Standard" : "Higher" }
    public var detail: String {
        self == .standard ? "Downloads faster and uses less storage." : "Uses more storage."
    }

    /// The conversion the server makes when the original won't play on the device (or is too big).
    var maxWidth: Int { self == .standard ? 1280 : 1920 }
    var videoBitrate: Int { self == .standard ? 2_500_000 : 7_000_000 }
    static let audioBitrate = 160_000
}

/// Where a download comes from: the original file when this device plays it as it is, otherwise an
/// MP4 the server converts on the fly (H.264 + stereo AAC, which every Apple device plays).
public struct DownloadSource: Sendable, Equatable {
    public var url: URL
    public var isOriginal: Bool
    public var fileExtension: String
    /// The original's size, or an estimate from the bitrate and running time (converted files
    /// arrive without a length).
    public var expectedBytes: Int64?
}

extension JellyfinClient {
    /// Containers and codecs Apple devices play straight from a file.
    static let playableContainers: Set<String> = ["mp4", "m4v", "mov"]
    static let playableVideo: Set<String> = ["h264", "hevc"]
    static let playableAudio: Set<String> = ["aac", "ac3", "eac3", "alac", "mp3", "flac"]

    /// `item` must have its media sources (as `item(_:)` returns it).
    public func downloadSource(for item: Item, quality: DownloadQuality) -> DownloadSource {
        let source = item.mediaSources?.first
        let video = source?.video
        let audio = source?.audioStreams.first
        let containers = Set((source?.container ?? "").lowercased().split(separator: ",").map(String.init))
        let playable = !containers.isDisjoint(with: Self.playableContainers)
            && Self.playableVideo.contains(video?.codec?.lowercased() ?? "")
            && (audio == nil || Self.playableAudio.contains(audio?.codec?.lowercased() ?? ""))
        // Standard keeps the original only when it's already about the size Standard would make.
        let smallEnough = quality == .higher || (video?.width ?? .max) <= quality.maxWidth + 40

        if playable && smallEnough {
            let url = HTTP.url(server, "/Items/\(item.id)/Download", ["api_key": token])
            let ext = containers.first(where: Self.playableContainers.contains) ?? "mp4"
            return DownloadSource(url: url, isOriginal: true, fileExtension: ext, expectedBytes: source?.size)
        }

        let url = HTTP.url(server, "/Videos/\(item.id)/stream.mp4", [
            "Static": "false",
            "MediaSourceId": source?.id ?? item.id,
            "DeviceId": device.id,
            "VideoCodec": "h264",
            "AudioCodec": "aac",
            "VideoBitrate": String(quality.videoBitrate),
            "AudioBitrate": String(DownloadQuality.audioBitrate),
            "MaxAudioChannels": "2",
            "MaxWidth": String(quality.maxWidth),
            "api_key": token
        ])
        let seconds = Double(item.runTimeTicks ?? 0) / ticksPerSecond
        let estimate = seconds > 0 ? Int64(seconds * Double(quality.videoBitrate + DownloadQuality.audioBitrate) / 8) : nil
        return DownloadSource(url: url, isOriginal: false, fileExtension: "mp4", expectedBytes: estimate)
    }
}

// MARK: - What's on the device

public struct DownloadRecord: Codable, Identifiable, Hashable, Sendable {
    public enum State: String, Codable, Sendable { case queued, downloading, finished, failed }

    /// The item id.
    public var id: String
    /// The film or episode as it was when downloaded (shown offline).
    public var item: Item
    /// The episode's series, for grouping and artwork offline.
    public var series: Item?
    public var fileName: String
    public var quality: DownloadQuality
    public var state: State
    public var bytesWritten: Int64
    public var bytesExpected: Int64?
    public var addedAt: Date
    /// Where the viewer got to watching it from the device.
    public var positionSeconds: Double
    public var played: Bool
    public var lastPlayed: Date?
    /// The position changed offline and the server hasn't heard yet.
    public var needsSync: Bool
    /// The server account the download belongs to (another profile doesn't see it).
    public var userId: String
    /// Saved artwork, so the Downloads page looks right with no connection.
    public var artworkFile: String?

    public init(item: Item, series: Item? = nil, fileName: String, quality: DownloadQuality, userId: String, addedAt: Date = Date()) {
        self.id = item.id
        self.item = item
        self.series = series
        self.fileName = fileName
        self.quality = quality
        self.state = .queued
        self.bytesWritten = 0
        self.addedAt = addedAt
        self.positionSeconds = item.resumeSeconds
        self.played = item.userData?.played == true
        self.needsSync = false
        self.userId = userId
    }

    /// 0…1 while downloading (estimated for converted files).
    public var fraction: Double {
        if state == .finished { return 1 }
        guard let expected = bytesExpected, expected > 0 else { return 0 }
        return min(0.99, Double(bytesWritten) / Double(expected))
    }

    /// The item with the offline position folded in, for playing and progress bars.
    public var playableItem: Item {
        var copy = item
        var data = copy.userData ?? UserItemData()
        data.playbackPositionTicks = Int64(positionSeconds * ticksPerSecond)
        data.played = played
        data.playedPercentage = nil
        copy.userData = data
        return copy
    }
}

/// The download index: a JSON file next to the downloaded videos. Thread-safe.
public final class DownloadStore: @unchecked Sendable {
    public let directory: URL
    private let lock = NSLock()
    private var records: [String: DownloadRecord] = [:]

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: indexURL),
           let saved = try? Self.decoder.decode([DownloadRecord].self, from: data) {
            records = Dictionary(uniqueKeysWithValues: saved.map { ($0.id, $0) })
        }
    }

    private var indexURL: URL { directory.appendingPathComponent("downloads.json") }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private func persist() {
        let list = records.values.sorted { $0.addedAt < $1.addedAt }
        if let data = try? Self.encoder.encode(list) { try? data.write(to: indexURL, options: .atomic) }
    }

    /// Newest first; only this account's downloads when `userId` is given.
    public func all(userId: String? = nil) -> [DownloadRecord] {
        lock.withLock {
            records.values.filter { userId == nil || $0.userId == userId }.sorted { $0.addedAt > $1.addedAt }
        }
    }

    public func record(_ id: String) -> DownloadRecord? {
        lock.withLock { records[id] }
    }

    public func upsert(_ record: DownloadRecord) {
        lock.withLock {
            records[record.id] = record
            persist()
        }
    }

    /// Changes a record in place (no-op if it's gone).
    @discardableResult
    public func update(_ id: String, _ change: (inout DownloadRecord) -> Void) -> DownloadRecord? {
        lock.withLock {
            guard var record = records[id] else { return nil }
            change(&record)
            records[id] = record
            persist()
            return record
        }
    }

    public func fileURL(for record: DownloadRecord) -> URL {
        directory.appendingPathComponent(record.fileName)
    }

    public func artworkURL(for record: DownloadRecord) -> URL? {
        record.artworkFile.map { directory.appendingPathComponent($0) }
    }

    /// Deletes the video, its artwork and the record.
    public func remove(_ id: String) {
        lock.withLock {
            guard let record = records.removeValue(forKey: id) else { return }
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(record.fileName))
            if let art = record.artworkFile { try? FileManager.default.removeItem(at: directory.appendingPathComponent(art)) }
            persist()
        }
    }

    public func removeAll(userId: String? = nil) {
        for record in all(userId: userId) { remove(record.id) }
    }

    /// Bytes of finished downloads on disk.
    public func totalBytes(userId: String? = nil) -> Int64 {
        all(userId: userId).filter { $0.state == .finished }.reduce(0) { $0 + $1.bytesWritten }
    }

    /// Records the position watched offline (synced later).
    public func savePosition(_ id: String, seconds: Double, played: Bool, at date: Date = Date()) {
        update(id) { record in
            record.positionSeconds = played ? 0 : seconds
            record.played = played
            record.lastPlayed = date
            record.needsSync = true
        }
    }

    /// Sends positions watched offline to the server. Returns how many were synced.
    @discardableResult
    public func syncPositions(with jellyfin: JellyfinClient) async -> Int {
        var synced = 0
        for record in all(userId: jellyfin.userId) where record.needsSync {
            do {
                try await jellyfin.savePosition(record.id, seconds: record.positionSeconds, played: record.played, lastPlayed: record.lastPlayed)
                update(record.id) { $0.needsSync = false }
                synced += 1
            } catch {
                continue
            }
        }
        return synced
    }
}
