// Tool definitions. build.mjs copies name + description of each into manifest.json.
const str = (description) => ({ type: "string", description });

export const TOOLS = [
  {
    name: "check_tools",
    title: "Check video tools",
    description:
      "Reports which of node, npx, ffmpeg, ffprobe, whisper-cli and a whisper.cpp model are installed on this computer, their paths and versions, and the install command for each on macOS and Windows. Installs nothing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "measure_style",
    title: "Measure edit style",
    description:
      "Measures the edit style of a video file with ffmpeg: cuts and shot lengths, hook cuts in the first 5 s, loudness, tempo and cut-on-beat ratio, brightness and saturation, and, with a whisper model, speech language and words per minute. Writes style.json and up to 12 frames to a new folder under ~/TimKeyPro/work and returns style.json, the folder and the frames as downscaled images. The video itself is not copied.",
    inputSchema: {
      type: "object",
      properties: {
        video_path: str("Absolute path to the reference video file (.mp4 .mov .m4v .webm .mkv .avi)."),
        whisper_model: str("Absolute path to a whisper.cpp model (.bin). Without it, speech is not measured."),
        max_frames: { type: "integer", minimum: 1, maximum: 12, default: 12, description: "Number of frames to extract and return (1-12)." },
      },
      required: ["video_path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "save_style_file",
    title: "Save style",
    description:
      "Writes a style.json object to ~/TimKeyPro/styles/<name>/style.json (the name is turned into a lowercase slug). Refuses to replace an existing style unless overwrite is true. With cleanup_work_dir, deletes that measure_style folder under ~/TimKeyPro/work (its frames) after saving.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Style name, for example \"Kể chuyện nhanh\"."),
        style: { type: "object", description: "The complete style.json object (from measure_style, with the visual blocks filled in)." },
        overwrite: { type: "boolean", default: false, description: "Replace a saved style with the same name." },
        cleanup_work_dir: str("A work folder returned by measure_style, to delete after saving."),
      },
      required: ["name", "style"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "list_style_files",
    title: "List saved styles",
    description:
      "Lists the styles saved under ~/TimKeyPro/styles with their style.json path, last change time, aspect, duration and cuts per minute.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "apply_style",
    title: "Build CapCut draft",
    description:
      "Builds an editable CapCut draft from a style.json, a voice-over and b-roll: shots cut to the measured pacing, punch-in zooms, the voice, optional music under it, a title and captions (from whisper or an .srt file). Writes capcut-spec.json to a new folder under ~/TimKeyPro/work, checks it with capcut-cli@0.35.0 (fetched by npx on first use), then writes the draft into CapCut's drafts folder and returns draft_path and the capcut-cli lint result. With plan_only, stops after the check and writes no draft.",
    inputSchema: {
      type: "object",
      properties: {
        style_path: str("Absolute path to a style.json (for example from list_style_files)."),
        voice_path: str("Absolute path to the voice-over (audio or video file)."),
        broll_path: str("Absolute path to a folder of b-roll clips and photos, or to one clip."),
        music_path: str("Absolute path to a background music file (optional)."),
        title: str("Title text shown for the first 2.5 s (optional)."),
        name: str("Project name shown in CapCut (optional)."),
        srt_path: str("Absolute path to an .srt caption file, used instead of whisper (optional)."),
        whisper_model: str("Absolute path to a whisper.cpp model (.bin) for captions from the voice (optional)."),
        language: str("Voice language for whisper, for example \"vi\" or \"en\" (default: auto)."),
        plan_only: { type: "boolean", default: false, description: "Write and check the spec only; no CapCut draft." },
      },
      required: ["style_path", "voice_path", "broll_path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];
