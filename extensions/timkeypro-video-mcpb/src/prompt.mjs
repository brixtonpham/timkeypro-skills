// The clone-edit-style workflow from SKILL.md, adapted to this extension's tools.
// build.mjs copies PROMPT_TEMPLATE into manifest.json, so this file is the only place to edit it.

export const PROMPT_NAME = "clone_edit_style";
export const PROMPT_DESCRIPTION =
  "Clone the edit style of a reference video (pacing, hook, captions, zoom, music level, colour) and build an editable CapCut draft from your own voice and b-roll.";
export const PROMPT_ARGUMENTS = [{ name: "video", description: "Absolute path to the reference video (optional)", required: false }];

export const INSTRUCTIONS = `TimKeyPro video clones the EDIT STYLE of a reference video the user has on their computer (pacing, cuts per minute, hook speed, caption look, zooms, music level, colour) into a style.json, then builds an editable CapCut draft from the user's own voice and b-roll. Copy the style, never the content: no footage, music, voice, logos or exact text from the reference.
Flow: check_tools once (if something is missing, give the one install command for the user's system and wait; never install without their yes) -> measure_style on the reference file -> look at every returned frame and fill captions, zoom, broll, transitions, hook and grade.lut_hint with what you see, nothing you cannot see -> show a short style card and ask for a name -> save_style_file (with cleanup_work_dir to delete the frames) -> ask for their voice-over, b-roll folder, optional music and title -> apply_style.
Every number you tell the user comes from style.json; say so when a value is a guess from the frames. The user approves the result before anything is published. Answer in the user's language. The full workflow is the clone_edit_style prompt.`;

