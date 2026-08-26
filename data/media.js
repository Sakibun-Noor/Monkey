// Media manifest for the Dynamic Monkey Video Player.
// Durations are measured, not guessed: narration runs 39.65s-44.33s against a
// 44.00s master video, and the music beds run 48s. The player syncs to the video
// clock and never stretches anything - see js/player.js.

export const VIDEO = {
  "src": "assets/video/monkey.mp4",
  "poster": "assets/video/poster.jpg",
  "duration": 44.0,
  "width": 480,
  "height": 848
};

export const POP_SFX = "assets/sfx/pop.wav";

export const NARRATORS = [
  {"id": "n01-shaun-british", "label": "Shaun — British, clean and reliable", "src": "assets/narration/n01-shaun-british.mp3", "duration": 42.031},
  {"id": "n02-verity-british", "label": "Verity X — calm British narration", "src": "assets/narration/n02-verity-british.mp3", "duration": 43.598},
  {"id": "n03-john-northern-ireland", "label": "John — warm, balanced Northern Ireland", "src": "assets/narration/n03-john-northern-ireland.mp3", "duration": 43.416},
  {"id": "n04-mahesh-caribbean", "label": "Mahesh — warm and calm Caribbean", "src": "assets/narration/n04-mahesh-caribbean.mp3", "duration": 44.147},
  {"id": "n05-tarquin-rp", "label": "Tarquin — posh English RP", "src": "assets/narration/n05-tarquin-rp.mp3", "duration": 41.639},
  {"id": "n06-english-rose", "label": "English Rose", "src": "assets/narration/n06-english-rose.mp3", "duration": 39.654},
  {"id": "n07-bek-british", "label": "Bek — trusted British English", "src": "assets/narration/n07-bek-british.mp3", "duration": 42.527},
  {"id": "n08-chris-scottish", "label": "Chris — Scottish casual", "src": "assets/narration/n08-chris-scottish.mp3", "duration": 41.273},
  {"id": "n09-studio-take-a", "label": "Studio take A", "src": "assets/narration/n09-studio-take-a.mp3", "duration": 43.703},
  {"id": "n10-studio-take-b", "label": "Studio take B", "src": "assets/narration/n10-studio-take-b.mp3", "duration": 44.33},
];

export const MUSIC_BEDS = [
  {"id": "m01-tribal", "label": "Tribal", "src": "assets/music/m01-tribal.mp3", "duration": 48.0},
  {"id": "m02-savana-beats", "label": "Savana Beats", "src": "assets/music/m02-savana-beats.mp3", "duration": 48.0},
  {"id": "m03-african-delta", "label": "African Delta", "src": "assets/music/m03-african-delta.mp3", "duration": 48.0},
  {"id": "m04-african-drums", "label": "African Drums", "src": "assets/music/m04-african-drums.mp3", "duration": 48.0},
  {"id": "m05-tribal-music", "label": "African Tribal", "src": "assets/music/m05-tribal-music.mp3", "duration": 48.0},
  {"id": "m06-light-tribal-dance", "label": "Light Tribal Dance", "src": "assets/music/m06-light-tribal-dance.mp3", "duration": 48.0},
  {"id": "m07-afro-beat", "label": "Afro Beat", "src": "assets/music/m07-afro-beat.mp3", "duration": 48.0},
  {"id": "m08-african-night", "label": "African Night", "src": "assets/music/m08-african-night.mp3", "duration": 48.0},
  {"id": "m09-africa", "label": "Africa", "src": "assets/music/m09-africa.mp3", "duration": 48.0},
  {"id": "m10-drums-tribal", "label": "Drums Tribal", "src": "assets/music/m10-drums-tribal.mp3", "duration": 48.0},
];

// Monkey ambience, lifted from the video's own audio and speech-cleaned by the
// freelancer. Verified 08.26.26: speech band -10.3 dB, monkey call band -0.6 dB,
// i.e. the calls survived. 43.955s against the 44.0s video -- the player's
// short-track handling covers the 45 ms gap, no looping or stretching.
export const MONKEY_TRACK = {
  "id": "monkey-track",
  "label": "Monkey ambience",
  "src": "assets/monkey/monkey-track.mp3",
  "duration": 43.955
};

// Ping options sent to the client 08.26.26; pop.wav currently holds ping-1.
export const PING_OPTIONS = [
  { "id": "ping-1-clean-beep",  "label": "Clean short beep, 880 Hz" },
  { "id": "ping-2-high-beep",   "label": "Higher, tighter beep, 1320 Hz" },
  { "id": "ping-3-soft-beep",   "label": "Soft rounded beep, 1046 Hz" },
  { "id": "ping-4-double-beep", "label": "Two-step beep, 784 then 1046 Hz" },
  { "id": "ping-5-blip",        "label": "Very short blip, slight fall" }
];
