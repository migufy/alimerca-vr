import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/webxr/VRButton.js';

// ─────────────────────────────────────────────
// 1. ESCENA
// ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xddeeff);

// ─────────────────────────────────────────────
// 2. CÁMARA
// Góndolas miden 18u → altura de ojos = 9u (mitad de góndola)
// ─────────────────────────────────────────────
const ALTURA_OJOS = 9;
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
// 5. SUELO CON CUADRÍCULA 5x5u (≈500x500mm)
// ─────────────────────────────────────────────
const GRID_SIZE = 600;
const TILE = 5;
const sueloCanvas = document.createElement('canvas');
sueloCanvas.width  = 512;
sueloCanvas.height = 512;
const sCtx = sueloCanvas.getContext('2d');
sCtx.fillStyle = '#d4d0b0';
sCtx.fillRect(0, 0, 512, 512);
sCtx.strokeStyle = '#b0ac8a';
sCtx.lineWidth = 2;
const paso = 512 / (GRID_SIZE / TILE);
for (let i = 0; i <= 512; i += paso) {
    sCtx.beginPath(); sCtx.moveTo(i, 0); sCtx.lineTo(i, 512); sCtx.stroke();
    sCtx.beginPath(); sCtx.moveTo(0, i); sCtx.lineTo(512, i); sCtx.stroke();
}
const sueloTex = new THREE.CanvasTexture(sueloCanvas);
sueloTex.wrapS = THREE.RepeatWrapping;
sueloTex.wrapT = THREE.RepeatWrapping;
sueloTex.repeat.set(GRID_SIZE / TILE, GRID_SIZE / TILE);
const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
    new THREE.MeshStandardMaterial({ map: sueloTex })
);
suelo.rotation.x = -Math.PI / 2;
suelo.position.set(70, 0, 220);
scene.add(suelo);

// ─────────────────────────────────────────────
// 6. UTILIDADES DE TEXTURA
// ─────────────────────────────────────────────

function loadImageSilent(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// Carga las 50 celdas posibles en paralelo — resuelve huecos (ej. el211 empieza en _0_10)
async function loadFaceCells(id, cara) {
    const results = await Promise.all(
        Array.from({length: 50}, (_, i) =>
            loadImageSilent(`./fotos/el${id}_${cara}_0_${i}.jpg`)
        )
    );
    return results.filter(img => img !== null);
}

function stitchTexture(imgs) {
    if (!imgs || imgs.length === 0) return null;
    const cellH = 512;
    const cellW = Math.round(imgs[0].width * (cellH / imgs[0].height));
    const canvas = document.createElement('canvas');
    canvas.width  = cellW * imgs.length;
    canvas.height = cellH;
    const ctx = canvas.getContext('2d');
    imgs.forEach((img, i) => ctx.drawImage(img, i * cellW, 0, cellW, cellH));
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

async function makeMaterial(id, cara, fallbackColor) {
    const imgs = await loadFaceCells(id, cara);
    const tex  = stitchTexture(imgs);
    return tex
        ? new THREE.MeshStandardMaterial({ map: tex })
        : new THREE.MeshStandardMaterial({ color: fallbackColor });
}

// ─────────────────────────────────────────────
// 7. MATERIALES FIJOS
// ─────────────────────────────────────────────
const MAT_TECHO     = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
const MAT_SUELO_OBJ = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });

// BoxGeometry orden de caras:
//   0=+X(E)  1=-X(W)  2=+Y(techo)  3=-Y(suelo)  4=+Z(S)  5=-Z(N)

