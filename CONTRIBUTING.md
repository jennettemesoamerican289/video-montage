# Contributing

Thanks for your interest in Video Montage! The project is open under the GPL-3.0
license, and any improvements are welcome — from bug fixes to new features.

## Getting started

```bash
git clone https://github.com/gitmir-hello/video-montage.git
cd video-montage
npm install          # also downloads the ffmpeg binary
npm run dev          # backend :3001 + frontend :5173
```

Open http://localhost:5173. You don't need to install ffmpeg manually — it's pulled
in by the `ffmpeg-static` package.

## Checks before a PR

```bash
npx tsc --noEmit     # types must be clean
npm run build        # the production build must pass
```

If you changed the backend, run a manual scenario: create a project, load a video
and mp3, export an mp4, and check the result with `ffprobe`.

## Project structure

```
server/
  index.js       # Express: project routes, media upload, export, serving /media
  projects.js    # on-disk project store (data/projects/<id>/)
  ffmpeg.js      # ffmpeg/ffprobe wrappers: frames, crop, cuts, mix, export
src/
  App.tsx        # root component, project state, orchestration
  useTransport.ts# synced preview (video = master clock, audio by windows)
  api.ts, types.ts
  components/     # ProjectPicker, Timeline, TransportBar, CropOverlay, ImportDialog, …
  styles.css     # the entire HUD design (no frameworks)
```

## Style

- **TypeScript** on the frontend, plain **ESM JavaScript** on the backend.
- Keep comments short; explain "why", not "what".
- No new dependencies without a good reason — the project is intentionally light.
- HUD aesthetic: sharp geometry (no rounding), cyan accent, Onest + JetBrains Mono
  fonts. Stick to the existing CSS tokens in `styles.css`.

## Pull requests

1. Fork the repo and create a branch off `main`.
2. Make atomic commits with clear messages.
3. Describe in the PR what changes and why; attach a screenshot for UI changes.
4. Make sure `tsc` and `build` pass.

## Bug reports

Open an [issue](https://github.com/gitmir-hello/video-montage/issues) with
reproduction steps, your OS, Node version and, if possible, the video's
characteristics (resolution, codec, duration).
