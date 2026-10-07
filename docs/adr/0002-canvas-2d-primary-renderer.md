# Canvas 2D is the primary renderer; SVG is an export format

HP-GL is vector data, so SVG is the obvious render target, but real files reach ~100k coordinates, which becomes tens of thousands of SVG DOM nodes and makes live pan/zoom janky. The live view renders to Canvas 2D instead; SVG is generated on demand as an export, where the DOM cost is paid once. The parser emits a renderer-neutral geometry stream that either backend consumes.
