import * as THREE from 'three';

export function getEyePoints(si: number): THREE.Vector3[] {
    const segments = 64;
    const points: THREE.Vector3[] = [];
    if (si === 0) {
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = 4.5 * Math.cos(angle);
            const y = 0;
            const z = 1.5 * Math.sin(angle);
            points.push(new THREE.Vector3(x, y, z));
        }
    } else if (si === 1) {
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = 1.2 * Math.cos(angle);
            const y = 0;
            const z = 1.2 * Math.sin(angle);
            points.push(new THREE.Vector3(x, y, z));
        }
    } else {
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = 0.375 * Math.cos(angle);
            const y = 0;
            const z = 0.75 * Math.sin(angle);
            points.push(new THREE.Vector3(x, y, z));
        }
    }
    return points;
}

export type CircleOutlineParts = { core: THREE.Line; innerGlow: THREE.Line; outerGlow: THREE.Line; ultraGlow: THREE.Line; superGlow: THREE.Line };

export function createCircleOutline(
    si: number,
    sphereY: number,
    cfgRadius: number,
    eyeToCircleProgress: number,
    circleDrawProgress: number,
    unwrappingT: number
): CircleOutlineParts {
    const coreColor = 0xffffff;
    const innerGlowColor = 0xe6f6ff;
    const outerGlowColor = 0x9edfff;
    const ultraGlowColor = 0x4d94ff; // Softer blue for outer halo
    const superGlowColor = 0x1a4d7a; // Deeper blue for super halo

    const circleRadius = cfgRadius * 1.07;
    const circleSegments = 64;
    const eyePoints = getEyePoints(si);
    const circlePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= circleSegments; i++) {
        const angle = (i / circleSegments) * Math.PI * 2;
        const x = circleRadius * Math.cos(angle);
        const z = circleRadius * Math.sin(angle);
        circlePoints.push(new THREE.Vector3(x, 0, z));
    }
    const basePoints = eyePoints.map((eye, i) => eye.clone().lerp(circlePoints[i], eyeToCircleProgress));

    const circleY = sphereY;

    // Single core line with slight scale and high opacity for thickness
    const corePoints = basePoints.map(p => new THREE.Vector3(p.x * 1.01, p.y, p.z * 1.01));
    const coreGeometry = new THREE.BufferGeometry().setFromPoints(corePoints);
    const coreMaterial = new THREE.LineBasicMaterial({
        color: coreColor,
        transparent: true,
        opacity: 1.0 * circleDrawProgress,
        depthTest: false,
        depthWrite: false,
        linewidth: 4,
    });
    const coreLine = new THREE.Line(coreGeometry, coreMaterial);
    coreLine.position.set(0, circleY, 0);
    coreLine.rotation.x = Math.PI / 2;
    coreLine.renderOrder = 9999;

    // Inner glow with increased opacity
    const innerGlowPoints = basePoints.map(p => new THREE.Vector3(p.x * 1.02, p.y, p.z * 1.02));
    const innerGlowGeom = new THREE.BufferGeometry().setFromPoints(innerGlowPoints);
    const innerGlowMat = new THREE.LineBasicMaterial({
        color: innerGlowColor,
        transparent: true,
        opacity: 0.7 * circleDrawProgress, // Increased from 0.6
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        linewidth: 4,
    });
    const innerGlow = new THREE.Line(innerGlowGeom, innerGlowMat);
    innerGlow.position.set(0, circleY, 0);
    innerGlow.rotation.x = Math.PI / 2;
    innerGlow.renderOrder = 9998;

    // Outer glow with increased opacity
    const outerGlowPoints = basePoints.map(p => new THREE.Vector3(p.x * 1.04, p.y, p.z * 1.04));
    const outerGlowGeom = new THREE.BufferGeometry().setFromPoints(outerGlowPoints);
    const outerGlowMat = new THREE.LineBasicMaterial({
        color: outerGlowColor,
        transparent: true,
        opacity: 0.5 * circleDrawProgress, // Increased from 0.4
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        linewidth: 4,
    });
    const outerGlow = new THREE.Line(outerGlowGeom, outerGlowMat);
    outerGlow.position.set(0, circleY, 0);
    outerGlow.rotation.x = Math.PI / 2;
    outerGlow.renderOrder = 9997;

    // Ultra glow with increased opacity
    const ultraGlowPoints = basePoints.map(p => new THREE.Vector3(p.x * 1.06, p.y, p.z * 1.06));
    const ultraGlowGeom = new THREE.BufferGeometry().setFromPoints(ultraGlowPoints);
    const ultraGlowMat = new THREE.LineBasicMaterial({
        color: ultraGlowColor,
        transparent: true,
        opacity: 0.3 * circleDrawProgress, // Increased from 0.2
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        linewidth: 4,
    });
    const ultraGlow = new THREE.Line(ultraGlowGeom, ultraGlowMat);
    ultraGlow.position.set(0, circleY, 0);
    ultraGlow.rotation.x = Math.PI / 2;
    ultraGlow.renderOrder = 9996;

    // New super glow layer for enhanced outer halo
    const superGlowPoints = basePoints.map(p => new THREE.Vector3(p.x * 1.08, p.y, p.z * 1.08));
    const superGlowGeom = new THREE.BufferGeometry().setFromPoints(superGlowPoints);
    const superGlowMat = new THREE.LineBasicMaterial({
        color: superGlowColor,
        transparent: true,
        opacity: 0.25 * circleDrawProgress,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        linewidth: 4,
    });
    const superGlow = new THREE.Line(superGlowGeom, superGlowMat);
    superGlow.position.set(0, circleY, 0);
    superGlow.rotation.x = Math.PI / 2;
    superGlow.renderOrder = 9995;

    return { core: coreLine, innerGlow, outerGlow, ultraGlow, superGlow };
}