from .models import OutputSize, TrainingProfile


PROFILES = [
    TrainingProfile(
        id="minimax-h3-diffsynth-fl2va",
        architecture="MiniMax H3",
        trainer="DiffSynth Studio FL2VA",
        label="MiniMax H3 / DiffSynth FL2VA",
        media_kind="video",
        fps=24,
        frame_options=[124, 175, 243, 362],
        dimension_multiple=32,
        frame_rule="17n + 5",
        sizes=[
            OutputSize(width=1344, height=768, label="16:9 · 1344×768"),
            OutputSize(width=768, height=1344, label="9:16 · 768×1344"),
            OutputSize(width=1152, height=864, label="4:3 · 1152×864"),
            OutputSize(width=864, height=1152, label="3:4 · 864×1152"),
            OutputSize(width=1024, height=1024, label="1:1 · 1024×1024"),
        ],
        notes="24 FPS profile with frame counts aligned to 17n+5.",
    ),
    TrainingProfile(
        id="wan-2-1-general",
        architecture="Wan 2.1",
        trainer="General video LoRA",
        label="Wan 2.1 / General",
        media_kind="video",
        fps=16,
        frame_options=[81, 121],
        dimension_multiple=16,
        sizes=[
            OutputSize(width=832, height=480, label="16:9 · 832×480"),
            OutputSize(width=480, height=832, label="9:16 · 480×832"),
            OutputSize(width=704, height=544, label="4:3 · 704×544"),
            OutputSize(width=544, height=704, label="3:4 · 544×704"),
            OutputSize(width=720, height=720, label="1:1 · 720×720"),
        ],
        notes="Common 16 FPS dataset profile. Confirm dimensions against the selected trainer.",
    ),
    TrainingProfile(
        id="sdxl-frame-extraction",
        architecture="SDXL",
        trainer="Frame extraction",
        label="SDXL / Frame extraction",
        media_kind="image",
        fps=1,
        frame_options=[1],
        dimension_multiple=64,
        sizes=[
            OutputSize(width=1024, height=1024, label="1:1 · 1024×1024"),
            OutputSize(width=1152, height=896, label="9:7 · 1152×896"),
            OutputSize(width=896, height=1152, label="7:9 · 896×1152"),
            OutputSize(width=1216, height=832, label="3:2 · 1216×832"),
            OutputSize(width=832, height=1216, label="2:3 · 832×1216"),
        ],
        notes="Exports a single PNG at the selected playhead position.",
    ),
]

PROFILE_BY_ID = {profile.id: profile for profile in PROFILES}
