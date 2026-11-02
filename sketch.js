const totalFireflies = 100;
const maxVisible = 10;
const inactivityDelayMs = 60 * 1000;
const additionalFirefliesPerInterval = 5;
const fadeDelayMs = 10 * 1000;
const fadeDurationMs = 10 * 1000;
const roundResetDelayMs = 5 * 60 * 1000;
const flashCalibrationMs = 1500;
const flashBrightnessIncrease = 35;
const flashResetCooldownMs = 2000;
const wristConfidenceThreshold = 0.55;
const wristHoldDurationMs = 180;
const fireflies = [];
const jars = {
  shared: { x: 0, y: 0 }
};

let lastBurst = 0;
let lastCatchTime = 0;
let visibleFireflyLimit = maxVisible;
let fadeStartTime = null;
let roundCompleteTime = null;
let isDraggingJar = false;
const sharedJarCount = document.getElementById('shared-jar-count');
const sharedJarElement = document.getElementById('shared-jar');
const poseStartButton = document.getElementById('pose-start');
const poseStatus = document.getElementById('pose-status');
const flashStatus = document.getElementById('flash-status');
const flashIndicator = document.getElementById('flash-indicator');
const cameraPreview = document.getElementById('camera-preview');
const cameraPreviewToggle = document.getElementById('camera-preview-toggle');
const resetButton = document.getElementById('reset-button');
let poseNet;
let camera;
let cameraStream;
let poseCanvas;
let poseCanvasContext;
let flashCanvas;
let flashCanvasContext;
let flashBaseline = null;
let flashCalibrationStartedAt = null;
let lastFlashResetAt = -Infinity;
let flashStatusTimeout;
let posePoints = [];
const poseTracks = new Map();

function hasSecureCameraContext() {
  return window.isSecureContext ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
  poseStartButton.addEventListener('click', startPoseControls);
  cameraPreviewToggle.addEventListener('click', toggleCameraPreview);
  resetButton.addEventListener('click', resetRound);
  bindDraggableJar(sharedJarElement, jars.shared);
  lastCatchTime = Date.now();
  for (let i = 0; i < totalFireflies; i++) {
    fireflies.push(createFirefly());
  }
  updateJarPosition();
}

function toggleCameraPreview() {
  const isMinimized = cameraPreview.classList.toggle('is-minimized');
  cameraPreviewToggle.setAttribute('aria-label', isMinimized ? 'Show camera' : 'Minimize camera');
  cameraPreviewToggle.setAttribute('aria-expanded', String(!isMinimized));
}

async function startPoseControls() {
  if (!hasSecureCameraContext()) {
    poseStartButton.disabled = false;
    poseStatus.textContent = 'Camera access requires a secure context. Run the app from localhost or HTTPS, then try again.';
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    poseStartButton.disabled = false;
    poseStatus.textContent = 'This browser does not support webcam access for PoseNet controls.';
    return;
  }

  poseStartButton.disabled = true;
  poseStatus.textContent = 'Requesting camera access…';

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    camera = document.createElement('video');
    camera.autoplay = true;
    camera.muted = true;
    camera.playsInline = true;
    camera.className = 'pose-camera';
    camera.id = 'camera-feed';
    camera.setAttribute('aria-label', 'Mirrored webcam preview');
    camera.srcObject = cameraStream;
    cameraPreview.appendChild(camera);
    cameraPreview.classList.add('is-minimized');
    cameraPreviewToggle.setAttribute('aria-label', 'Show camera');
    cameraPreviewToggle.setAttribute('aria-expanded', 'false');
    cameraPreview.hidden = false;
    await camera.play();
    if (!camera.videoWidth || !camera.videoHeight) {
      await new Promise(resolve => camera.addEventListener('loadedmetadata', resolve, { once: true }));
    }

    startFlashDetection();
    poseStatus.textContent = 'Loading PoseNet…';
    poseNet = ml5.poseNet(camera, () => {
      poseStartButton.classList.add('is-ready');
      poseStartButton.setAttribute('aria-label', 'PoseNet controls active');
      poseStartButton.title = 'PoseNet controls active';
      poseStatus.hidden = true;
      poseCanvas = document.createElement('canvas');
      poseCanvasContext = poseCanvas.getContext('2d');
      requestAnimationFrame(trackPoseFrame);
    });
  } catch (error) {
    cameraStream?.getTracks().forEach(track => track.stop());
    camera?.remove();
    camera = null;
    cameraStream = null;
    cameraPreview.hidden = true;
    poseStartButton.disabled = false;
    poseStatus.textContent = `Could not start PoseNet controls: ${error.message}`;
  }
}

