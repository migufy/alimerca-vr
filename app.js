import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/webxr/VRButton.js';

// ─────────────────────────────────────────────
// 1. ESCENA
// ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xddeeff);

// ─────────────────────────────────────────────
// 2. CÁMARA — centrada en el plano real (X: -62..205, Z: 49..403)
// ─────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(70, 10, 500);
camera.lookAt(70, 10, 220);

// ─────────────────────────────────────────────
// 3. RENDERIZADOR VR
// ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// ─────────────────────────────────────────────
// 4. ILUMINACIÓN
// ─────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.5);
sun.position.set(200, 500, 200);
scene.add(sun);

// ─────────────────────────────────────────────
// 5. SUELO
// ─────────────────────────────────────────────
const sueloGeo = new THREE.PlaneGeometry(600, 600);
const sueloMat = new THREE.MeshStandardMaterial({ color: 0xccccaa });
const suelo = new THREE.Mesh(sueloGeo, sueloMat);
suelo.rotation.x = -Math.PI / 2;
suelo.position.set(70, 0, 220);
scene.add(suelo);

// ─────────────────────────────────────────────
// 6. UTILIDADES DE TEXTURA
// ─────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();

/**
 * Carga una imagen y devuelve una Promise<HTMLImageElement | null>
 * Si no existe (404) devuelve null sin error en consola.
 */
