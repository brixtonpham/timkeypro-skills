---
name: clone-edit-style
description: Clone the EDIT STYLE of any reference video (pacing, cuts per minute, hook speed, caption look, zooms, music level, colour) into a reusable style.json, then apply it to the user's own voice and b-roll as an editable CapCut draft. Use when the user shares a video and asks "edit like this", "make my video in this style", "clone this edit", "dựng giống video này", "bắt chước phong cách edit", "làm video theo style này", or asks to turn a style into a CapCut project. Also use when the user has no reference video and wants a ready Vietnamese style (kể chuyện lịch sử, top 10, review TikTok Shop, trích dẫn, tin nhanh). Works for YouTube, Shorts, TikTok, Reels and Facebook videos. Reply in the user's language.
---

# Clone edit style

You copy how a video is **edited**, never what is **in** it. The output is a small `style.json`
(numbers and colours) and, when the user wants it, an editable CapCut draft built from **their own**
voice and footage. The reference video, its frames, music and voice are never reused.

Scripts live next to this file in `scripts/`. Run them with `node`. They need Node 18+, `ffmpeg` and
`ffprobe`. Captions also need `whisper-cli` and a whisper.cpp model. The CapCut step runs
`npx capcut-cli@0.35.0` (MIT, downloads on first use).

Loaded from the TimKeyPro connector (the skill came over MCP, so no `scripts/` folder is on disk)? Read
`skill://timkeypro/clone-edit-style/scripts/measure-style.mjs` and `.../scripts/apply-style.mjs` with the MCP
resource-read tool, save both unchanged into `<work>/scripts/`, and run them from there. Read a preset the same
way (`.../styles/<slug>/style.json`).