function startFlashDetection() {
  flashCanvas = document.createElement('canvas');
  flashCanvas.width = 32;
  flashCanvas.height = 24;
  flashCanvasContext = flashCanvas.getContext('2d', { willReadFrequently: true });

  if (!flashCanvasContext) {
    flashStatus.textContent = 'Flash reset could not start because this browser could not create an image sampler.';
    flashIndicator.setAttribute('aria-label', flashStatus.textContent);
    return;
  }

  flashBaseline = null;
  flashCalibrationStartedAt = null;
  flashIndicator.classList.add('is-active');
  flashIndicator.setAttribute('aria-label', 'Flash reset is active');
  flashStatus.textContent = 'Flash reset is active. Flash a light toward the webcam to reset the game.';
  requestAnimationFrame(checkCameraForFlash);
}

function checkCameraForFlash() {
  if (!camera || !flashCanvasContext) {
    return;
  }

  if (camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    flashCanvasContext.drawImage(camera, 0, 0, flashCanvas.width, flashCanvas.height);
    const pixels = flashCanvasContext.getImageData(0, 0, flashCanvas.width, flashCanvas.height).data;
    let totalBrightness = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      totalBrightness += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    }

    const brightness = totalBrightness / (pixels.length / 4);
    const now = performance.now();

    if (flashBaseline === null) {
      flashBaseline = brightness;
      flashCalibrationStartedAt = now;
    } else if (now - flashCalibrationStartedAt < flashCalibrationMs) {
      flashBaseline += (brightness - flashBaseline) * 0.05;
    } else if (now - flashCalibrationStartedAt >= flashCalibrationMs) {
      const isBrightFlash =
        brightness >= flashBaseline + flashBrightnessIncrease &&
        brightness >= Math.max(45, flashBaseline * 1.5);

      if (isBrightFlash && now - lastFlashResetAt >= flashResetCooldownMs) {
        resetRound();
        lastFlashResetAt = now;
        flashBaseline = brightness;
        flashIndicator.classList.add('is-detected');
        flashIndicator.setAttribute('aria-label', 'Flash detected. Game reset.');
        flashStatus.textContent = 'Flash detected. Game reset.';
        clearTimeout(flashStatusTimeout);
        flashStatusTimeout = setTimeout(() => {
          flashIndicator.classList.remove('is-detected');
          flashIndicator.setAttribute('aria-label', 'Flash reset is active');
          flashStatus.textContent = 'Flash reset is active. Flash a light toward the webcam to reset the game.';
        }, flashResetCooldownMs);
      } else {
        const adjustment = brightness < flashBaseline ? 0.1 : 0.005;
        flashBaseline += (brightness - flashBaseline) * adjustment;
      }
    }
  }

  requestAnimationFrame(checkCameraForFlash);
}

