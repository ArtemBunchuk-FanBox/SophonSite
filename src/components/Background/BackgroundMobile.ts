import * as THREE from 'three';
import { Background } from './Background';
import { createGoreGeometry, lerp, easeInOutCubic } from './core/geometry';

export class BackgroundMobile extends Background {
    private mobileScaleGroup: THREE.Group | null = null;
    private targetScreenWidthRatio = 0.95;
    private boundResize?: () => void;

    constructor(container: HTMLElement, onAnimationComplete?: () => void) {
        super(container, onAnimationComplete);

        // Setup scaling root and initial scaling asynchronously (after parent init)
        this.setupMobileRoot();
        this.boundResize = () => this.handleMobileResize();
        window.addEventListener('resize', this.boundResize);
        // Initial measure and apply on next frames to ensure renderer/camera are ready
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.recalculateAndApplyScale();
            this.applyMobileFonts();
        }));
    }

    // Move all current and future scene children under a dedicated scaling group
    private setupMobileRoot(): void {
        const scene: THREE.Scene | undefined = (this as any).scene;
        if (!scene) return;

        // If already created, skip
        if (this.mobileScaleGroup) return;

        const group = new THREE.Group();
        group.name = 'MobileScaleRoot';
        this.mobileScaleGroup = group;
        scene.add(group);

        // Move existing children (except the new group itself) under the group
        // Clone array to avoid iteration mutation issues
        const existing = [...scene.children].filter((c) => c !== group);
        existing.forEach((child) => {
            scene.remove(child);
            group.add(child);
        });

        // Monkey patch add/remove so future additions go under the scaling group too
        const originalAdd = scene.add.bind(scene);
        const originalRemove = scene.remove.bind(scene);
        const mobileGroup = group;
        // Store originals for potential debugging/cleanup
        (scene as any).__origAdd = originalAdd;
        (scene as any).__origRemove = originalRemove;
        (scene as any).add = function patchedAdd(...objs: THREE.Object3D[]) {
            mobileGroup.add(...objs);
            return scene;
        };
        (scene as any).remove = function patchedRemove(...objs: THREE.Object3D[]) {
            mobileGroup.remove(...objs);
            return scene;
        };
    }

    // Compute current pixel width of two adjacent gores when fully unfolded (t=1)
    private measureGorePixelWidth(): number {
        const scene: THREE.Scene | undefined = (this as any).scene;
        const camera: THREE.PerspectiveCamera | undefined = (this as any).camera;
        const renderer: THREE.WebGLRenderer | undefined = (this as any).renderer;
        if (!scene || !camera || !renderer) return 0;

        const sphereGroups: THREE.Group[] | undefined = (this as any).sphereGroups;
        const currentNumGores: number = (this as any).currentNumGores ?? 9;
        const transitionProgress: number = (this as any).transitionProgress ?? 1;
        const gridMode: any = (this as any).gridMode ?? 'rectangular';

        // Determine radii for each sphere group (fallbacks keep them reasonable)
        const fallbackRadii = [2.2, 1.4, 0.75];
        const radii: number[] = [];
        for (let si = 0; si < (sphereGroups?.length ?? 3); si++) {
            let r = fallbackRadii[si] ?? fallbackRadii[fallbackRadii.length - 1];
            try {
                const grp = sphereGroups?.[si];
                const goreAny = grp?.children?.[0] as any;
                if (goreAny?.userData?.sphereRadius) r = goreAny.userData.sphereRadius;
            } catch { /* keep fallback */ }
            radii.push(r);
        }

        // Compute transforms: scene rotation and current uniform scale
        const sceneQuat = new THREE.Quaternion().setFromEuler(scene.rotation);
        const scaleVal = (this.mobileScaleGroup ? this.mobileScaleGroup.scale.x : scene.scale.x) || 1;
        const scaleVec = new THREE.Vector3(scaleVal, scaleVal, scaleVal);
        const canvasW = (renderer.domElement as HTMLCanvasElement).clientWidth || window.innerWidth;
        const projectX = (v: THREE.Vector3) => {
            const ndc = v.clone().project(camera);
            return (ndc.x * 0.5 + 0.5) * canvasW;
        };

        const angleStep = lerp(Math.PI * 2 / currentNumGores, Math.PI * 2 / 3, transitionProgress);
        const progress = easeInOutCubic(1);
        const tmp = new THREE.Vector3();
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;

        // Build and project every gore for every sphere at unfold=1 and collect screen-space X extents
        const unfold = 1;
        for (let si = 0; si < radii.length; si++) {
            const r = radii[si];
            for (let gi = 0; gi < currentNumGores; gi++) {
                const geom = createGoreGeometry(gi, unfold, r, currentNumGores, transitionProgress, gridMode);
                const ang = (gi + 0.5) * angleStep * progress;
                const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
                const worldMat = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), sceneQuat.clone().multiply(rot), scaleVec.clone());
                const pos = geom.getAttribute('position') as THREE.BufferAttribute;
                for (let vi = 0; vi < pos.count; vi++) {
                    tmp.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(worldMat);
                    const sx = projectX(tmp);
                    if (sx < minX) minX = sx;
                    if (sx > maxX) maxX = sx;
                }
                geom.dispose();
            }
        }

        if (!isFinite(minX) || !isFinite(maxX)) return 0;
        return Math.max(0, maxX - minX);
    }

    private calculateMobileScale(): number {
        const renderer: THREE.WebGLRenderer | undefined = (this as any).renderer;
        if (!renderer) return 1;
        const measuredPx = this.measureGorePixelWidth();
        const cssW = (renderer.domElement as HTMLCanvasElement).clientWidth || window.innerWidth;
        const targetPx = Math.max(1, Math.floor(cssW * this.targetScreenWidthRatio));
        if (measuredPx <= 0) return 1;
        // Incorporate current group scale so we return absolute target scale
        const currentGroupScale = (this.mobileScaleGroup ? this.mobileScaleGroup.scale.x : (this as any).scene?.scale?.x) || 1;
        const neededScale = (targetPx / measuredPx) * currentGroupScale;
        return Math.max(0.01, Math.min(10, neededScale));
    }

    private applyMobileScale(scale: number): void {
        const scene: THREE.Scene | undefined = (this as any).scene;
        if (!scene) return;
        // Apply scale uniformly via the scaling group if present; otherwise scale scene
        if (this.mobileScaleGroup) {
            this.mobileScaleGroup.scale.set(scale, scale, scale);
        } else {
            scene.scale.set(scale, scale, scale);
        }
        // Optionally adjust camera if needed (keep minimal change per plan)
        // Intentionally left light-touch: camera stays, uniform scale drives on-screen width
    }

    private recalculateAndApplyScale(): void {
        const s = this.calculateMobileScale();
        this.applyMobileScale(s);
    }

    private handleMobileResize(): void {
        // Recompute scale on viewport changes
        this.recalculateAndApplyScale();
        this.applyMobileFonts();
    }

    public destroy(): void {
        // Remove listeners and reset scale, then let parent clean up
        if (this.boundResize) window.removeEventListener('resize', this.boundResize);
        // Best-effort restore scene add/remove if we patched them
        const scene: THREE.Scene | undefined = (this as any).scene;
        if (scene && (scene as any).__origAdd && (scene as any).__origRemove) {
            (scene as any).add = (scene as any).__origAdd;
            (scene as any).remove = (scene as any).__origRemove;
            delete (scene as any).__origAdd;
            delete (scene as any).__origRemove;
        }
        super.destroy();
    }

    // Compute mobile font sizes so the longest stage word ("TRANSFORM") fits ~90% of viewport width
    // and dispatch results for both the title words and the company name.
    private applyMobileFonts(): void {
        const vw = Math.max(1, window.innerWidth || 0);
        const target = vw * 0.9;
        const word = 'TRANSFORM';
        const chars = word.length;

        // Use a canvas context to measure text width accurately.
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Maintain look by treating original letter-spacing ratios as proportional to font size:
        // company main: 0.5rem at 4rem -> 0.125em
        const letterSpacingRatioCompany = 0.125; // px per px of font-size
        // stage/subtitle: 0.35rem at 1.25rem -> 0.28em
        const letterSpacingRatioSubtitle = 0.28;

        // Binary search font size (px) to fit target including letter-spacing contribution
        const fits = (sizePx: number, ratio: number) => {
            ctx.font = `300 ${sizePx}px Arial`;
            const textWidth = ctx.measureText(word).width;
            const lsPx = ratio * sizePx;
            const total = textWidth + Math.max(0, chars - 1) * lsPx;
            return total <= target;
        };

        const findSize = (ratio: number) => {
            let lo = 14; // min
            let hi = 128; // max
            for (let i = 0; i < 18; i++) { // enough iterations for px precision
                const mid = (lo + hi) / 2;
                if (fits(mid, ratio)) lo = mid; else hi = mid;
            }
            return Math.floor(lo);
        };

        const sizeCompanyPx = findSize(letterSpacingRatioCompany);
        const sizeTitlePx = sizeCompanyPx; // same per requirement

        try { window.dispatchEvent(new CustomEvent('mobileCompanyFontSize', { detail: { fontSizePx: sizeCompanyPx } })); } catch { }
        try { window.dispatchEvent(new CustomEvent('mobileTitleFontSize', { detail: { fontSizePx: sizeTitlePx } })); } catch { }
    }
}