// ─────────────────────────────────────────────
// 8. CARGA DEL PLANOGRAMA
// ─────────────────────────────────────────────
fetch('./planograma.json')
    .then(res => res.json())
    .then(async data => {

        const centroX = 70;
        const centroZ = 220;

        for (const el of data.elements) {

            let ancho = Math.abs(el.x2 - el.x1);
            let largo = Math.abs(el.y2 - el.y1);

            let altura, colorBase;
            switch (el.type) {
                case 'wall':     altura = 28; colorBase = 0x888888; break;
                case 'gondola':  altura = 18; colorBase = 0x3399ff; break;
                case 'caja':     altura = 10; colorBase = 0xffaa00; break;
                case 'entrance': altura =  1; colorBase = 0x44dd44; break;
                default:         altura =  5; colorBase = 0xaaaaaa;
            }

            if (ancho < 0.5) ancho = 1.5;
            if (largo < 0.5) largo = 1.5;

            const geo  = new THREE.BoxGeometry(ancho, altura, largo);
            const posX = (el.x1 + el.x2) / 2;
            const posZ = (el.y1 + el.y2) / 2;
            let mesh;

            // ── GÓNDOLAS ──────────────────────────────────
            if (el.type === 'gondola') {
                // Cargamos las 4 caras — las que no tienen fotos quedan en color sólido
                const [matE, matW, matN, matS] = await Promise.all([
                    makeMaterial(el.id, 'E', colorBase),
                    makeMaterial(el.id, 'W', colorBase),
                    makeMaterial(el.id, 'N', colorBase),
                    makeMaterial(el.id, 'S', colorBase),
                ]);
                // [+X=E, -X=W, +Y=techo, -Y=suelo, +Z=S, -Z=N]
                mesh = new THREE.Mesh(geo, [matE, matW, MAT_TECHO, MAT_SUELO_OBJ, matS, matN]);

            // ── PAREDES ───────────────────────────────────
            // Todos los ficheros de pared usan _N_ como nombre de cara.
            // La textura se asigna a la cara del cubo que mira al interior de la tienda.
            } else if (el.type === 'wall') {

                const matFoto = await makeMaterial(el.id, 'N', colorBase);
                const matBase = new THREE.MeshStandardMaterial({ color: colorBase });
                const esEW    = ancho >= largo;
                let materiales;

                if (esEW) {
                    // Pared horizontal: cara interior mira en Z
                    // Norte del centro → interior es +Z (índice 4)
                    // Sur  del centro → interior es -Z (índice 5)
                    if (posZ < centroZ) {
                        materiales = [matBase, matBase, MAT_TECHO, MAT_SUELO_OBJ, matFoto, matBase];
                    } else {
                        materiales = [matBase, matBase, MAT_TECHO, MAT_SUELO_OBJ, matBase, matFoto];
                    }
                } else {
                    // Pared vertical: cara interior mira en X
                    // Oeste del centro → interior es +X (índice 0)
                    // Este  del centro → interior es -X (índice 1)
                    if (posX < centroX) {
                        materiales = [matFoto, matBase, MAT_TECHO, MAT_SUELO_OBJ, matBase, matBase];
                    } else {
                        materiales = [matBase, matFoto, MAT_TECHO, MAT_SUELO_OBJ, matBase, matBase];
                    }
                }
                mesh = new THREE.Mesh(geo, materiales);

            // ── RESTO (cajas, entrada) ─────────────────────
            } else {
                mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colorBase }));
            }

            mesh.position.set(posX, altura / 2, posZ);
            mesh.name = el.name || String(el.id);
            scene.add(mesh);
        }
    })
    .catch(err => console.error("Error cargando planograma.json:", err));

// ─────────────────────────────────────────────
// 9. CONTROLES — cursores + ratón para girar
// ─────────────────────────────────────────────
const controls = new PointerLockControls(camera, document.body);

// Instrucciones en pantalla
const info = document.createElement('div');
info.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.6);color:white;padding:20px 30px;border-radius:10px;font-family:sans-serif;font-size:16px;text-align:center;pointer-events:none;';
info.innerHTML = '<b>Clic para navegar</b><br>↑↓←→ Mover &nbsp;|&nbsp; Ratón Girar';
document.body.appendChild(info);

controls.addEventListener('lock',   () => { info.style.display = 'none'; });
controls.addEventListener('unlock', () => { info.style.display = 'block'; });

document.addEventListener('click', () => {
    if (!renderer.xr.isPresenting) controls.lock();
});

const mover = { adelante: false, atras: false, izquierda: false, derecha: false };
document.addEventListener('keydown', e => {
    if (e.code === 'ArrowUp')    mover.adelante  = true;
    if (e.code === 'ArrowDown')  mover.atras     = true;
    if (e.code === 'ArrowLeft')  mover.izquierda = true;
    if (e.code === 'ArrowRight') mover.derecha   = true;
});
document.addEventListener('keyup', e => {
    if (e.code === 'ArrowUp')    mover.adelante  = false;
    if (e.code === 'ArrowDown')  mover.atras     = false;
    if (e.code === 'ArrowLeft')  mover.izquierda = false;
    if (e.code === 'ArrowRight') mover.derecha   = false;
});

// ─────────────────────────────────────────────
// 10. BUCLE DE ANIMACIÓN
// ─────────────────────────────────────────────
renderer.setAnimationLoop(() => {
    if (controls.isLocked) {
        const vel = 1.0;
        if (mover.adelante)  controls.moveForward(vel);
        if (mover.atras)     controls.moveForward(-vel);
        if (mover.izquierda) controls.moveRight(-vel);
        if (mover.derecha)   controls.moveRight(vel);

        // Altura de ojos fija a mitad de góndola
        controls.getObject().position.y = ALTURA_OJOS;
    }
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
