import * as THREE from 'three';

type GoreBall = {
    root: THREE.Group;              // attached under gore; preserves through overlay rebuilds
    gore: THREE.Mesh;
    color: number;
    pos: THREE.Vector2;             // local XY on gore
    vel: THREE.Vector2;             // local XY velocity
    hull: THREE.Vector2[];          // allowed base hull (local XY)
    target: THREE.Vector2;          // current target point for seeking

    // Exclusion polygons (in current gore-local XY) projected from smaller spheres
    exPolys: THREE.Vector2[][];

    // New fields for smoother behavior
    coreMat: THREE.MeshBasicMaterial;
    glowMat: THREE.MeshBasicMaterial;
    spawnTime: number;
    fadeDuration: number;
    center: THREE.Vector2;     // gore centroid for inward steering
    wanderTheta: number;       // current wander heading
};

export class BallsManager {
    private scene: THREE.Scene;
    private balls: GoreBall[] = [];
    private active = true;

    // Proximity glow shader limits
    private static readonly MAX_HOTS = 8;
    private static readonly GLOW_SIGMA = 0.45;     // falloff radius in local units
    private static readonly GLOW_STRENGTH = 0.4;   // overall intensity multiplier

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public setActive(active: boolean) {
        this.active = active;
        this.balls.forEach(b => (b.root.visible = active));
    }

    public clear(): void {
        this.balls.forEach(b => {
            if (b.root.parent) b.root.parent.remove(b.root);
            b.root.traverse(obj => {
                const mesh = obj as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                const mat = (mesh as any).material;
                if (mat) {
                    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
                    else mat.dispose();
                }
            });
        });
        this.balls = [];
    }

    public destroy(): void {
        this.clear();
    }

    // Add a ball to a specific gore mesh with a given color
    public addBallForGore(gore: THREE.Mesh, color: number): void {
        const geometry = gore.geometry as THREE.BufferGeometry;
        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

        // tip = farthest vertex from center (0,0)
        let maxL = -Infinity;
        const tip = new THREE.Vector2();
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const l = x * x + y * y;
            if (l > maxL) { maxL = l; tip.set(x, y); }
        }