async function trackPoseFrame() {
  if (!poseNet || !camera || !camera.videoWidth || !camera.videoHeight) {
    requestAnimationFrame(trackPoseFrame);
    return;
  }

  if (poseCanvas.width !== camera.videoWidth || poseCanvas.height !== camera.videoHeight) {
    poseCanvas.width = camera.videoWidth;
    poseCanvas.height = camera.videoHeight;
  }

  poseCanvasContext.drawImage(camera, 0, 0, poseCanvas.width, poseCanvas.height);

  try {
    const pose = await poseNet.net.estimateSinglePose(poseCanvas, { flipHorizontal: false });
    const now = performance.now();
    for (const point of pose.keypoints) {
      if (
        point.score <= wristConfidenceThreshold ||
        (point.part !== 'leftWrist' && point.part !== 'rightWrist') ||
        !Number.isFinite(point.position.x) ||
        !Number.isFinite(point.position.y)
      ) {
        continue;
      }

      const x = constrain(width - (point.position.x / poseCanvas.width) * width, 0, width);
      const y = constrain((point.position.y / poseCanvas.height) * height, 0, height);
      const track = poseTracks.get(point.part);

      if (!track) {
        poseTracks.set(point.part, { x, y, score: point.score, lastSeen: now });
        continue;
      }

      const movement = dist(track.x, track.y, x, y);
      if (movement > 2.5) {
        const smoothing = movement > 100 ? 0.55 : point.score > 0.75 ? 0.34 : 0.26;
        track.x += (x - track.x) * smoothing;
        track.y += (y - track.y) * smoothing;
      }
      track.score = point.score;
      track.lastSeen = now;
    }

    posePoints = [];
    for (const [part, track] of poseTracks) {
      if (now - track.lastSeen > wristHoldDurationMs) {
        poseTracks.delete(part);
        continue;
      }

      posePoints.push({ part, x: track.x, y: track.y, score: track.score });
    }
  } catch (error) {
    posePoints = [];
    poseTracks.clear();
    poseStatus.textContent = `Pose tracking failed: ${error.message}`;
    poseStatus.hidden = false;
    poseStartButton.classList.remove('is-ready');
    poseStartButton.setAttribute('aria-label', 'Enable PoseNet controls');
    poseStartButton.title = 'Enable PoseNet controls';
    poseStartButton.disabled = false;
    return;
  }

  requestAnimationFrame(trackPoseFrame);
}

function createFirefly() {
  const radius = random(4, 12);
  return {
    x: random(width * 0.2, width * 0.8),
    y: random(height * 0.25, height * 0.55),
    radius,
    phase: random(TWO_PI),
    driftX: random(-0.28, 0.28),
    driftY: random(-0.22, 0.22),
    caught: false,
    caughtBy: null,
    caughtOrder: 0,
    twinkle: random(0.7, 1.8),
    glow: random(18, 42),
    visible: false,
    fade: random(0.8, 1.5)
  };
}

function placeJar(element, jar, centerX, centerY) {
  const halfWidth = element.offsetWidth / 2;
  const halfHeight = element.offsetHeight / 2;
  const x = constrain(centerX, halfWidth, width - halfWidth);
  const y = constrain(centerY, halfHeight, height - halfHeight);

  element.style.left = `${x - halfWidth}px`;
  element.style.right = 'auto';
  element.style.top = `${y - halfHeight}px`;
  element.style.transform = 'none';
  jar.x = x;
  jar.y = y;
}

function bindDraggableJar(element, jar) {
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    isDraggingJar = true;
    element.setPointerCapture(event.pointerId);
    const bounds = element.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const offsetY = event.clientY - bounds.top;

    const moveJar = moveEvent => {
      placeJar(
        element,
        jar,
        moveEvent.clientX - offsetX + bounds.width / 2,
        moveEvent.clientY - offsetY + bounds.height / 2
      );
    };

    const stopDragging = () => {
      isDraggingJar = false;
      element.removeEventListener('pointermove', moveJar);
      element.removeEventListener('pointerup', stopDragging);
      element.removeEventListener('pointercancel', stopDragging);
    };

    element.addEventListener('pointermove', moveJar);
    element.addEventListener('pointerup', stopDragging);
    element.addEventListener('pointercancel', stopDragging);
  });

  element.addEventListener('keydown', event => {
    const directions = {
      ArrowLeft: [-10, 0],
      ArrowRight: [10, 0],
      ArrowUp: [0, -10],
      ArrowDown: [0, 10]
    };
    const direction = directions[event.key];
    if (!direction) {
      return;
    }

    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    placeJar(
      element,
      jar,
      bounds.left + bounds.width / 2 + direction[0],
      bounds.top + bounds.height / 2 + direction[1]
    );
  });
}

