import * as THREE from 'three';

export function applyWireframeOverlay(target: THREE.Object3D, geometry: THREE.BufferGeometry): void {
    const wireGeom = new THREE.WireframeGeometry(geometry);
    const wireMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
    const wire = new THREE.LineSegments(wireGeom, wireMat);
    wire.renderOrder = 10;
    target.add(wire);
}

export function applyEdgeOverlay(target: THREE.Object3D, edges: THREE.EdgesGeometry | null): void {
    if (!edges) return;
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    const edgeLines = new THREE.LineSegments(edges, edgeMat);
    edgeLines.renderOrder = 9;
    target.add(edgeLines);
}

export function clearOverlays(obj: THREE.Object3D): void {
    while (obj.children.length > 0) {
        const c = obj.children[0];
        obj.remove(c);
        // Dispose
        // @ts-expect-error
        if (c.geometry) c.geometry.dispose();
        // @ts-expect-error
        if (c.material) {
            // @ts-expect-error
            const m = c.material;
            if (Array.isArray(m)) m.forEach(mm => mm.dispose()); else m.dispose();
        }
    }
}
