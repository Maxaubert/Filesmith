# File-type navigation: four concepts

The left rail becomes **file types** (Images, Video, Audio, PDF, Documents). The open
question is where the **operations** go. Every mockup below shares the same title bar,
left rail and queue layout, so the only variable is the answer to that question.

Open the `.html` files directly in a browser, or view the rendered PNGs.

| File | Concept |
| --- | --- |
| `1-sidebar-list.html` | Operation list at the top of the right sidebar |
| `2-centre-tabs.html` | Operations as a tab strip across the centre |
| `3-nested-rail.html` | Operations nested under the file type in the left rail |
| `4-sidebar-chips.html` | Operations as wrapping chips in the right sidebar |
| `1b-sidebar-list-PDF.html` | Concept 1 under load: PDF's seven operations |
| `2b-centre-tabs-PDF.html` | Concept 2 under load: PDF's seven operations |

## The load case that separates them

Images has five operations, but **PDF has seven** (Extract text, Pages to PNG, Merge,
Split, Burst, Extract images, Compress). Any concept that only works for Images is not a
concept, so both leading candidates were rendered with PDF selected.

Result: the centre tab strip does fit seven tabs at 1400px wide, but only just. It
consumes the full centre width with no slack, so a narrower window or one longer
operation name pushes it into scrolling or wrapping. The sidebar list absorbs seven
entries without stress, since it grows downward into space that is otherwise empty.

## Trade-offs

**1. Sidebar list.** Operation and its options are in one column, read top to bottom, and
the primary button sits directly below. Scales to any operation count. Costs the most
vertical space in the sidebar, so with seven operations the options sit lower.

**2. Centre tabs.** The most conventional pattern, and the operation is legible at a
glance from across the screen. Keeps the sidebar purely for options. But it competes with
the page title for the top of the centre column, and it is the only concept with a real
width ceiling.

**3. Nested rail.** Everything navigational lives in one place, and the whole hierarchy
(type, then operation) is visible at once. Reads like a file tree, which suits a utility.
The rail grows tall, and the current operation is far from the options panel it controls.

**4. Sidebar chips.** The most compact, leaving maximum room for options. But chips wrap
into ragged rows, long names need abbreviating ("Remove BG", "Upscale"), and the colour
swatches carry less meaning than the real icons.

## Recommendation

**Concept 1, the sidebar list.** It matches the stated instinct to put operations on the
right, it is the only layout that keeps operation, options and action in one vertical
reading order, and it is the one that absorbs PDF's seven operations without strain.
Concept 3 is the strongest alternative if the operation should stay visible while the
sidebar scrolls.