function updateJarPosition() {
  const bounds = sharedJarElement.getBoundingClientRect();
  jars.shared.x = bounds.left + bounds.width / 2;
  jars.shared.y = bounds.top + bounds.height / 2;
  jars.shared.width = bounds.width;
  jars.shared.height = bounds.height;
}

function updateJarCounter() {
  const caughtCount = fireflies.filter(f => f.caught).length;
  sharedJarCount.textContent = caughtCount;

  if (caughtCount >= totalFireflies && fadeStartTime === null) {
    fadeStartTime = Date.now();
    roundCompleteTime = Date.now();
  }
}

function resetRound() {
  fireflies.length = 0;
  for (let i = 0; i < totalFireflies; i++) {
    fireflies.push(createFirefly());
  }

  lastBurst = frameCount;
  lastCatchTime = Date.now();
  visibleFireflyLimit = maxVisible;
  fadeStartTime = null;
  roundCompleteTime = null;
  updateJarCounter();
  sharedJarCount.style.opacity = '1';
}

function getSceneFade() {
  if (fadeStartTime === null) {
    return 1;
  }

  const elapsed = Date.now() - fadeStartTime;

  if (elapsed < fadeDelayMs) {
    return 1;
  }

  const fadeProgress = constrain((elapsed - fadeDelayMs) / fadeDurationMs, 0, 1);
  return 1 - fadeProgress;
}

function drawFirefly(f) {
  const sceneFade = getSceneFade();
  const pulse = 0.7 + 0.7 * sin(frameCount * 0.09 * f.twinkle + f.phase);
  const glowSize = f.radius * (1.8 + pulse * 2.2);

  for (let i = 0; i < 4; i++) {
    const r = glowSize * (1 + i * 0.9);
    fill(180, 255, 120, f.glow / (i + 1.2) * f.fade);
    circle(f.x, f.y, r);
  }

  fill(240, 255, 200, 220 * f.fade);
  circle(f.x, f.y, f.radius + pulse * 3);
}

function drawCaughtFirefly(f) {
  const sceneFade = getSceneFade();
  const orbit = frameCount * 0.03 + f.phase;
  const jar = jars[f.caughtBy];
  const x = jar.x + cos(orbit) * 18 * (jar.width / 120);
  const y = jar.y + sin(orbit * 1.4) * 22 * (jar.height / 180);
  const fade = max(0, 1.2 - f.caughtOrder * 0.08) * sceneFade;

  drawFirefly({ ...f, x, y, fade });
}

function triggerRandomBurst() {
  const visibleCount = fireflies.filter(f => !f.caught && f.visible).length;
  if (visibleCount >= visibleFireflyLimit) {
    return;
  }

  const burstSize = min(floor(random(5, 11)), visibleFireflyLimit - visibleCount);
  let placed = 0;

  for (let i = 0; i < fireflies.length && placed < burstSize; i++) {
    const f = fireflies[i];
    if (!f.caught && !f.visible) {
      f.visible = true;
      f.x = random(width * 0.22, width * 0.78);
      f.y = random(height * 0.26, height * 0.56);
      f.driftX = random(-0.28, 0.28);
      f.driftY = random(-0.22, 0.22);
      f.phase = random(TWO_PI);
      f.fade = random(0.8, 1.5);
      placed++;
    }
  }
}

