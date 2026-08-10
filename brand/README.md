# App Requests — brand

> *Ask. Vote. Watch it get built.*

Store assets for this app's Civitai App listing. **These files are the source of truth for
this app's identity** — the listing images are exported from them, not the other way round.

## Identity

**Voice.** Town-hall noticeboard — open, plain-spoken, democratic. The least technical of the set, and it should look it.

**Motif.** **The card that rises.** A stack of cards with one lifted clear, held up by solid cyan triangles. The rise is always earned by the triangles — the card never floats on its own.

## Palette

| Role | Hex | |
|---|---|---|
| Plate / dominant | `#FFA726` | the icon background, edge to edge |
| Secondary | `#FFD8A0` | the mark itself |
| Accent | `#4DD0E1` | the vote — used sparingly, one element only |
| Cover ground | `#0B0E14` | |

## Files

| File | Purpose |
|---|---|
| `icon.svg` | listing icon, 1024×1024 |
| `cover.svg` | listing cover, 1600×900 |

Export with `rsvg-convert`:

```bash
rsvg-convert -w 1024 -h 1024 brand/icon.svg  -o /tmp/icon.png
rsvg-convert -w 1600 -h 900  brand/cover.svg -o /tmp/cover.png
```

🔴 **Flatten the icon's corners onto the plate colour before uploading** — do not upload it
with transparency:

```bash
magick /tmp/icon.png -background '#FFA726' -alpha remove -alpha off /tmp/icon-upload.png
```

The listing pipeline transcodes every asset to JPEG, which has no alpha channel, and the
transparency is flattened to **black**. The store then clips the icon with a CSS avatar mask
that is slightly *less* rounded than the plate, so a thin dark rim survives along the curve.
Filling the corners with the plate colour removes the whole class — there is no transparency
left to flatten.

Attach with:

```bash
civitai app listing set-icon  /tmp/icon-upload.png
civitai app listing set-cover /tmp/cover.png
```

On a live listing this opens a revision for moderator re-review; the current assets stay
visible until it is approved. Setting the icon and cover in the same session puts both on one
revision, so they are reviewed together.

## Shared construction grammar

This app is one of five first-party apps drawn to a common grammar, so a row of them reads as
a suite while each stays individually memorable. Keep to it when changing anything here:

- Flat vector. Solid fills only — no gradients, shading, bevel, glow or 3D.
- Geometric primitives only: squares, triangles, circles, arcs, rings.
- Thick, uniform stroke weight. This is the strongest family signal at thumbnail size.
- Three colours maximum: one dominant, one accent, one neutral.
- The plate fills the whole canvas **edge to edge**; the margin lives *inside* it, around the
  mark. Never ask for margin *around* the plate — that bakes in a surround the store cannot
  crop past the rounded corners.
- **No lettering anywhere** — and that includes motifs whose skeleton *constructs* a letter or
  digit. Before locking a shape, ask what character it resembles.
- Never name a direction with a noun that already implies one. Say the geometry.

## App-specific note

🔴 Every triangle has its **apex at the top and flat base at the bottom**, stated as geometry rather than as a direction word. Describing them as "chevrons pointing upward" produced *downward* chevrons in 3 of 4 generated attempts — the noun carries a down-caret prior strong enough to override the adjective, and a voting board that reads as a downvote is the precise inverse of the brand.

## If you regenerate these

These were drawn as vector rather than generated, after three measured rounds established that
the constraints above and diffusion are structurally mismatched: across 42 generated images,
flat solid fills held 0/20, exact palette 1/10, and the alpha channel 0/20. Generation is
useful for *finding* a composition and poor at *meeting* a spec. If you use it, treat the
output as a sketch and redraw the winner in vector — and judge a candidate by what a stranger
would say it depicts, not by whether it matches the prompt.
