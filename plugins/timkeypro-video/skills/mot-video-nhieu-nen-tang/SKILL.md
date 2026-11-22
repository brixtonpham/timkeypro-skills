---
name: mot-video-nhieu-nen-tang
description: Use this skill for ANY request to turn one video, transcript or script into posts, clips or captions for several platforms, even a simple one: it holds the current per-platform rules (length, ratio, caption limits, hashtags, first-line hook, CTA) for YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, the YouTube long description and Threads/X, and the paste-ready table format. Triggers: "một video đăng nhiều nền tảng", "chuyển video dài thành Shorts/TikTok/Reels", "cắt video dài thành clip ngắn", "bảng bài đăng cho từng nền tảng", "viết caption cho từng nền tảng", "đăng lại video lên TikTok, Reels, Shorts", "repurpose this video", "turn my video into shorts", "cross-post captions", "one video many platforms". Reply in the user's language.
---

# One video, many platforms (một video nhiều nền tảng)

You take one long video (a file's transcript, a script, or a description of it) and plan the clips and posts for
each platform. The output is a table the user pastes into each app or into their own scheduler. You do not
post anything and TimKeyPro does not post for them.

Reply in the user's language. Post copy follows the audience's language (Vietnamese for Vietnamese viewers),
whatever language the user writes to you in.

## 1. Get the source

Ask for the most useful thing they have, in this order:
1. the **script** or a **transcript** (an .srt / .txt from CapCut, YouTube Studio or whisper);
2. otherwise a **summary** of the video: topic, the 3-5 strongest moments with timestamps, who it is for.

Also ask, in one message: the channel's niche, who the viewer is, what the CTA should be (watch the long video,
follow, buy, visit a link), and which platforms they actually use. Do not plan for platforms they do not use.

If the TimKeyPro connector is connected and the user has a niche keyword, offer `keyword_report` or `video_brief`
once to see which titles and topics are winning in that niche, so clip angles follow real outliers. It spends
their allowance, so ask first.

## 2. Pick the clips

From the source, pick **3-5 moments** that stand alone without the rest of the video:
a surprising fact, a strong opinion, a short story with an ending, a before/after, one clear how-to step.
For each: start and end timestamp (when you have them), why it stands alone, and the hook line to say or show in
the first 2 seconds. A clip that needs "as I said earlier" to make sense is not a clip.

Make each platform's version **different** (another hook, another caption, another cut length), not one file
copied everywhere. Copies of the same short with the same text are what platforms treat as low-effort reposts,
and on YouTube many near-identical videos can count as "inauthentic content" (run `kiem-tra-chan-thuc` if unsure).

## 3. Platform rules

Limits change often. These were checked in late 2026; tell the user to confirm in the app when a limit matters.

| Platform | Length | Ratio | Caption | Hashtags | First line | CTA |
|---|---|---|---|---|---|---|
| YouTube Shorts | up to 3 min; most clips 20-60 s | 9:16 | title up to 100 characters; it is what people search, so put the keyword in it | 1-3 in title or description; more than 60 and YouTube ignores them all | the spoken line in second 0-2 and the title must make the same promise | "video đầy đủ ở link liên quan" (use the related video link), subscribe |
| TikTok | 15-90 s works for most clips; longer is allowed | 9:16 | up to 4,000 characters; keep the first line short, it is all most viewers see | 3-5 specific to the topic; no #fyp spam | on-screen text + spoken hook in the first 2 s | follow for part 2, comment a keyword, link in bio |
| Instagram Reels | up to 3 min; 15-45 s typical | 9:16 (cover crops to 4:5 on the grid, keep text centred) | up to 2,200 characters; about the first 125 show before "more" | 3-5 specific tags (Instagram has been limiting the number per post; check in the app) | text on the first frame, viewers often start muted | save, share to a friend, link in bio (links in captions are not clickable) |
| Facebook Reels | Facebook now treats new videos as reels; 30-90 s is safe for clips | 9:16 | short; 1-3 lines | 0-3 | plain statement of what the viewer gets | follow the page, message the page, watch the full video |
| YouTube long description | (the long video itself) | 16:9 | up to 5,000 characters; the first 1-2 lines show in search and above "more" | up to 3 hashtags show above the title; put them at the end | first line repeats the title's promise in other words, with the main keyword | chapters (00:00 first, at least 3), links to related videos, subscribe |
| Threads / X | text post (+ the clip if they want) | 9:16 or 1:1 clip | Threads up to 500 characters; X 280 for free accounts | Threads: one topic tag; X: 0-2 | one opinion or one fact, no lead-in | ask a question that invites replies; link in the first reply if reach matters |

General rules for every platform:
- Captions on screen (most short video is watched muted): 1-2 lines, a few words each, readable on a phone.
- The first line of the caption is a hook too. Never start with "Video hôm nay mình sẽ…" or a greeting.
- Hashtags describe the topic so the platform knows who to show it to. They are not a growth trick.
- No invented numbers in captions ("10 triệu người đã xem", "kiếm 50 triệu/tháng"). Only numbers from the
  video itself that the user stands behind.
- The banned "văn AI" phrases in the `kich-ban-ban-hang` skill apply here too: write captions the way the user talks.
- AI voice, AI avatar or realistic AI footage: turn on the platform's AI label (TikTok AIGC label; YouTube's
  "altered or synthetic content" disclosure for realistic content).

## 4. Output: the paste table

One row per post. Keep each cell copy-paste ready, with no notes inside.

| # | Nền tảng | Clip (từ – đến) | Độ dài | Tỉ lệ | Hook 2 giây đầu (nói + chữ trên màn hình) | Tiêu đề / dòng đầu | Caption đầy đủ | Hashtag | CTA |
|---|---|---|---|---|---|---|---|---|---|

Then:
- the full **YouTube long description** as its own block (first lines, summary, chapters, links, hashtags);
- the **Threads / X post** as its own block;
- one line on the posting order, for example the long video first, then shorts that point to it over the next days.
  Do not promise best posting times; suggest the user checks their own analytics.

## 5. Scheduling (optional, user's own tool)

If the user wants posts scheduled, they can add a scheduler connector to their own Claude (for example Metricool
or Postiz, if those offer one they can use) and you can hand the table to it as **drafts** for them to approve.
TimKeyPro does not post or schedule for them, and you never publish without their explicit yes.
