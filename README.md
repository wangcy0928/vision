# Vision

One iPhone web app that combines the three **Body Interface** prototypes (IPD 5900, Penn) for blind navigation. Like Be My Eyes, with AI in place of the human volunteer.

| Gesture | What it does |
|---|---|
| **Hold the screen** (wait for the beep, then speak) | Find ("find the door"), reading ("read this poster"), or any question |
| **Double-tap** | Obstacle mode (Echo) on |
| **Tap once** | Back to standby: stops Find, obstacle mode and speech |
| **Point** at something and hold still | Says what it is |

The app starts in **standby**: camera on, nothing beeping. The original prototypes are untouched and still live in their own repos: `echo`, `point-explain`, `find`.

## Using it

- **Obstacle mode** (double-tap). Left ear "tok", right ear "ting", ahead "bzz" in both ears. Faster = closer. Very close → "Close, ahead."
- **Hold the screen and talk.** What you say picks the job:

| You say | What happens |
|---|---|
| "Find the door", "Where's a chair?", "Take me to the exit" | Find |
| "Read this", "Read the text on this poster", "What does it say?" | Reads the text aloud |
| "What's in front of me?", "Describe", "Where am I?" | Describes the scene |
| Anything else | The question goes to the AI with a photo |
| "Where is it?" (during Find) | Says where the target is now |
| "Stop" | Ends Find |
| "Standby" / "Obstacle mode" | Same as a single tap / a double-tap |

- **Point** at something and hold still for a second → "On your left. Exit sign, text reads EXIT."

On a computer: hold Space to talk, Enter = single tap, `d` = double-tap, `t` = read, Esc = stop Find.

## How the three share one phone

- **Sound.** If obstacle mode is on while Find is running, Echo goes quiet except for something very close, and then it uses a low hum instead of its usual beeps, so it can't be mistaken for Find's guidance. Once Find is locked on, "ahead" is ignored (you are walking straight at the target).
- **Finger pointing** is switched off while Find is running, to save the phone's processing power.
- **Camera.** Normal lens by default. Find switches to the ultra-wide lens and switches back when it ends (about half a second each way). A web page on an iPhone can only use one camera at a time. `?wide=0` turns the ultra-wide lens off.

## Distance: one camera, not two

Safari does not let a web page open two cameras at once, so real stereo is not possible in a web app. Echo uses a single-camera depth model instead: **Depth Anything V2 Small**, run on the phone with Transformers.js in a web worker (`depth-worker.js`), on the GPU when available.

The model gives *relative* depth only — which parts of the picture are nearer than others, not metres. Echo turns that into a 0–1 "closeness" for the left, middle and right of your path, measured against the nearest thing in view (usually the floor at your feet). So Echo says "close", never "1.5 metres". Find still estimates steps from the target's size.

The grey thumbnail at the top right of the screen is the depth picture (bright = close); the three bars near the bottom are left / ahead / right closeness.

## Files

- `index.html` — the whole app
- `depth-worker.js` — depth model
- `api/describe.js` — Explain: `POST {image, mode: point|scene|read|ask, question?}` → `{text}`
- `api/locate.js` — Find: `POST {image, target}` → `{found, x, y, w, h, steps, label}`

## Deploy

Vercel, no build step. Environment variable: `DEEPSEEK_API_KEY` (optional `DEEPSEEK_MODEL`, default `deepseek-flash`).
Check: `GET /api/describe` and `GET /api/locate` should both return `{"ok":true,"hasKey":true}`.

iPhone: Safari needs camera, microphone and Motion & Orientation permission (asked on the start tap). Turn on Dictation for voice input. Wear headphones.

## Tuning from the URL

`?near=0.6` beeping starts · `?close=0.9` "close" warning · `?depthms=250` pause between depth frames · `?dsize=224` depth frame size · `?depth=0` no obstacle radar · `?hands=0` no finger pointing · `?wide=0` no ultra-wide lens

The line at the bottom of the screen shows: camera, depth (gpu/cpu and time per frame, or OFF), hand model, motion sensor, AI time, fps, version.

*Prototype only. Not a mobility aid.*
