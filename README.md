# firefly

## Getting Started

Open `index.html` in your web browser and start editing `sketch.js`.

## Running Locally

Run the project from `localhost` or a secure HTTPS page so the browser can grant camera access. Opening the raw `index.html` file directly may block webcam access in modern browsers.

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx http-server

# Using VS Code Live Server extension
# Right-click index.html -> "Open with Live Server"
```

Select the hand button in the upper-left corner and allow camera access to enable PoseNet controls. This also enables flash reset: after the camera calibrates for a moment, flash a light toward the webcam to reset the round. Move a wrist or the mouse over a firefly to catch it; all catches go into the shared jar. PoseNet runs in the browser using ml5.js.

Five fireflies appear at first. For each full minute without a catch while the jar is empty, five more can appear, staying within the screen and moving in a band below the top edge. Catching any firefly resets the visible limit to five and starts the inactivity timer again; while the jar contains any caught fireflies, the limit stays at five. When all fireflies have been caught, the scene waits 10 seconds, fades to black over the following 10 seconds, then starts a new round after five minutes.

Use the camera icon to show or hide the preview, and the X button in the lower-right corner to reset the game at any time.

PoseNet wrist markers use confidence filtering and position smoothing to reduce jitter. A marker briefly holds its last detected position through short tracking dropouts.

The shared jar starts at half its previous size. Drag it to reposition it; caught fireflies orbit the jar's new location. You can also focus the jar and use the arrow keys to move it. Use the plus and minus buttons at the jar's top corners to change its size in steps.

## Resources

- [p5.js 2.0](https://beta.p5js.org/)
- [p5.js Reference](https://p5js.org/reference/)
- [ml5.js PoseNet](https://learn.ml5js.org/#/reference/posenet)
