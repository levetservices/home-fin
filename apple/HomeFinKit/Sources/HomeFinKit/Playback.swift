import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// How a title will be played: the URL AVPlayer opens and what Jellyfin needs for progress reports.
public struct PlaybackPlan: Sendable, Equatable {
    public var url: URL
    public var itemId: String
    public var mediaSourceId: String
    public var playSessionId: String?
    /// "DirectPlay" (the file as it is) or "Transcode" (HLS made by the server).
    public var playMethod: String
    public var startSeconds: Double
}

/// What Apple devices play natively, so Jellyfin only converts what it must.
public enum AppleDeviceProfile {
    public static func json(maxBitrate: Int?) -> [String: Any] {
        [
            "Name": "Home Fin (Apple)",
            "MaxStreamingBitrate": maxBitrate ?? 120_000_000,
            "MaxStaticBitrate": 200_000_000,
            "MusicStreamingTranscodingBitrate": 384_000,
            "DirectPlayProfiles": [
                ["Container": "mp4,m4v,mov", "Type": "Video", "VideoCodec": "h264,hevc", "AudioCodec": "aac,ac3,eac3,alac,mp3,flac"],
                ["Container": "mp3,aac,m4a,alac,flac", "Type": "Audio"]
            ],
            "TranscodingProfiles": [
                ["Container": "mp4", "Type": "Video", "Protocol": "hls", "Context": "Streaming",
                 "VideoCodec": "hevc,h264", "AudioCodec": "aac,ac3,eac3", "MaxAudioChannels": "6",
                 "MinSegments": "2", "BreakOnNonKeyFrames": true],
                ["Container": "aac", "Type": "Audio", "Protocol": "http", "Context": "Streaming", "AudioCodec": "aac", "MaxAudioChannels": "2"]
            ],
            "ContainerProfiles": [],
            "CodecProfiles": [
                ["Type": "Video", "Codec": "h264", "Conditions": [
                    ["Condition": "LessThanEqual", "Property": "VideoLevel", "Value": "52", "IsRequired": false]
                ]]
            ],
            // Text subtitles ride inside the HLS stream as WebVTT (AVPlayer lists them); picture
            // subtitles (PGS, VobSub) and styled ASS are burned in.
            "SubtitleProfiles": [
                ["Format": "vtt", "Method": "Hls"],
                ["Format": "subrip", "Method": "Hls"],
                ["Format": "ass", "Method": "Encode"],
                ["Format": "ssa", "Method": "Encode"],
                ["Format": "pgssub", "Method": "Encode"],
                ["Format": "dvdsub", "Method": "Encode"]
            ]
        ]
    }
}

extension JellyfinClient {
    /// Ask Jellyfin how this device should play `item` and build the URL for AVPlayer.
    /// `maxBitrate` nil means the best the connection allows.
    public func playbackPlan(for item: Item, maxBitrate: Int? = nil, startSeconds: Double? = nil) async throws -> PlaybackPlan {
        let start = startSeconds ?? item.resumeSeconds
        let body: [String: Any] = [
            "DeviceProfile": AppleDeviceProfile.json(maxBitrate: maxBitrate),
            "MaxStreamingBitrate": maxBitrate ?? 120_000_000,
            "StartTimeTicks": Int64(start * ticksPerSecond),
            "AutoOpenLiveStream": true,
            "EnableDirectPlay": true,
            "EnableDirectStream": true,
            "EnableTranscoding": true,
            "AllowVideoStreamCopy": true,
            "AllowAudioStreamCopy": true
        ]
        let data = try JSONSerialization.data(withJSONObject: body)
        let info = try await http.decode(PlaybackInfoResponse.self, request("/Items/\(item.id)/PlaybackInfo", query: ["userId": uid], method: "POST", body: data))
        guard let source = info.mediaSources.first, let sourceId = source.id else {
            throw HomeFinError(message: "This title has nothing playable.", code: "no_source")
        }

        if source.supportsDirectPlay == true {
            let url = HTTP.url(server, "/Videos/\(item.id)/stream", [
                "static": "true", "MediaSourceId": sourceId, "PlaySessionId": info.playSessionId,
                "DeviceId": device.id, "api_key": token
            ])
            return PlaybackPlan(url: url, itemId: item.id, mediaSourceId: sourceId, playSessionId: info.playSessionId,
                                playMethod: "DirectPlay", startSeconds: start)
        }
        guard let transcoding = source.transcodingUrl, var components = URLComponents(string: HTTP.url(server, transcoding.components(separatedBy: "?")[0]).absoluteString) else {
            throw HomeFinError(message: "The server can't convert this title for this device.", code: "no_transcode")
        }
        // Keep the server's own query (it describes the conversion) and make sure the token rides along.
        let serverQuery = URLComponents(string: transcoding)?.queryItems ?? []
        var queryItems = serverQuery
        if !serverQuery.contains(where: { $0.name.lowercased() == "api_key" || $0.name.lowercased() == "apikey" }) {
            queryItems.append(URLQueryItem(name: "api_key", value: token))
        }
        components.queryItems = queryItems
        guard let url = components.url else { throw HomeFinError(message: "Bad stream address from the server.", code: "bad_url") }
        return PlaybackPlan(url: url, itemId: item.id, mediaSourceId: sourceId, playSessionId: info.playSessionId,
                            playMethod: "Transcode", startSeconds: start)
    }

    private func report(_ path: String, _ plan: PlaybackPlan, seconds: Double, paused: Bool = false) async {
        let body: [String: Any] = [
            "ItemId": plan.itemId,
            "MediaSourceId": plan.mediaSourceId,
            "PlaySessionId": plan.playSessionId ?? "",
            "PositionTicks": Int64(max(0, seconds) * ticksPerSecond),
            "IsPaused": paused,
            "PlayMethod": plan.playMethod,
            "CanSeek": true
        ]
        try? await send(path, json: body)
    }

    /// Tell Jellyfin playback started (shows in the dashboard, starts "Continue Watching").
    public func reportStart(_ plan: PlaybackPlan, seconds: Double) async {
        await report("/Sessions/Playing", plan, seconds: seconds)
    }

    /// Every few seconds while playing, so Continue Watching resumes in the right place.
    public func reportProgress(_ plan: PlaybackPlan, seconds: Double, paused: Bool) async {
        await report("/Sessions/Playing/Progress", plan, seconds: seconds, paused: paused)
    }

    public func reportStopped(_ plan: PlaybackPlan, seconds: Double) async {
        await report("/Sessions/Playing/Stopped", plan, seconds: seconds)
    }
}