        // Current hull (local XY)
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i < posAttr.count; i++) {
            pts.push(new THREE.Vector2(posAttr.getX(i), posAttr.getY(i)));
        }
        const hull = this.buildConvexHull2D(pts);

        // Centroid for steering
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p.x; cy += p.y; }
        const center = new THREE.Vector2(cx / Math.max(1, pts.length), cy / Math.max(1, pts.length));

        // Build exclusion polygons from smaller-sphere gores projected into this gore's local space
        const sphereRadius = gore.userData?.sphereRadius as number | undefined;
        const exPolys = this.gatherExclusionPolys(gore, sphereRadius ?? Number.POSITIVE_INFINITY);

        const root = new THREE.Group();
        root.userData.goreBall = true;
        // Make the whole group render last
        root.renderOrder = 100000;

        const coreGeo = new THREE.SphereGeometry(0.06, 16, 16);
        const coreMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.0,          // start invisible for fade-in
            depthTest: false,
            depthWrite: false
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.renderOrder = 100002; // after glow and all other content

        const glowGeo = new THREE.SphereGeometry(0.1, 12, 12);
        const glowMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.0,          // start invisible for fade-in
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.renderOrder = 100001;

        root.add(glow);
        root.add(core);
        gore.add(root);

        // Slower base velocity and gentle wander
        const vel = this.randomVelocity(0.06, 0.14);

        // Ensure initial position is valid (not within exclusions); sample a few times if needed
        let start = tip.clone();
        if (!this.pointValidLocal(start, hull, exPolys)) {
            start = this.randomAllowedPointInside(hull, exPolys, center);
        }

        const ball: GoreBall = {
            root,
            gore,
            color,
            pos: start,
            vel,
            hull,
            target: this.randomAllowedPointInside(hull, exPolys, center),
            exPolys,
            coreMat,
            glowMat,
            spawnTime: performance.now(),
            fadeDuration: 900,   // ms
            center,
            wanderTheta: Math.random() * Math.PI * 2
        };

        // Slight z lift to avoid coplanar artifacts
        root.position.set(ball.pos.x, ball.pos.y, 0.001);
        // Ensure proximity overlay exists (created once and reused)
        this.ensureProximityOverlay(gore);
        this.balls.push(ball);
    }

    public update(dt: number): void {
        if (!this.active || this.balls.length === 0) return;
        const now = performance.now();

        for (const b of this.balls) {
            // 1) Fade-in core and glow with smooth easing
            const t = Math.min(1, (now - b.spawnTime) / b.fadeDuration);
            const ease = t * t * (3 - 2 * t);
            b.coreMat.opacity = 1.0 * ease;
            b.glowMat.opacity = 0.35 * ease;

            // 2) Choose a new target occasionally or when reaching current
            const toTarget = b.target.clone().sub(b.pos);
            if (toTarget.length() < 0.08 || Math.random() < 0.005) {
                b.target = this.randomAllowedPointInside(b.hull, b.exPolys, b.center);
            }

            // Wander heading + seek target
            b.wanderTheta += (Math.random() - 0.5) * 0.6 * dt;
            const wanderDir = new THREE.Vector2(Math.cos(b.wanderTheta), Math.sin(b.wanderTheta));
            const seekDir = b.target.clone().sub(b.pos).normalize();

            // Blend directions and set desired speed
            const desired = seekDir.multiplyScalar(0.18).addScaledVector(wanderDir, 0.06);
            // Move velocity toward desired smoothly
            b.vel.lerp(desired, 0.8 * dt);

            // Mild jitter
            b.vel.addScaledVector(this.randomVelocity(0, 0.03), 0.5 * dt);

            // Clamp speed
            const sp = b.vel.length();
            const minS = 0.05, maxS = 0.22;
            if (sp > maxS) b.vel.multiplyScalar(maxS / sp);
            if (sp < minS) b.vel.multiplyScalar((minS + 1e-6) / Math.max(sp, 1e-6));

            // Propose next position and keep inside hull
            const proposed = b.pos.clone().addScaledVector(b.vel, dt);
            if (this.pointValidLocal(proposed, b.hull, b.exPolys)) {
                b.pos.copy(proposed);
            } else {
                // steer slightly inward then clamp along segment inside allowed region
                const inward = b.center.clone().sub(b.pos).normalize().multiplyScalar(0.12);
                const adjustedVel = b.vel.clone().add(inward);

                // Bisection to find last inside point along segment
                let lo = 0, hi = 1, mid = 0.5;
                let chosen = b.pos.clone();
                for (let k = 0; k < 6; k++) {
                    mid = (lo + hi) * 0.5;
                    const test = b.pos.clone().addScaledVector(adjustedVel, dt * mid);
                    if (this.pointValidLocal(test, b.hull, b.exPolys)) { lo = mid; chosen.copy(test); } else { hi = mid; }
                }
                b.pos.copy(chosen);
                b.vel.multiplyScalar(0.9);
            }

            // Maintain slight z offset
            b.root.position.set(b.pos.x, b.pos.y, 0.001);
        }

        // After updating all balls, update proximity glow overlays with current hotspots
        this.updateProximityGlows();
    }

    // Create or fetch an additive glow overlay Mesh attached to this gore
    private ensureProximityOverlay(gore: THREE.Mesh): { mesh: THREE.Mesh, mat: THREE.ShaderMaterial } {
        const ud = (gore as any).userData || ((gore as any).userData = {});
        if (ud.proximityOverlay && ud.proximityOverlay.mesh) {
            const overlay = ud.proximityOverlay as { mesh: THREE.Mesh, mat: THREE.ShaderMaterial };
            // keep geometry pointer in sync in case gore geometry is replaced
            if (overlay.mesh.geometry !== gore.geometry) {
                overlay.mesh.geometry = gore.geometry as THREE.BufferGeometry;
            }
            return overlay;
        }

        const mat = new THREE.ShaderMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uCount: { value: 0 },
                uHot: { value: new Array(BallsManager.MAX_HOTS).fill(new THREE.Vector2()) },
                uSigma: { value: BallsManager.GLOW_SIGMA },
                uStrength: { value: BallsManager.GLOW_STRENGTH },
                uColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec2 vPos;
                void main() {
                    vPos = position.xy;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec2 vPos;
                uniform int uCount;
                uniform vec2 uHot[${BallsManager.MAX_HOTS}];
                uniform float uSigma;
                uniform float uStrength;
                uniform vec3 uColor;
                void main() {
                    float sigma2 = uSigma * uSigma + 1e-6;
                    float intensity = 0.0;
                    // Sum Gaussian contributions from hotspots
                    for (int i = 0; i < ${BallsManager.MAX_HOTS}; i++) {
                        if (i >= uCount) break;
                        vec2 d = vPos - uHot[i];
                        float dist2 = dot(d, d);
                        float contrib = exp(-dist2 / (2.0 * sigma2));
                        intensity += contrib;
                    }
                    intensity = clamp(intensity * uStrength, 0.0, 1.0);
                    if (intensity < 0.001) discard;
                    gl_FragColor = vec4(uColor, intensity);
                }
            `
        });

        const mesh = new THREE.Mesh(gore.geometry as THREE.BufferGeometry, mat);
        mesh.renderOrder = 100003;
        (mesh as any).userData = (mesh as any).userData || {};
        (mesh as any).userData.proximityGlow = true;  // preserve on overlay rebuilds
        (mesh as any).userData.keepOverlay = true;

        gore.add(mesh);
        ud.proximityOverlay = { mesh, mat };
        return ud.proximityOverlay;
    }

    // Push current ball positions per gore to the glow overlay uniforms
    private updateProximityGlows(): void {
        // Build gore -> positions map
        const map = new Map<THREE.Mesh, THREE.Vector2[]>();
        for (const b of this.balls) {
            let arr = map.get(b.gore);
            if (!arr) { arr = []; map.set(b.gore, arr); }
            if (arr.length < BallsManager.MAX_HOTS) arr.push(b.pos.clone());
        }

        // Update or create overlays and feed uniforms
        for (const [gore, positions] of map) {
            const overlay = this.ensureProximityOverlay(gore);
            // Keep geometry synced (in case gore geometry object changed this frame)
            if (overlay.mesh.geometry !== gore.geometry) overlay.mesh.geometry = gore.geometry as THREE.BufferGeometry;

            overlay.mesh.visible = true;
            overlay.mat.uniforms.uCount.value = positions.length;

            // Fill up to MAX_HOTS; reuse same Vector2 instances to avoid realloc in WebGLUniforms
            const uHot = overlay.mat.uniforms.uHot.value as THREE.Vector2[];
            for (let i = 0; i < BallsManager.MAX_HOTS; i++) {
                if (i < positions.length) {
                    uHot[i].set(positions[i].x, positions[i].y);
                } else {
                    uHot[i].set(1e6, 1e6); // push far away
                }
            }
            overlay.mat.uniformsNeedUpdate = true;
        }

        // Optionally hide overlays on gores without balls
        // If you want to hide them explicitly, uncomment:
        // this.scene.traverse(obj => {
        //   const m = obj as THREE.Mesh;
        //   if (m.parent && (m as any).userData?.proximityGlow && !map.has(m.parent as THREE.Mesh)) m.visible = false;
        // });
    }

    // Build exclusion polygons from smaller-sphere gore meshes, projected into current gore local XY
    private gatherExclusionPolys(current: THREE.Mesh, currentRadius: number): THREE.Vector2[][] {
        const exPolys: THREE.Vector2[][] = [];
        // Ensure world matrices are up to date
        current.updateWorldMatrix(true, false);

        this.scene.traverse(obj => {
            const m = obj as THREE.Mesh;
            const ud = (m as any).userData || {};
            if (!(m.isMesh && ud.isGore)) return;
            if (m === current) return;
            const r = ud.sphereRadius as number | undefined;
            if (r === undefined || !(r < currentRadius)) return;

            const geom = m.geometry as THREE.BufferGeometry;
            const pa = geom.getAttribute('position') as THREE.BufferAttribute;
            if (!pa) return;

            m.updateWorldMatrix(true, false);

            // Build other gore hull in its local, then project to current local
            const otherPts: THREE.Vector2[] = [];
            for (let i = 0; i < pa.count; i++) {
                const vx = pa.getX(i), vy = pa.getY(i);
                const wp = new THREE.Vector3(vx, vy, 0);
                m.localToWorld(wp);
                const lp = current.worldToLocal(wp);
                otherPts.push(new THREE.Vector2(lp.x, lp.y));
            }
            const otherHull = this.buildConvexHull2D(otherPts);
            if (otherHull.length >= 3) exPolys.push(otherHull);
        });

        return exPolys;
    }

    private pointValidLocal(p: THREE.Vector2, hull: THREE.Vector2[], exPolys: THREE.Vector2[][]): boolean {
        if (!this.pointInPolygon(p, hull)) return false;
        for (const poly of exPolys) {
            if (this.pointInPolygon(p, poly)) return false;
        }
        return true;
    }

    private randomAllowedPointInside(hull: THREE.Vector2[], exPolys: THREE.Vector2[][], centroid: THREE.Vector2): THREE.Vector2 {
        // Try a few random samples; fallback to centroid if all fail
        for (let tries = 0; tries < 20; tries++) {
            const p = this.randomPointInsideHull(hull, centroid);
            if (this.pointValidLocal(p, hull, exPolys)) return p;
        }
        // Nudge centroid slightly if excluded
        let fallback = centroid.clone();
        for (let a = 0; a < 16; a++) {
            const dir = new THREE.Vector2(Math.cos(a * Math.PI / 8), Math.sin(a * Math.PI / 8));
            const p = centroid.clone().addScaledVector(dir, 0.1);
            if (this.pointValidLocal(p, hull, exPolys)) { fallback = p; break; }
        }
        return fallback;
    }

    // Convex hull (Monotonic chain) for 2D points
    private buildConvexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
        const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
        const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

        const lower: THREE.Vector2[] = [];
        for (const p of pts) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        const upper: THREE.Vector2[] = [];
        for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop(); lower.pop();
        const hull = lower.concat(upper);
        // If degenerate, fallback to bounding circle approx as a tiny square
        if (hull.length < 3 && pts.length > 0) {
            const c = new THREE.Vector2();
            pts.forEach(p => c.add(p));
            c.multiplyScalar(1 / pts.length);
            const r = pts.reduce((m, p) => Math.max(m, p.distanceTo(c)), 0.01);
            return [
                new THREE.Vector2(c.x - r, c.y - r),
                new THREE.Vector2(c.x + r, c.y - r),
                new THREE.Vector2(c.x + r, c.y + r),
                new THREE.Vector2(c.x - r, c.y + r),
            ];
        }
        return hull;
    }

    // Random point inside convex hull using triangle fan sampling from centroid
    private randomPointInsideHull(hull: THREE.Vector2[], centroid: THREE.Vector2): THREE.Vector2 {
        if (hull.length < 3) return centroid.clone();
        // Build fan triangles (centroid, hull[i], hull[i+1])
        const idx = Math.floor(Math.random() * hull.length);
        const a = centroid;
        const b = hull[idx];
        const c = hull[(idx + 1) % hull.length];
        // Random barycentric
        let u = Math.random(), v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        return new THREE.Vector2(
            a.x + u * (b.x - a.x) + v * (c.x - a.x),
            a.y + u * (b.y - a.y) + v * (c.y - a.y)
        );
    }

    // Point-in-polygon (ray casting) with small epsilon for borders
    private pointInPolygon(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
        let inside = false;
        const eps = 1e-6;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const onEdge = Math.abs((xj - xi) * (p.y - yi) - (yj - yi) * (p.x - xi)) < eps &&
                (p.x - xi) * (p.x - xj) <= eps && (p.y - yi) * (p.y - yj) <= eps;
            if (onEdge) return true;
            const intersect = ((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-6) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    private randomVelocity(min: number, max: number): THREE.Vector2 {
        const a = Math.random() * Math.PI * 2;
        const s = min + Math.random() * Math.max(0, max - min);
        return new THREE.Vector2(Math.cos(a) * s, Math.sin(a) * s);
    }
}
