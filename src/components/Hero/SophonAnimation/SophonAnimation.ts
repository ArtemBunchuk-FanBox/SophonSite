import * as THREE from 'three';
import { createCircleOutline } from './core/circles';
import { createGoreEdges, createGoreGeometry, easeInOutCubic, lerp } from './core/geometry';
import { BallsManager } from './core/balls';

// Top-level helpers (fixes TS1005 by avoiding class-scope ambiguity)
const easeInOutSine = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return -(Math.cos(Math.PI * x) - 1) / 2;
};

const ensureDistanceAttribute = (geom: THREE.BufferGeometry): void => {
  if (geom.getAttribute('aDist')) return;
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return;
  geom.computeBoundingSphere();
  const center = geom.boundingSphere?.center ?? new THREE.Vector3(0, 0, 0);
  const radius = Math.max(geom.boundingSphere?.radius ?? 1e-6, 1e-6);
  const arr = pos.array as Float32Array;
  const out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = arr[i * 3] - center.x;
    const y = arr[i * 3 + 1] - center.y;
    const z = arr[i * 3 + 2] - center.z;
    const d = Math.sqrt(x * x + y * y + z * z) / radius;
    out[i] = Math.max(0, Math.min(1, d));
  }
  geom.setAttribute('aDist', new THREE.BufferAttribute(out, 1));
};