**Claude on the web or mobile (a cloud sandbox, not the user's computer).** You are there when the user's
files arrive as chat attachments (`/mnt/user-data/uploads/`) and nothing of theirs is on disk.
- The video must be attached to the chat. If no attachment is there, do not search the disk for it: ask the
  user, in one line, to attach the video file (or a 720p copy if it is too big to upload), and stop.
- Measuring and the style card (steps 0 to 4) work in the sandbox when it has Node, `ffmpeg` and `ffprobe`: run them.
  Without `whisper-cli`, skip the caption measurements and say so; never guess them.
- The CapCut draft (step 5) needs CapCut on the user's own computer. Give them the `style.json` as a file
  and say the draft is built in Claude Code or Claude Desktop with the TimKeyPro video extension.
- If the host cannot run commands at all, say the skill needs Claude Code or Claude Desktop with the
  TimKeyPro video extension, and stop.

## 0. Check the machine (once)

```bash
node --version && ffmpeg -version | head -1 && ffprobe -version | head -1
whisper-cli --help >/dev/null 2>&1 && echo whisper ok || echo whisper missing
```

Missing tools: tell the user the one install command for their system and wait.

| Tool | macOS | Windows |
|---|---|---|
| ffmpeg + ffprobe | `brew install ffmpeg` | `winget install Gyan.FFmpeg` |
| whisper-cli | `brew install whisper-cpp` | download `whisper-bin-x64.zip` from github.com/ggml-org/whisper.cpp/releases |
| whisper model | `curl -L -o ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin` | same file, any folder |

The model is about 550 MB. It reads Vietnamese well. Never install anything without the user's yes.

## 1. Get the reference video

Ask for a video **file** on their computer. If the user only has a link, ask them to save their own
copy first (for example with the app they use, or `yt-dlp <url>` if they are allowed to download it).
If the user has no reference yet and the TimKeyPro connector is available, offer to find one:
`keyword_report` on their niche lists outlier videos from small channels; a video that beats its
channel size is a good style to study.

## No reference video? Start from a preset

When the user has no reference video (or wants to start now), offer a ready style from `styles/`
(next to this file; `styles/README.md` has the table):

| Slug | Style | Aspect |
|---|---|---|
| `lich-su-ke-chuyen` | Kể chuyện lịch sử: slow, calm, long form | 16:9 |
| `top-10-su-that` | Top 10 sự thật: fast list | 16:9 |
| `review-tiktok-shop` | Review sản phẩm TikTok Shop: fast hook, big captions | 9:16 |
| `trich-dan-dong-luc` | Trích dẫn động lực: quotes, slow, music-led | 9:16 |
| `tin-nhanh-60-giay` | Tin tức nhanh 60 giây | 9:16 |

1. Pick the closest one with the user, read its `style.json` and show the style card from step 4,
   built from the preset's numbers, plus its `notes`. Say plainly that these are starting values
   chosen by TimKeyPro, not measured from any channel; never present them as a channel's style or
   promise results.
2. Let the user tweak it (pace, captions, aspect, music level). Keep the numbers consistent:
   `cuts_per_min` ≈ 60 / `shot_len_s.median`, p10 < median < p90, hook cuts fit in 5 s.
3. Copy it to `~/TimKeyPro/styles/<slug>/style.json` (keep `source.kind: "preset"`), then
   continue at step 5. Steps 2-4 are skipped (the card above takes the place of step 4).

## 2. Measure

```bash
node scripts/measure-style.mjs "<reference.mp4>" --out "<work>/style-<slug>" --whisper-model "<model.bin>"
```

Leave out `--whisper-model` when whisper is missing; only the speech block is skipped.
The script prints `{"ok":true,"style":...,"frames":N}` and writes:

- `style.json` with `source`, `pacing` (cuts, cuts per minute, shot lengths p10/median/p90, a cuts-per-minute
  curve per 30 s, hook cuts in 0-5 s, cut times), `audio` (loudness, BPM with a confidence, cut-on-beat ratio
  and its chance level), `speech` (language, words per minute, first line), `grade.measured`
  (brightness, saturation).
- `frames/` with up to 12 JPEG frames: 3 from the hook, the rest spread over the shots.

Trust rules:

- `audio.beat.confidence` under 0.3 means the "tempo" is speech rhythm, not music. Do not claim cuts on beat.
- Compare `cut_on_beat_ratio` with `chance_ratio`. Only a ratio clearly above chance means the editor cut on the beat.
- `cuts` counts hard cuts. Slow fades and moving-camera shots can hide cuts; say so when the frames disagree.
- With no `--threshold`, a reference with 0 cuts at 0.3 is measured again at 0.12 (soft transitions) and
  `pacing.threshold_note` says so. Check that the frames really change scene; a moving camera can also pass 0.12.
  Pass `--threshold 0.3` to keep the strict value.

## 3. Read the frames and complete style.json

Open every file in `frames/`. Fill the `null` blocks with what you **see**, and nothing you cannot see:

```json
"captions": {
  "present": true,
  "position": {"x": 0.5, "y": 0.78},
  "font_size_pct_h": 0.065,
  "font_class": "bold-sans | condensed-sans | serif | handwritten",
  "fill": "#FFFFFF",
  "outline": {"color": "#000000", "px": 6},
  "box": null,
  "highlight": {"color": "#FFE600", "rule": "keyword | current-word | none"},
  "words_per_chunk": 2,
  "case": "upper | sentence",
  "animation": "pop | none | typewriter | unknown"
},
"zoom": {"punch_in_per_min": 3, "scale": 1.15},
"broll": {"share_of_runtime": 0.7, "kinds": ["stock", "screen", "ai_image", "text_card", "talking_head"]},
"transitions": {"hard_cut": 0.9, "other": "whoosh | fade | zoom"},
"hook": {"pattern": "question | number | bold claim | story", "title_card": true, "title_text": null},
"grade": {"lut_hint": "warm | cool | neutral | high-contrast | desaturated"}
```

- `position` and `font_size_pct_h` are fractions of the frame (0 = left/top, 1 = right/bottom).
- `box` is `{"color": "#000000", "alpha": 0.6}` when captions sit on a box, else `null`.
- `title_text` stays `null`: the user writes their own title. Never copy the reference's text.
- Fonts cannot be identified reliably. Give the class only, then pick a free font with Vietnamese
  letters (Be Vietnam Pro, Montserrat, Roboto) when the user asks.

## 4. Show the style and confirm

Show the user a short card in their language, for example:

```
Phong cách "<tên>"
- Nhịp: 32 lần cắt/phút, mỗi cảnh ~1,8 s (ngắn nhất 1,0 s, dài nhất 3,0 s)
- Mở đầu: 4 lần cắt trong 5 giây đầu, câu hỏi + con số
- Phụ đề: chữ trắng viền đen, 2 từ/lần, tô vàng từ khóa, giữa-dưới
- Zoom: 3 lần/phút, phóng 115%
- Âm thanh: giọng 203 từ/phút, nhạc nền nhỏ, không cắt theo nhịp nhạc
```

Ask: save it under which name? Save `style.json` to `~/TimKeyPro/styles/<slug>/style.json`.
If the TimKeyPro connector shows a `save_style` tool, offer to save it to their account as well (pass the whole style.json as `style` and the name they chose). In a later chat, `my_styles` with that name returns the saved style.json: write it to `style.json` and continue at step 5.

Then **delete the `frames/` folder**. Keep only `style.json`.

## 5. Apply to the user's own video (CapCut draft)

Ask for:

1. their **voice-over** file (their own voice, a cloned voice of their own, or a licensed AI voice);
2. a **folder of b-roll** clips or photos they have the right to use;
3. optional: a royalty-free **music** file, and the **title** for the first 2.5 s.

```bash
node scripts/apply-style.mjs "<style.json>" --voice "<voice.mp3>" --broll "<broll folder>" \
  --name "<video name>" --title "<hook title>" --music "<music.mp3>" \
  --whisper-model "<model.bin>" --language vi --out "<work>/apply"
```

- It writes `<work>/apply/capcut-spec.json`, checks it with `capcut-cli compile --check`, then builds the draft
  in CapCut's own drafts folder. Add `--plan-only` to stop after the check.
- `--srt <file>` uses the user's own captions instead of whisper. Use it when they have a script. Cues that
  overlap or run backwards are repaired in a copy (`<work>/apply/captions-fixed.srt`, count in `captions_fixed`);
  the user's file is never edited.
- A b-roll clip shorter than its shot is slowed to fill it. The script re-syncs those speeds after the build
  (capcut-cli 0.35 leaves CapCut's speed material at 1x; count in `speed_resynced`).
- On success it prints `draft_path`. Tell the user: open CapCut, the project "<name>" is in the list;
  every clip, caption and the music stay editable.
- Then run `npx --yes capcut-cli@0.35.0 lint "<draft_path>" -H` and fix what it lists (or explain it).

What the draft contains: shots cut to the measured pacing (a faster hook, then lengths around the measured
median), punch-in zooms at the measured rate, the voice, music under the voice at the measured level, a title,
and captions in the measured colours and position. Keyword highlight, caption animation, transitions and the
colour grade are **not** applied automatically yet: tell the user where to set them in CapCut in one line each.

## Rules

- Copy the **style**, never the **content**: no footage, music, voice, logos or exact text from the reference.
- The user approves the result before anything is published. Do not post for them.
- A video made only from stock clips and an AI voice in a fixed template can lose monetization on YouTube
  ("inauthentic content") and reach on TikTok. Suggest they vary b-roll, add their own commentary or
  footage, and label AI content where the platform asks (TikTok's AIGC label).
- Every number you tell the user comes from `style.json`. When a value is a guess from the frames, say so.
