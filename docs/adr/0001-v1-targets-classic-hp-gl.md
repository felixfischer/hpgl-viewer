# v1 targets classic HP-GL only

HP-GL, HP-GL/2, and HP RTL are three separate specifications, and HP-GL/2 is a large superset (a 540-page reference) that adds colour, palettes, and hard-clip. v1 parses and renders classic HP-GL only. This keeps the first release honest about what it supports and matches the sample plots, which use a small classic subset. HP-GL/2 and HP RTL are explicitly out of scope until the classic renderer is solid — expect files exported from CAD tools (often HP-GL/2 `.plt`) not to render.
