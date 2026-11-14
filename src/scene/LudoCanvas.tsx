import { Component, useEffect, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { getBoardYawForTeam } from '../engine/boardMap';
import { getLocalAnchorTeam, useGameStore } from '../engine/gameStore';
import { BoardMesh } from './BoardMesh';
import { AnimeEffects } from './effects/AnimeEffects';
import { PawnActor } from './PawnActor';

class PostProcessingErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/** Must match the page background so the canvas edge is invisible. */
const SCENE_BACKGROUND = '#ffeef4';

const FOV = 36;
/** Half the board's footprint including the wooden rim, with a sliver of breathing room. */
const BOARD_RADIUS = 8.65;
/** Camera elevation above the horizon — angled slightly lower so character faces & expressions read clearly. */
const ELEVATION = THREE.MathUtils.degToRad(47);
/** Room above the far edge for pawns standing and hopping there. */
const HEADROOM = 1.15;

/** Idle time before an orbited/zoomed board camera glides back to its original framing. */
const CAMERA_AUTO_RESET_MS = 3000;
const ORIGIN = new THREE.Vector3(0, 0, 0);

/** Pulls the camera back just far enough to frame the whole board, and auto-returns 3s after manual orbit/zoom. */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const defaultPosRef = useRef(new THREE.Vector3(0, 14, 14));
  const isInteractingRef = useRef(false);
  const isProgrammaticUpdateRef = useRef(false);
  const isReturningRef = useRef(false);
  const lastInteractionAtRef = useRef(0);
  const needsAutoReturnRef = useRef(false);
  const curSphericalRef = useRef(new THREE.Spherical());
  const dstSphericalRef = useRef(new THREE.Spherical());

  const cameraResetTick = useGameStore((s) => s.cameraResetTick);

  useEffect(() => {
    const dom = gl.domElement;
    const onWheel = () => {
      lastInteractionAtRef.current = performance.now();
      isReturningRef.current = false;
      needsAutoReturnRef.current = true;
    };
    dom.addEventListener('wheel', onWheel, { passive: true });
    return () => dom.removeEventListener('wheel', onWheel);
  }, [gl]);

  useLayoutEffect(() => {
    if (width < 2 || height < 2) return;
    const aspect = width / height;
    const isNarrow = width < 640 || aspect < 0.95;
    const isCompact = isNarrow || height < 540;
    const fov = isNarrow ? 42.5 : FOV;
    const elevation = isNarrow ? THREE.MathUtils.degToRad(56) : ELEVATION;
    // WoodBase outer edge spans 8.5 units; keep >= 8.55 radius so corner yards never clip.
    const radius = isNarrow ? 8.55 : BOARD_RADIUS;
    const headroom = isCompact ? 0.45 : HEADROOM;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const nearEdge = radius * Math.cos(elevation);
    const fitHeight = (radius * Math.sin(elevation) + headroom) / tanHalf + nearEdge;
    const fitWidth = radius / (tanHalf * aspect) + nearEdge;
    const distance = Math.max(fitHeight, fitWidth);

    defaultPosRef.current.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    isProgrammaticUpdateRef.current = true;
    camera.fov = fov;
    camera.position.copy(defaultPosRef.current);
    camera.lookAt(ORIGIN);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.copy(ORIGIN);
      controlsRef.current.enableDamping = false;
      controlsRef.current.update();
      controlsRef.current.enableDamping = true;
    }
    needsAutoReturnRef.current = false;
    isReturningRef.current = false;
    isInteractingRef.current = false;
    isProgrammaticUpdateRef.current = false;
  }, [camera, width, height, cameraResetTick]);

  useFrame((_, delta) => {
    if (!needsAutoReturnRef.current || isInteractingRef.current || !controlsRef.current) return;
    if (performance.now() - lastInteractionAtRef.current < CAMERA_AUTO_RESET_MS) return;

    isProgrammaticUpdateRef.current = true;
    if (!isReturningRef.current) {
      // Zero leftover OrbitControls damping inertia before gliding back.
      controlsRef.current.enableDamping = false;
      controlsRef.current.update();
      controlsRef.current.enableDamping = true;
      isReturningRef.current = true;
    }

    const cur = curSphericalRef.current.setFromVector3(camera.position);
    const dst = dstSphericalRef.current.setFromVector3(defaultPosRef.current);
    let dTheta = dst.theta - cur.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;

    const alpha = 1 - Math.exp(-9.0 * Math.min(delta, 0.05));
    cur.radius += (dst.radius - cur.radius) * alpha;
    cur.phi += (dst.phi - cur.phi) * alpha;
    cur.theta += dTheta * alpha;

    camera.position.setFromSpherical(cur);
    controlsRef.current.target.lerp(ORIGIN, alpha);
    camera.lookAt(controlsRef.current.target);
    controlsRef.current.enableDamping = false;
    controlsRef.current.update();
    controlsRef.current.enableDamping = true;

    if (camera.position.distanceToSquared(defaultPosRef.current) < 0.002) {
      camera.position.copy(defaultPosRef.current);
      controlsRef.current.target.copy(ORIGIN);
      controlsRef.current.enableDamping = false;
      controlsRef.current.update();
      controlsRef.current.enableDamping = true;
      needsAutoReturnRef.current = false;
      isReturningRef.current = false;
    }
    isProgrammaticUpdateRef.current = false;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={12}
      maxDistance={90}
      minPolarAngle={THREE.MathUtils.degToRad(16)}
      maxPolarAngle={THREE.MathUtils.degToRad(68)}
      onStart={() => {
        isInteractingRef.current = true;
        isReturningRef.current = false;
        needsAutoReturnRef.current = false;
      }}
      onEnd={() => {
        isInteractingRef.current = false;
        isReturningRef.current = false;
        lastInteractionAtRef.current = performance.now();
        if (camera.position.distanceToSquared(defaultPosRef.current) > 0.002) {
          needsAutoReturnRef.current = true;
        }
      }}
    />
  );
}

