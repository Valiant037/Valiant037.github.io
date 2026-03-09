/**
 * pano-viewer.js
 * Self-contained 360° equirectangular image viewer.
 * Uses Three.js (loaded from CDN on first call) to render a WebGL sphere.
 *
 * Usage:  PanoViewer.open('path/to/360image.jpg', 'Optional title');
 */

var PanoViewer = (function () {
    'use strict';

    var THREE_CDN = 'https://unpkg.com/three@0.128.0/build/three.min.js';

    var state = {
        renderer: null,
        scene: null,
        camera: null,
        sphere: null,
        animId: null,
        isOpen: false,
        isDragging: false,
        prevX: 0,
        prevY: 0,
        lon: 0,       // horizontal angle
        lat: 0,       // vertical angle
        autoRotateTimer: null,
        autoRotating: true
    };

    /* ── DOM creation ─────────────────────────────────────────── */

    function buildModal() {
        if (document.getElementById('pano-modal')) return;

        var modal = document.createElement('div');
        modal.id = 'pano-modal';
        modal.innerHTML = [
            '<div id="pano-loading"><div class="pano-spinner"></div><span>Loading 360°…</span></div>',
            '<canvas id="pano-canvas"></canvas>',
            '<div class="pano-controls">',
            '  <span id="pano-title" class="pano-title-text"></span>',
            '  <div class="pano-btn-group">',
            '    <button id="pano-hint" class="pano-btn pano-hint-btn" title="Drag to explore">',
            '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.5"/></svg>',
            '      <span>Drag to rotate</span>',
            '    </button>',
            '    <button id="pano-fullscreen" class="pano-btn" title="Fullscreen">',
            '      <svg id="pano-fs-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
            '      <svg id="pano-fs-compress" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:none"><path d="M8 3v5H3M21 8h-5V3M16 21v-5h5M3 16h5v5"/></svg>',
            '    </button>',
            '    <button id="pano-close" class="pano-btn pano-close-btn" title="Close">',
            '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            '    </button>',
            '  </div>',
            '</div>'
        ].join('');

        document.body.appendChild(modal);

        /* Wire controls */
        document.getElementById('pano-close').addEventListener('click', close);
        document.getElementById('pano-fullscreen').addEventListener('click', toggleFullscreen);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && state.isOpen) close();
        });

        /* Pointer events on canvas */
        var canvas = document.getElementById('pano-canvas');
        canvas.addEventListener('mousedown', onPointerDown);
        canvas.addEventListener('mousemove', onPointerMove);
        canvas.addEventListener('mouseup', onPointerUp);
        canvas.addEventListener('mouseleave', onPointerUp);
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onPointerUp);

        /* Fullscreen change detection */
        document.addEventListener('fullscreenchange', onFSChange);
        document.addEventListener('webkitfullscreenchange', onFSChange);

        /* Hide the hint after first interaction */
        canvas.addEventListener('mousedown', hideHint, { once: true });
        canvas.addEventListener('touchstart', hideHint, { once: true, passive: true });
    }

    function hideHint() {
        var hint = document.getElementById('pano-hint');
        if (hint) hint.style.opacity = '0';
    }

    /* ── Three.js setup ───────────────────────────────────────── */

    function initThree() {
        var canvas = document.getElementById('pano-canvas');
        var w = window.innerWidth;
        var h = window.innerHeight;

        state.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        state.renderer.setPixelRatio(window.devicePixelRatio);
        state.renderer.setSize(w, h);

        state.scene = new THREE.Scene();

        state.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
        state.camera.position.set(0, 0, 0.01);

        var geo = new THREE.SphereGeometry(500, 64, 32);
        geo.scale(-1, 1, 1); // flip inside-out

        var mat = new THREE.MeshBasicMaterial({ map: null });
        state.sphere = new THREE.Mesh(geo, mat);
        state.scene.add(state.sphere);

        /* Handle window resize */
        window.addEventListener('resize', onResize);
    }

    function loadTexture(src, onLoaded) {
        var img = new Image();

        img.onload = function () {
            /* ── Draw into an offscreen canvas ──────────────────────────────
               new THREE.Texture(img) silently fails on file:// because WebGL
               blocks cross-origin textures even for local files.
               Drawing first to a canvas bypasses that restriction:
               CanvasTexture reads raw pixel data, no origin check applies.  */
            var maxSize = getWebGLMaxTextureSize();
            var w = img.naturalWidth;
            var h = img.naturalHeight;

            /* Scale down if image exceeds GPU texture limit (usually 4096–16384) */
            if (w > maxSize || h > maxSize) {
                var scale = Math.min(maxSize / w, maxSize / h);
                w = Math.floor(w * scale);
                h = Math.floor(h * scale);
            }

            var offscreen = document.createElement('canvas');
            offscreen.width = w;
            offscreen.height = h;
            offscreen.getContext('2d').drawImage(img, 0, 0, w, h);

            var tex = new THREE.CanvasTexture(offscreen);
            state.sphere.material.map = tex;
            state.sphere.material.needsUpdate = true;
            onLoaded();
        };

        img.onerror = function () {
            console.error('PanoViewer: failed to load image:', src);
            var loading = document.getElementById('pano-loading');
            if (loading) {
                loading.innerHTML =
                    '<span style="color:#e07070">Failed to load image. Check the file path.</span>';
            }
        };

        img.src = src;
    }

    /* Returns the WebGL maximum texture dimension, or 4096 as a safe fallback */
    function getWebGLMaxTextureSize() {
        try {
            var testCanvas = document.createElement('canvas');
            var gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
            if (gl) return gl.getParameter(gl.MAX_TEXTURE_SIZE);
        } catch (e) { /* ignore */ }
        return 4096;
    }


    /* ── Animation loop ───────────────────────────────────────── */

    function animate() {
        state.animId = requestAnimationFrame(animate);

        if (state.autoRotating && !state.isDragging) {
            state.lon += 0.04;
        }

        /* Clamp latitude */
        state.lat = Math.max(-85, Math.min(85, state.lat));

        var phi = THREE.MathUtils.degToRad(90 - state.lat);
        var theta = THREE.MathUtils.degToRad(state.lon);

        var target = new THREE.Vector3(
            500 * Math.sin(phi) * Math.cos(theta),
            500 * Math.cos(phi),
            500 * Math.sin(phi) * Math.sin(theta)
        );
        state.camera.lookAt(target);
        state.renderer.render(state.scene, state.camera);
    }

    /* ── Pointer / touch handlers ─────────────────────────────── */

    function onPointerDown(e) {
        state.isDragging = true;
        state.prevX = e.clientX;
        state.prevY = e.clientY;
        cancelAutoRotate();
    }

    function onPointerMove(e) {
        if (!state.isDragging) return;
        var dx = e.clientX - state.prevX;
        var dy = e.clientY - state.prevY;
        state.lon -= dx * 0.25;
        state.lat += dy * 0.25;
        state.prevX = e.clientX;
        state.prevY = e.clientY;
    }

    function onPointerUp() {
        state.isDragging = false;
        scheduleAutoRotate();
    }

    function onTouchStart(e) {
        e.preventDefault();
        var t = e.touches[0];
        state.isDragging = true;
        state.prevX = t.clientX;
        state.prevY = t.clientY;
        cancelAutoRotate();
    }

    function onTouchMove(e) {
        e.preventDefault();
        if (!state.isDragging) return;
        var t = e.touches[0];
        var dx = t.clientX - state.prevX;
        var dy = t.clientY - state.prevY;
        state.lon -= dx * 0.25;
        state.lat += dy * 0.25;
        state.prevX = t.clientX;
        state.prevY = t.clientY;
    }

    /* ── Auto-rotate helpers ──────────────────────────────────── */

    function cancelAutoRotate() {
        state.autoRotating = false;
        if (state.autoRotateTimer) clearTimeout(state.autoRotateTimer);
    }

    function scheduleAutoRotate() {
        if (state.autoRotateTimer) clearTimeout(state.autoRotateTimer);
        state.autoRotateTimer = setTimeout(function () {
            state.autoRotating = true;
        }, 2500);
    }

    /* ── Resize ───────────────────────────────────────────────── */

    function onResize() {
        if (!state.renderer) return;
        var w = window.innerWidth;
        var h = window.innerHeight;
        state.renderer.setSize(w, h);
        state.camera.aspect = w / h;
        state.camera.updateProjectionMatrix();
    }

    /* ── Fullscreen ───────────────────────────────────────────── */

    function toggleFullscreen() {
        var modal = document.getElementById('pano-modal');
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            (modal.requestFullscreen || modal.webkitRequestFullscreen).call(modal);
        } else {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
    }

    function onFSChange() {
        var isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
        document.getElementById('pano-fs-expand').style.display = isFS ? 'none' : 'inline';
        document.getElementById('pano-fs-compress').style.display = isFS ? 'inline' : 'none';
        onResize();
    }

    /* ── Three.js lazy-load ───────────────────────────────────── */

    function loadThreeThenRun(callback) {
        if (window.THREE) { callback(); return; }
        var s = document.createElement('script');
        s.src = THREE_CDN;
        s.onload = callback;
        s.onerror = function () {
            document.getElementById('pano-loading').innerHTML =
                '<span style="color:#e07070">Could not load 3D library. Check your connection.</span>';
        };
        document.head.appendChild(s);
    }

    /* ── Public API ───────────────────────────────────────────── */

    function open(imageSrc, title) {
        buildModal();

        var modal = document.getElementById('pano-modal');
        var loading = document.getElementById('pano-loading');
        var titleEl = document.getElementById('pano-title');
        var hint = document.getElementById('pano-hint');

        /* Reset state */
        state.lon = 0;
        state.lat = 0;
        state.autoRotating = true;
        if (state.autoRotateTimer) clearTimeout(state.autoRotateTimer);

        titleEl.textContent = title || '';
        if (hint) hint.style.opacity = '1';

        loading.style.display = 'flex';
        modal.classList.add('pano-modal-open');
        state.isOpen = true;
        document.body.style.overflow = 'hidden';

        loadThreeThenRun(function () {
            if (!state.renderer) {
                initThree();
            } else {
                onResize();
            }

            /* Clear previous texture */
            if (state.sphere.material.map) {
                state.sphere.material.map.dispose();
                state.sphere.material.map = null;
            }

            loadTexture(imageSrc, function () {
                loading.style.display = 'none';
            });

            if (state.animId) cancelAnimationFrame(state.animId);
            animate();
        });
    }

    function close() {
        var modal = document.getElementById('pano-modal');
        if (!modal) return;

        modal.classList.remove('pano-modal-open');
        state.isOpen = false;
        document.body.style.overflow = '';

        /* Exit fullscreen if active */
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }

        if (state.animId) {
            cancelAnimationFrame(state.animId);
            state.animId = null;
        }
    }

    return { open: open, close: close };
}());
