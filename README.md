<div align="center">
  <br>
  <img src="./FlickIcon.svg" alt="Flick Editor" width="25%">
  <br>
</div>

# Flick Editor
SVG-based keyframe animation system. Edit your SVGs in Inkscape (or any editor), bring them to life in Flick.

## How It Works
Flick gives you a timeline on which you can create layers. Each layers acts as its own separate animation channel. This model will be very familiar to those coming from Flash. In each layer are keyframes, and you specify how each keyframe will interpolate in between. The editing is done in an external editor - Inkscape by default, but any SVG editor that can open and save to a file will work - and Flick watches the SVG files for edits to update the timeline. The animation is done in Flick.