"""Encode the monkey ambience track and synthesise comment-ping options.

Deryck on the current sound: "That sounds like a gaming ping. I want more of a
short beep ping. I'll know it when I hear it." So this writes five distinct short
beeps for him to choose from rather than guessing at one.
"""
import math
import os
import struct
import subprocess

ROOT = r"C:\Users\Sakib Jawad\Desktop\Anti Grav\monkey-player\assets"
# clip_a: verified as a genuine speech-removal pass over the video's own audio
# (speech band -10.3 dB, monkey call band -0.6 dB). clip_b is 82% silence.
MONKEY_SRC = r"C:\Users\Sakib Jawad\Desktop\Monkey\08.25.26 Monkey.WAV"

SR = 44100


def write_wav(path, samples):
    frames = bytearray()
    for s in samples:
        frames += struct.pack("<h", max(-32767, min(32767, int(s * 32767))))
    with open(path, "wb") as fh:
        fh.write(b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt ")
        fh.write(struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16))
        fh.write(b"data" + struct.pack("<I", len(frames)) + bytes(frames))


def env(t, dur, attack=0.0015, release=None):
    """Click-free envelope: fast attack, exponential tail."""
    release = release if release is not None else dur * 0.75
    if t < attack:
        return t / attack
    return math.exp(-(t - attack) / (release / 4.0))


def tone(dur, freq, gain=0.5, harm=0.0, glide=0.0):
    n = int(SR * dur)
    out, phase = [], 0.0
    for i in range(n):
        t = i / SR
        f = freq * (1.0 + glide * (t / dur))
        phase += 2 * math.pi * f / SR
        s = math.sin(phase) + harm * math.sin(phase * 2)
        out.append(s * gain * env(t, dur))
    return out


def two_tone(d1, f1, d2, f2, gain=0.5):
    return tone(d1, f1, gain) + tone(d2, f2, gain)


PINGS = {
    # id                       description sent to the client
    "ping-1-clean-beep":   ("Clean short beep, 880 Hz",      tone(0.060, 880, 0.55)),
    "ping-2-high-beep":    ("Higher, tighter beep, 1320 Hz", tone(0.050, 1320, 0.50)),
    "ping-3-soft-beep":    ("Soft rounded beep, 1046 Hz",    tone(0.075, 1046, 0.42, harm=0.12)),
    "ping-4-double-beep":  ("Two-step beep, 784 then 1046",  two_tone(0.045, 784, 0.055, 1046, 0.45)),
    "ping-5-blip":         ("Very short blip, slight fall",  tone(0.040, 1500, 0.50, glide=-0.18)),
}

os.makedirs(os.path.join(ROOT, "sfx", "ping-options"), exist_ok=True)

for pid, (desc, samples) in PINGS.items():
    p = os.path.join(ROOT, "sfx", "ping-options", pid + ".wav")
    write_wav(p, samples)
    print(f"{pid:22} {desc:34} {len(samples)/SR*1000:5.0f} ms  {os.path.getsize(p):>6} B")

# Default until he picks: the plain clean beep, which is the least "gaming" of the set.
write_wav(os.path.join(ROOT, "sfx", "pop.wav"), PINGS["ping-1-clean-beep"][1])
print("\ndefault pop.wav <- ping-1-clean-beep")

# Monkey ambience: stereo, matches the video bed. 43.955s against a 44.0s video,
# so the player's existing short-track tail handling covers the 45 ms gap.
dst = os.path.join(ROOT, "monkey", "monkey-track.mp3")
os.makedirs(os.path.dirname(dst), exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", MONKEY_SRC,
                "-ac", "2", "-ar", "44100", "-b:a", "128k", "-map_metadata", "-1", dst],
               check=True)
dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                      "-of", "csv=p=0", dst], capture_output=True, text=True, check=True)
print(f"monkey-track.mp3  {float(dur.stdout.strip()):.3f}s  {os.path.getsize(dst):,} B")