function loadImageSilent(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * Carga todas las celdas de una cara: el{id}_{cara}_0_0.jpg, _0_1.jpg, ...
 * Devuelve array de HTMLImageElement (solo las que existen, en orden).
 * Para cara N/S esperamos máximo 1 imagen; para E/W probamos hasta 40.
 */
async function loadFaceCells(id, cara) {
    const maxCeldas = (cara === 'N' || cara === 'S') ? 1 : 40;
    const imgs = [];
    for (let i = 0; i < maxCeldas; i++) {
        const url = `./fotos/el${id}_${cara}_0_${i}.jpg`;
        const img = await loadImageSilent(url);
        if (!img) break; // en cuanto falla una, para (son consecutivas)
        imgs.push(img);
    }
    return imgs;
}

/**
 * Compone un array de imágenes en un canvas horizontal y devuelve una THREE.Texture.
 * Si no hay imágenes devuelve null.
 */
function stitchTexture(imgs) {
    if (!imgs || imgs.length === 0) return null;

    const cellH = 512; // altura estándar del canvas
    const cellW = Math.round(imgs[0].width * (cellH / imgs[0].height));
    const totalW = cellW * imgs.length;

    const canvas = document.createElement('canvas');
    canvas.width  = totalW;
    canvas.height = cellH;
    const ctx = canvas.getContext('2d');

    imgs.forEach((img, i) => {
        ctx.drawImage(img, i * cellW, 0, cellW, cellH);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

/**
 * Crea un material con textura si hay fotos, o color sólido si no.
 */
async function makeMaterial(id, cara, fallbackColor) {
    const imgs = await loadFaceCells(id, cara);
    const tex  = stitchTexture(imgs);
    if (tex) {
        return new THREE.MeshStandardMaterial({ map: tex });
    }
    return new THREE.MeshStandardMaterial({ color: fallbackColor });
}

// ─────────────────────────────────────────────
// 7. MATERIALES POR DEFECTO (sin foto)
// ─────────────────────────────────────────────
const MAT_TECHO  = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
const MAT_SUELO_OBJ = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });

/**
 * BoxGeometry tiene 6 caras en este orden:
 *   0: +X (Este/derecha)
 *   1: -X (Oeste/izquierda)
 *   2: +Y (techo)
 *   3: -Y (suelo del objeto)
 *   4: +Z (Sur — Z crece hacia el sur en Three.js cuando Y del plano 2D es Z)
 *   5: -Z (Norte)
 *
 * Para una góndola orientada N-S (largo en Z):
 *   caras largas → índices 0(E) y 1(W)
 *   caras cortas → índices 4(S) y 5(N)
 *
 * Para una góndola orientada E-W (largo en X):
 *   caras largas → índices 4(S) y 5(N)  [las que miran Z]
 *   caras cortas → índices 0(E) y 1(W)  [las que miran X]
 */

// ─────────────────────────────────────────────
// 8. CARGA DEL PLANOGRAMA
// ─────────────────────────────────────────────
fetch('./planograma.json')
    .then(res => res.json())
    .then(async data => {
        for (const el of data.elements) {

            let ancho = Math.abs(el.x2 - el.x1);  // dimensión en X
            let largo = Math.abs(el.y2 - el.y1);  // dimensión en Z (Y del plano 2D)

            // ── Alturas y color base por tipo ──
            let altura, colorBase;
            switch (el.type) {
                case 'wall':     altura = 28; colorBase = 0x888888; break;
                case 'gondola':  altura = 18; colorBase = 0x3399ff; break;
                case 'caja':     altura = 10; colorBase = 0xffaa00; break;
                case 'entrance': altura =  1; colorBase = 0x44dd44; break;
                default:         altura =  5; colorBase = 0xaaaaaa;
            }

            // ── Grosor mínimo para paredes (son segmentos) ──
            if (ancho < 0.5) ancho = 1.5;
            if (largo < 0.5) largo = 1.5;

            const geo = new THREE.BoxGeometry(ancho, altura, largo);
            const posX = (el.x1 + el.x2) / 2;
            const posZ = (el.y1 + el.y2) / 2;

            let mesh;

            // ── GÓNDOLAS: 6 materiales con texturas ──
            if (el.type === 'gondola') {
                // Determinamos orientación: ¿es más larga en Z o en X?
                const esNS = largo >= ancho; // largo en el eje Z → caras largas miran E/W

                let matE, matW, matN, matS;

                if (esNS) {
                    // Caras largas: E (índice 0) y W (índice 1)
                    // Caras cortas: S (índice 4) y N (índice 5)
                    [matE, matW, matN, matS] = await Promise.all([
                        makeMaterial(el.id, 'E', colorBase),
                        makeMaterial(el.id, 'W', colorBase),
                        makeMaterial(el.id, 'N', colorBase),
                        makeMaterial(el.id, 'S', colorBase),
                    ]);
                } else {
                    // Caras largas: N (índice 5) y S (índice 4)
                    // Caras cortas: E (índice 0) y W (índice 1)
                    [matE, matW, matN, matS] = await Promise.all([
                        makeMaterial(el.id, 'E', colorBase),
                        makeMaterial(el.id, 'W', colorBase),
                        makeMaterial(el.id, 'N', colorBase),
                        makeMaterial(el.id, 'S', colorBase),
                    ]);
                }

                // Orden BoxGeometry: [+X, -X, +Y, -Y, +Z, -Z] = [E, W, techo, suelo, S, N]
                const materiales = [matE, matW, MAT_TECHO, MAT_SUELO_OBJ, matS, matN];
                mesh = new THREE.Mesh(geo, materiales);

            // ── PAREDES: 1 cara interior con textura ──
            } else if (el.type === 'wall') {
                // Determinamos qué cara es la "interior" según orientación de la pared
                // Una pared E-W (largo en X, grosor en Z mínimo) → cara interior mira al Sur (+Z) o Norte (-Z)
                // Una pared N-S (largo en Z, grosor en X mínimo) → cara interior mira al Este (+X) o Oeste (-X)
                const esEW = ancho >= largo; // pared horizontal → caras interiores en Z

                let matInterior;
                if (esEW) {
                    // Probamos cara S primero, luego N
                    matInterior = await makeMaterial(el.id, 'S', colorBase);
                    if (!matInterior.map) {
                        matInterior = await makeMaterial(el.id, 'N', colorBase);
                    }
                } else {
                    // Probamos cara E primero, luego W
                    matInterior = await makeMaterial(el.id, 'E', colorBase);
                    if (!matInterior.map) {
                        matInterior = await makeMaterial(el.id, 'W', colorBase);
                    }
                }

                const matParedBase = new THREE.MeshStandardMaterial({ color: colorBase });
                // Orden: [E, W, techo, suelo, S, N]
                let materiales;
                if (esEW) {
                    // cara interior es S (índice 4) o N (índice 5)
                    materiales = [matParedBase, matParedBase, MAT_TECHO, MAT_SUELO_OBJ, matInterior, matParedBase];
                } else {
                    // cara interior es E (índice 0) o W (índice 1)
                    materiales = [matInterior, matParedBase, MAT_TECHO, MAT_SUELO_OBJ, matParedBase, matParedBase];
                }
                mesh = new THREE.Mesh(geo, materiales);

            // ── RESTO (cajas, entrada): material único ──
            } else {
                const mat = new THREE.MeshStandardMaterial({ color: colorBase });
                mesh = new THREE.Mesh(geo, mat);
            }

            mesh.position.set(posX, altura / 2, posZ);
            mesh.name = el.name || String(el.id);
            scene.add(mesh);
        }
    })
    .catch(err => console.error("Error cargando planograma.json:", err));

// ─────────────────────────────────────────────
// 9. CONTROLES PC (WASD + ratón)
// ─────────────────────────────────────────────
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => {
    if (!renderer.xr.isPresenting) controls.lock();
});

const mover = { adelante: false, atras: false, izquierda: false, derecha: false };
document.addEventListener('keydown', e => {
    if (e.code === 'KeyW') mover.adelante  = true;
    if (e.code === 'KeyS') mover.atras     = true;
    if (e.code === 'KeyA') mover.izquierda = true;
    if (e.code === 'KeyD') mover.derecha   = true;
});
document.addEventListener('keyup', e => {
    if (e.code === 'KeyW') mover.adelante  = false;
    if (e.code === 'KeyS') mover.atras     = false;
    if (e.code === 'KeyA') mover.izquierda = false;
    if (e.code === 'KeyD') mover.derecha   = false;
});

// ─────────────────────────────────────────────
// 10. BUCLE DE ANIMACIÓN
// ─────────────────────────────────────────────
renderer.setAnimationLoop(() => {
    if (controls.isLocked) {
        const vel = 2.0;
        if (mover.adelante)  controls.moveForward(vel);
        if (mover.atras)     controls.moveForward(-vel);
        if (mover.izquierda) controls.moveRight(-vel);
        if (mover.derecha)   controls.moveRight(vel);
    }
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
