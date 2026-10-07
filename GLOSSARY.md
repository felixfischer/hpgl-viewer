# hpgl-viewer

An open-source viewer for HP-GL plotter files, rendered in the browser and as a macOS QuickLook preview.

## Language

### Dialects

**HP-GL**:
Hewlett-Packard's vector language for driving pen plotters. The project's v1 target dialect.
_Avoid_: HPGL, HP/GL

**HP-GL/2**:
The later, raster-oriented superset of HP-GL. Out of scope for v1.
_Avoid_: HPGL2, HP-GL 2

**HP RTL**:
Raster image data for raster plotters. Out of scope.
_Avoid_: RTL

### Coordinates and units

**Plotter unit**:
The base device unit of HP-GL: 0.025 mm, i.e. 40 units per millimetre.
_Avoid_: device unit, hardware unit

**User unit**:
Coordinates defined by the file itself through the scaling points and scale command. Floating-point, unlike plotter units.
_Avoid_: logical unit, scaled unit

**Scaling points**:
The two points, P1 and P2, that anchor user units to the plotter-unit coordinate system.

**Input window**:
The rectangle, in plotter units, that `IW` clips drawing to. Each primitive carries the window in force when it was drawn.
_Avoid_: clip rect, viewport

**Line type**:
The dash pattern set by `LT`: a pattern number (0–6) and a pattern length, given as a percentage of the P1–P2 diagonal and carried on each primitive in plotter units.
_Avoid_: dash style, stroke style

**Chord angle**:
The angle, in degrees, each straight chord of a tessellated circle or arc spans; rounded so a whole number of chords covers the sweep. Set per command, or derived from a chord height under `CT1`.
_Avoid_: resolution, segment angle

**Chord tolerance**:
The `CT` mode deciding whether a curve's resolution parameter is a chord angle (`CT0`, default) or a chord height, the maximum deviation from the true curve in current units (`CT1`).
_Avoid_: flatness, precision

### Pen

**Pen**:
A numbered drawing tool selected with `SP` (0–255; `SP0` parks the pen). Classic HP-GL attaches no colour to a pen.
_Avoid_: tool, head

**Pen colour**:
The colour a pen's strokes are drawn in. Since classic HP-GL carries no colour, the viewer assigns each pen a distinct colour from a default palette, overridable by the user.
_Avoid_: pen style, pen shade

### Shapes and fills

**Polygon buffer**:
The rings collected between `PM0` and `PM2`, drawn by `FP` (fill) and `EP` (edge). Nothing draws while it is being defined.
_Avoid_: path, shape buffer

**Ring**:
One closed outline in the polygon buffer (HP-GL's subpolygon). Rings fill by the even-odd rule, so nested rings make holes.
_Avoid_: contour, loop

**Fill type**:
How `FT` fills a shape: solid (types 1 and 2, drawn as an area) or hatched with parallel lines (3) or crossed lines (4) at a spacing and angle.
_Avoid_: pattern, fill style
