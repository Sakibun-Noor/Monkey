# Dynamic Monkey Video Player

A mobile-only portrait player built on one 44-second master video. Every
playback draws a fresh combination:

**10 narrators × 10 music beds × 40 comment sets = 4,000 combinations.**

```bash
python monkey-player/serve.py 5179
```

Then open <http://localhost:5179> (use a phone or a mobile-sized viewport).
`serve.py` exists because `python -m http.server` does not answer HTTP Range
requests, which leaves `<video>` unseekable.

## Deploying

Static site — no build step, no dependencies. Push this repo to GitHub, then in
Vercel: **Add New → Project → import the repo → Framework Preset "Other" →
Deploy.** Leave build command and output directory empty; the repo root is the
site root. `vercel.json` sets cache headers and `.vercelignore` keeps `serve.py`
and `tools/` out of the deployment (Vercel's CDN answers Range requests
natively, so the dev server isn't needed in production).

Assets are cached for a day rather than a year, because the media is still under
review. Once the tracks and comment wording are final, bump `/assets/(.*)` in
`vercel.json` to `max-age=31536000, immutable` — but from then on, **rename a
file when you replace it**, or viewers will keep the cached copy.

Bandwidth is the one thing to watch: a first visit pulls ~9 MB (8 MB video plus
one narration and one music track). Vercel's Hobby tier gives 100 GB/month —
roughly 11,000 first visits — and is licensed for non-commercial use only. For
client work either use a Pro account, or deploy to Cloudflare Pages, which is
free with unlimited bandwidth and suits video-heavy static sites better.

---

## Assets — where each one came from

| Slot | Count | Source |
| --- | --- | --- |
| Master video | 1 | `monkey2/Monkey (1).mp4` — copied **byte-identical** (sha256 `f31cfb82…`), 480×848 portrait, 44.00 s |
| Narration | 10 | `OneDrive_1_8-16-2026 (1).zip` — 9 mp3 + 1 wav, re-encoded to mono 96 kbps mp3 |
| Music beds | 10 | `OneDrive_1_8-16-2026.zip` — trimmed to 48 s with a 1.2 s fade-in / 3 s fade-out, stereo 96 kbps |
| Comment sets | 40 | `40_Synchronized_Monkey_Comment_Sets_Gender_Neutral.xlsx` — 902 comments total |
| Commenter headshots | 55 | The 55-portrait contact sheet, sliced per cell with the burnt-in name strip cropped off |
| Pop SFX | 1 | **Generated** — see below |

### The two things that are not verbatim source

1. **Pop sound.** No pop shipped with the assets, so
   `tools/build_audio.py` synthesises one: a 90 ms downward pitch sweep with a
   click transient. Drop a real `assets/sfx/pop.wav` in its place and nothing
   else needs to change.
2. **Two music beds are unused.** The zip held 12. Left out:
   `alexguz-african-drums-386471` (15 s — shorter than the video) and
   `diluvios-roots-in-motion-495223` (5 m 27 s). To swap one in, edit the
   `MUSIC` list in `tools/build_audio.py` and re-run it.

There are 55 headshots in `assets/avatars/`. Each of the 40 comment sets (44
comments apiece, 1,760 in all) is voiced by exactly 10 of them, so a mix only
ever fetches those 10.

---

## Sync model

Audio and picture are kept together by the **audio** clock, not the video's.

`js/mix.js` decodes narration, music and the monkey bed into memory and starts
them together on one Web Audio clock. Once started they are never seeked or
rate-adjusted, which is what removed the clicking on iPhone (three `<audio>`
elements corrected every frame drift harder when Safari throttles the frame
loop). Instead the muted video is walked onto that clock in `js/player.js`:

- drift under 0.25 s → left completely alone
- drift over 0.25 s → playback rate nudged by at most ±2 %, with hysteresis
- picture ahead by more than 1 s → the *audio* restarts at the picture; the
  picture is never seeked backwards onto the clock (that looped a second of
  footage on iPhone when the clock froze after switching apps)
- picture behind by more than 1 s → one forward seek

Audio only exists while the picture is genuinely rolling: it stops on a
buffering stall and rejoins from wherever the picture is. A watchdog notices a
context that reports "running" with a stopped clock (iOS after an interruption)
and revives it.

**Tracks that are not exactly 44 s.** Narration runs 39.65 s–44.33 s; the music
beds run 48 s. Nothing is stretched or looped: a shorter track just ends and the
tail is silent; a longer one stops with the video.

## Play / pause

`intent` in `js/player.js` is the single source of truth for "should this be
playing". A tap sets it immediately and the buttons follow it, not the `<video>`
element, whose state lags behind on a phone. Picture, audio and the spinner are
reconciled toward it, so any sequence of taps ends in the state the last tap
asked for. Tapping the picture only shows or hides the controls.

One press plays **two different mixes back to back** (new narrator, music and
comments for the second), swapped under the fade to black, then shows the end
card. Pressing play again starts a fresh pair.

## Loading

- The first mix (narration + music + monkey bed) is fetched and decoded up front;
  a tap that lands earlier shows a spinner and starts the moment it is ready.
- Playback waits for ~5 s of picture to be downloaded ahead of the playhead
  (max 8 s), so a slow connection waits behind a spinner instead of stalling.
- The next mix downloads in the background, but not while it would compete with
  the picture: once the picture is fully in, 10 s ahead, or 30 s into playback.
- Audio fetches time out and retry, so a dropped request can't hang the player
  or silently leave a layer missing. Only the ~10 avatars a mix uses are fetched.
- `tools/serve_slow.py` serves the site through a throttled link for testing.

---

## Comments

`js/comments.js` renders comments as HTML/CSS over the video — never baked in.

- circular 28 px avatar, bold name, off-white body text, lower-left
- newest enters at the bottom with a pop/slide-in plus the pop sound
- at most **4** on screen; older rows glide upward and fade out
- each comment lives 8 s of *video* time, so pausing freezes the stack
- seeking rebuilds the stack silently — correct comments, no pop spam

## Editing the comments

Everything lives in `data/comment-sets.js`, which is plain, hand-editable JS:

```js
{ "t": 12, "who": "tomb", "target": "Monkey", "text": "How do you know?", "emoji": "🙄" }
```

- `t` — seconds into the 44 s video
- `who` — a `COMMENTERS[].id` in the same file
- `text` — edit freely; this is where gender-neutral wording gets finalised
- `emoji` — optional, appended after the text
- `note` — a stage direction carried over from the sheet that had no emoji
  glyph (4 of them, e.g. `"Couch potato"`). Render it or delete it.

To regenerate from an updated workbook: `python tools/build_comments.py`.

---

## Layout

Portrait-only by design. Phones held sideways get a "rotate to portrait" gate;
screens wider than 620 px show the same 9:16 stage letterboxed in the middle.

## Controls

Centre and bottom-left buttons play/pause · scrubber · mute · shuffle (a fresh
combination that never repeats the previous narrator, bed, or set).
Keyboard: `space` `R` `M` `←` `→`.

## Layout of the repo

```
index.html
css/player.css
js/player.js       orchestration, selection, controls
js/mix.js          Web Audio mixer: one clock for all three layers
js/comments.js     the overlay
js/pop.js          low-latency pop SFX
data/media.js      narrator + music manifest with measured durations
data/comment-sets.js  the 40 sets and the roster  <-- edit here
tools/             regeneration scripts for every derived asset
serve.py           dev server with Range support
tools/serve_slow.py   the same, through a throttled link
```
