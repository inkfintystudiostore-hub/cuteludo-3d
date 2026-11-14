import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGameStore } from '../engine/gameStore';
import { CAPTURE_TWIRL_DURATION, SPAWN_DURATION } from './animationTiming';
import { BoardMesh } from './BoardMesh';
import { AnimeEffects } from './effects/AnimeEffects';
import { PawnActor } from './PawnActor';

/** Must match the page background so the canvas edge is invisible. */
const SCENE_BACKGROUND = '#ffeef4';

const FOV = 36;
/** Half the board's footprint including the wooden rim, with a sliver of breathing room. */
const BOARD_RADIUS = 8.65;
/** Camera elevation above the horizon — angled slightly lower so character faces & expressions read clearly. */
const ELEVATION = THREE.MathUtils.degToRad(47);
/** Room above the far edge for pawns standing and hopping there. */
const HEADROOM = 1.15;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Pulls the camera back just far enough to frame the whole board, supports damped orbit & subtle event shake. */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const shakeRef = useRef(0);
  const offsetRef = useRef(new THREE.Vector3());

  const cameraResetTick = useGameStore((s) => s.cameraResetTick);
  const lastEvent = useGameStore((s) => s.lastEvent);

  useLayoutEffect(() => {
    const aspect = width / height;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const nearEdge = BOARD_RADIUS * Math.cos(ELEVATION);
    const fitHeight = (BOARD_RADIUS * Math.sin(ELEVATION) + HEADROOM) / tanHalf + nearEdge;
    const fitWidth = BOARD_RADIUS / (tanHalf * aspect) + nearEdge;
    const distance = Math.max(fitHeight, fitWidth);

    camera.fov = FOV;
    camera.position.set(0, Math.sin(ELEVATION) * distance, Math.cos(ELEVATION) * distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [camera, width, height, cameraResetTick]);

  useEffect(() => {
    if (!lastEvent || prefersReducedMotion()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (lastEvent.type === 'CAPTURE') {
      timer = setTimeout(() => {
        shakeRef.current = 0.28;
      }, CAPTURE_TWIRL_DURATION * 1000);
    } else if (lastEvent.type === 'SPAWN_6') {
      timer = setTimeout(() => {
        shakeRef.current = 0.12;
      }, SPAWN_DURATION * 1000);
    } else if (lastEvent.type === 'REACH_HOME') {
      shakeRef.current = 0.16;
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [lastEvent]);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    // Undo previous frame's shake before controls update, then apply fresh damped offset.
    camera.position.sub(offsetRef.current);
    offsetRef.current.set(0, 0, 0);

    if (shakeRef.current > 0.002) {
      const t = clock.elapsedTime * 55;
      const amp = shakeRef.current;
      offsetRef.current.set(Math.sin(t) * amp, Math.cos(t * 1.3) * amp * 0.65, Math.sin(t * 0.9) * amp * 0.4);
      camera.position.add(offsetRef.current);
      shakeRef.current *= Math.exp(-9 * dt);
    } else {
      shakeRef.current = 0;
    }
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
    />
  );
}

export function LudoCanvas() {
  const pawns = useGameStore((s) => s.game.pawns);
  const triggerCameraReset = useGameStore((s) => s.triggerCameraReset);

  return (
    <div className="h-full w-full" onDoubleClick={triggerCameraReset}>
      {/* `flat`: the composer owns the output, and un-tone-mapped colours keep the pastels true. */}
      <Canvas
        flat
        shadows
        dpr={[1, 1.5]}
        camera={{ fov: FOV, near: 0.5, far: 300 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ scene, camera }) => {
          if (import.meta.env.DEV) Object.assign(window, { ludoScene: scene, ludoCamera: camera });
        }}
      >
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <CameraRig />
        {/* Offline procedural studio reflection rig for crisp figurine highlights. */}
        <Environment frames={1} resolution={128} environmentIntensity={0.44}>
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
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.015}
          shadow-radius={2.5}
        >
          <orthographicCamera attach="shadow-camera" args={[-9.8, 9.8, 9.8, -9.8, 1, 45]} />
        </directionalLight>
        <BoardMesh />
        {pawns.map((pawn) => (
          <PawnActor key={pawn.id} pawn={pawn} />
        ))}
        <AnimeEffects />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1.2} luminanceSmoothing={0.2} intensity={0.85} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