const createGlowLine = (
  geom: THREE.BufferGeometry,
  color: number,
  baseOpacity: number,
  reveal: number,
  pulse: number
): THREE.LineSegments => {
  ensureDistanceAttribute(geom);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: baseOpacity },
      uReveal: { value: reveal },
      uPulse: { value: pulse }
    },
    vertexShader: `
      attribute float aDist;
      varying float vDist;
      void main() {
        vDist = aDist;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uPulse;
      varying float vDist;
      void main() {
        float edge = 0.12;
        // Change mask so endpoints are included when reveal reaches 1.0
        // Old: float mask = 1.0 - smoothstep(uReveal - edge, uReveal, vDist);
        float mask = 1.0 - smoothstep(uReveal, uReveal + edge, vDist);
        float alpha = uOpacity * (0.5 + 0.5 * uPulse) * mask;
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  });
  const line = new THREE.LineSegments(geom, mat);
  line.renderOrder = 9995;
  return line;
};

export class Background {
  private element: HTMLDivElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationId: number | null = null;

  // Callback for animation completion
  private onAnimationComplete?: () => void;

  // Animation state
  private sphereGroups: THREE.Group[] = [];
  private circleOutlines: THREE.Line[] = [];
  private circleOutlinesVisible = true;
  private circleDrawProgress = 1.0;
  private goreDrawProgress = 0.0;
  private currentPlacementProgress = 0;

  // Eye to circle morphing
  private eyeToCircleProgress = 0;

  // Wireframe animation
  private wireframeTransitioning = false;
  private wireframeTransitionProgress = 0;
  private wireframeTransitionTarget = 'edges';
  private wireframeTransitionDuration = 1.0;
  private wireframeMode = 'none';

  // Animation state machine
  private animationStep = 'INITIAL_CIRCLES_MOVE';
  private stepProgress = 0;
  private stepDurations = {
    // Increased so circle-to-bottom alignment is slower and more methodical
    INITIAL_CIRCLES_MOVE: 6.5,
    FORMING_GORES: 2.0,
    UNWRAPPING: 8.0,
    WRAPPING: 8.0,
    DEFORMING_GORES: 2.0,
  };

  private unwrappingT = 0;
  private sphereYs = [4.5, 4.5, 4.5];
  // Reverse control and helpers
  private reverseEnabled = true; // public toggle via setter to run the reverse half
  private reverseStartYs: number[] = [4.5, 4.5, 4.5];

  // Configuration
  private numGores = 9;
  private currentNumGores = 9;
  private sphereConfigs = [
    { radius: 2.2, colors: [0xff4444, 0xff4444, 0xff4444, 0x44ff44, 0x44ff44, 0x44ff44, 0x4444ff, 0x4444ff, 0x4444ff] },
    { radius: 1.4, colors: [0xff8888, 0xff8888, 0xff8888, 0x88ff88, 0x88ff88, 0x88ff88, 0x8888ff, 0x8888ff, 0x8888ff] },
    { radius: 0.75, colors: [0xffcccc, 0xffcccc, 0xffcccc, 0xccffcc, 0xccffcc, 0xccffcc, 0xccccff, 0xccccff, 0xccccff] }
  ];
  private transition = false;
  private transitionProgress = 1;
  private gridMode = 'rectangular';
  // If true, do not create per-gore edge geometries/LineSegments (saves CPU / GPU)
  private skipEdgeCreation = true;
  // Bright outline toggle while company name types
  private glowOutlineActive = false;
  // Progressive reveal (0..1) tied to typing progress
  private glowOutlineProgress = 0;
  // Pulse intensity (0..1) synced with CompanyName pulses
  private glowPulseIntensity = 0.3;
  // Balls
  private balls?: BallsManager;
  private ballsSpawned = false;
  private pendingBallSpawn = false;
  // Post-typing glow tween (animate center-out reveal after typing finishes)
  private glowPostAnimating = false;
  private glowPostStart = 0;
  private glowPostDurationMs = 2000;

  // Stage text during initial eye hold
  private stageTextEl: HTMLDivElement | null = null;
  private stageText = 'OBSERVE';
  // New: per-step text init flags
  private fgTextInit = false;
  private unwrTextInit = false;

  // Consistent timing across stage words (typing slower than backspacing)
  private readonly STAGE_TYPE_SEC = 1.2;
  private readonly STAGE_BACK_SEC = 0.5;          // was 0.8 -> faster backspaces
  private readonly STAGE_HOLD_FIRST_SEC = 1.0;   // after RESEARCH typed
  private readonly STAGE_HOLD_SECOND_SEC = 0.8;  // after STRATEGY typed
  private readonly UNWRAP_HOLD_SEC = 4.5;         // fallback; UNWRAPPING uses computed hold

  // Mouse controls
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private rotationX = 0;
  private rotationY = 0;

  // Add reference to mission text element
  private missionTextEl: HTMLElement | null = null;

  constructor(container: HTMLElement, onAnimationComplete?: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'three-background';
    this.setupContainer();
    container.appendChild(this.element);

    // Store callback
    this.onAnimationComplete = onAnimationComplete;

    this.initThreeJS();
    this.setupEventListeners();
    this.startAnimation();

    // Initialize mission text reference
    this.missionTextEl = document.querySelector('.mission-text');
  }

  // Allow consumers to enable/disable the reverse part of the sequence
  public setReverseEnabled(enabled: boolean): void {
    this.reverseEnabled = enabled;
  }

  // Helical twist configuration (applies only during UNWRAPPING)
  private twistEnabled = true;
  private twistTurns = 0.15; // number of full revolutions at peak twist (sin(pi * t) = 1)
  public setTwistTurns(turns: number): void {
    this.twistTurns = Math.max(0, turns);
  }

  private setupContainer(): void {
    this.element.style.position = 'absolute';
    this.element.style.top = '0';
    this.element.style.left = '0';
    this.element.style.width = '100%';
    this.element.style.height = '100%';
    this.element.style.zIndex = '-1';
    this.element.style.overflow = 'hidden';
  }

  private initThreeJS(): void {
    // Scene setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Enable WebGL2 for linewidth support (fallback to WebGL1 if not available)
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | undefined;
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
    // Ensure renderer respects renderOrder for transparent objects
    this.renderer.sortObjects = true;

    // Size will be matched to parent hero section via observer/resize
    const parent = this.element.parentElement as HTMLElement | null;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.element.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 1.2);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8);
    directionalLight.position.set(6, 6, 6);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.8);
    fillLight.position.set(-6, -6, 6);
    this.scene.add(fillLight);

    // Camera position
    this.camera.position.set(0, 0, 14);

    // Initialize sphere groups
    this.sphereConfigs.forEach(() => {
      const group = new THREE.Group();
      this.sphereGroups.push(group);
      this.scene.add(group);
    });

    // Initial setup
    this.updateGores(0);
    this.updatePositions(0);
    // Create stage text overlay (same style as CompanyName)
    this.createStageTextElement();
  }

  private setupEventListeners(): void {
    // Mouse controls
    const handleMouseDown = (e: MouseEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };

    const handleMouseUp = () => {
      this.mouseDown = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!this.mouseDown) return;
      const dx = e.clientX - this.mouseX;
      const dy = e.clientY - this.mouseY;
      this.rotationY += dx * 0.01;
      this.rotationX += dy * 0.01;
      this.scene.rotation.y = this.rotationY;
      this.scene.rotation.x = this.rotationX;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };

    const handleWheel = (e: WheelEvent) => {
      this.camera.position.z += e.deltaY * 0.01;
      this.camera.position.z = Math.max(4, Math.min(28, this.camera.position.z));
    };

    const handleResize = () => {
      const parent = this.element.parentElement as HTMLElement | null;
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    this.element.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousemove', handleMouseMove);
    this.element.addEventListener('wheel', handleWheel);
    window.addEventListener('resize', handleResize);

    // Company name typing events -> control progressive glow outlines
    const handleTypingStart = () => {
      // Do not show glow edges during typing
      this.glowOutlineActive = false;
      this.glowOutlineProgress = 0;
      // No rebuild here; defer to finished
    };
    const handleTypingProgress = (e: Event) => {
      // Track progress but do not light edges yet
      const detail = (e as CustomEvent).detail || {};
      this.glowOutlineProgress = Math.max(0, Math.min(1, detail.progress ?? 0));
      // No rebuild; defer to finished
    };
    const handleTypingFinished = () => {
      // Start the same center-out reveal after typing, with the same speed (2s)
      this.glowOutlineActive = true;
      this.glowOutlineProgress = 0;
      this.glowPostAnimating = true;
      this.glowPostStart = performance.now();
      // Defer ball spawn until glow fully revealed
      this.pendingBallSpawn = true;
      // Initial rebuild
      this.updateGores(this.unwrappingT);
    };
    const handleGlow = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      this.glowPulseIntensity = Math.max(0, Math.min(1, detail.intensity ?? 0.3));
      // no forced rebuild; main loop updates frequently in idle
    };
    const handleHidden = () => {
      this.glowOutlineActive = false;
      this.glowOutlineProgress = 0;
      this.updateGores(this.unwrappingT);
    };

    window.addEventListener('companyNameTypingStart', handleTypingStart as EventListener);
    window.addEventListener('companyNameTypingProgress', handleTypingProgress as EventListener);
    window.addEventListener('companyNameTypingFinished', handleTypingFinished as EventListener);
    window.addEventListener('companyNameGlow', handleGlow as EventListener);
    window.addEventListener('companyNameHidden', handleHidden as EventListener);
  }

  // Create the 3 requested balls on specific sphere/gore indices
  private spawnDefaultBalls(): void {
    if (this.ballsSpawned) return;
    if (!this.balls) this.balls = new BallsManager(this.scene);

    // Changed mapping: sphere 0 -> gore 3, sphere 1 -> gore 1, sphere 2 -> gore 2
    const gore03 = (this.sphereGroups[0]?.children[1] as THREE.Mesh | undefined) ?? (this.sphereGroups[0]?.children[0] as THREE.Mesh | undefined);
    const gore11 = (this.sphereGroups[1]?.children[3] as THREE.Mesh | undefined) ?? (this.sphereGroups[1]?.children[0] as THREE.Mesh | undefined);
    const gore22 = (this.sphereGroups[2]?.children[2] as THREE.Mesh | undefined) ?? (this.sphereGroups[2]?.children[0] as THREE.Mesh | undefined);

    const glowing_white = 0xffffff;
    if (gore03) this.balls.addBallForGore(gore03, glowing_white);
    if (gore11) this.balls.addBallForGore(gore11, glowing_white);
    if (gore22) this.balls.addBallForGore(gore22, glowing_white);

    this.ballsSpawned = true;
  }

  private updateGores(unfoldProgress: number): void {
    // Twist amount over time: 0 -> 1 -> 0 across unwrapping (twist then untwist)
    const twistAmount =
      (this.twistEnabled && this.animationStep === 'UNWRAPPING')
        ? Math.sin(Math.PI * THREE.MathUtils.clamp(unfoldProgress, 0, 1))
        : 0;

    for (let si = 0; si < this.sphereConfigs.length; si++) {
      const cfg = this.sphereConfigs[si];
      const goreColors = cfg.colors;
      const sphereRadius = cfg.radius;
      const group = this.sphereGroups[si];

      // If we don't yet have the expected number of gore Meshes, clear and create them.
      if (group.children.length !== this.currentNumGores) {
        // Clear existing children & dispose resources
        while (group.children.length > 0) {
          const child = group.children[0];
          group.remove(child);
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
          if ((child as THREE.Mesh).material) {
            const material = (child as THREE.Mesh).material;
            if (Array.isArray(material)) {
              material.forEach(mat => mat.dispose());
            } else {
              material.dispose();
            }
          }
        }

        // Create gore Meshes (initial construction)
        for (let i = 0; i < this.currentNumGores; i++) {
          const goreGeometry = createGoreGeometry(
            i,
            unfoldProgress,
            sphereRadius,
            this.currentNumGores,
            this.transitionProgress,
            this.gridMode as any
          );
          // Apply helical twist deformation for this frame (only during UNWRAPPING)
          if (twistAmount > 0) this.applyHelicalTwist(goreGeometry, twistAmount);

          let gore: THREE.Mesh;

          const baseColor = goreColors[i];

          if (this.wireframeMode === 'none' && !this.wireframeTransitioning) {
            // Use MeshBasicMaterial so both sides render at same brightness (no lighting variation)
            gore = new THREE.Mesh(goreGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide }));
          }
          else if (this.wireframeTransitioning) {
            // Base mesh is invisible during transition; use MeshBasicMaterial for consistent brightness if shown
            gore = new THREE.Mesh(
              goreGeometry,
              new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide })
            );
            const target = this.wireframeTransitionTarget;
            const t = THREE.MathUtils.clamp(this.wireframeTransitionProgress, 0, 1);

            const edgesGeometry = createGoreEdges(goreGeometry, this.glowOutlineActive ? false : this.skipEdgeCreation);
            if (edgesGeometry && edgesGeometry.attributes && edgesGeometry.attributes.position) {
              const vCount = edgesGeometry.attributes.position.count;
              const drawCount = Math.max(0, Math.floor((vCount * this.goreDrawProgress) / 2) * 2);
              edgesGeometry.setDrawRange(0, drawCount);
            }

            let edgeOpacity = 0;
            if (target === 'edges') edgeOpacity = t;
            else if (target === 'wireframe') edgeOpacity = 1 - t;
            else if (target === 'none') edgeOpacity = 1 - t;

            const edgesMaterial = new THREE.LineBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: edgeOpacity * 1.0,
              blending: THREE.AdditiveBlending,
              depthTest: false,
              depthWrite: false
            });
            if (edgesGeometry) {
              const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
              edges.renderOrder = 9990;
              gore.add(edges);
            }

            if (target === 'wireframe' || (target === 'edges' && (this.wireframeMode === 'wireframe' || this.wireframeMode === 'transitioning_to_wireframe'))) {
              let wireframeOpacity = 0;
              if (target === 'wireframe') wireframeOpacity = 0.6 * t;
              else if (target === 'edges' && (this.wireframeMode === 'wireframe' || this.wireframeMode === 'transitioning_to_wireframe')) wireframeOpacity = 0.6 * (1 - t);

              const wm = new THREE.MeshBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: wireframeOpacity,
                wireframe: true,
                side: THREE.DoubleSide,
                // keep colors intact (avoid whitening) but avoid depth-write so overlapping edges don't occlude
                blending: THREE.NormalBlending,
                depthWrite: false,
              });
              const wf = new THREE.Mesh(goreGeometry.clone(), wm);
              gore.add(wf);
            }
          }
          else if (this.wireframeMode === 'wireframe') {
            const goreMaterial = new THREE.MeshBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: 0.6,
              wireframe: true,
              side: THREE.DoubleSide,
              // Use normal blending so wireframe color is preserved (prevent bright white wash)
              blending: THREE.NormalBlending,
              depthWrite: false,
            });
            gore = new THREE.Mesh(goreGeometry, goreMaterial);

            // Center-out glow overlay while typing/persistent glow
            if (this.glowOutlineActive) {
              const reveal = easeInOutSine(this.glowOutlineProgress);
              const pulse = this.glowPulseIntensity;
              const glowEdgesGeom = createGoreEdges(goreGeometry, false);
              if (glowEdgesGeom) {
                const glowA = createGlowLine(glowEdgesGeom, 0xffffff, 1.0, reveal, pulse);
                gore.add(glowA);
                const glowB = createGlowLine(glowEdgesGeom.clone(), 0x9edfff, 0.35, reveal, pulse);
                glowB.renderOrder = 9994;
                gore.add(glowB);
              }
            }
          }
          else {
            // Filled gore + edges without shimmer
            const goreMaterial = new THREE.MeshBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: 0.18,
              wireframe: false,
              side: THREE.DoubleSide,
              // Use normal blending to preserve per-gore color while preventing depth-write occlusion.
              // Glow/edges remain additive for the highlight effect.
              blending: THREE.NormalBlending,
              depthWrite: false,
            });
            gore = new THREE.Mesh(goreGeometry, goreMaterial);

            const edgesGeometry = createGoreEdges(goreGeometry, this.glowOutlineActive ? false : this.skipEdgeCreation);
            if (edgesGeometry && edgesGeometry.attributes && edgesGeometry.attributes.position) {
              const vCount = edgesGeometry.attributes.position.count;
              const drawCount = Math.max(0, Math.floor((vCount * this.goreDrawProgress) / 2) * 2);
              edgesGeometry.setDrawRange(0, drawCount);
            }
            const edgesMaterial = new THREE.LineBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: 1.0,
              blending: THREE.AdditiveBlending,
              depthTest: false,
              depthWrite: false
            });
            if (edgesGeometry) {
              const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
              edges.renderOrder = 9990;
              gore.add(edges);
            }
          }

          // Add gore and tag with metadata for BallsManager
          group.add(gore);
          gore.userData.isGore = true;
          gore.userData.sphereIndex = si;
          gore.userData.sphereRadius = sphereRadius;
        }
      } else {
        // Reuse existing gore Meshes: update their geometry positions in-place when possible
        for (let i = 0; i < this.currentNumGores; i++) {
          const gore = group.children[i] as THREE.Mesh;
          if (!gore) continue;

          // Ensure gore has metadata
          gore.userData.isGore = true;
          gore.userData.sphereIndex = si;
          gore.userData.sphereRadius = sphereRadius;

          // build a temporary geometry for the new shape
          let newGeom = createGoreGeometry(
            i,
            unfoldProgress,
            sphereRadius,
            this.currentNumGores,
            this.transitionProgress,
            this.gridMode as any
          );
          // Apply helical twist deformation before copying into the live geometry
          if (twistAmount > 0) this.applyHelicalTwist(newGeom, twistAmount);

          const oldGeom = gore.geometry as THREE.BufferGeometry;
          const newPosAttr = newGeom.attributes.position as THREE.BufferAttribute;

          if (oldGeom && oldGeom.attributes && oldGeom.attributes.position && (oldGeom.attributes.position.count === newPosAttr.count)) {
            // copy position data into existing geometry
            const oldPosArray = oldGeom.attributes.position.array as Float32Array;
            oldPosArray.set(newPosAttr.array as Float32Array);
            (oldGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
            oldGeom.computeVertexNormals();
            // dispose the temporary geometry (we only needed its positions)
            newGeom.dispose();
            newGeom = undefined as any;
          } else {
            // fallback: replace geometry object (keeps Mesh instance)
            if (oldGeom) {
              try { oldGeom.dispose(); } catch (e) { /* ignore */ }
            }
            gore.geometry = newGeom;
            newGeom = undefined as any;
          }

          // Remove and rebuild overlays without removing balls (children tagged userData.goreBall)
          // Old:
          // while (gore.children.length > 0) { const c = gore.children[0]; gore.remove(c); dispose... }
          // New: selective removal
          const toRemove: THREE.Object3D[] = [];
          gore.children.forEach(c => {
            const ud = (c as any).userData || {};
            if (!(ud.goreBall || ud.proximityGlow || ud.keepOverlay)) toRemove.push(c);
          });
          toRemove.forEach(c => {
            gore.remove(c);
            const m = c as any as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            const mat = (m as any).material;
            if (mat) { if (Array.isArray(mat)) mat.forEach((mm: any) => mm.dispose()); else mat.dispose(); }
          });

          // Add overlays consistent with current mode
          if (this.wireframeTransitioning) {
            const target = this.wireframeTransitionTarget;
            const t = THREE.MathUtils.clamp(this.wireframeTransitionProgress, 0, 1);
            const edgesGeometry = createGoreEdges(gore.geometry as THREE.BufferGeometry, this.glowOutlineActive ? false : this.skipEdgeCreation);
            if (edgesGeometry && edgesGeometry.attributes && edgesGeometry.attributes.position) {
              const vCount = edgesGeometry.attributes.position.count;
              const drawCount = Math.max(0, Math.floor((vCount * this.goreDrawProgress) / 2) * 2);
              edgesGeometry.setDrawRange(0, drawCount);
            }
            let edgeOpacity = 0;
            if (target === 'edges') edgeOpacity = t;
            else if (target === 'wireframe') edgeOpacity = 1 - t;
            else if (target === 'none') edgeOpacity = 1 - t;

            const baseColor = goreColors[i];
            const edgesMaterial = new THREE.LineBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: edgeOpacity * 1.0,
              blending: THREE.AdditiveBlending,
              depthTest: false,
              depthWrite: false
            });
            if (edgesGeometry) {
              const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
              edges.renderOrder = 9990;
              gore.add(edges);
            }

            if (target === 'wireframe' || (target === 'edges' && (this.wireframeMode === 'wireframe' || this.wireframeMode === 'transitioning_to_wireframe'))) {
              let wireframeOpacity = 0;
              if (target === 'wireframe') wireframeOpacity = 0.6 * t;
              else if (target === 'edges' && (this.wireframeMode === 'wireframe' || this.wireframeMode === 'transitioning_to_wireframe')) wireframeOpacity = 0.6 * (1 - t);

              const wm = new THREE.MeshBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: wireframeOpacity,
                wireframe: true,
                side: THREE.DoubleSide
                // keep color fidelity here as well
                , blending: THREE.NormalBlending
                , depthWrite: false
              });
              const wf = new THREE.Mesh((gore.geometry as THREE.BufferGeometry).clone(), wm);
              gore.add(wf);
            }
          } else if (this.wireframeMode === 'wireframe') {
            const baseColor = goreColors[i];
            const wm = new THREE.MeshBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: 0.6,
              wireframe: true,
              side: THREE.DoubleSide,
              // Use normal blending to preserve per-gore color while preventing depth-write occlusion.
              // Glow/edges remain additive for the highlight effect.
              blending: THREE.NormalBlending,
              depthWrite: false,
            });
            const wf = new THREE.Mesh((gore.geometry as THREE.BufferGeometry).clone(), wm);
            gore.add(wf);

            if (this.glowOutlineActive) {
              const reveal = easeInOutSine(this.glowOutlineProgress);
              const pulse = this.glowPulseIntensity;
              const glowEdgesGeom = createGoreEdges(gore.geometry as THREE.BufferGeometry, false);
              if (glowEdgesGeom) {
                const glowA = createGlowLine(glowEdgesGeom, 0xffffff, 1.0, reveal, pulse);
                gore.add(glowA);
                const glowB = createGlowLine(glowEdgesGeom.clone(), 0x9edfff, 0.35, reveal, pulse);
                glowB.renderOrder = 9994;
                gore.add(glowB);
              }
            }
          } else {
            const edgesGeometry = createGoreEdges(gore.geometry as THREE.BufferGeometry, this.glowOutlineActive ? false : this.skipEdgeCreation);
            if (edgesGeometry && edgesGeometry.attributes && edgesGeometry.attributes.position) {
              const vCount = edgesGeometry.attributes.position.count;
              const drawCount = Math.max(0, Math.floor((vCount * this.goreDrawProgress) / 2) * 2);
              edgesGeometry.setDrawRange(0, drawCount);
            }
            const baseColor = goreColors[i];
            const edgesMaterial = new THREE.LineBasicMaterial({
              color: baseColor,
              transparent: true,
              opacity: 1.0,
              blending: THREE.AdditiveBlending,
              depthTest: false,
              depthWrite: false
            });
            if (edgesGeometry) {
              const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
              edges.renderOrder = 9990;
              gore.add(edges);
            }
          }

          // Ensure reused/replaced gore materials also use additive blending + no depthWrite
          // to avoid folding artifacts when geometry overlaps.
          try {
            const mat = gore.material as any;
            if (mat && !Array.isArray(mat)) {
              if (mat.isMeshBasicMaterial || mat.constructor?.name === 'MeshBasicMaterial') {
                // preserve the material's color (avoid whitening) while preventing depth-write occlusion
                mat.blending = THREE.NormalBlending;
                mat.depthWrite = false;
              }
            } else if (Array.isArray(mat)) {
              mat.forEach((m: any) => { if (m) { m.blending = THREE.NormalBlending; m.depthWrite = false; } });
            }
          } catch (e) { /* non-critical */ }

          // apply transforms to reused gore
          const angleStep = lerp(Math.PI * 2 / this.currentNumGores, Math.PI * 2 / 3, this.transitionProgress);
          const centerAngle = (i + 0.5) * angleStep;
          const eased = easeInOutCubic(this.currentPlacementProgress);
          const angle = centerAngle * eased;
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
          gore.position.set(0, this.sphereYs[si] - cfg.radius, 0);
          gore.quaternion.copy(q);
        }
      }
    }
  }

  private updateWireframeTransition(dt: number): void {
    if (this.wireframeTransitioning) {
      this.wireframeTransitionProgress += dt / this.wireframeTransitionDuration;

      if (this.wireframeTransitionProgress >= 1) {
        this.wireframeTransitionProgress = 1;
        this.wireframeTransitioning = false;
        this.wireframeMode = this.wireframeTransitionTarget;
        this.updateGores(this.unwrappingT);
      } else {
        this.updateGores(this.unwrappingT);
      }
    }
  }

  private updatePositions(progress: number): void {
    this.currentPlacementProgress = progress;
    // Use the actual unwrapping progress for gore geometry so the mesh shape
    // stays consistent during the UNWRAPPING / WRAPPING steps.
    // Keep using eased(progress) for placement/rotation below.
    this.updateGores(this.unwrappingT);

    for (let si = 0; si < this.sphereGroups.length; si++) {
      const group = this.sphereGroups[si];
      const cfg = this.sphereConfigs[si];

      group.children.forEach((gore, i) => {
        let centerY = this.sphereYs[si];
        if (this.unwrappingT > 0) {
          // Align all sphere bottoms to the same level during unwrapping
          const targetBottom = 2.3; // the lowest bottom position
          const targetCenterY = targetBottom + cfg.radius;
          centerY = lerp(this.sphereYs[si], targetCenterY, this.unwrappingT);
        }
        gore.position.set(0, centerY - cfg.radius, 0);
        gore.quaternion.set(0, 0, 0, 1);

        const angleStep = lerp(Math.PI * 2 / this.currentNumGores, Math.PI * 2 / 3, this.transitionProgress);
        const centerAngle = (i + 0.5) * angleStep;
        const angle = centerAngle * easeInOutCubic(progress);

        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
        gore.quaternion.copy(q);
      });
    }

    this.createCircleOutlines();
  }

  private createCircleOutlines(): void {
    // Remove existing circle outlines
    this.circleOutlines.forEach(circle => {
      this.scene.remove(circle);
      if (circle.geometry) circle.geometry.dispose();
      if (circle.material) {
        const material = circle.material as any;
        if (Array.isArray(material)) {
          material.forEach((mat: any) => mat.dispose());
        } else {
          material.dispose();
        }
      }
    });
    this.circleOutlines.length = 0;

    if (!this.circleOutlinesVisible) return;

    if (this.unwrappingT > 0.1 && this.animationStep !== 'INITIAL_CIRCLES_MOVE' && this.animationStep !== 'DEFORMING_GORES') return;

    for (let si = 0; si < this.sphereConfigs.length; si++) {
      const cfg = this.sphereConfigs[si];
      let circleY = this.sphereYs[si];
      if (this.unwrappingT > 0) {
        const targetBottom = 2.3;
        const targetCenterY = targetBottom + cfg.radius;
        circleY = lerp(this.sphereYs[si], targetCenterY, this.unwrappingT);
      }

      const parts = createCircleOutline(
        si,
        circleY,
        cfg.radius,
        this.eyeToCircleProgress,
        this.circleDrawProgress,
        this.unwrappingT
      );

      // Add core line to scene and tracking array (single line, not array)
      this.scene.add(parts.core);
      this.circleOutlines.push(parts.core);
      this.scene.add(parts.innerGlow, parts.outerGlow, parts.ultraGlow, parts.superGlow);
      this.circleOutlines.push(parts.innerGlow, parts.outerGlow, parts.ultraGlow, parts.superGlow);
    }
  }

  // Public triggers to control the new manual phases
  public startWrap(): void {
    if (this.animationStep !== 'UNWRAPPED_IDLE') return;
    this.animationStep = 'WRAPPING';
    this.stepProgress = 0;
    this.reverseStartYs = [...this.sphereYs];
    // Also clear pending balls
    this.pendingBallSpawn = false;
    if (this.balls) { this.balls.destroy(); this.balls = undefined; this.ballsSpawned = false; }
  }

  public startUnwrap(): void {
    if (this.animationStep !== 'EYE_IDLE') return;
    // reset state to run the forward flow again
    this.eyeToCircleProgress = 0;
    this.circleDrawProgress = 1.0;
    this.goreDrawProgress = 0.0;
    this.wireframeMode = 'none';
    this.wireframeTransitioning = false;
    this.wireframeTransitionProgress = 0;
    this.unwrappingT = 0;
    this.sphereYs = [4.5, 4.5, 4.5];
    this.animationStep = 'INITIAL_CIRCLES_MOVE';
    this.stepProgress = 0;
  }

  private startAnimation(): void {
    let last = performance.now();

    const animate = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      this.stepProgress += dt;

      switch (this.animationStep) {
        case 'INITIAL_CIRCLES_MOVE': {
          // Hold eye, type "RESEARCH", hold, then morph while backspacing (all in seconds)
          const sp = this.stepProgress; // seconds into this step
          const total = this.stepDurations.INITIAL_CIRCLES_MOVE; // now longer
          const typeSec = this.STAGE_TYPE_SEC;
          const holdSec = this.STAGE_HOLD_FIRST_SEC;
          const morphSec = 1.0; // keep morph speed
          // movement window (now larger because total increased)
          const yMoveSec = Math.max(0, total - (typeSec + holdSec + morphSec));

          if (sp < typeSec) {
            // Eye held + typing over typeSec
            this.eyeToCircleProgress = 0;
            this.sphereYs = [4.5, 4.5, 4.5];
            this.setStageTextTypingElapsed(sp, typeSec);
          } else if (sp < typeSec + holdSec) {
            // Eye held + full word shown
            this.eyeToCircleProgress = 0;
            this.sphereYs = [4.5, 4.5, 4.5];
            this.setStageTextTyping(1);
          } else if (sp < typeSec + holdSec + morphSec) {
            // Morph eye->circle while backspacing (backspace faster than morph)
            const m = (sp - typeSec - holdSec) / morphSec;
            this.eyeToCircleProgress = m;
            this.sphereYs = [4.5, 4.5, 4.5];
            const eb = sp - typeSec - holdSec; // elapsed into backspace window
            this.setStageTextBackspacingElapsed(eb, this.STAGE_BACK_SEC);
          } else {
            // Circles formed; move Y positions over remaining time
            this.eyeToCircleProgress = 1;
            this.clearStageText();
            const rem = sp - (typeSec + holdSec + morphSec);
            // use eased progress so movement is smooth and methodical
            const t3 = yMoveSec > 0 ? THREE.MathUtils.clamp(rem / yMoveSec, 0, 1) : 1;
            const tE = easeInOutCubic(t3);

            const rLarge = this.sphereConfigs[0].radius;
            const rMed = this.sphereConfigs[1].radius;
            const rSmall = this.sphereConfigs[2].radius;
            const largeCenter = 4.5;

            const smallAlignsToMediumCenter = largeCenter + (rSmall - rMed);
            const mediumAlignsToLargeCenter = largeCenter + (rMed - rLarge);
            const smallAlignsToLargeCenter = largeCenter + (rSmall - rLarge);

            // apply eased progress for both halves for a slower, more deliberate motion
            if (tE < 0.5) {
              const a = tE / 0.5;
              this.sphereYs[0] = largeCenter;
              this.sphereYs[1] = largeCenter;
              this.sphereYs[2] = lerp(largeCenter, smallAlignsToMediumCenter, a);
            } else {
              const b = (tE - 0.5) / 0.5;
              this.sphereYs[0] = largeCenter;
              this.sphereYs[1] = lerp(largeCenter, mediumAlignsToLargeCenter, b);
              this.sphereYs[2] = lerp(smallAlignsToMediumCenter, smallAlignsToLargeCenter, b);
            }
          }
          this.updatePositions(0);
          if (sp >= total) {
            this.animationStep = 'FORMING_GORES';
            this.stepProgress = 0;
            this.goreDrawProgress = 0;
            this.circleDrawProgress = 1;
            this.wireframeMode = 'none';
            this.wireframeTransitionTarget = 'wireframe';
            this.wireframeTransitioning = true;
            this.wireframeTransitionProgress = 0;
            this.unwrappingT = 0;
            // reset per-step text init
            this.fgTextInit = false;
          }
          break;
        }

        case 'FORMING_GORES': {
          // Type and hold "DISCOVER" before gore drawing; then draw gores while backspacing
          if (!this.fgTextInit) { this.stageText = 'DISCOVER'; this.fgTextInit = true; }
          const sp = this.stepProgress;                // seconds
          const typeSec = this.STAGE_TYPE_SEC;
          const holdSec = this.STAGE_HOLD_SECOND_SEC;
          const goreDur = this.stepDurations.FORMING_GORES; // keep draw speed (2s)

          if (sp < typeSec) {
            this.setStageTextTypingElapsed(sp, typeSec);
            this.goreDrawProgress = 0;
            this.circleDrawProgress = 1;
            this.wireframeTransitionTarget = 'wireframe';
            this.wireframeTransitioning = true;
            this.wireframeTransitionProgress = 0;
            this.unwrappingT = 0;
            this.currentPlacementProgress = 0;
            this.updateGores(0);
            this.createCircleOutlines();
          } else if (sp < typeSec + holdSec) {
            this.setStageTextTyping(1);
            this.goreDrawProgress = 0;
            this.circleDrawProgress = 1;
            this.wireframeTransitionTarget = 'wireframe';
            this.wireframeTransitioning = true;
            this.wireframeTransitionProgress = 0;
            this.unwrappingT = 0;
            this.currentPlacementProgress = 0;
            this.updateGores(0);
          } else {
            const tg = Math.min(1, (sp - typeSec - holdSec) / goreDur);
            this.goreDrawProgress = tg;
            this.circleDrawProgress = 1 - tg;
            this.createCircleOutlines();
            this.wireframeTransitionTarget = 'wireframe';
            this.wireframeTransitioning = true;
            this.wireframeTransitionProgress = tg;
            this.unwrappingT = 0;
            this.currentPlacementProgress = 0;
            this.updateGores(0);
            // Backspace STRATEGY at uniform faster speed (independent of gore draw fraction)
            const eb = sp - typeSec - holdSec;
            this.setStageTextBackspacingElapsed(eb, this.STAGE_BACK_SEC);

            if (tg >= 1) {
              this.wireframeMode = 'wireframe';
              this.wireframeTransitioning = false;
              this.wireframeTransitionProgress = 1;
              this.goreDrawProgress = 1;
              this.circleDrawProgress = 0;
              this.unwrappingT = 0;
              this.updateGores(0);
              this.animationStep = 'UNWRAPPING';
              this.stepProgress = 0;
              // prepare next stage word
              this.unwrTextInit = false;
              this.clearStageText();
            }
          }
          break;
        }

        case 'UNWRAPPING': {
          if (!this.unwrTextInit) { this.stageText = 'TRANSFORM'; this.unwrTextInit = true; }
          // Keep geometry unwrapping on original 8s timeline
          this.unwrappingT = Math.min(1, this.stepProgress / this.stepDurations.UNWRAPPING);
          if (this.wireframeMode !== 'wireframe') {
            this.wireframeMode = 'wireframe';
            this.wireframeTransitioning = false;
          }

          // Text timeline: type (uniform speed) -> hold (computed to match inter-word gap) -> backspace (uniform speed)
          const sp2 = this.stepProgress; // seconds
          const typeSec2 = this.STAGE_TYPE_SEC;
          const holdSec2 = this.getUnwrapHoldToMatchGap();   // compute so gap to CompanyName matches earlier gaps
          const backSec2 = this.STAGE_BACK_SEC;

          if (sp2 < typeSec2) {
            this.setStageTextTypingElapsed(sp2, typeSec2);
          } else if (sp2 < typeSec2 + holdSec2) {
            this.setStageTextTyping(1);
          } else if (sp2 < typeSec2 + holdSec2 + backSec2) {
            const eb = sp2 - typeSec2 - holdSec2;
            this.setStageTextBackspacingElapsed(eb, backSec2);
          } else {
            this.clearStageText();
          }

          this.updatePositions(this.unwrappingT);
          if (this.unwrappingT >= 1) {
            // REMOVE ALL THE REBUILDING - just pause the animation state
            this.unwrappingT = 1;
            // Don't change goreDrawProgress or circleDrawProgress
            // Don't force wireframe mode changes
            // Don't call updateGores() or updatePositions() again

            if (this.onAnimationComplete) {
              console.log('Unwrap finished, showing company name');
              this.onAnimationComplete();
            }
            this.animationStep = 'UNWRAPPED_IDLE';
            this.stepProgress = 0;
            if (this.glowOutlineActive && this.glowOutlineProgress >= 1 && (this.pendingBallSpawn || !this.ballsSpawned)) {
              this.spawnDefaultBalls();
              this.pendingBallSpawn = false;
            }
          }

          // Update mission text opacity to fade in simultaneously with edges
          if (this.missionTextEl) {
            this.missionTextEl.style.opacity = this.unwrappingT.toString();
          }

          break;
        }

        case 'UNWRAPPED_IDLE':
          // Continue updating glow effects even while idle
          if (this.glowOutlineActive) {
            // Update glow pulse and reveal effects
            this.updateGores(this.unwrappingT);

            // Handle pending ball spawn after glow fully reveals
            if (this.glowOutlineProgress >= 1 && this.pendingBallSpawn && !this.ballsSpawned) {
              this.spawnDefaultBalls();
              this.pendingBallSpawn = false;
            }
          }
          break;

        case 'WRAPPING':
          this.unwrappingT = 1 - Math.min(1, this.stepProgress / this.stepDurations.WRAPPING);
          if (this.wireframeMode !== 'wireframe') {
            this.wireframeMode = 'wireframe';
            this.wireframeTransitioning = false;
          }
          this.updatePositions(this.unwrappingT);
          if (this.unwrappingT <= 0) {
            this.unwrappingT = 0;
            this.updateGores(0);
            this.animationStep = 'DEFORMING_GORES';
            this.stepProgress = 0;
            this.wireframeTransitionTarget = 'edges';
            this.wireframeTransitioning = true;
            this.wireframeTransitionProgress = 0;
            this.wireframeMode = 'wireframe';
            this.reverseStartYs = [...this.sphereYs];
          }
          break;

        case 'DEFORMING_GORES': {
          // Simplified and fixed reverse: draw circles back in and morph from circle -> eye
          const t = Math.min(1, this.stepProgress / this.stepDurations.DEFORMING_GORES);
          this.circleDrawProgress = t;            // outlines draw in
          this.eyeToCircleProgress = 1 - t;       // 1 -> 0 (circle -> eye)
          // Move centers back to neutral level smoothly
          const targetY = 4.5;
          this.sphereYs[0] = lerp(this.reverseStartYs[0], targetY, t);
          this.sphereYs[1] = lerp(this.reverseStartYs[1], targetY, t);
          this.sphereYs[2] = lerp(this.reverseStartYs[2], targetY, t);

          // Transition wireframe to edges during first half, then edges fade slightly
          if (this.wireframeMode !== 'edges' || this.wireframeTransitioning) {
            this.wireframeTransitioning = true;
            this.wireframeTransitionTarget = 'edges';
            this.wireframeTransitionProgress = t;
          }

          this.createCircleOutlines();
          this.currentPlacementProgress = 0;
          this.updateGores(0);

          if (t >= 1) {
            // End of reverse morph: settle into the eye + outlines and idle
            this.wireframeTransitioning = false;
            this.wireframeMode = 'none';
            this.animationStep = 'EYE_IDLE';
            this.stepProgress = 0;
          }
          break;
        }

        case 'EYE_IDLE':
          // Idle in the initial eye/circle state until startUnwrap() is called
          this.unwrappingT = 0;
          this.goreDrawProgress = 0; // only outlines
          this.circleDrawProgress = 1;
          this.wireframeTransitioning = false;
          this.wireframeMode = 'none';
          this.currentPlacementProgress = 0;
          this.updateGores(0);
          this.createCircleOutlines();
          break;
      }


      // Run post-typing glow tween (center-out reveal) after name is typed
      if (this.glowPostAnimating) {
        const t = Math.min(1, (performance.now() - this.glowPostStart) / this.glowPostDurationMs);
        this.glowOutlineProgress = t;
        this.updateGores(this.unwrappingT);
        if (t >= 1) this.glowPostAnimating = false;
      }
      if (this.animationStep === 'UNWRAPPED_IDLE' && this.pendingBallSpawn && this.glowOutlineActive && this.glowOutlineProgress >= 1 && !this.ballsSpawned) {
        this.spawnDefaultBalls();
        this.pendingBallSpawn = false;
      }
      if (this.balls) this.balls.update(dt);

      this.renderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  // Create centered stage text element (same style as CompanyName)
  private createStageTextElement(): void {
    if (this.stageTextEl) return;
    const el = document.createElement('div');
    el.className = 'stage-text';
    el.style.cssText = `
      position: absolute;
      top: var(--hero-center);
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Arial', sans-serif;
      font-size: 4rem;
      font-weight: 300;
      letter-spacing: 0.5rem;
      text-align: center;
      line-height: 1.15;
      z-index: 950;
      opacity: 1;
      pointer-events: none;
      text-shadow:
        0 0 10px #ffffff,
        0 0 20px #e6f6ff,
        0 0 30px #9edfff,
        0 0 40px #9edfff;
      color: #ffffff;
      text-transform: uppercase;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      white-space: nowrap;
      display: none;
    `;
    // Append inside the hero container (parent of the three-background)
    const host = this.element.parentElement || document.body;
    host.appendChild(el);
    this.stageTextEl = el;
  }

  private setStageTextTyping(t: number): void {
    if (!this.stageTextEl) this.createStageTextElement();
    if (!this.stageTextEl) return;
    const len = Math.floor(this.stageText.length * THREE.MathUtils.clamp(t, 0, 1));
    this.stageTextEl.textContent = this.stageText.substring(0, len);
    this.stageTextEl.style.display = len > 0 ? 'block' : 'none';
  }

  private setStageTextBackspacing(t: number): void {
    if (!this.stageTextEl) return;
    const len = Math.max(0, this.stageText.length - Math.floor(this.stageText.length * THREE.MathUtils.clamp(t, 0, 1)));
    this.stageTextEl.textContent = this.stageText.substring(0, len);
    this.stageTextEl.style.display = len > 0 ? 'block' : 'none';
  }

  // Map elapsed seconds -> normalized typing progress and reuse existing substring logic
  private setStageTextTypingElapsed(elapsed: number, total: number): void {
    const t = THREE.MathUtils.clamp(elapsed / Math.max(0.001, total), 0, 1);
    this.setStageTextTyping(t);
  }
  private setStageTextBackspacingElapsed(elapsed: number, total: number): void {
    const t = THREE.MathUtils.clamp(elapsed / Math.max(0.001, total), 0, 1);
    this.setStageTextBackspacing(t);
  }

  // Compute average inter-word gap from earlier stages, then derive UNWRAPPING hold to match that gap to the CompanyName reveal.
  private getInterWordGapSec(): number {
    // Gap after word 1 (INITIAL_CIRCLES_MOVE): stage ends at 4.0s, backspace ends at type+hold+back
    const gap1 = this.stepDurations.INITIAL_CIRCLES_MOVE - (this.STAGE_TYPE_SEC + this.STAGE_HOLD_FIRST_SEC + this.STAGE_BACK_SEC);
    // Gap after word 2 (FORMING_GORES): remaining gore draw after backspace; total remainder = goreDur - back
    const gap2 = this.stepDurations.FORMING_GORES - this.STAGE_BACK_SEC;
    return Math.max(0, (gap1 + gap2) / 2);
  }
  private getUnwrapHoldToMatchGap(): number {
    const desiredGap = this.getInterWordGapSec();
    // Ensure: UNWRAP total (8s) = type + hold + back + desiredGap
    const hold = this.stepDurations.UNWRAPPING - (this.STAGE_TYPE_SEC + this.STAGE_BACK_SEC + desiredGap);
    return Math.max(0, hold);
  }
  private clearStageText(): void {
    if (!this.stageTextEl) return;
    this.stageTextEl.textContent = '';
    this.stageTextEl.style.display = 'none';
  }

  // Apply a helical twist around the local Y-axis distributed along the gore's height.
  // amount01: 0..1 scalar where 1 means "peak twist" for the current frame.
  private applyHelicalTwist(geom: THREE.BufferGeometry, amount01: number): void {
    if (!geom) return;
    if (amount01 <= 0) return;

    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    if (!pos) return;

    const arr = pos.array as Float32Array;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    // Find vertical range
    for (let i = 0; i < pos.count; i++) {
      const y = arr[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const range = Math.max(1e-6, maxY - minY);

    // Total twist angle at the top (yNorm=1)
    const totalAngle = amount01 * this.twistTurns * Math.PI * 2;

    // Rotate each vertex around the Y-axis by angle proportional to its Y position
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = arr[ix];
      const y = arr[ix + 1];
      const z = arr[ix + 2];

      const yNorm = (y - minY) / range; // 0..1 along height
      const angle = totalAngle * yNorm;

      const s = Math.sin(angle);
      const c = Math.cos(angle);

      const nx = x * c - z * s;
      const nz = x * s + z * c;

      arr[ix] = nx;
      arr[ix + 2] = nz;
    }

    pos.needsUpdate = true;
    if (geom.getAttribute('normal')) {
      geom.computeVertexNormals();
    }
  }

  public destroy(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.balls) { this.balls.destroy(); this.balls = undefined; }

    // Dispose of Three.js resources
    this.sphereGroups.forEach(group => {
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
        if ((child as THREE.Mesh).material) {
          const material = (child as THREE.Mesh).material;
          if (Array.isArray(material)) {
            material.forEach(mat => mat.dispose());
          } else {
            material.dispose();
          }
        }
      }
    });

    this.circleOutlines.forEach(circle => {
      this.scene.remove(circle);
      if (circle.geometry) circle.geometry.dispose();
      if (circle.material) {
        const material = circle.material;
        if (Array.isArray(material)) {
          material.forEach(mat => mat.dispose());
        } else {
          material.dispose();
        }
      }
    });

    this.renderer.dispose();
    this.element.remove();
    // Remove stage text overlay
    if (this.stageTextEl) {
      this.stageTextEl.remove();
      this.stageTextEl = null;
    }
  }
}