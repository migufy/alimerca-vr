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
const ALTURA_OJOS = 17; // 1.7m escalado (el plano usa ~10 unidades = 1 metro aprox)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(70, ALTURA_OJOS, 500);
camera.lookAt(70, ALTURA_OJOS, 220);

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
 * Carga todas las celdas de una cara probando hasta 50 números en paralelo.
 * NO para en el primer hueco — carga todas las que existen (resuelve el211 que empieza en _0_10).
 */
async function loadFaceCells(id, cara) {
    const MAX = 50;
    const promises = [];
    for (let i = 0; i < MAX; i++) {
        promises.push(loadImageSilent(`./fotos/el${id}_${cara}_0_${i}.jpg`));
    }
    const results = await Promise.all(promises);
    return results.filter(img => img !== null);
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

            // ── PAREDES ──
            // Todas las fotos de pared se llaman _N_ independientemente de su orientación real.
            // El interior de la tienda está siempre en el lado que da hacia el centro (Z positivo
            // para paredes norte, X positivo para paredes oeste, etc.)
            // Mapeamos cada pared por su ID al índice de cara de BoxGeometry correcto:
            //   BoxGeometry orden: [0=+X(E), 1=-X(W), 2=+Y(techo), 3=-Y(suelo), 4=+Z(S), 5=-Z(N)]
            } else if (el.type === 'wall') {

                const matN = await makeMaterial(el.id, 'N', colorBase);
                const matBase = new THREE.MeshStandardMaterial({ color: colorBase });

                // Para saber qué cara del cubo es la "interior":
                // - Pared E-W (ancho >= largo): es horizontal, su cara interior mira hacia +Z o -Z
                //   Las paredes norte de la tienda (y1 pequeño) → interior mira +Z (índice 4)
                //   Las paredes sur de la tienda (y1 grande)  → interior mira -Z (índice 5)
                // - Pared N-S (largo > ancho): es vertical, su cara interior mira hacia +X o -X
                //   Las paredes oeste (x1 pequeño/negativo)  → interior mira +X (índice 0)
                //   Las paredes este (x1 grande)             → interior mira -X (índice 1)

                const esEW = ancho >= largo;
                const centroTiendaX = 70;   // centro aproximado del plano en X
                const centroTiendaZ = 220;  // centro aproximado del plano en Z

                let materiales;
                if (esEW) {
                    // Pared horizontal: cara interior mira en Z
                    const posZpared = (el.y1 + el.y2) / 2;
                    if (posZpared < centroTiendaZ) {
                        // Pared está al norte del centro → interior mira hacia +Z (índice 4)
                        materiales = [matBase, matBase, MAT_TECHO, MAT_SUELO_OBJ, matN, matBase];
                    } else {
                        // Pared está al sur del centro → interior mira hacia -Z (índice 5)
                        materiales = [matBase, matBase, MAT_TECHO, MAT_SUELO_OBJ, matBase, matN];
                    }
                } else {
                    // Pared vertical: cara interior mira en X
                    const posXpared = (el.x1 + el.x2) / 2;
                    if (posXpared < centroTiendaX) {
                        // Pared está al oeste del centro → interior mira hacia +X (índice 0)
                        materiales = [matN, matBase, MAT_TECHO, MAT_SUELO_OBJ, matBase, matBase];
                    } else {
                        // Pared está al este del centro → interior mira hacia -X (índice 1)
                        materiales = [matBase, matN, MAT_TECHO, MAT_SUELO_OBJ, matBase, matBase];
                    }
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

const mover = { adelante: false, atras: false, izquierda: false, derecha: false, girarIzq: false, girarDer: false };
document.addEventListener('keydown', e => {
    if (e.code === 'KeyW') mover.adelante   = true;
    if (e.code === 'KeyS') mover.atras      = true;
    if (e.code === 'KeyA') mover.izquierda  = true;
    if (e.code === 'KeyD') mover.derecha    = true;
    if (e.code === 'KeyQ') mover.girarIzq   = true;
    if (e.code === 'KeyE') mover.girarDer   = true;
});
document.addEventListener('keyup', e => {
    if (e.code === 'KeyW') mover.adelante   = false;
    if (e.code === 'KeyS') mover.atras      = false;
    if (e.code === 'KeyA') mover.izquierda  = false;
    if (e.code === 'KeyD') mover.derecha    = false;
    if (e.code === 'KeyQ') mover.girarIzq   = false;
    if (e.code === 'KeyE') mover.girarDer   = false;
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
        if (mover.girarIzq)  controls.getObject().rotation.y += 0.03;
        if (mover.girarDer)  controls.getObject().rotation.y -= 0.03;

        // Fijar altura de ojos — no puede subir ni bajar
        controls.getObject().position.y = ALTURA_OJOS;
    }
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
