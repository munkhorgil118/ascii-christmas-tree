# ASCII Christmas Tree

A rotating 3D particle Christmas tree drawn entirely with coloured ASCII characters.
The tree grows from the bottom up with a white flash, then the tinsel, baubles,
170 fairy lights, presents and star appear, and finally **MERRY CHRISTMAS 2026**
is typed out letter by letter. Snow falls through the whole scene.

**Live demo:** https://ascii-christmas-tree-mauve.vercel.app

It is a static web port (plain HTML + vanilla JavaScript + `<canvas>`, no framework,
no build step) of the original Python / pygame program in [`python/christmas_tree.py`](python/christmas_tree.py).

## Controls

| Key / gesture | Action |
| --- | --- |
| `Space` / tap the tree | Pause / resume |
| `R` / ↻ button | Restart |
| `S` / ⤓ button | Download a PNG screenshot |
| ♪ Music button | Play / pause the background music |

Tip: add `?t=14` to the URL to jump straight to that point of the timeline.

## Music

The ♪ Music button plays Wham! - *Last Christmas* from the official YouTube video,
embedded with the [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).
No audio is downloaded or hosted here. Browsers block autoplay with sound, so nothing
loads until you tap the button; the song then loops. The player stays visible as a small
card: bottom-right when there is room beside the tree, otherwise below it. If the video
can't be embedded, the card shows a *Listen on YouTube* link instead.

## Run locally

No install needed. Serve the folder over HTTP (opening `index.html` directly from disk
shows the tree, but the YouTube player doesn't work from `file://`):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

### Original Python version

```bash
pip install pygame numpy
python python/christmas_tree.py        # optional: python python/christmas_tree.py 12  (cell height in px)
```

## How it works

- ~56,000 particles (needles, inner cone, trunk, tinsel, baubles, lights, presents) are
  generated once with a seeded RNG (mulberry32) and stored in `Float32Array`s.
- Every frame each particle is rotated, projected with perspective onto an 88×74
  character grid, and only the particle nearest to the camera is kept per cell.
- The winner is lit (Lambert + facing term + density), mapped to a brightness level and
  drawn with a per-kind character set (`.-~^*+=vx%&#W` for needles, `oO0@` for lights, …).
- Rendering uses a pre-rendered glyph atlas: a white glyph mask is multiplied by a
  per-cell colour layer, then two blurred glow layers are added for the bloom.
- The canvas is sized in whole device pixels per cell (`devicePixelRatio` aware) so text
  stays crisp on any screen, from phones to 4K monitors.

## Files

```
index.html   page markup
style.css    layout (dark, centred, responsive)
main.js      scene, renderer and controls
python/      original pygame version
```
