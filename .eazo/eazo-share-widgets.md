# MURMUR Share Widget Spec

## App context

MURMUR is a hum-to-song card generator. Users hum a melody, the system generates a polished arrangement, and the result is saved as a **Song Card** — a visual artifact with a gradient background, title, vibe label, and BPM.

## Visual identity

- Background: warm ivory `#F7F3EA` with subtle grain texture
- Cards: off-white `#FFFDF8` with `3px solid rgba(255,255,255,0.9)` sticker border and soft shadow
- Primary accent: warm orange `#E9A06D`
- Dust blue: `#A7B8C8`
- Lavender: `#C9B6E4`
- Text primary: deep blue-grey `#22303A`
- Text muted: warm grey `#8B8680`
- Fonts: system sans, medium/semibold weights
- Aesthetic: mymind-inspired warm minimal, SnapWords-inspired sticker object cards

## Vibe gradients

| Vibe | Gradient |
|------|----------|
| 黄昏 (sunset) | `linear-gradient(135deg, #F4C87A, #E9A06D 45%, #C9B6E4)` |
| 卧室 (bedroom) | `linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8B8680)` |
| 电影 (cinematic) | `linear-gradient(135deg, #22303A, #A7B8C8, #F7F3EA)` |
| 派对 (party) | `linear-gradient(135deg, #E9A06D, #F7C5CC, #C9B6E4)` |
| 雨天 (rain) | `linear-gradient(135deg, #A7B8C8, #D8DDD8, #FFFDF8)` |
| 合成器 (synth) | `linear-gradient(135deg, #C9B6E4, #22303A, #E9A06D)` |

## Share scenario: Song Card saved to Gallery

**Trigger**: User saves a generated song to Gallery and taps "Share"

**Payload facts**:
- `song.title` — e.g. "Soft Evening"
- `song.vibe` — Chinese label, e.g. "黄昏"
- `song.bpm` — integer
- `song.keySignature` — e.g. "C minor"
- `visualConfig.posterBg` — CSS gradient string
- `app_id` — from `NEXT_PUBLIC_EAZO_APP_ID`

**Share card inner composition** (fits 300×400px host frame):

```
┌─────────────────────────────┐
│  [gradient background fill] │
│                             │
│  MURMUR          [logo dot] │
│                             │
│                             │
│       Soft Evening          │  ← title, 22px semibold, white
│       黄昏                  │  ← vibe, 13px, white/70
│                             │
│  82 BPM · C minor           │  ← meta, 11px, white/50
└─────────────────────────────┘
```

- Background: use `visualConfig.posterBg` gradient — covers full 300×400px
- Noise texture: subtle fractalNoise SVG overlay at 5% opacity
- MURMUR wordmark: top-left, `#FFFDF8`, 10px, tracking-widest, uppercase
- Title: center, white, 22px semibold
- Vibe: center below title, white/70, 13px
- BPM + Key: bottom-center, white/50, 11px

**Text payload for composer**:
```
我的哼唱变成了一首小歌 ✦

「{title}」
{vibe} · {bpm} BPM

用 MURMUR 把脑海里的旋律变成音乐 🎵
```

## Share scenario: Milestone — First song saved

**Trigger**: User saves their very first song

**Payload**: same as above, but with milestone context added:
```
第一首 MURMUR 小歌诞生了

「{title}」
{vibe} · {bpm} BPM
```