export function LudoCanvas() {
  const pawns = useGameStore((s) => s.game.pawns);
  const triggerCameraReset = useGameStore((s) => s.triggerCameraReset);
  const anchorTeam = useGameStore((s) => getLocalAnchorTeam(s));
  const boardYaw = getBoardYawForTeam(anchorTeam);
  const [canvasKey, setCanvasKey] = useState(0);
  const cleanupCanvasRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupCanvasRef.current?.(), []);

  return (
    <div className="h-full w-full" onDoubleClick={triggerCameraReset}>
      {/* `flat`: the composer owns the output, and un-tone-mapped colours keep the pastels true. */}
      <Canvas
        key={canvasKey}
        flat
        shadows
        dpr={[1, 2.5]}
        camera={{ fov: FOV, near: 0.5, far: 300 }}
        gl={{ antialias: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl, scene, camera }) => {
          cleanupCanvasRef.current?.();
          const canvasEl = gl.domElement;
          const onLost = (e: Event) => {
            e.preventDefault();
          };
          const onRestored = () => {
            setCanvasKey((k) => k + 1);
            triggerCameraReset();
          };
          canvasEl.addEventListener('webglcontextlost', onLost);
          canvasEl.addEventListener('webglcontextrestored', onRestored);
          cleanupCanvasRef.current = () => {
            canvasEl.removeEventListener('webglcontextlost', onLost);
            canvasEl.removeEventListener('webglcontextrestored', onRestored);
          };
          if (import.meta.env.DEV) Object.assign(window, { ludoScene: scene, ludoCamera: camera });
        }}
      >
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <CameraRig />
        {/* Offline procedural studio reflection rig for crisp figurine highlights. */}
        <Environment frames={1} resolution={256} environmentIntensity={0.44}>
          <Lightformer form="rect" intensity={1.4} color="#fff7ec" position={[5, 10, 6]} scale={[12, 8, 1]} target={[0, 0, 0]} />
          <Lightformer form="circle" intensity={1.1} color="#e6d6ff" position={[-8, 6, -6]} scale={9} target={[0, 0, 0]} />
          <Lightformer form="ring" intensity={0.85} color="#ffd8e6" position={[0, 8, -9]} scale={8} target={[0, 0, 0]} />
        </Environment>
        {/* Warm daylight + soft lavender rim fill; balanced so lit pastels stay under the bloom threshold. */}
        <hemisphereLight args={['#fffaf0', '#f6d6bd', 1.0]} />
        <ambientLight intensity={0.32} color="#fff6ec" />
        <directionalLight color="#e8d8ff" intensity={0.42} position={[-8, 9, -7]} />
        <directionalLight
          castShadow
          color="#fff6e6"
          intensity={2.1}
          position={[9, 17, 8]}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.015}
          shadow-radius={2.5}
        >
          <orthographicCamera attach="shadow-camera" args={[-9.8, 9.8, 9.8, -9.8, 1, 45]} />
        </directionalLight>
        <group rotation-y={boardYaw}>
          <BoardMesh boardYaw={boardYaw} />
          {pawns.map((pawn) => (
            <PawnActor key={pawn.id} pawn={pawn} />
          ))}
          <AnimeEffects />
        </group>
        <PostProcessingErrorBoundary>
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur luminanceThreshold={1.2} luminanceSmoothing={0.2} intensity={0.85} />
          </EffectComposer>
        </PostProcessingErrorBoundary>
      </Canvas>
    </div>
  );
}
