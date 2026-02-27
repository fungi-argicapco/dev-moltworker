---
name: video-moment-analyzer
description: Analyze video for emotional peaks, viral moments, and subject tracking. Use for extracting key moments from Cloudflare Stream videos, detecting speech/music/emotional peaks, and generating clip metadata for multi-platform distribution.
---

# Video Moment Analyzer Agent

Autonomous video analysis for emotional peak detection, moment extraction, and intelligent clip generation.

## Core Operations

### Video Analysis
- Detect subject position (DETR person detection)
- Identify emotional peaks (speech, music, silence, motion)
- Score moments by virality potential (engagement heuristics)
- Generate tracking metadata for "virtual camera" pan-and-scan
- Timeline of key moments with timestamps and engagement scores

### Moment Extraction
- List top N moments by score
- Filter by type (speech, music, emotional peak, action)
- Generate clip timelines with recommended aspect ratios
- Suggest multi-platform deployment strategy

### Integration with Stream
- Query Cloudflare Stream Thumbnail API
- No re-encoding, no downloads needed
- Works with live-streamed or archived videos
- Outputs JSON metadata for clip generation pipelines

## Tools & Scripts

See `scripts/` directory:
- `analyze-video.js` - Main entry point (takes video UID, runs full analysis)
- `detect-moments.js` - DETR-based moment detection
- `score-moments.js` - Calculate virality/engagement scores
- `generate-timeline.js` - Create clip recommendations

## Output

All analyses return:
1. **Moments Array** — Timestamped peaks with scores (0-100)
2. **Tracking Data** — Subject position over time (for virtual camera)
3. **Recommendations** — Which moments to clip, best platforms, aspect ratios
4. **Timeline** — Visual representation of engagement curve

## Key Models

- **DETR-ResNet-50** — Person detection and bounding box tracking
- **Heuristic Analysis** — Speech/music detection, movement analysis, emotional markers
- **Smoothing Filter** — Temporal coherence for stable tracking

## Use Cases

- Extract viral moments from long-form video (sermons, events)
- Generate multi-platform clip recommendations
- Analyze engagement patterns
- Create automated content distribution timelines
- Support for TikTok, Instagram Reels, YouTube Shorts optimization

## API

Primary interface:
```bash
node scripts/analyze-video.js <cloudflare-video-uid> [options]
```

Options:
- `--top N` — Show top N moments
- `--type TYPE` — Filter by moment type (speech, music, peak, action)
- `--format json|csv|markdown` — Output format
- `--confidence THRESHOLD` — Minimum detection confidence (0-100)
