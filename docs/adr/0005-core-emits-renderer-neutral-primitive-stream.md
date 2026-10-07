# Core parses to a renderer-neutral geometry stream that preserves HP-GL primitives

`packages/core` turns a file into a typed stream of HP-GL primitives — polyline, circle, arc, wedge, rectangle, filled polygon, and text label, each tagged with pen and line type — rather than flattening everything to line segments at parse time. Renderers tessellate from this stream as needed. Keeping primitives is what lets SVG export emit real circles and arcs and keep labels as text; flattening would throw that away and force both renderers to duplicate geometry logic.