export const PROMPT_TEMPLATE = `Clone the edit style of a reference video and, when the user wants it, build an editable CapCut draft from their own voice and footage. Answer in the user's language.

Reference video (may be empty): \${arguments.video}

You copy how a video is EDITED, never what is IN it. The output is a small style.json (numbers and colours) and an editable CapCut draft built from the user's OWN voice and footage. The reference video, its frames, music and voice are never reused.

## 0. Check the machine (once)
Call check_tools. If ready.measure_style or ready.apply_style is false, tell the user the one install command for their system (the "install" field, macos or windows) and wait. Whisper is optional: without it, speech is not measured and captions need an .srt file from the user. The whisper model is about 550 MB. Never install anything without the user's yes.

## 1. Get the reference video
Ask for a video FILE on their computer, as an absolute path (on macOS they can drag the file into the chat box or use "Copy as pathname"; on Windows, Shift + right-click > "Copy as path"). If the user only has a link, ask them to save their own copy first, with an app they use, if they are allowed to download it. If the user has no reference yet and the TimKeyPro connector is available, offer to find one: keyword_report on their niche lists outlier videos from small channels; a video that beats its channel size is a good style to study.

## 2. Measure
Call measure_style with video_path (and whisper_model when check_tools found a complete model). It returns style.json, the work folder and up to 12 frames as images.
style.json holds source, pacing (cuts, cuts per minute, shot lengths p10/median/p90, a cuts-per-minute curve per 30 s, hook cuts in 0-5 s, cut times), audio (loudness, BPM with a confidence, cut-on-beat ratio and its chance level), speech (language, words per minute, first line) and grade.measured (brightness, saturation).
Trust rules:
- audio.beat.confidence under 0.3 means the "tempo" is speech rhythm, not music. Do not claim cuts on beat.
- Compare cut_on_beat_ratio with chance_ratio. Only a ratio clearly above chance means the editor cut on the beat.
- cuts counts hard cuts. Slow fades and moving-camera shots can hide cuts; say so when the frames disagree.

## 3. Read the frames and complete style.json
Look at every frame. Fill the null blocks with what you SEE, and nothing you cannot see:
{
  "captions": {"present": true, "position": {"x": 0.5, "y": 0.78}, "font_size_pct_h": 0.065,
    "font_class": "bold-sans | condensed-sans | serif | handwritten", "fill": "#FFFFFF",
    "outline": {"color": "#000000", "px": 6}, "box": null,
    "highlight": {"color": "#FFE600", "rule": "keyword | current-word | none"},
    "words_per_chunk": 2, "case": "upper | sentence", "animation": "pop | none | typewriter | unknown"},
  "zoom": {"punch_in_per_min": 3, "scale": 1.15},
  "broll": {"share_of_runtime": 0.7, "kinds": ["stock", "screen", "ai_image", "text_card", "talking_head"]},
  "transitions": {"hard_cut": 0.9, "other": "whoosh | fade | zoom"},
  "hook": {"pattern": "question | number | bold claim | story", "title_card": true, "title_text": null},
  "grade": {"lut_hint": "warm | cool | neutral | high-contrast | desaturated"}
}
- position and font_size_pct_h are fractions of the frame (0 = left/top, 1 = right/bottom).
- box is {"color": "#000000", "alpha": 0.6} when captions sit on a box, else null.
- Keep hook.cuts_0_5s and grade.measured from the measurement when you fill hook and grade.
- title_text stays null: the user writes their own title. Never copy the reference's text.
- Fonts cannot be identified reliably. Give the class only, then pick a free font with Vietnamese letters (Be Vietnam Pro, Montserrat, Roboto) when the user asks.

## 4. Show the style and confirm
Show the user a short card in their language, for example:
Phong cách "<tên>"
- Nhịp: 32 lần cắt/phút, mỗi cảnh ~1,8 s (ngắn nhất 1,0 s, dài nhất 3,0 s)
- Mở đầu: 4 lần cắt trong 5 giây đầu, câu hỏi + con số
- Phụ đề: chữ trắng viền đen, 2 từ/lần, tô vàng từ khóa, giữa-dưới
- Zoom: 3 lần/phút, phóng 115%
- Âm thanh: giọng 203 từ/phút, nhạc nền nhỏ, không cắt theo nhịp nhạc
Ask: save it under which name? Then call save_style_file with that name, the whole completed style.json, and cleanup_work_dir set to the work folder from measure_style, which deletes the reference frames. Only style.json is kept.
If the TimKeyPro connector shows a save_style tool, offer to save it to their account as well (pass the whole style.json as style and the name they chose). In a later chat, my_styles with that name returns the saved style.json: save it with save_style_file and continue at step 5. list_style_files shows the styles saved on this computer.

## 5. Apply to the user's own video (CapCut draft)
Ask for:
1. their voice-over file (their own voice, a cloned voice of their own, or a licensed AI voice);
2. a folder of b-roll clips or photos they have the right to use;
3. optional: a royalty-free music file, and the title for the first 2.5 s.
Call apply_style with style_path, voice_path, broll_path and the optional music_path, title, name, whisper_model and language (for example "vi"). srt_path uses the user's own captions instead of whisper; use it when they have a script. Captions need either whisper_model or srt_path.
- plan_only: true writes and checks the CapCut spec without making a draft.
- On success it returns draft_path and the capcut-cli lint result. Tell the user: open CapCut, the project "<name>" is in the list; every clip, caption and the music stay editable. Explain what lint lists.
What the draft contains: shots cut to the measured pacing (a faster hook, then lengths around the measured median), punch-in zooms at the measured rate, the voice, music under the voice at the measured level, a title, and captions in the measured colours and position. Keyword highlight, caption animation, transitions and the colour grade are NOT applied automatically yet: tell the user where to set them in CapCut in one line each.

## Rules
- Copy the STYLE, never the CONTENT: no footage, music, voice, logos or exact text from the reference.
- The user approves the result before anything is published. Do not post for them.
- A video made only from stock clips and an AI voice in a fixed template can lose monetization on YouTube ("inauthentic content") and reach on TikTok. Suggest they vary b-roll, add their own commentary or footage, and label AI content where the platform asks (TikTok's AIGC label).
- Every number you tell the user comes from style.json. When a value is a guess from the frames, say so.`;

export function renderPrompt(args = {}) {
  const video = typeof args.video === "string" && args.video.trim() ? args.video.trim() : "(not given yet: ask the user)";
  return PROMPT_TEMPLATE.replace("${arguments.video}", video);
}
