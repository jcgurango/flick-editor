Great. Now let's talk about how this actually works.

**Flick v1**

Flick is an animation editor. You draw in Inkscape, you animate in Flick.

A project is a timeline with a framerate, a number of frames, and a stage size. The timeline has layers stacked in z-order. Each layer has keyframes. Each keyframe is a plain SVG file.

To animate, you create a keyframe on a layer, open it in Inkscape, draw, save. Create another keyframe further along, open it, modify, save. Flick interpolates between them by matching elements across keyframes by SVG ID. Transforms, colors, numeric attributes, and structurally-identical paths get lerped. Anything that can't be lerped holds until the next keyframe. Elements that appear in one keyframe but not the other fade in or out.

**Editing in Inkscape:**

When you open a keyframe for editing, Flick prepares a working file in a cache folder. The other layers are pre-rendered at the current frame by the interpolation engine, saved as separate SVGs in the cache, and linked into the working file as locked Inkscape layers via `<image>` references. The editable layer's content is inlined directly. Inkscape sees a normal multi-layer SVG — locked context layers you can see but not touch, and one editable layer with your content.

Flick watches the working file. On save, it throws away any layer whose name starts with `[ctx]`, and writes the remaining content back to the keyframe SVG on disk. The stage preview updates.

The cache is ephemeral and fully derived. It's regenerated every time you open a keyframe for editing.

**On disk:**

```
my-animation/
  project.xml
  layers/
    background/
      kf_000.svg
    character/
      kf_000.svg
      kf_024.svg
      kf_048.svg
    foreground/
      kf_000.svg
      kf_060.svg
  .cache/
    edit/
      context_background.svg
      context_foreground.svg
      editing_character_kf024.svg
```

**project.json:**

```xml
{
  "name": "my-animation",
  "fps": "30",
  "frames": "60",
  "width": "1920",
  "height": "1080",
  "layers": [
    {
      "id": "background"
    },
    {
      "id": "character"
    },
    {
      "id": "foreground"
    }
  ]
}
```

**Tech:** The stage preview is an SVG in the DOM — the browser is the renderer. The interpolation engine is a pure function: two SVGs and a t value in, one blended SVG out. The Inkscape bridge is `spawn` plus `fs.watch` to watch the file that's currently being edited.

**What Flick does:** timeline, layers, keyframe management, interpolation, preview, export.

**What Inkscape does:** drawing.'

Let's not think of export right now, just preview.