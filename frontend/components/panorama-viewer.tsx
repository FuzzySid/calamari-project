"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

export type PanoramaViewerProps = {
  mediaType: "image" | "video";
  src: string;
  title?: string;
  initialYaw?: number;
  initialPitch?: number;
};

type ViewState = {
  yaw: number;
  pitch: number;
  fov: number;
};

const MIN_FOV = 35;
const MAX_FOV = 90;

function formatTime(value: number) {
  if (!Number.isFinite(value)) {
    return "0:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function PanoramaViewer({
  mediaType,
  src,
  title = "360 degree panorama",
  initialYaw = 0,
  initialPitch = 0
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewRef = useRef<ViewState>({ yaw: initialYaw, pitch: initialPitch, fov: 75 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const updateFov = useCallback((nextFov: number) => {
    const fov = THREE.MathUtils.clamp(nextFov, MIN_FOV, MAX_FOV);
    viewRef.current.fov = fov;

    if (cameraRef.current) {
      cameraRef.current.fov = fov;
      cameraRef.current.updateProjectionMatrix();
    }
  }, []);

  const resetView = useCallback(() => {
    viewRef.current.yaw = initialYaw;
    viewRef.current.pitch = initialPitch;
    updateFov(75);
  }, [initialPitch, initialYaw, updateFov]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    viewRef.current = { yaw: initialYaw, pitch: initialPitch, fov: 75 };

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.setAttribute("aria-label", `${title}. Drag to look around.`);
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(500, 64, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let texture: THREE.Texture | null = null;
    let video: HTMLVideoElement | null = null;
    let frameId = 0;
    let disposed = false;

    if (mediaType === "image") {
      new THREE.TextureLoader().load(
        src,
        (loadedTexture) => {
          if (disposed) {
            loadedTexture.dispose();
            return;
          }

          texture = loadedTexture;
          texture.encoding = THREE.sRGBEncoding;
          material.map = texture;
          material.needsUpdate = true;
          setIsLoading(false);
        },
        undefined,
        () => {
          if (!disposed) {
            setError("The panorama image could not be loaded.");
            setIsLoading(false);
          }
        }
      );
    } else {
      video = document.createElement("video");
      videoRef.current = video;
      video.src = src;
      video.crossOrigin = "anonymous";
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";

      texture = new THREE.VideoTexture(video);
      texture.encoding = THREE.sRGBEncoding;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      material.map = texture;
      material.needsUpdate = true;

      const handleCanPlay = () => {
        if (disposed) {
          return;
        }

        setIsLoading(false);
        void video?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      };
      const handleMetadata = () => setDuration(video?.duration ?? 0);
      const handleTimeUpdate = () => setCurrentTime(video?.currentTime ?? 0);
      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleError = () => {
        setError("This browser could not play the panorama video.");
        setIsLoading(false);
      };

      video.addEventListener("canplay", handleCanPlay, { once: true });
      video.addEventListener("loadedmetadata", handleMetadata);
      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("error", handleError);
      video.load();
    }

    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let pinchStart: { distance: number; fov: number } | null = null;

    function pointerDistance() {
      const values = Array.from(pointers.values());
      if (values.length < 2) {
        return 0;
      }
      return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    }

    function handlePointerDown(event: PointerEvent) {
      renderer.domElement.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      renderer.domElement.style.cursor = "grabbing";

      if (pointers.size === 1) {
        dragStart = {
          x: event.clientX,
          y: event.clientY,
          yaw: viewRef.current.yaw,
          pitch: viewRef.current.pitch
        };
      } else if (pointers.size === 2) {
        pinchStart = { distance: pointerDistance(), fov: viewRef.current.fov };
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) {
        return;
      }

      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2 && pinchStart) {
        const distance = pointerDistance();
        if (distance > 0) {
          updateFov(pinchStart.fov * (pinchStart.distance / distance));
        }
        return;
      }

      if (pointers.size === 1 && dragStart) {
        viewRef.current.yaw = dragStart.yaw + (dragStart.x - event.clientX) * 0.12;
        viewRef.current.pitch = THREE.MathUtils.clamp(
          dragStart.pitch + (event.clientY - dragStart.y) * 0.12,
          -85,
          85
        );
      }
    }

    function handlePointerUp(event: PointerEvent) {
      pointers.delete(event.pointerId);
      renderer.domElement.style.cursor = pointers.size ? "grabbing" : "grab";
      dragStart = null;
      pinchStart = null;

      const remaining = Array.from(pointers.values())[0];
      if (remaining) {
        dragStart = {
          x: remaining.x,
          y: remaining.y,
          yaw: viewRef.current.yaw,
          pitch: viewRef.current.pitch
        };
      }
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      updateFov(viewRef.current.fov + event.deltaY * 0.04);
    }

    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) {
        return;
      }

      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    function animate() {
      const { yaw, pitch } = viewRef.current;
      const phi = THREE.MathUtils.degToRad(90 - pitch);
      const theta = THREE.MathUtils.degToRad(yaw);
      camera.lookAt(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    }
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      video?.pause();
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
      videoRef.current = null;
      cameraRef.current = null;
      texture?.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [initialPitch, initialYaw, mediaType, src, title, updateFov]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      void video.play().catch(() => setError("Press play again to start the video."));
    } else {
      video.pause();
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.muted = !video.muted;
    setIsMuted(video.muted);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen();
      }
    } catch {
      setError("Fullscreen is not available in this browser.");
    }
  }

  function handleSeek(value: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = value;
    setCurrentTime(value);
  }

  function handleKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 3;
    let handled = true;

    switch (event.key) {
      case "ArrowLeft":
        viewRef.current.yaw -= step;
        break;
      case "ArrowRight":
        viewRef.current.yaw += step;
        break;
      case "ArrowUp":
        viewRef.current.pitch = Math.min(85, viewRef.current.pitch + step);
        break;
      case "ArrowDown":
        viewRef.current.pitch = Math.max(-85, viewRef.current.pitch - step);
        break;
      case "+":
      case "=":
        updateFov(viewRef.current.fov - 5);
        break;
      case "-":
        updateFov(viewRef.current.fov + 5);
        break;
      case "r":
      case "R":
        resetView();
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  const controlClass =
    "rounded-full border border-white/15 bg-black/45 px-4 py-2 text-sm text-mist backdrop-blur-md transition hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-gold/70";

  return (
    <div
      ref={containerRef}
      className="relative min-h-[28rem] w-full flex-1 overflow-hidden bg-black"
      onKeyDown={handleKeyboard}
      tabIndex={0}
      aria-label={`${title} viewer. Use arrow keys to look around, plus and minus to zoom, and R to reset.`}
    >
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/55" />

      {isLoading && !error && (
        <div className="absolute inset-0 grid place-items-center bg-ink/80 text-center">
          <div>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-gold" />
            <p className="mt-4 text-sm uppercase tracking-[0.25em] text-mist/75">
              Loading panorama
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-ink/90 px-6 text-center">
          <div className="max-w-md">
            <p className="font-display text-2xl text-mist">Panorama unavailable</p>
            <p className="mt-3 text-sm leading-6 text-mist/70">{error}</p>
          </div>
        </div>
      )}

      <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-xs uppercase tracking-[0.22em] text-mist/80 backdrop-blur-md">
        Drag to explore · Scroll to zoom
      </div>

      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center gap-2">
        {mediaType === "video" && (
          <>
            <button type="button" onClick={togglePlayback} className={controlClass}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={toggleMute} className={controlClass}>
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <label className="flex min-w-[12rem] flex-1 items-center gap-3 rounded-full border border-white/15 bg-black/45 px-4 py-2 text-xs text-mist backdrop-blur-md">
              <span className="sr-only">Video progress</span>
              <span>{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => handleSeek(Number(event.target.value))}
                className="min-w-0 flex-1 accent-[#d4b16a]"
              />
              <span>{formatTime(duration)}</span>
            </label>
          </>
        )}
        <button type="button" onClick={resetView} className={controlClass}>
          Reset view
        </button>
        <button type="button" onClick={toggleFullscreen} className={controlClass}>
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
    </div>
  );
}
