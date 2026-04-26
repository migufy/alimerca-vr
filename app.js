import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/webxr/VRButton.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────
const ALTURA_GONDOLA = 18;   // unidades
const ALTURA_PARED   = 18;   // igual que góndola para coherencia visual
const ALTURA_CAJA    = 10;
const ALTURA_ENTRADA =  1;
const GROSOR_MIN     =  1.5; // grosor mínimo para paredes que son segmentos

// Altura de ojos = mitad de góndola, para ver bien los artículos
const ALTURA_OJOS = ALTURA_GONDOLA / 2;

// BoxGeometry — orden de caras:
//   0 = +X = Este     1 = -X = Oeste
//   2 = +Y = techo    3 = -Y = suelo objeto
//   4 = +Z = Sur      5 = -Z = Norte
const IDX_E = 0, IDX_W = 1, IDX_TOP = 2, IDX_BOT = 3, IDX_S = 4, IDX_N = 5;

// ─────────────────────────────────────────────────────────────────────────────
// 1. ESCENA
// ─────────────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xddeeff);

// ─────────────────────────────────────────────────────────────────────────────
// 2. CÁMARA
// ─────────────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(70, ALTURA_OJOS, 500);
camera.lookAt(70, ALTURA_OJOS, 220);

// ─────────────────────────────────────────────────────────────────────────────
// 3. RENDERIZADOR VR
// ─────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// ─────────────────────────────────────────────────────────────────────────────
// 4. ILUMINACIÓN
// ─────────────────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.5);
sun.position.set(200, 500, 200);
scene.add(sun);

// ─────────────────────────────────────────────────────────────────────────────
// 5. SUELO CON CUADRÍCULA 5x5u ≈ 500×500 mm
// ─────────────────────────────────────────────────────────────────────────────
const sueloCanvas = document.createElement('canvas');
sueloCanvas.width = sueloCanvas.height = 512;
const sCtx = sueloCanvas.getContext('2d');
sCtx.fillStyle   = '#d4d0b0';
sCtx.fillRect(0, 0, 512, 512);
sCtx.strokeStyle = '#b0ac8a';
sCtx.lineWidth   = 1.5;
// Una celda = 5u → canvas de 512px representa N celdas
// Usamos 512/5 = 102.4 px por celda de 5u, con repeat en la textura
const PX_PER_TILE = 512 / 5; // 102.4 px
for (let i = 0; i <= 512; i += PX_PER_TILE) {
    sCtx.beginPath(); sCtx.moveTo(i, 0);   sCtx.lineTo(i, 512); sCtx.stroke();
    sCtx.beginPath(); sCtx.moveTo(0, i);   sCtx.lineTo(512, i); sCtx.stroke();
}
const sueloTex = new THREE.CanvasTexture(sueloCanvas);
sueloTex.wrapS = sueloTex.wrapT = THREE.RepeatWrapping;
// El suelo mide 600u, cada tile 5u → 120 repeticiones
sueloTex.repeat.set(600 / 5, 600 / 5);

const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ map: sueloTex })
);
suelo.rotation.x = -Math.PI / 2;
suelo.position.set(70, 0, 220);
scene.add(suelo);

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATERIALES FIJOS
// ─────────────────────────────────────────────────────────────────────────────
const MAT_TECHO = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
const MAT_BASE  = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });

// ─────────────────────────────────────────────────────────────────────────────
// 7. UTILIDADES DE TEXTURA
// ─────────────────────────────────────────────────────────────────────────────

function loadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// Construye textura cosiendo las imágenes horizontalmente
function stitchTexture(imgs) {
    if (!imgs.length) return null;
    const H   = 512;
    const W   = Math.round(imgs[0].width * (H / imgs[0].height));
    const cvs = document.createElement('canvas');
    cvs.width  = W * imgs.length;
    cvs.height = H;
    const ctx  = cvs.getContext('2d');
    imgs.forEach((img, i) => ctx.drawImage(img, i * W, 0, W, H));
    const tex  = new THREE.CanvasTexture(cvs);
    tex.wrapS  = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

// Carga las celdas de una cara usando el mapa ya construido
// fotoMap: { "id_cara": [n0, n1, ...] }
async function buildFaceMaterial(fotoMap, id, cara, fallbackColor) {
    const key    = `${id}_${cara}`;
    const celdas = fotoMap[key];
    if (!celdas || !celdas.length) {
        return new THREE.MeshStandardMaterial({ color: fallbackColor });
    }
    const imgs = await Promise.all(
        celdas.map(n => loadImage(`./fotos/el${id}_${cara}_0_${n}.jpg`))
    );
    const tex = stitchTexture(imgs.filter(Boolean));
    return new THREE.MeshStandardMaterial(tex ? { map: tex } : { color: fallbackColor });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CONSTRUCCIÓN DEL MAPA DE FOTOS DESDE EL SERVIDOR
// Lee lista_fotos.txt y construye { "id_cara": [celdas] } automáticamente.
// Cuando añadas fotos nuevas no hay que tocar el código — solo actualizar lista_fotos.txt.
// ─────────────────────────────────────────────────────────────────────────────
async function buildFotoMap() {
    const fotoMap = {};
    try {
        const txt = await fetch('./lista_fotos.txt').then(r => r.text());
        for (const line of txt.split('\n')) {
            const f = line.trim();
            if (!f.endsWith('.jpg')) continue;
            // Formato: el{id}_{cara}_0_{celda}.jpg
            const m = f.match(/^el(\d+)_([NSEW])_0_(\d+)\.jpg$/);
            if (!m) continue;
            const [, id, cara, celda] = m;
            const key = `${id}_${cara}`;
            if (!fotoMap[key]) fotoMap[key] = [];
            fotoMap[key].push(parseInt(celda));
        }
        // Ordenar celdas numéricamente (el ls las devuelve en orden alfabético)
        for (const key of Object.keys(fotoMap)) {
            fotoMap[key].sort((a, b) => a - b);
        }
    } catch (e) {
        console.warn('No se pudo leer lista_fotos.txt, sin texturas:', e);
    }
    return fotoMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. CARGA DEL PLANOGRAMA
// ─────────────────────────────────────────────────────────────────────────────
async function buildScene() {
    const [planograma, fotoMap] = await Promise.all([
        fetch('./planograma.json').then(r => r.json()),
        buildFotoMap(),
    ]);

    // Calcular bordes reales de la tienda para determinar cara interior de paredes
    // (más robusto que usar un centro fijo)
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const el of planograma.elements) {
        xMin = Math.min(xMin, el.x1, el.x2);
        xMax = Math.max(xMax, el.x1, el.x2);
        zMin = Math.min(zMin, el.y1, el.y2);
        zMax = Math.max(zMax, el.y1, el.y2);
    }

    for (const el of planograma.elements) {

        let ancho = Math.abs(el.x2 - el.x1);
        let largo = Math.abs(el.y2 - el.y1);

        // Ignorar elementos punto (paredes 221/222/223 que son x1=x2 y y1=y2)
        if (ancho < 0.01 && largo < 0.01) continue;

        // Aplicar grosor mínimo a dimensiones de segmento
        if (ancho < 0.5) ancho = GROSOR_MIN;
        if (largo < 0.5) largo = GROSOR_MIN;

        const posX = (el.x1 + el.x2) / 2;
        const posZ = (el.y1 + el.y2) / 2;

        let altura, colorBase;
        switch (el.type) {
            case 'wall':     altura = ALTURA_PARED;   colorBase = 0x888888; break;
            case 'gondola':  altura = ALTURA_GONDOLA; colorBase = 0x3399ff; break;
            case 'caja':     altura = ALTURA_CAJA;    colorBase = 0xffaa00; break;
            case 'entrance': altura = ALTURA_ENTRADA; colorBase = 0x44dd44; break;
            default:         altura = 5;              colorBase = 0xaaaaaa;
        }

        const geo  = new THREE.BoxGeometry(ancho, altura, largo);
        const mats = new Array(6).fill(null); // 6 caras
        mats[IDX_TOP] = MAT_TECHO;
        mats[IDX_BOT] = MAT_BASE;
        let mesh;

        // ── GÓNDOLAS ────────────────────────────────────────────────────────
        if (el.type === 'gondola') {
            // Cargamos las 4 caras laterales con su foto o color fallback
            // El mapa ya sabe qué fotos existen — si no hay foto devuelve color sólido
            const [mE, mW, mN, mS] = await Promise.all([
                buildFaceMaterial(fotoMap, el.id, 'E', colorBase),
                buildFaceMaterial(fotoMap, el.id, 'W', colorBase),
                buildFaceMaterial(fotoMap, el.id, 'N', colorBase),
                buildFaceMaterial(fotoMap, el.id, 'S', colorBase),
            ]);
            mats[IDX_E] = mE;
            mats[IDX_W] = mW;
            mats[IDX_N] = mN;
            mats[IDX_S] = mS;
            mesh = new THREE.Mesh(geo, mats);

        // ── PAREDES ──────────────────────────────────────────────────────────
        // Todas las fotos de pared tienen sufijo _N_ en el fichero.
        // La cara interior se determina por distancia al borde más cercano de la tienda:
        // - Pared EW (horizontal): interior mira en Z → +Z(idx4) si está en borde norte, -Z(idx5) si en borde sur
        // - Pared NS (vertical):   interior mira en X → +X(idx0) si está en borde oeste, -X(idx1) si en borde este
        } else if (el.type === 'wall') {
            const mFoto = await buildFaceMaterial(fotoMap, el.id, 'N', colorBase);
            const mGris = new THREE.MeshStandardMaterial({ color: colorBase });
            const esEW  = ancho >= largo;

            // Rellenar todas las caras con gris primero
            mats[IDX_E] = mGris; mats[IDX_W] = mGris;
            mats[IDX_S] = mGris; mats[IDX_N] = mGris;

            if (esEW) {
                // Pared horizontal — cara interior mira en Z
                // Más cerca de zMin → borde norte → interior es +Z (Sur, idx4)
                // Más cerca de zMax → borde sur  → interior es -Z (Norte, idx5)
                const haciaNorte = (posZ - zMin) < (zMax - posZ);
                mats[haciaNorte ? IDX_S : IDX_N] = mFoto;
            } else {
                // Pared vertical — cara interior mira en X
                // Más cerca de xMin → borde oeste → interior es +X (Este, idx0)
                // Más cerca de xMax → borde este  → interior es -X (Oeste, idx1)
                const haciaOeste = (posX - xMin) < (xMax - posX);
                mats[haciaOeste ? IDX_E : IDX_W] = mFoto;
            }
            mesh = new THREE.Mesh(geo, mats);

        // ── RESTO (cajas, entrada, desconocidos) ─────────────────────────────
        } else {
            const m = new THREE.MeshStandardMaterial({ color: colorBase });
            mats[IDX_E] = mats[IDX_W] = mats[IDX_S] = mats[IDX_N] = m;
            mesh = new THREE.Mesh(geo, mats);
        }

        mesh.position.set(posX, altura / 2, posZ);
        mesh.name = el.name || String(el.id);
        scene.add(mesh);
    }
}

buildScene().catch(err => console.error('Error construyendo escena:', err));

// ─────────────────────────────────────────────────────────────────────────────
// 10. CONTROLES — cursores + ratón para girar
// ─────────────────────────────────────────────────────────────────────────────
const controls = new PointerLockControls(camera, document.body);

const info = document.createElement('div');
info.style.cssText = [
    'position:fixed','top:50%','left:50%',
    'transform:translate(-50%,-50%)',
    'background:rgba(0,0,0,0.65)','color:#fff',
    'padding:18px 28px','border-radius:10px',
    'font:16px/1.6 sans-serif','text-align:center',
    'pointer-events:none'
].join(';');
info.innerHTML = '<b>Clic para navegar</b><br>↑ ↓ ← → Mover &nbsp;|&nbsp; Ratón Girar<br><small>Esc para salir</small>';
document.body.appendChild(info);

controls.addEventListener('lock',   () => info.style.display = 'none');
controls.addEventListener('unlock', () => info.style.display = 'block');
document.addEventListener('click',  () => { if (!renderer.xr.isPresenting) controls.lock(); });

const mover = { adelante: false, atras: false, izq: false, der: false };
document.addEventListener('keydown', e => {
    if (e.code === 'ArrowUp')    mover.adelante = true;
    if (e.code === 'ArrowDown')  mover.atras    = true;
    if (e.code === 'ArrowLeft')  mover.izq      = true;
    if (e.code === 'ArrowRight') mover.der      = true;
});
document.addEventListener('keyup', e => {
    if (e.code === 'ArrowUp')    mover.adelante = false;
    if (e.code === 'ArrowDown')  mover.atras    = false;
    if (e.code === 'ArrowLeft')  mover.izq      = false;
    if (e.code === 'ArrowRight') mover.der      = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. BUCLE DE ANIMACIÓN
// ─────────────────────────────────────────────────────────────────────────────
renderer.setAnimationLoop(() => {
    if (controls.isLocked) {
        const v = 1.0;
        if (mover.adelante) controls.moveForward(v);
        if (mover.atras)    controls.moveForward(-v);
        if (mover.izq)      controls.moveRight(-v);
        if (mover.der)      controls.moveRight(v);
        controls.getObject().position.y = ALTURA_OJOS;
    }
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
