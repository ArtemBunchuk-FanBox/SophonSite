import * as THREE from 'three';

export function makePhong(color: number, shininess = 60, opacity = 1): THREE.MeshPhongMaterial {
    return new THREE.MeshPhongMaterial({ color, shininess, transparent: opacity < 1, opacity });
}
