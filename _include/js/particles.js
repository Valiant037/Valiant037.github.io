/**
 * Three.js Grid Particles + GPU Stable Fluid with Water Refraction
 * + Live Settings UI Panel for real-time tweaking
 */
(function () {
    'use strict';

    if (typeof THREE === 'undefined') return;

    /* ---- Saved Color Presets ----
     *
     * "Rainbow" (original):
     *   goldTint:  vec3(0.86, 0.81, 0.50)
     *   highlight: vec3(1.0, 0.98, 0.92)
     *   chromatic: vec3(vel.x, vel.y * 0.5, -vel.x) * 0.05
     *   diffuse:   0.15
     *   specular:  0.5
     *   fresnel:   0.1
     *   alpha max: 0.7
     */

    /* ============================================================
       CONFIGURATION (live-editable via UI)
    ============================================================ */
    var CONFIG = {
        // Fluid
        fluidRes: 128,
        splatRadius: 0.007,
        splatForce: 3600,
        velocityDissipation: 1,
        pressureIterations: 5,

        // Refraction colors (0-1)
        tintR: 0.62, tintG: 0.46, tintB: 0,
        highlightR: 0.14, highlightG: 0.06, highlightB: 0,
        diffuseIntensity: 1,
        specularIntensity: 2,
        specularPower: 5,
        fresnelIntensity: 1,
        chromaticStrength: 0.02,
        normalStrength: 1,
        alphaMax: 1,

        // Particles
        particleSize: 2,
        mouseRadius: 260,
        mouseStrength: 60,
        springStiffness: 0.03,
        damping: 0.85,

        // Center fade
        fadeInner: 0.45,
        fadeOuter: 1.05,
        fadeMinAlpha: 0,
        fadeMaxAlpha: 1,

        // Show/hide UI
        showUI: false
    };

    /* ============================================================
       GLSL
    ============================================================ */
    var GLSL_VERT = [
        'varying vec2 vUv;',
        'void main() {',
        '    vUv = uv;',
        '    gl_Position = vec4(position, 1.0);',
        '}'
    ].join('\n');

    var advectFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uVelocity;',
        'uniform sampler2D uSource;',
        'uniform float dt;',
        'uniform vec2 texelSize;',
        'uniform float dissipation;',
        'void main() {',
        '    vec2 vel = texture2D(uVelocity, vUv).xy;',
        '    vec2 coord = vUv - vel * dt * texelSize;',
        '    gl_FragColor = dissipation * texture2D(uSource, coord);',
        '}'
    ].join('\n');

    var divergenceFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uVelocity;',
        'uniform vec2 texelSize;',
        'void main() {',
        '    float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).x;',
        '    float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).x;',
        '    float B = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).y;',
        '    float T = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).y;',
        '    float div = 0.5 * (R - L + T - B);',
        '    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);',
        '}'
    ].join('\n');

    var pressureFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uPressure;',
        'uniform sampler2D uDivergence;',
        'uniform vec2 texelSize;',
        'void main() {',
        '    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;',
        '    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;',
        '    float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;',
        '    float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;',
        '    float div = texture2D(uDivergence, vUv).x;',
        '    float p = (L + R + B + T - div) * 0.25;',
        '    gl_FragColor = vec4(p, p, 0.0, 1.0);',
        '}'
    ].join('\n');

    var gradientFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uPressure;',
        'uniform sampler2D uVelocity;',
        'uniform vec2 texelSize;',
        'void main() {',
        '    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;',
        '    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;',
        '    float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;',
        '    float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;',
        '    vec2 vel = texture2D(uVelocity, vUv).xy;',
        '    vel -= vec2(R - L, T - B) * 0.5;',
        '    gl_FragColor = vec4(vel, 0.0, 1.0);',
        '}'
    ].join('\n');

    var splatFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uTarget;',
        'uniform vec2 point;',
        'uniform vec3 color;',
        'uniform float radius;',
        'uniform float aspectRatio;',
        'void main() {',
        '    vec2 p = vUv - point;',
        '    p.x *= aspectRatio;',
        '    float d = dot(p, p);',
        '    vec3 splat = exp(-d / radius) * color;',
        '    vec3 base = texture2D(uTarget, vUv).xyz;',
        '    gl_FragColor = vec4(base + splat, 1.0);',
        '}'
    ].join('\n');

    var clearFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uTexture;',
        'uniform float value;',
        'void main() {',
        '    gl_FragColor = value * texture2D(uTexture, vUv);',
        '}'
    ].join('\n');

    // Refraction shader — all color/intensity values via uniforms
    var refractionFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uVelocity;',
        'uniform vec2 texelSize;',
        'uniform vec3 uTint;',
        'uniform vec3 uHighlight;',
        'uniform float uDiffuse;',
        'uniform float uSpecular;',
        'uniform float uSpecPow;',
        'uniform float uFresnel;',
        'uniform float uChromatic;',
        'uniform float uNormalStr;',
        'uniform float uAlphaMax;',
        '',
        'void main() {',
        '    vec2 vel = texture2D(uVelocity, vUv).xy;',
        '    float speed = length(vel);',
        '',
        '    float vL = length(texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).xy);',
        '    float vR = length(texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).xy);',
        '    float vB = length(texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).xy);',
        '    float vT = length(texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).xy);',
        '',
        '    vec3 normal = normalize(vec3((vL - vR) * uNormalStr, (vB - vT) * uNormalStr, 1.0));',
        '',
        '    vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));',
        '    float diffuse = max(dot(normal, lightDir), 0.0);',
        '',
        '    vec3 viewDir = vec3(0.0, 0.0, 1.0);',
        '    vec3 halfDir = normalize(lightDir + viewDir);',
        '    float spec = pow(max(dot(normal, halfDir), 0.0), uSpecPow);',
        '',
        '    float fresnel = 1.0 - abs(normal.z);',
        '    fresnel = pow(fresnel, 3.0);',
        '',
        '    float ripple = smoothstep(0.0, 0.5, speed);',
        '',
        '    vec3 color = uTint * diffuse * uDiffuse + uHighlight * spec * uSpecular;',
        '    color += uTint * fresnel * uFresnel;',
        '    color += vec3(vel.x, vel.y * 0.5, -vel.x) * uChromatic;',
        '',
        '    float alpha = ripple * 0.6 + spec * 0.4 + fresnel * 0.15;',
        '    alpha = clamp(alpha, 0.0, uAlphaMax);',
        '',
        '    gl_FragColor = vec4(color, alpha);',
        '}'
    ].join('\n');

    /* ============================================================
       GLOBALS
    ============================================================ */
    var container, renderer, fluidScene, particleScene;
    var fluidCamera, particleCamera;
    var clock = new THREE.Clock();

    var velocity, pressure, divergenceFBO;
    var quadGeom, advectMat, divergenceMat, pressureMat, gradientMat, splatMat, clearMat, refractionMat;

    var particleField, particleMat, gridPositions, currentOffsets, velocities, particleCount;

    var mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, dx: 0, dy: 0 };
    var mouseNorm = { x: 0, y: 0 };
    var isMouseOver = false;

    /* ============================================================
       DOUBLE BUFFER
    ============================================================ */
    function createDoubleFBO(w, h) {
        var params = {
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat, type: THREE.HalfFloatType,
            stencilBuffer: false, depthBuffer: false
        };
        return {
            read: new THREE.WebGLRenderTarget(w, h, params),
            write: new THREE.WebGLRenderTarget(w, h, params),
            swap: function () { var t = this.read; this.read = this.write; this.write = t; }
        };
    }

    function createFBO(w, h) {
        return new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat, type: THREE.HalfFloatType,
            stencilBuffer: false, depthBuffer: false
        });
    }

    /* ============================================================
       INIT
    ============================================================ */
    function init() {
        container = document.querySelector('.intro');
        if (!container) return;

        var cs = window.getComputedStyle(container);
        if (cs.position === 'static') container.style.position = 'relative';

        var W = container.offsetWidth;
        var H = container.offsetHeight;

        quadGeom = new THREE.PlaneGeometry(2, 2);

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
        renderer.setPixelRatio(1);
        renderer.setSize(W, H);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        renderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
        container.appendChild(renderer.domElement);

        fluidScene = new THREE.Scene();
        fluidCamera = new THREE.Camera();

        particleScene = new THREE.Scene();
        particleCamera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 1000);
        particleCamera.position.z = 500;

        var simRes = CONFIG.fluidRes;
        velocity = createDoubleFBO(simRes, simRes);
        pressure = createDoubleFBO(simRes, simRes);
        divergenceFBO = createFBO(simRes, simRes);

        var texel = new THREE.Vector2(1.0 / simRes, 1.0 / simRes);

        advectMat = makeMat(advectFrag, {
            uVelocity: { value: null }, uSource: { value: null },
            dt: { value: 0.016 }, texelSize: { value: texel }, dissipation: { value: 0.97 }
        });
        divergenceMat = makeMat(divergenceFrag, { uVelocity: { value: null }, texelSize: { value: texel } });
        pressureMat = makeMat(pressureFrag, { uPressure: { value: null }, uDivergence: { value: null }, texelSize: { value: texel } });
        gradientMat = makeMat(gradientFrag, { uPressure: { value: null }, uVelocity: { value: null }, texelSize: { value: texel } });
        splatMat = makeMat(splatFrag, {
            uTarget: { value: null }, point: { value: new THREE.Vector2() },
            color: { value: new THREE.Vector3() }, radius: { value: CONFIG.splatRadius }, aspectRatio: { value: W / H }
        });
        clearMat = makeMat(clearFrag, { uTexture: { value: null }, value: { value: 0.8 } });

        refractionMat = makeMat(refractionFrag, {
            uVelocity: { value: null }, texelSize: { value: texel },
            uTint: { value: new THREE.Vector3(CONFIG.tintR, CONFIG.tintG, CONFIG.tintB) },
            uHighlight: { value: new THREE.Vector3(CONFIG.highlightR, CONFIG.highlightG, CONFIG.highlightB) },
            uDiffuse: { value: CONFIG.diffuseIntensity },
            uSpecular: { value: CONFIG.specularIntensity },
            uSpecPow: { value: CONFIG.specularPower },
            uFresnel: { value: CONFIG.fresnelIntensity },
            uChromatic: { value: CONFIG.chromaticStrength },
            uNormalStr: { value: CONFIG.normalStrength },
            uAlphaMax: { value: CONFIG.alphaMax }
        });
        refractionMat.transparent = true;
        refractionMat.blending = THREE.NormalBlending;

        createParticles(W, H);
        // buildUI(); // Settings UI hidden — uncomment to re-enable

        container.addEventListener('mousemove', onMouseMove);
        container.addEventListener('mouseleave', onMouseLeave);
        container.addEventListener('mouseenter', onMouseEnter);
        container.addEventListener('touchstart', onTouchStart, { passive: false });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.addEventListener('touchend', onTouchEnd);
        window.addEventListener('resize', onResize);

        // Explicit scroll handler for scroll indicators inside the particle container
        // (anchor default behavior can be blocked by non-passive touch listeners on some Android browsers)
        var scrollLinks = container.querySelectorAll('.scroll-indicator');
        for (var i = 0; i < scrollLinks.length; i++) {
            (function (link) {
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    var targetId = link.getAttribute('href');
                    var target = document.querySelector(targetId);
                    if (target) target.scrollIntoView({ behavior: 'smooth' });
                });
            })(scrollLinks[i]);
        }

        animate();
    }

    function makeMat(frag, u) {
        return new THREE.ShaderMaterial({ vertexShader: GLSL_VERT, fragmentShader: frag, uniforms: u, depthTest: false, depthWrite: false });
    }

    /* ============================================================
       PARTICLES
    ============================================================ */
    function createParticles(W, H) {
        // Scale particle density & size relative to 1080p baseline
        var REF_WIDTH = 1920;
        var screenScale = Math.min(W / REF_WIDTH, 1.0); // 0..1, capped at 1

        // Grid: ~5000 particles at 1080p, scale down for smaller screens
        var targetCount = Math.round(5000 * Math.max(screenScale, 0.3));
        var spacing = Math.floor(Math.sqrt((W * H) / targetCount));
        if (spacing < 8) spacing = 8;
        var cols = Math.ceil(W / spacing) + 1;
        var rows = Math.ceil(H / spacing) + 1;
        particleCount = cols * rows;
        var oX = -W / 2, oY = -H / 2;

        gridPositions = new Float32Array(particleCount * 2);
        currentOffsets = new Float32Array(particleCount * 2);
        velocities = new Float32Array(particleCount * 2);
        var pos = new Float32Array(particleCount * 3);
        var col = new Float32Array(particleCount * 3);
        var siz = new Float32Array(particleCount);

        var idx = 0;
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var px = c * spacing + oX, py = r * spacing + oY;
                gridPositions[idx * 2] = px; gridPositions[idx * 2 + 1] = py;
                pos[idx * 3] = px; pos[idx * 3 + 1] = -py; pos[idx * 3 + 2] = 0;
                // All white
                col[idx * 3] = 1.0; col[idx * 3 + 1] = 1.0; col[idx * 3 + 2] = 1.0;
                var sizeScale = Math.max(screenScale, 0.35);
                siz[idx] = CONFIG.particleSize * sizeScale * (0.7 + Math.random() * 0.6);
                idx++;
            }
        }

        var geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geom.setAttribute('size', new THREE.BufferAttribute(siz, 1));

        particleMat = new THREE.ShaderMaterial({
            uniforms: {
                uPixelRatio: { value: 1 },
                uResolution: { value: new THREE.Vector2(W, H) },
                uFadeInner: { value: CONFIG.fadeInner },
                uFadeOuter: { value: CONFIG.fadeOuter },
                uFadeMin: { value: CONFIG.fadeMinAlpha },
                uFadeMax: { value: CONFIG.fadeMaxAlpha }
            },
            vertexShader: [
                'attribute float size;',
                'varying vec3 vColor;',
                'varying vec2 vScreenPos;',
                'uniform float uPixelRatio;',
                'uniform vec2 uResolution;',
                'void main() {',
                '    vColor = color;',
                '    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);',
                '    gl_PointSize = size * uPixelRatio;',
                '    gl_Position = projectionMatrix * mvPos;',
                '    vScreenPos = position.xy / (uResolution * 0.5);',
                '}'
            ].join('\n'),
            fragmentShader: [
                'varying vec3 vColor;',
                'varying vec2 vScreenPos;',
                'uniform float uFadeInner;',
                'uniform float uFadeOuter;',
                'uniform float uFadeMin;',
                'uniform float uFadeMax;',
                'void main() {',
                '    float dist = length(gl_PointCoord - vec2(0.5));',
                '    if (dist > 0.5) discard;',
                '    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);',
                '    float centerDist = length(vScreenPos);',
                '    float centerFade = smoothstep(uFadeInner, uFadeOuter, centerDist);',
                '    centerFade = mix(uFadeMin, uFadeMax, centerFade);',
                '    gl_FragColor = vec4(vColor, alpha * 0.7 * centerFade);',
                '}'
            ].join('\n'),
            blending: THREE.AdditiveBlending,
            depthTest: false, transparent: true, vertexColors: true
        });

        particleField = new THREE.Points(geom, particleMat);
        particleScene.add(particleField);
    }

    /* ============================================================
       FLUID SIM
    ============================================================ */
    function renderQuad(mat, target) {
        var m = new THREE.Mesh(quadGeom, mat);
        fluidScene.add(m);
        renderer.setRenderTarget(target);
        renderer.render(fluidScene, fluidCamera);
        fluidScene.remove(m);
        m.geometry = undefined;
    }

    function splatAtPoint(x, y, dx, dy) {
        var W = container.offsetWidth, H = container.offsetHeight;
        splatMat.uniforms.uTarget.value = velocity.read.texture;
        splatMat.uniforms.point.value.set(x, y);
        splatMat.uniforms.color.value.set(dx * CONFIG.splatForce, dy * CONFIG.splatForce, 0);
        splatMat.uniforms.radius.value = CONFIG.splatRadius;
        splatMat.uniforms.aspectRatio.value = W / H;
        renderQuad(splatMat, velocity.write);
        velocity.swap();
    }

    function stepFluid(dt) {
        advectMat.uniforms.uVelocity.value = velocity.read.texture;
        advectMat.uniforms.uSource.value = velocity.read.texture;
        advectMat.uniforms.dt.value = dt;
        advectMat.uniforms.dissipation.value = CONFIG.velocityDissipation;
        renderQuad(advectMat, velocity.write);
        velocity.swap();

        divergenceMat.uniforms.uVelocity.value = velocity.read.texture;
        renderQuad(divergenceMat, divergenceFBO);

        clearMat.uniforms.uTexture.value = pressure.read.texture;
        clearMat.uniforms.value.value = 0.8;
        renderQuad(clearMat, pressure.write);
        pressure.swap();

        pressureMat.uniforms.uDivergence.value = divergenceFBO.texture;
        for (var i = 0; i < CONFIG.pressureIterations; i++) {
            pressureMat.uniforms.uPressure.value = pressure.read.texture;
            renderQuad(pressureMat, pressure.write);
            pressure.swap();
        }

        gradientMat.uniforms.uPressure.value = pressure.read.texture;
        gradientMat.uniforms.uVelocity.value = velocity.read.texture;
        renderQuad(gradientMat, velocity.write);
        velocity.swap();
    }

    /* ============================================================
       EVENTS
    ============================================================ */
    function onMouseMove(e) {
        var rect = container.getBoundingClientRect();
        var x = e.clientX - rect.left, y = e.clientY - rect.top;
        mouse.prevX = mouse.x; mouse.prevY = mouse.y;
        mouse.x = x; mouse.y = y;
        mouse.dx = (mouse.x - mouse.prevX) / container.offsetWidth;
        mouse.dy = -(mouse.y - mouse.prevY) / container.offsetHeight;
        mouseNorm.x = x / container.offsetWidth;
        mouseNorm.y = 1.0 - (y / container.offsetHeight);
    }
    function onMouseEnter() { isMouseOver = true; }
    function onMouseLeave() { isMouseOver = false; mouse.x = -9999; mouse.y = -9999; }

    // Touch handlers — hold-to-interact pattern
    // Quick tap/swipe = normal page scroll; hold 300ms+ = particle interaction
    var touchHoldTimer = null;
    var touchActive = false; // true once hold threshold is met

    function onTouchStart(e) {
        if (e.target.closest('.scroll-indicator')) return;

        var touch = e.touches[0];
        var rect = container.getBoundingClientRect();
        var x = touch.clientX - rect.left, y = touch.clientY - rect.top;

        // Store initial position but don't activate yet
        mouse.x = x; mouse.y = y;
        mouse.prevX = x; mouse.prevY = y;
        mouse.dx = 0; mouse.dy = 0;
        mouseNorm.x = x / container.offsetWidth;
        mouseNorm.y = 1.0 - (y / container.offsetHeight);

        // Start hold timer — activate interaction after 300ms
        touchActive = false;
        touchHoldTimer = setTimeout(function () {
            touchActive = true;
            isMouseOver = true;
            // Visual feedback: subtle glow on canvas
            renderer.domElement.style.boxShadow = 'inset 0 0 30px rgba(219, 207, 127, 0.15)';
        }, 300);
    }

    function onTouchMove(e) {
        if (e.target.closest('.scroll-indicator')) return;

        if (!touchActive) {
            // Not yet holding — cancel timer if finger moved (it's a scroll/swipe)
            if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; }
            return; // let browser scroll normally
        }

        // Holding — interact with particles, block scroll
        e.preventDefault();
        var touch = e.touches[0];
        var rect = container.getBoundingClientRect();
        var x = touch.clientX - rect.left, y = touch.clientY - rect.top;
        mouse.prevX = mouse.x; mouse.prevY = mouse.y;
        mouse.x = x; mouse.y = y;
        mouse.dx = (mouse.x - mouse.prevX) / container.offsetWidth;
        mouse.dy = -(mouse.y - mouse.prevY) / container.offsetHeight;
        mouseNorm.x = x / container.offsetWidth;
        mouseNorm.y = 1.0 - (y / container.offsetHeight);
    }

    function onTouchEnd() {
        if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; }
        touchActive = false;
        isMouseOver = false;
        mouse.x = -9999; mouse.y = -9999;
        renderer.domElement.style.boxShadow = 'none';
    }

    function onResize() {
        var W = container.offsetWidth, H = container.offsetHeight;
        particleCamera.left = -W / 2; particleCamera.right = W / 2;
        particleCamera.top = H / 2; particleCamera.bottom = -H / 2;
        particleCamera.updateProjectionMatrix();
        renderer.setSize(W, H);
    }

    /* ============================================================
       ANIMATION
    ============================================================ */

    // Tint color animation state — all channels transition together
    // Cycle: 10s hold → 10s smooth transition → new color → repeat
    var tintAnim = {
        fromR: 0, fromG: 0, fromB: 0,
        toR: Math.random() * 0.5, toG: Math.random() * 0.5, toB: Math.random() * 0.5,
        phaseStart: 0
    };
    var TINT_HOLD = 10;
    var TINT_TRANSITION = 10;
    var TINT_CYCLE = TINT_HOLD + TINT_TRANSITION;

    function getAnimatedTint(elapsed) {
        var localTime = elapsed - tintAnim.phaseStart;

        // Advance cycles if needed
        while (localTime >= TINT_CYCLE) {
            tintAnim.fromR = tintAnim.toR;
            tintAnim.fromG = tintAnim.toG;
            tintAnim.fromB = tintAnim.toB;
            tintAnim.toR = Math.random() * 0.5;
            tintAnim.toG = Math.random() * 0.5;
            tintAnim.toB = Math.random() * 0.5;
            tintAnim.phaseStart += TINT_CYCLE;
            localTime = elapsed - tintAnim.phaseStart;
        }

        if (localTime < TINT_HOLD) {
            // Holding at current color
            return { r: tintAnim.fromR, g: tintAnim.fromG, b: tintAnim.fromB };
        } else {
            // Transitioning to next color
            var t = (localTime - TINT_HOLD) / TINT_TRANSITION;
            t = t * t * (3 - 2 * t); // smoothstep
            return {
                r: tintAnim.fromR + (tintAnim.toR - tintAnim.fromR) * t,
                g: tintAnim.fromG + (tintAnim.toG - tintAnim.fromG) * t,
                b: tintAnim.fromB + (tintAnim.toB - tintAnim.fromB) * t
            };
        }
    }

    // Highlight color animation state — same pattern as tint
    var highlightAnim = {
        fromR: 0, fromG: 0, fromB: 0,
        toR: Math.random() * 0.5, toG: Math.random() * 0.5, toB: Math.random() * 0.5,
        phaseStart: 0
    };

    function getAnimatedHighlight(elapsed) {
        var localTime = elapsed - highlightAnim.phaseStart;

        while (localTime >= TINT_CYCLE) {
            highlightAnim.fromR = highlightAnim.toR;
            highlightAnim.fromG = highlightAnim.toG;
            highlightAnim.fromB = highlightAnim.toB;
            highlightAnim.toR = Math.random() * 0.5;
            highlightAnim.toG = Math.random() * 0.5;
            highlightAnim.toB = Math.random() * 0.5;
            highlightAnim.phaseStart += TINT_CYCLE;
            localTime = elapsed - highlightAnim.phaseStart;
        }

        if (localTime < TINT_HOLD) {
            return { r: highlightAnim.fromR, g: highlightAnim.fromG, b: highlightAnim.fromB };
        } else {
            var t = (localTime - TINT_HOLD) / TINT_TRANSITION;
            t = t * t * (3 - 2 * t);
            return {
                r: highlightAnim.fromR + (highlightAnim.toR - highlightAnim.fromR) * t,
                g: highlightAnim.fromG + (highlightAnim.toG - highlightAnim.fromG) * t,
                b: highlightAnim.fromB + (highlightAnim.toB - highlightAnim.fromB) * t
            };
        }
    }

    function syncUniforms() {
        var elapsed = clock.getElapsedTime();

        // Animated tint color
        var tint = getAnimatedTint(elapsed);
        refractionMat.uniforms.uTint.value.set(tint.r, tint.g, tint.b);

        // Animated highlight color
        var hl = getAnimatedHighlight(elapsed);
        refractionMat.uniforms.uHighlight.value.set(hl.r, hl.g, hl.b);
        refractionMat.uniforms.uDiffuse.value = CONFIG.diffuseIntensity;
        refractionMat.uniforms.uSpecular.value = CONFIG.specularIntensity;
        refractionMat.uniforms.uSpecPow.value = CONFIG.specularPower;
        refractionMat.uniforms.uFresnel.value = CONFIG.fresnelIntensity;

        // Animated chromatic strength: 0.04 ↔ 0, 10s hold + 10s transition each
        // Total cycle: 40s (0.04 hold → transition → 0 hold → transition → repeat)
        var cycleDuration = 40; // seconds
        var phase = (elapsed % cycleDuration) / cycleDuration; // 0–1
        var chromatic;
        if (phase < 0.25) {
            // Hold at 0.04 (0–10s)
            chromatic = 0.04;
        } else if (phase < 0.5) {
            // Transition 0.04 → 0 (10–20s) with smooth ease
            var t = (phase - 0.25) / 0.25;
            t = t * t * (3 - 2 * t); // smoothstep
            chromatic = 0.04 * (1 - t);
        } else if (phase < 0.75) {
            // Hold at 0 (20–30s)
            chromatic = 0;
        } else {
            // Transition 0 → 0.04 (30–40s) with smooth ease
            var t2 = (phase - 0.75) / 0.25;
            t2 = t2 * t2 * (3 - 2 * t2); // smoothstep
            chromatic = t2 * 0.04;
        }
        refractionMat.uniforms.uChromatic.value = chromatic;
        refractionMat.uniforms.uNormalStr.value = CONFIG.normalStrength;
        refractionMat.uniforms.uAlphaMax.value = CONFIG.alphaMax;

        // Particle fade
        particleMat.uniforms.uFadeInner.value = CONFIG.fadeInner;
        particleMat.uniforms.uFadeOuter.value = CONFIG.fadeOuter;
        particleMat.uniforms.uFadeMin.value = CONFIG.fadeMinAlpha;
        particleMat.uniforms.uFadeMax.value = CONFIG.fadeMaxAlpha;
    }

    function animate() {
        requestAnimationFrame(animate);
        var dt = Math.min(clock.getDelta(), 0.016);

        syncUniforms();

        if (isMouseOver && mouse.prevX > -9000) {
            var force = Math.sqrt(mouse.dx * mouse.dx + mouse.dy * mouse.dy);
            if (force > 0.0001) splatAtPoint(mouseNorm.x, mouseNorm.y, mouse.dx, mouse.dy);
        }
        stepFluid(dt);

        // Particles
        var positions = particleField.geometry.attributes.position.array;
        var rad = CONFIG.mouseRadius, radSq = rad * rad;
        var W = container.offsetWidth, H = container.offsetHeight;
        var mWx = mouse.x - W / 2, mWy = -(mouse.y - H / 2);

        for (var i = 0; i < particleCount; i++) {
            var i2 = i * 2, i3 = i * 3;
            var ox = gridPositions[i2], oy = gridPositions[i2 + 1];

            if (isMouseOver) {
                var pwx = ox + currentOffsets[i2], pwy = -oy + currentOffsets[i2 + 1];
                var dx = pwx - mWx, dy = pwy - mWy, dSq = dx * dx + dy * dy;
                if (dSq < radSq && dSq > 0.1) {
                    var d = Math.sqrt(dSq), f = (1 - d / rad) * CONFIG.mouseStrength;
                    velocities[i2] += (dx / d) * f * 0.05;
                    velocities[i2 + 1] += (dy / d) * f * 0.05;
                }
            }
            velocities[i2] += -currentOffsets[i2] * CONFIG.springStiffness;
            velocities[i2 + 1] += -currentOffsets[i2 + 1] * CONFIG.springStiffness;
            velocities[i2] *= CONFIG.damping;
            velocities[i2 + 1] *= CONFIG.damping;
            currentOffsets[i2] += velocities[i2];
            currentOffsets[i2 + 1] += velocities[i2 + 1];
            positions[i3] = ox + currentOffsets[i2];
            positions[i3 + 1] = -oy + currentOffsets[i2 + 1];
        }
        particleField.geometry.attributes.position.needsUpdate = true;

        // Render
        renderer.setRenderTarget(null);
        renderer.clear();
        refractionMat.uniforms.uVelocity.value = velocity.read.texture;
        var rm = new THREE.Mesh(quadGeom, refractionMat);
        fluidScene.add(rm); renderer.render(fluidScene, fluidCamera); fluidScene.remove(rm);
        renderer.render(particleScene, particleCamera);
    }

    /* ============================================================
       SETTINGS UI PANEL
    ============================================================ */
    function buildUI() {
        var panel = document.createElement('div');
        panel.id = 'fx-settings-panel';
        panel.style.cssText = [
            'position:fixed;top:80px;left:0;z-index:9999;',
            'background:rgba(10,10,10,0.88);color:#ddd;',
            'font-family:Consolas,monospace;font-size:11px;',
            'padding:12px 14px;border-radius:0 8px 8px 0;',
            'max-height:calc(100vh - 100px);overflow-y:auto;',
            'width:260px;backdrop-filter:blur(8px);',
            'border:1px solid rgba(219,207,127,0.3);border-left:none;',
            'transition:transform 0.3s ease;',
            'scrollbar-width:thin;scrollbar-color:#555 transparent;'
        ].join('');

        var toggleBtn = document.createElement('button');
        toggleBtn.textContent = '⚙ FX';
        toggleBtn.style.cssText = [
            'position:fixed;top:80px;left:0;z-index:10000;',
            'background:rgba(10,10,10,0.85);color:#dbcf7f;',
            'border:1px solid rgba(219,207,127,0.4);border-left:none;',
            'padding:6px 10px;cursor:pointer;font-family:Consolas,monospace;',
            'font-size:12px;border-radius:0 6px 6px 0;'
        ].join('');

        var visible = false;
        panel.style.transform = 'translateX(-100%)';

        toggleBtn.addEventListener('click', function () {
            visible = !visible;
            panel.style.transform = visible ? 'translateX(0)' : 'translateX(-100%)';
            toggleBtn.style.left = visible ? '260px' : '0';
        });

        // Section helper
        function addSection(title) {
            var h = document.createElement('div');
            h.textContent = title;
            h.style.cssText = 'color:#dbcf7f;font-weight:bold;margin:10px 0 6px;font-size:12px;border-bottom:1px solid rgba(219,207,127,0.2);padding-bottom:3px;';
            panel.appendChild(h);
        }

        // Slider helper
        function addSlider(label, key, min, max, step) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;align-items:center;margin:3px 0;gap:6px;';

            var lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:0 0 110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

            var slider = document.createElement('input');
            slider.type = 'range';
            slider.min = min; slider.max = max; slider.step = step;
            slider.value = CONFIG[key];
            slider.style.cssText = 'flex:1;height:4px;accent-color:#dbcf7f;cursor:pointer;';

            var val = document.createElement('span');
            val.textContent = parseFloat(CONFIG[key]).toFixed(step < 0.01 ? 3 : 2);
            val.style.cssText = 'flex:0 0 42px;text-align:right;font-size:10px;color:#aaa;';

            slider.addEventListener('input', function () {
                CONFIG[key] = parseFloat(this.value);
                val.textContent = parseFloat(this.value).toFixed(step < 0.01 ? 3 : 2);
            });

            wrap.appendChild(lbl);
            wrap.appendChild(slider);
            wrap.appendChild(val);
            panel.appendChild(wrap);
        }

        // Export button helper
        function addExportBtn() {
            var btn = document.createElement('button');
            btn.textContent = '📋 Copy Current Settings';
            btn.style.cssText = 'width:100%;margin-top:10px;padding:6px;background:#dbcf7f;color:#111;border:none;border-radius:4px;cursor:pointer;font-family:Consolas,monospace;font-size:11px;font-weight:bold;';
            btn.addEventListener('click', function () {
                var keys = [
                    'splatRadius', 'splatForce', 'velocityDissipation', 'pressureIterations',
                    'tintR', 'tintG', 'tintB', 'highlightR', 'highlightG', 'highlightB',
                    'diffuseIntensity', 'specularIntensity', 'specularPower',
                    'fresnelIntensity', 'chromaticStrength', 'normalStrength', 'alphaMax',
                    'particleSize', 'mouseRadius', 'mouseStrength', 'springStiffness', 'damping',
                    'fadeInner', 'fadeOuter', 'fadeMinAlpha', 'fadeMaxAlpha'
                ];
                var out = '--- Current Settings ---\n';
                keys.forEach(function (k) { out += k + ': ' + CONFIG[k] + '\n'; });
                navigator.clipboard.writeText(out).then(function () {
                    btn.textContent = '✅ Copied!';
                    setTimeout(function () { btn.textContent = '📋 Copy Current Settings'; }, 1500);
                });
            });
            panel.appendChild(btn);
        }

        // Build sections
        var title = document.createElement('div');
        title.textContent = 'FX SETTINGS';
        title.style.cssText = 'font-size:14px;font-weight:bold;color:#dbcf7f;margin-bottom:8px;text-align:center;';
        panel.appendChild(title);

        addSection('🌊 Fluid Simulation');
        addSlider('Splat Radius', 'splatRadius', 0.001, 0.02, 0.001);
        addSlider('Splat Force', 'splatForce', 500, 10000, 100);
        addSlider('Vel Dissipation', 'velocityDissipation', 0.9, 1.0, 0.005);
        addSlider('Pressure Iters', 'pressureIterations', 5, 40, 1);

        addSection('💧 Refraction Colors');
        addSlider('Tint R', 'tintR', 0, 1, 0.01);
        addSlider('Tint G', 'tintG', 0, 1, 0.01);
        addSlider('Tint B', 'tintB', 0, 1, 0.01);
        addSlider('Highlight R', 'highlightR', 0, 1, 0.01);
        addSlider('Highlight G', 'highlightG', 0, 1, 0.01);
        addSlider('Highlight B', 'highlightB', 0, 1, 0.01);

        addSection('✨ Refraction Effect');
        addSlider('Diffuse', 'diffuseIntensity', 0, 1, 0.01);
        addSlider('Specular', 'specularIntensity', 0, 2, 0.01);
        addSlider('Spec Power', 'specularPower', 5, 100, 1);
        addSlider('Fresnel', 'fresnelIntensity', 0, 1, 0.01);
        addSlider('Chromatic', 'chromaticStrength', 0, 0.3, 0.005);
        addSlider('Normal Str', 'normalStrength', 1, 30, 0.5);
        addSlider('Alpha Max', 'alphaMax', 0, 1, 0.01);

        addSection('⬡ Particles');
        addSlider('Mouse Radius', 'mouseRadius', 50, 400, 5);
        addSlider('Mouse Strength', 'mouseStrength', 10, 200, 5);
        addSlider('Spring Stiff', 'springStiffness', 0.005, 0.1, 0.005);
        addSlider('Damping', 'damping', 0.7, 0.98, 0.01);

        addSection('🎯 Center Fade');
        addSlider('Fade Inner', 'fadeInner', 0, 1, 0.01);
        addSlider('Fade Outer', 'fadeOuter', 0.3, 2, 0.01);
        addSlider('Min Alpha', 'fadeMinAlpha', 0, 0.5, 0.01);
        addSlider('Max Alpha', 'fadeMaxAlpha', 0.1, 1, 0.01);

        addExportBtn();

        document.body.appendChild(panel);
        document.body.appendChild(toggleBtn);
    }

    /* ============================================================
       BOOTSTRAP
    ============================================================ */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
