"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { resolveFigureSource, type FigureSource } from "@/lib/period-figures";

type PeriodFigureProps = {
  /** ISO3 country code, e.g. "ESP". */
  code: string;
  /** Period id, e.g. "golden-age". Null hides the stage. */
  periodId: string | null;
  className?: string;
};

/** Height in world units the model is normalised to, whatever it ships as. */
const TARGET_HEIGHT = 1.7;
const AUTO_SPIN = 0.22;
/** Pointer travel (px) → yaw (radians). */
const DRAG_SENSITIVITY = 0.008;
const SPIN_DAMPING = 0.94;

async function loadModel(url: string) {
  const extension = url.split(".").pop()?.toLowerCase();

  if (extension === "glb" || extension === "gltf") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene as THREE.Object3D;
  }

  if (extension === "fbx") {
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    return (await new FBXLoader().loadAsync(url)) as THREE.Object3D;
  }

  if (extension === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    return (await new OBJLoader().loadAsync(url)) as THREE.Object3D;
  }

  throw new Error(`Unsupported model format: ${url}`);
}

/** Stand-in used until a real model is dropped into `public/models/`. */
function buildPlaceholder() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4b16a,
    roughness: 0.5,
    metalness: 0.22
  });

  const parts: Array<[THREE.BufferGeometry, number]> = [
    [new THREE.SphereGeometry(0.17, 32, 24), 1.5],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.12, 20), 1.29],
    [new THREE.CylinderGeometry(0.2, 0.27, 0.66, 28), 0.9],
    [new THREE.CylinderGeometry(0.27, 0.38, 0.62, 28), 0.31],
    [new THREE.CylinderGeometry(0.44, 0.44, 0.03, 40), 0.01]
  ];

  for (const [geometry, y] of parts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    group.add(mesh);
  }

  return group;
}

/** Frees every geometry and material under an object before it is dropped. */
function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}

/**
 * Centres a freshly loaded model on the origin and scales it to a consistent
 * height, so a 200-unit FBX and a 1.8-unit GLB read the same on screen.
 */
function normalise(object: THREE.Object3D, extraScale = 1) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = size.y || size.x || size.z || 1;
  const scale = (TARGET_HEIGHT / height) * extraScale;

  object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  object.scale.setScalar(scale);
}

export default function PeriodFigure({ code, periodId, className }: PeriodFigureProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const pivotRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const spin = useRef({ yaw: 0, velocity: 0, dragging: false, lastX: 0 });
  const [isLoaded, setIsLoaded] = useState(false);

  // Renderer, lights and the render loop live for as long as the stage does —
  // only the model inside `pivot` is swapped when the era changes.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.12, 3.35);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf5efe2, 0x0d1626, 0.85));

    const key = new THREE.DirectionalLight(0xfff3d6, 1.75);
    key.position.set(1.8, 2.4, 2.6);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xd4b16a, 1.1);
    rim.position.set(-2.4, 1.2, -1.8);
    scene.add(rim);

    const fill = new THREE.DirectionalLight(0x8fa8d8, 0.4);
    fill.position.set(-1.4, -0.6, 1.6);
    scene.add(fill);

    const pivot = new THREE.Group();
    pivotRef.current = pivot;
    scene.add(pivot);

    function resize() {
      const { clientWidth, clientHeight } = mount!;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    function handlePointerDown(event: PointerEvent) {
      spin.current.dragging = true;
      spin.current.lastX = event.clientX;
      spin.current.velocity = 0;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    }

    function handlePointerMove(event: PointerEvent) {
      if (!spin.current.dragging) return;
      const delta = (event.clientX - spin.current.lastX) * DRAG_SENSITIVITY;
      spin.current.lastX = event.clientX;
      spin.current.yaw += delta;
      // Carried into the idle spin so a flick keeps gliding.
      spin.current.velocity = delta;
    }

    function handlePointerUp(event: PointerEvent) {
      if (!spin.current.dragging) return;
      spin.current.dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grab";
    }

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);

    const clock = new THREE.Clock();
    let frame = 0;

    function tick() {
      frame = requestAnimationFrame(tick);
      const delta = Math.min(clock.getDelta(), 0.1);

      if (!spin.current.dragging) {
        spin.current.yaw += AUTO_SPIN * delta + spin.current.velocity;
        spin.current.velocity *= SPIN_DAMPING;
        if (Math.abs(spin.current.velocity) < 0.0001) spin.current.velocity = 0;
      }

      pivot.rotation.y = spin.current.yaw;
      renderer.render(scene, camera);
    }

    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      if (modelRef.current) disposeObject(modelRef.current);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
      pivotRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pivot = pivotRef.current;
    if (!pivot || !periodId) return;

    let cancelled = false;
    setIsLoaded(false);

    function mount(object: THREE.Object3D, source: FigureSource | null) {
      if (cancelled || !pivotRef.current) {
        disposeObject(object);
        return;
      }

      const previous = modelRef.current;
      if (previous) {
        pivotRef.current.remove(previous);
        disposeObject(previous);
      }

      normalise(object, source?.scale ?? 1);
      object.rotation.y = source?.rotationY ?? 0;
      pivotRef.current.add(object);
      modelRef.current = object;
      spin.current.yaw = 0;
      spin.current.velocity = 0;
      setIsLoaded(true);
    }

    resolveFigureSource(code, periodId)
      .then(async (source) => {
        if (cancelled) return;
        if (!source) {
          mount(buildPlaceholder(), null);
          return;
        }

        try {
          mount(await loadModel(source.url), source);
        } catch (error) {
          console.error(`Could not load figure for ${code}:${periodId}`, error);
          if (!cancelled) mount(buildPlaceholder(), null);
        }
      })
      .catch(() => {
        if (!cancelled) mount(buildPlaceholder(), null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, periodId]);

  return (
    <div className={className}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,177,106,0.16),transparent_62%)]"
      />
      <div
        ref={mountRef}
        className={`relative h-full w-full transition-opacity duration-700 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
