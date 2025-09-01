import * as THREE from 'three';

export type GridMode = 'rectangular' | 'minimal' | 'triangular' | 'radial';

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createGoreGeometry(
    goreIndex: number,
    unfoldProgress: number,
    sphereRadius: number,
    currentNumGores: number,
    transitionProgress: number,
    gridMode: GridMode
): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];
    const sphericalAngleStep = lerp(Math.PI * 2 / currentNumGores, Math.PI * 2 / 3, transitionProgress);
    const startAngle = goreIndex * sphericalAngleStep;
    const endAngle = (goreIndex + 1) * sphericalAngleStep;

    let latitudeSteps: number, longitudeSteps: number;
    if (gridMode === 'minimal') {
        latitudeSteps = 3;
        longitudeSteps = 2;
    } else if (gridMode === 'triangular') {
        latitudeSteps = 20;
        longitudeSteps = 10;
    } else if (gridMode === 'radial') {
        latitudeSteps = 12;
        longitudeSteps = 24;
    } else {
        latitudeSteps = 16;
        longitudeSteps = 8;
    }

    const meridionalDistance = Math.PI * sphereRadius;
    const flatYOffset = (-sphereRadius) - (-meridionalDistance / 2);
    const flatAngleStep = lerp(Math.PI * 2 / currentNumGores, Math.PI * 2 / 3, transitionProgress);

    for (let lat = 0; lat <= latitudeSteps; lat++) {
        for (let lon = 0; lon <= longitudeSteps; lon++) {
            const phi = (lat / latitudeSteps) * Math.PI;
            const theta = startAngle + (lon / longitudeSteps) * (endAngle - startAngle);

            const radius = Math.sin(phi);
            const x = sphereRadius * radius * Math.cos(theta);
            const y = sphereRadius * Math.cos(phi);
            const z = sphereRadius * radius * Math.sin(theta);

            const u = lon / longitudeSteps;
            const v = lat / latitudeSteps;

            const flatY = meridionalDistance * (0.5 - v) + flatYOffset;
            const maxWidth = flatAngleStep * sphereRadius;

            const latitudeFromEquator = Math.abs(phi - Math.PI / 2);
            const tapering = Math.cos(latitudeFromEquator);

            const edgeParameter = 2 * u - 1;
            const concavity = gridMode === 'minimal' ? 0.1 : 0.3;
            const concaveFactor = 1 - concavity * (1 - edgeParameter * edgeParameter);

            const currentWidth = maxWidth * tapering * concaveFactor;
            let flatX = edgeParameter * currentWidth / 2;
            let flatZ = 0;

            if (gridMode === 'radial') {
                const angle = (u - 0.5) * Math.PI;
                const ringRadius = (1 - v) * (currentWidth / 2) * tapering;
                flatX = Math.cos(angle) * ringRadius;
                flatZ = Math.sin(angle) * ringRadius;
            }

            const finalX = (1 - unfoldProgress) * x + unfoldProgress * flatX;
            const finalY = (1 - unfoldProgress) * y + unfoldProgress * flatY;
            const finalZ = (1 - unfoldProgress) * z + unfoldProgress * flatZ;

            const localY = finalY + sphereRadius;
            points.push(new THREE.Vector3(finalX, localY, finalZ));
        }
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    (geometry as any).userData = { latCount: latitudeSteps + 1, lonCount: longitudeSteps + 1 };

    const indices: number[] = [];
    for (let lat = 0; lat < latitudeSteps; lat++) {
        for (let lon = 0; lon < longitudeSteps; lon++) {
            const a = lat * (longitudeSteps + 1) + lon;
            const b = lat * (longitudeSteps + 1) + lon + 1;
            const c = (lat + 1) * (longitudeSteps + 1) + lon;
            const d = (lat + 1) * (longitudeSteps + 1) + lon + 1;

            if (gridMode === 'triangular') {
                if ((lat + lon) % 2 === 0) {
                    indices.push(a, b, c, b, d, c);
                } else {
                    indices.push(a, d, c, a, b, d);
                }
            } else {
                indices.push(a, b, d, a, d, c);
            }
        }
    }

    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function createGoreEdges(geometry: THREE.BufferGeometry, skipEdgeCreation: boolean): THREE.EdgesGeometry | null {
    if (skipEdgeCreation) return null;
    return new THREE.EdgesGeometry(geometry, 180);
}
