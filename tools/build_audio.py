"""Encode the narration + music beds for the web player, and synthesise the pop SFX."""
import json
import math
import os
import struct
import subprocess

ZIPS = r"C:\Users\SAKIBJ~1\AppData\Local\Temp\claude\C--Users-Sakib-Jawad-Desktop-Anti-Grav\25a2e51c-6a35-4ced-8fd9-b125f94ea9b6\scratchpad\zips"
ROOT = r"C:\Users\Sakib Jawad\Desktop\Anti Grav\monkey-player\assets"

VIDEO_LEN = 44.0
MUSIC_LEN = 48.0  # headroom past the video so the runtime end-handling is real

NARRATION = [
    ("n01-shaun-british", "Shaun - British, Clean and Reliable_pvc_s50_m2.mp3", "Shaun — British, clean and reliable"),
    ("n02-verity-british", "Verity X \u2013 Calm British Narration_pvc_s50_m2.mp3", "Verity X — calm British narration"),
    ("n03-john-northern-ireland", "John - Warm, Balanced Northern Ireland _pvc_s50_m2.mp3", "John — warm, balanced Northern Ireland"),
    ("n04-mahesh-caribbean", "Mahesh - Warm and Calm Caribbean.mp3", "Mahesh — warm and calm Caribbean"),
    ("n05-tarquin-rp", "Tarquin - Posh & English RP_pvc_s50_m2.mp3", "Tarquin — posh English RP"),
    ("n06-english-rose", "English Rose_pvc_s50_m2.mp3", "English Rose"),
    ("n07-bek-british", "Bek - Trusted British English_pvc_s50_m2.mp3", "Bek — trusted British English"),
    ("n08-chris-scottish", "Chris - Scottish Casual_pvc_s50_m2.mp3", "Chris — Scottish casual"),
    ("n09-studio-take-a", "AUD-20260813-WA0001.mp3", "Studio take A"),
    ("n10-studio-take-b", "AUD-20260623-WA0003.wav", "Studio take B"),
]

# 10 of the 12 supplied beds. Skipped: alexguz-african-drums-386471 (15s — shorter
# than the video) and diluvios-roots-in-motion-495223 (5m27s journey track).
MUSIC = [
    ("m01-tribal", "renrebello-tribal-273033.mp3", "Tribal"),
    ("m02-savana-beats", "surprising_media-african-savana-beats-315881.mp3", "Savana Beats"),
    ("m03-african-delta", "23350895-african-delta-140627.mp3", "African Delta"),
    ("m04-african-drums", "alban_gogh-african-drums-209632.mp3", "African Drums"),
    ("m05-tribal-music", "maksymmalko-african-tribal-music-342635.mp3", "African Tribal"),
    ("m06-light-tribal-dance", "geoffharvey-light-tribal-dance-african-386425.mp3", "Light Tribal Dance"),
    ("m07-afro-beat", "ikoliks_aj-african-africa-afro-beat-music-400918.mp3", "Afro Beat"),
    ("m08-african-night", "eco-art-african-night-171020.mp3", "African Night"),
    ("m09-africa", "monume-africa-african-music-556466.mp3", "Africa"),
    ("m10-drums-tribal", "alec_koff-african-drums-tribal-492178.mp3", "Drums Tribal"),
]


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True)
    return round(float(out.stdout.strip()), 3)


def run(args):
    subprocess.run(args, check=True, capture_output=True)


def make_pop(path):
    """Short UI pop: a fast downward pitch sweep with a click transient.

    Synthesised because no pop sound shipped with the source assets.
    """
    sr, dur = 44100, 0.09
    n = int(sr * dur)
    frames = bytearray()
    phase = 0.0
    for i in range(n):
        t = i / sr
        f = 1250.0 * math.exp(-26.0 * t) + 190.0
        phase += 2 * math.pi * f / sr
        env = math.exp(-34.0 * t) * min(1.0, t / 0.0016)
        click = math.exp(-900.0 * t) * 0.35
        s = (math.sin(phase) * 0.72 + math.sin(phase * 2) * 0.16 + click) * env
        frames += struct.pack("<h", max(-32767, min(32767, int(s * 25000))))
    with open(path, "wb") as fh:
        fh.write(b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt ")
        fh.write(struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16))
        fh.write(b"data" + struct.pack("<I", len(frames)) + bytes(frames))


manifest = {"narration": [], "music": [], "video": {}, "sfx": {}}

for slug, src, label in NARRATION:
    dst = os.path.join(ROOT, "narration", slug + ".mp3")
    run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(ZIPS, "narration", src),
         "-ac", "1", "-ar", "44100", "-b:a", "96k", "-map_metadata", "-1", dst])
    manifest["narration"].append({"id": slug, "label": label,
                                  "src": f"assets/narration/{slug}.mp3",
                                  "duration": probe(dst)})
    print("narration", slug, manifest["narration"][-1]["duration"])

for slug, src, label in MUSIC:
    dst = os.path.join(ROOT, "music", slug + ".mp3")
    run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(ZIPS, "music", src),
         "-t", str(MUSIC_LEN),
         "-af", f"afade=t=in:st=0:d=1.2,afade=t=out:st={MUSIC_LEN - 3}:d=3",
         "-ac", "2", "-ar", "44100", "-b:a", "96k", "-map_metadata", "-1", dst])
    manifest["music"].append({"id": slug, "label": label,
                              "src": f"assets/music/{slug}.mp3",
                              "duration": probe(dst)})
    print("music", slug, manifest["music"][-1]["duration"])

pop = os.path.join(ROOT, "sfx", "pop.wav")
make_pop(pop)
manifest["sfx"] = {"pop": "assets/sfx/pop.wav"}

manifest["video"] = {"src": "assets/video/monkey.mp4",
                     "poster": "assets/video/poster.jpg",
                     "duration": VIDEO_LEN, "width": 480, "height": 848}

with open(os.path.join(ROOT, "..", "data", "media-manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False)
print("done")
