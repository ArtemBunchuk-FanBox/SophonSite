import * as THREE from 'three';
import { Background } from './Background';
import { createGoreGeometry, lerp, easeInOutCubic } from './core/geometry';

export class BackgroundMobile extends Background {
    private mobileScaleGroup: THREE.Group | null = null;
    private targetScreenWidthRatio = 0.95;
    private boundResize?: () => void;
    // Font sizing config
    private fontTargetScreenWidthRatio = 1.1;
    private fontReferenceWord = 'TRANSFORM'; // Longest word to use as reference
    private fontMinSize = 24; // Increased minimum font size
    private fontMaxSize = 200; // Increased maximum font size
    private fontLetterSpacingRatio = 0.125; // Letter spacing as a ratio of font size (0.5rem/4rem = 0.125)

    // Track the last calculated font size for reuse
    private lastCalculatedFontSize = 0;
    private lastCalculatedSubtitleFontSize = 0;

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

        // Listen for stage text creation/updates and reapply font size
        window.addEventListener('stageTextCreated', this.handleStageTextEvent.bind(this));
        window.addEventListener('stageTextUpdated', this.handleStageTextEvent.bind(this));
    }

    /**
     * Handle stage text creation or update events
     */
    private handleStageTextEvent(): void {
        // Calculate the font size and apply to stage text
        const screenWidth = window.innerWidth;
        if (screenWidth <= 0) return;

        // Reuse calculated font size from last calculation or calculate new one
        // We're using the same font size for company name and stage text
        const fontSize = this.getCalculatedSubtitleFontSize();
        if (fontSize > 0) {
            this.applyFontSizeToStageText(fontSize);
        }
    }

    /**
     * Helper method to get the last calculated font size
     * or calculate a new one if needed
     */
    private getCalculatedSubtitleFontSize(): number {
        // Return the same font size as the main font size
        if (this.lastCalculatedFontSize > 0) {
            return this.lastCalculatedFontSize;
        }

        // Calculate from scratch
        const screenWidth = window.innerWidth;
        if (screenWidth <= 0) return 0;

        // Target width is 90% of screen width for text
        const targetWidth = screenWidth * this.fontTargetScreenWidthRatio;

        // Create canvas for text measurement
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 0;

        // Calculate font size
        const fontSize = this.calculateOptimalFontSize(ctx, targetWidth);

        // Store calculated value
        this.lastCalculatedFontSize = fontSize;

        return fontSize;
    }

    /**
     * Helper method to calculate optimal font size
     */
    private calculateOptimalFontSize(ctx: CanvasRenderingContext2D, targetWidth: number): number {
        // Configure font family and weight to match CompanyName styles
        const fontFamily = 'Arial, sans-serif';
        const fontWeight = '300';

        // Binary search to find optimal font size
        let minSize = this.fontMinSize;
        let maxSize = this.fontMaxSize;
        let fontSize = Math.floor((minSize + maxSize) / 2);
        let iterations = 0;
        const maxIterations = 10; // Prevent infinite loops

        // Account for letter spacing in measurement
        const letterSpacing = fontSize * this.fontLetterSpacingRatio;
        const referenceWord = this.fontReferenceWord;

        while (minSize <= maxSize && iterations < maxIterations) {
            // Set font with current size for measurement
            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

            // Measure text width
            const metrics = ctx.measureText(referenceWord);
            // Add letter spacing to the width (n-1 spaces between n characters)
            const totalWidth = metrics.width + (referenceWord.length - 1) * letterSpacing;

            if (Math.abs(totalWidth - targetWidth) < 2) {
                // Close enough, break early
                break;
            } else if (totalWidth > targetWidth) {
                // Too big, reduce size
                maxSize = fontSize - 1;
            } else {
                // Too small, increase size
                minSize = fontSize + 1;
            }

            // Update font size for next iteration
            fontSize = Math.floor((minSize + maxSize) / 2);
            iterations++;
        }

        // Apply clamping to ensure reasonable bounds
        return Math.max(this.fontMinSize, Math.min(this.fontMaxSize, fontSize));
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
        // Update font sizes
        this.applyMobileFonts();
    }

    /**
     * Calculate and apply optimal font sizes for mobile display
     * Uses canvas text measurement to find a font size where the longest word
     * fits within the target screen width ratio
     */
    private applyMobileFonts(): void {
        // Get current screen width
        const screenWidth = window.innerWidth;
        if (screenWidth <= 0) return;

        // Target width is 90% of screen width for text
        const targetWidth = screenWidth * this.fontTargetScreenWidthRatio;

        // Create canvas for text measurement
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate optimal font size
        const fontSize = this.calculateOptimalFontSize(ctx, targetWidth);

        // Store calculated value for later reuse
        this.lastCalculatedFontSize = fontSize;

        // Use the SAME font size for both company name and stage text
        this.lastCalculatedSubtitleFontSize = fontSize;

        // Dispatch events with calculated font sizes - both use the same size
        this.dispatchFontSizeEvent('mobileCompanyFontSize', fontSize);
        this.dispatchFontSizeEvent('mobileTitleFontSize', fontSize);

        // Also apply to any stage text elements created by Background
        this.applyFontSizeToStageText(fontSize);
    }

    /**
     * Apply calculated font size to stage text elements
     * (OBSERVE, RESEARCH, STRATEGY)
     */
    private applyFontSizeToStageText(fontSize?: number): void {
        // Use provided font size or get the last calculated one
        const textFontSize = fontSize ?? this.lastCalculatedFontSize;
        if (textFontSize <= 0) return;

        // Get access to the stage text element from Background 
        // Need to use 'any' type to access private property
        const stageTextEl = (this as any).stageTextEl as HTMLElement | null;
        const letterSpacingRatio = this.fontLetterSpacingRatio;

        if (stageTextEl) {
            stageTextEl.style.fontSize = `${textFontSize}px`;
            stageTextEl.style.letterSpacing = `${textFontSize * letterSpacingRatio}px`;

            // Also look for stage text in the DOM directly as a fallback
            const stageTextElements = document.querySelectorAll('.stage-text') as NodeListOf<HTMLElement>;
            stageTextElements.forEach(el => {
                if (el !== stageTextEl) {
                    el.style.fontSize = `${textFontSize}px`;
                    el.style.letterSpacing = `${textFontSize * letterSpacingRatio}px`;
                }
            });
        } else {
            // Try to find it in the DOM directly as a fallback
            const stageTextElements = document.querySelectorAll('.stage-text') as NodeListOf<HTMLElement>;
            stageTextElements.forEach(el => {
                el.style.fontSize = `${textFontSize}px`;
                el.style.letterSpacing = `${textFontSize * letterSpacingRatio}px`;
            });
        }
    }

    /**
     * Helper to dispatch a custom font size event
     */
    private dispatchFontSizeEvent(eventName: string, fontSize: number): void {
        const event = new CustomEvent(eventName, {
            detail: {
                fontSize: fontSize,
                letterSpacingRatio: this.fontLetterSpacingRatio
            },
            bubbles: true,
            cancelable: true
        });
        window.dispatchEvent(event);
    }

    public destroy(): void {
        // Remove listeners and reset scale, then let parent clean up
        if (this.boundResize) window.removeEventListener('resize', this.boundResize);

        // Remove stage text event listeners - store the bound function reference to properly remove
        const boundHandleStageTextEvent = this.handleStageTextEvent.bind(this);
        window.removeEventListener('stageTextCreated', boundHandleStageTextEvent);
        window.removeEventListener('stageTextUpdated', boundHandleStageTextEvent);

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
}

