import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/webxr/VRButton.js';

// 1. CONFIGURACIÓN DE LA ESCENA
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0); // Fondo gris claro

// 2. CÁMARA (Tus ojos)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
// Posición inicial estratégica para ver el plano de 400 unidades
camera.position.set(100, 50, 600); 

// 3. RENDERIZADOR CON SOPORTE VR
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true; // ACTIVAMOS VR
document.body.appendChild(renderer.domElement);

// Añadimos el botón de "Enter VR" al final del documento
document.body.appendChild(VRButton.createButton(renderer));

// 4. ILUMINACIÓN
const light = new THREE.AmbientLight(0xffffff, 0.8); 
scene.add(light);
const sun = new THREE.DirectionalLight(0xffffff, 0.5);
sun.position.set(200, 500, 200);
scene.add(sun);

// 5. CARGAR TU JSON (planograma (6).json)
fetch('./planograma (6).json')
    .then(res => res.json())
    .then(data => {
        data.elements.forEach(el => {
            // Calculamos dimensiones según tus coordenadas x1, y1, x2, y2
            const ancho = Math.abs(el.x2 - el.x1) || 2;
            const largo = Math.abs(el.y2 - el.y1) || 2;
            const altura = (el.type === 'wall') ? 30 : 5; // Paredes altas, objetos bajos

            const geo = new THREE.BoxGeometry(ancho, altura, largo);
            const color = (el.type === 'wall') ? 0x999999 : 0x00aaff;
            const mat = new THREE.MeshStandardMaterial({ color: color });
            const mesh = new THREE.Mesh(geo, mat);
            
            // Calculamos el centro para posicionar la pieza
            const posX = (el.x1 + el.x2) / 2;
            const posZ = (el.y1 + el.y2) / 2;
            
            mesh.position.set(posX, altura / 2, posZ);
            scene.add(mesh);
        });
    })
    .catch(err => console.error("Error cargando el JSON: ", err));

// 6. CONTROLES PARA PC (Teclado y Ratón)
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => {
    if (!renderer.xr.isPresenting) { // Solo bloquea el ratón si no estamos en VR
        controls.lock();
    }
});

const mover = { adelante: false, atras: false, izquierda: false, derecha: false };

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') mover.adelante = true;
    if (e.code === 'KeyS') mover.atras = true;
    if (e.code === 'KeyA') mover.izquierda = true;
    if (e.code === 'KeyD') mover.derecha = true;
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') mover.adelante = false;
    if (e.code === 'KeyS') mover.atras = false;
    if (e.code === 'KeyA') mover.izquierda = false;
    if (e.code === 'KeyD') mover.derecha = false;
});

// 7. BUCLE DE ANIMACIÓN (Especial para VR)
renderer.setAnimationLoop(() => {
    
    // Movimiento solo si el ratón está bloqueado (PC)
    if (controls.isLocked) {
        const velocidad = 3.0;
        if (mover.adelante) controls.moveForward(velocidad);
        if (mover.atras) controls.moveForward(-velocidad);
        if (mover.izquierda) controls.moveRight(-velocidad);
        if (mover.derecha) controls.moveRight(velocidad);
    }
    
    // Si estás en VR, la cámara se mueve con tu cabeza automáticamente
    renderer.render(scene, camera);
});

// Ajuste si cambias el tamaño de la ventana
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});