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

Tip: add `?t=14` to the URL to jump straight to that point of the timeline.

## Run locally

No install needed. Either open `index.html` directly in a browser, or serve the folder:

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
