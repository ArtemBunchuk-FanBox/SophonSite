import * as THREE from 'three';

export type WireframeMode = 'none' | 'wireframe' | 'edges';
export type AnimationStep =
    | 'INITIAL_CIRCLES_MOVE'
    | 'FORMING_GORES'
    | 'UNWRAPPING'
    | 'HOLD_UNWRAPPED'
    | 'PAUSE_UNWRAPPED'
    | 'WRAPPING'
    | 'DEFORMING_GORES'
    | 'SHOW_COMPANY_NAME';

export type SphereConfig = { radius: number; colors: number[] };

export interface SceneRefs {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
}