function updateFireflyMotion(f) {
  if (!f.visible || f.caught) {
    return;
  }

  const minY = height * 0.18;
  const maxY = height * 0.62;
  f.x += f.driftX + random(-0.35, 0.35);
  f.y += f.driftY + random(-0.3, 0.3);

  if (f.x < f.radius || f.x > width - f.radius) {
    f.driftX *= -1;
  }
  if (f.y < minY || f.y > maxY) {
    f.driftY *= -1;
  }
  f.x = constrain(f.x, f.radius, width - f.radius);
  f.y = constrain(f.y, minY, maxY);

  let catcherX = null;
  let closestDistance = Infinity;
  const mouseOverJar = document.elementFromPoint(mouseX, mouseY)?.closest('.player-jar');
  const mouseDistance = isDraggingJar || mouseOverJar ? Infinity : dist(mouseX, mouseY, f.x, f.y);
  if (mouseDistance < f.radius + 42) {
    catcherX = mouseX;
    closestDistance = mouseDistance;
  }

  for (const point of posePoints) {
    const poseDistance = dist(point.x, point.y, f.x, f.y);
    if (poseDistance < f.radius + 52 && poseDistance < closestDistance) {
      catcherX = point.x;
      closestDistance = poseDistance;
    }
  }

  if (catcherX !== null) {
    lastCatchTime = Date.now();
    f.caughtBy = 'shared';
    f.caughtOrder = fireflies.filter(item => item.caughtBy === 'shared').length;
    f.caught = true;
    f.visible = false;
    visibleFireflyLimit = maxVisible;

    const visibleFireflies = fireflies.filter(item => !item.caught && item.visible);
    for (const firefly of visibleFireflies.slice(maxVisible)) {
      firefly.visible = false;
    }
  }
}

function draw() {
  const sceneFade = getSceneFade();
  background(6 * sceneFade, 14 * sceneFade, 20 * sceneFade);
  updateJarPosition();

  const inactiveFor = Date.now() - lastCatchTime;
  const jarIsEmpty = !fireflies.some(f => f.caught);
  const additionalFireflies = jarIsEmpty
    ? floor(inactiveFor / inactivityDelayMs) * additionalFirefliesPerInterval
    : 0;
  visibleFireflyLimit = min(totalFireflies, maxVisible + additionalFireflies);

  if (fireflies.filter(f => f.caught).length < totalFireflies && frameCount - lastBurst > 60) {
    triggerRandomBurst();
    lastBurst = frameCount;
  }

  for (const f of fireflies) {
    if (!f.caught && f.visible) {
      updateFireflyMotion(f);
      drawFirefly(f);
    }

    if (f.caught) {
      drawCaughtFirefly(f);
    }
  }

  for (const point of posePoints) {
    noStroke();
    const handColor = point.part === 'leftWrist' ? [100, 220, 255] : [255, 160, 220];
    fill(...handColor, 35);
    circle(point.x, point.y, 56);
    noFill();
    stroke(...handColor, 220);
    strokeWeight(2);
    circle(point.x, point.y, 38);
    line(point.x - 28, point.y, point.x + 28, point.y);
    line(point.x, point.y - 28, point.x, point.y + 28);
    noStroke();
    fill(245, 255, 255, 240);
    circle(point.x, point.y, 9);
    fill(8, 16, 24, 210);
    rect(point.x + 20, point.y + 18, 82, 22, 6);
    fill(...handColor);
    textSize(12);
    textAlign(LEFT, CENTER);
    text(point.part === 'leftWrist' ? 'Left hand' : 'Right hand', point.x + 27, point.y + 29);
  }

  updateJarCounter();
  sharedJarCount.style.opacity = String(sceneFade);

  if (roundCompleteTime !== null && Date.now() - roundCompleteTime >= roundResetDelayMs) {
    resetRound();
  }

}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  placeJar(sharedJarElement, jars.shared, jars.shared.x, jars.shared.y);
  updateJarPosition();
}
