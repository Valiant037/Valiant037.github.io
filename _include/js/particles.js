/**
 * Three.js Grid Particles + GPU Stable Fluid with Water Refraction
 *
 * The fluid simulation produces a velocity field from mouse movement.
 * Instead of rendering colored dye, the velocity field drives a water-surface
 * refraction effect that distorts the background through the canvas.
 *
 * Layer 1: Fluid refraction overlay (distorts background like water ripples)
 * Layer 2: 5000+ grid particles displaced by mouse with spring physics
 */
(function () {
    'use strict';

    if (typeof THREE === 'undefined') return;

    /* ============================================================
       CONFIGURATION
    ============================================================ */
    var CONFIG = {
        // Fluid
        fluidRes: 128,
        viscosity: 0.3,
        pressureIterations: 20,
        splatRadius: 0.004,
        splatForce: 3000,

        // Particles
        particleSize: 2.5,
        mouseRadius: 150,
        mouseStrength: 60,
        springStiffness: 0.03,
        damping: 0.85,

        // Colors
        goldR: 219 / 255,
        goldG: 207 / 255,
        goldB: 127 / 255
    };

    /* ============================================================
       SHARED GLSL
    ============================================================ */
    var GLSL_VERT = [
        'varying vec2 vUv;',
        'void main() {',
        '    vUv = uv;',
        '    gl_Position = vec4(position, 1.0);',
        '}'
    ].join('\n');

    /* ============================================================
       FLUID SHADERS
    ============================================================ */

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

    // Water refraction display — uses velocity field to create ripple distortion
    var refractionFrag = [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D uVelocity;',
        'uniform vec2 texelSize;',
        '',
        'void main() {',
        '    vec2 vel = texture2D(uVelocity, vUv).xy;',
        '    float speed = length(vel);',
        '',
        '    // Compute "normals" from velocity gradient for surface lighting',
        '    float vL = length(texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).xy);',
        '    float vR = length(texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).xy);',
        '    float vB = length(texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).xy);',
        '    float vT = length(texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).xy);',
        '',
        '    // Surface normal from height differences',
        '    vec3 normal = normalize(vec3((vL - vR) * 8.0, (vB - vT) * 8.0, 1.0));',
        '',
        '    // Light direction (from top-left)',
        '    vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));',
        '    float diffuse = max(dot(normal, lightDir), 0.0);',
        '',
        '    // Specular highlight (water glint)',
        '    vec3 viewDir = vec3(0.0, 0.0, 1.0);',
        '    vec3 halfDir = normalize(lightDir + viewDir);',
        '    float spec = pow(max(dot(normal, halfDir), 0.0), 40.0);',
        '',
        '    // Edge highlight (Fresnel-like)',
        '    float fresnel = 1.0 - abs(normal.z);',
        '    fresnel = pow(fresnel, 3.0);',
        '',
        '    // Ripple intensity',
        '    float ripple = smoothstep(0.0, 0.5, speed);',
        '',
        '    // Gold-tinted water refraction',
        '    vec3 goldTint = vec3(0.86, 0.81, 0.50);',
        '    vec3 highlight = vec3(1.0, 0.98, 0.92);',
        '',
        '    // Combine: subtle colored caustics + bright specular glints',
        '    vec3 color = goldTint * diffuse * 0.15 + highlight * spec * 0.5;',
        '    color += goldTint * fresnel * 0.1;',
        '',
        '    // Chromatic-like edge shift from velocity direction',
        '    color += vec3(vel.x, vel.y * 0.5, -vel.x) * 0.05;',
        '',
        '    float alpha = ripple * 0.6 + spec * 0.4 + fresnel * 0.15;',
        '    alpha = clamp(alpha, 0.0, 0.7);',
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

    var particleField, gridPositions, currentOffsets, velocities, particleCount;

    var mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, dx: 0, dy: 0 };
    var mouseNorm = { x: 0, y: 0 };
    var isMouseOver = false;

    /* ============================================================
       DOUBLE BUFFER
    ============================================================ */
    function createDoubleFBO(w, h) {
        var params = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            stencilBuffer: false,
            depthBuffer: false
        };
        return {
            read: new THREE.WebGLRenderTarget(w, h, params),
            write: new THREE.WebGLRenderTarget(w, h, params),
            swap: function () {
                var tmp = this.read;
                this.read = this.write;
                this.write = tmp;
            }
        };
    }

    function createFBO(w, h) {
        return new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            stencilBuffer: false,
            depthBuffer: false
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

        // Renderer
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
        renderer.setPixelRatio(1);
        renderer.setSize(W, H);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        renderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;' +
            'pointer-events:none;z-index:0;';
        container.appendChild(renderer.domElement);

        fluidScene = new THREE.Scene();
        fluidCamera = new THREE.Camera();

        particleScene = new THREE.Scene();
        particleCamera = new THREE.OrthographicCamera(
            -W / 2, W / 2, H / 2, -H / 2, 1, 1000
        );
        particleCamera.position.z = 500;

        // FBOs
        var simRes = CONFIG.fluidRes;
        velocity = createDoubleFBO(simRes, simRes);
        pressure = createDoubleFBO(simRes, simRes);
        divergenceFBO = createFBO(simRes, simRes);

        var texel = new THREE.Vector2(1.0 / simRes, 1.0 / simRes);

        advectMat = createMaterial(advectFrag, {
            uVelocity: { value: null },
            uSource: { value: null },
            dt: { value: 0.016 },
            texelSize: { value: texel },
            dissipation: { value: 0.97 }
        });

        divergenceMat = createMaterial(divergenceFrag, {
            uVelocity: { value: null },
            texelSize: { value: texel }
        });

        pressureMat = createMaterial(pressureFrag, {
            uPressure: { value: null },
            uDivergence: { value: null },
            texelSize: { value: texel }
        });

        gradientMat = createMaterial(gradientFrag, {
            uPressure: { value: null },
            uVelocity: { value: null },
            texelSize: { value: texel }
        });

        splatMat = createMaterial(splatFrag, {
            uTarget: { value: null },
            point: { value: new THREE.Vector2() },
            color: { value: new THREE.Vector3() },
            radius: { value: CONFIG.splatRadius },
            aspectRatio: { value: W / H }
        });

        clearMat = createMaterial(clearFrag, {
            uTexture: { value: null },
            value: { value: 0.8 }
        });

        refractionMat = createMaterial(refractionFrag, {
            uVelocity: { value: null },
            texelSize: { value: texel }
        });
        refractionMat.transparent = true;
        refractionMat.blending = THREE.NormalBlending;

        createParticles(W, H);

        container.addEventListener('mousemove', onMouseMove);
        container.addEventListener('mouseleave', onMouseLeave);
        container.addEventListener('mouseenter', onMouseEnter);
        window.addEventListener('resize', onResize);

        animate();
    }

    function createMaterial(frag, uniforms) {
        return new THREE.ShaderMaterial({
            vertexShader: GLSL_VERT,
            fragmentShader: frag,
            uniforms: uniforms,
            depthTest: false,
            depthWrite: false
        });
    }

    /* ============================================================
       PARTICLE GRID
    ============================================================ */
    function createParticles(W, H) {
        var spacing = Math.floor(Math.sqrt((W * H) / 5000));
        if (spacing < 10) spacing = 10;

        var cols = Math.ceil(W / spacing) + 1;
        var rows = Math.ceil(H / spacing) + 1;
        particleCount = cols * rows;

        var offsetX = -W / 2;
        var offsetY = -H / 2;

        gridPositions = new Float32Array(particleCount * 2);
        currentOffsets = new Float32Array(particleCount * 2);
        velocities = new Float32Array(particleCount * 2);

        var positions = new Float32Array(particleCount * 3);
        var colors = new Float32Array(particleCount * 3);
        var sizes = new Float32Array(particleCount);

        var idx = 0;
        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
                var px = col * spacing + offsetX;
                var py = row * spacing + offsetY;

                gridPositions[idx * 2] = px;
                gridPositions[idx * 2 + 1] = py;

                positions[idx * 3] = px;
                positions[idx * 3 + 1] = -py;
                positions[idx * 3 + 2] = 0;

                var variation = 0.85 + Math.random() * 0.3;
                if (Math.random() > 0.85) {
                    colors[idx * 3] = 0.9 + Math.random() * 0.1;
                    colors[idx * 3 + 1] = 0.9 + Math.random() * 0.1;
                    colors[idx * 3 + 2] = 0.85 + Math.random() * 0.15;
                } else {
                    colors[idx * 3] = CONFIG.goldR * variation;
                    colors[idx * 3 + 1] = CONFIG.goldG * variation;
                    colors[idx * 3 + 2] = CONFIG.goldB * variation;
                }

                sizes[idx] = CONFIG.particleSize * (0.7 + Math.random() * 0.6);
                idx++;
            }
        }

        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        var material = new THREE.ShaderMaterial({
            uniforms: {
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
                uResolution: { value: new THREE.Vector2(W, H) }
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
                'void main() {',
                '    float dist = length(gl_PointCoord - vec2(0.5));',
                '    if (dist > 0.5) discard;',
                '    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);',
                '',
                '    // Radial fade from center — large clear zone for hero text',
                '    float centerDist = length(vScreenPos);',
                '    float centerFade = smoothstep(0.35, 1.0, centerDist);',
                '    centerFade = mix(0.02, 0.7, centerFade);',
                '',
                '    gl_FragColor = vec4(vColor, alpha * 0.7 * centerFade);',
                '}'
            ].join('\n'),
            blending: THREE.AdditiveBlending,
            depthTest: false,
            transparent: true,
            vertexColors: true
        });

        particleField = new THREE.Points(geometry, material);
        particleScene.add(particleField);
    }

    /* ============================================================
       FLUID SIMULATION
    ============================================================ */
    function renderQuad(material, target) {
        var mesh = new THREE.Mesh(quadGeom, material);
        fluidScene.add(mesh);
        renderer.setRenderTarget(target);
        renderer.render(fluidScene, fluidCamera);
        fluidScene.remove(mesh);
        mesh.geometry = undefined;
    }

    function splatAtPoint(x, y, dx, dy) {
        var W = container.offsetWidth;
        var H = container.offsetHeight;

        splatMat.uniforms.uTarget.value = velocity.read.texture;
        splatMat.uniforms.point.value.set(x, y);
        splatMat.uniforms.color.value.set(dx * CONFIG.splatForce, dy * CONFIG.splatForce, 0);
        splatMat.uniforms.radius.value = CONFIG.splatRadius;
        splatMat.uniforms.aspectRatio.value = W / H;
        renderQuad(splatMat, velocity.write);
        velocity.swap();
    }

    function stepFluid(dt) {
        // 1. Advect velocity
        advectMat.uniforms.uVelocity.value = velocity.read.texture;
        advectMat.uniforms.uSource.value = velocity.read.texture;
        advectMat.uniforms.dt.value = dt;
        advectMat.uniforms.dissipation.value = 0.97;
        renderQuad(advectMat, velocity.write);
        velocity.swap();

        // 2. Divergence
        divergenceMat.uniforms.uVelocity.value = velocity.read.texture;
        renderQuad(divergenceMat, divergenceFBO);

        // 3. Clear pressure
        clearMat.uniforms.uTexture.value = pressure.read.texture;
        clearMat.uniforms.value.value = 0.8;
        renderQuad(clearMat, pressure.write);
        pressure.swap();

        // 4. Pressure solve
        pressureMat.uniforms.uDivergence.value = divergenceFBO.texture;
        for (var i = 0; i < CONFIG.pressureIterations; i++) {
            pressureMat.uniforms.uPressure.value = pressure.read.texture;
            renderQuad(pressureMat, pressure.write);
            pressure.swap();
        }

        // 5. Gradient subtraction
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
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;

        mouse.prevX = mouse.x;
        mouse.prevY = mouse.y;
        mouse.x = x;
        mouse.y = y;
        mouse.dx = (mouse.x - mouse.prevX) / container.offsetWidth;
        mouse.dy = -(mouse.y - mouse.prevY) / container.offsetHeight;

        mouseNorm.x = x / container.offsetWidth;
        mouseNorm.y = 1.0 - (y / container.offsetHeight);
    }

    function onMouseEnter() { isMouseOver = true; }
    function onMouseLeave() {
        isMouseOver = false;
        mouse.x = -9999;
        mouse.y = -9999;
    }

    function onResize() {
        var W = container.offsetWidth;
        var H = container.offsetHeight;

        particleCamera.left = -W / 2;
        particleCamera.right = W / 2;
        particleCamera.top = H / 2;
        particleCamera.bottom = -H / 2;
        particleCamera.updateProjectionMatrix();

        renderer.setSize(W, H);
    }

    /* ============================================================
       ANIMATION LOOP
    ============================================================ */
    function animate() {
        requestAnimationFrame(animate);

        var dt = Math.min(clock.getDelta(), 0.016);

        // Fluid input
        if (isMouseOver && mouse.prevX > -9000) {
            var force = Math.sqrt(mouse.dx * mouse.dx + mouse.dy * mouse.dy);
            if (force > 0.0001) {
                splatAtPoint(mouseNorm.x, mouseNorm.y, mouse.dx, mouse.dy);
            }
        }
        stepFluid(dt);

        // Update particle positions (spring physics)
        var positions = particleField.geometry.attributes.position.array;
        var radius = CONFIG.mouseRadius;
        var radiusSq = radius * radius;
        var W = container.offsetWidth;
        var H = container.offsetHeight;

        var mWorldX = mouse.x - W / 2;
        var mWorldY = -(mouse.y - H / 2);

        for (var i = 0; i < particleCount; i++) {
            var i2 = i * 2;
            var i3 = i * 3;

            var origX = gridPositions[i2];
            var origY = gridPositions[i2 + 1];

            if (isMouseOver) {
                var pWorldX = origX + currentOffsets[i2];
                var pWorldY = -origY + currentOffsets[i2 + 1];

                var dx = pWorldX - mWorldX;
                var dy = pWorldY - mWorldY;
                var distSq = dx * dx + dy * dy;

                if (distSq < radiusSq && distSq > 0.1) {
                    var dist = Math.sqrt(distSq);
                    var f = (1 - dist / radius) * CONFIG.mouseStrength;
                    velocities[i2] += (dx / dist) * f * 0.05;
                    velocities[i2 + 1] += (dy / dist) * f * 0.05;
                }
            }

            velocities[i2] += -currentOffsets[i2] * CONFIG.springStiffness;
            velocities[i2 + 1] += -currentOffsets[i2 + 1] * CONFIG.springStiffness;

            velocities[i2] *= CONFIG.damping;
            velocities[i2 + 1] *= CONFIG.damping;

            currentOffsets[i2] += velocities[i2];
            currentOffsets[i2 + 1] += velocities[i2 + 1];

            positions[i3] = origX + currentOffsets[i2];
            positions[i3 + 1] = -origY + currentOffsets[i2 + 1];
        }

        particleField.geometry.attributes.position.needsUpdate = true;

        // --- Render ---
        renderer.setRenderTarget(null);
        renderer.clear();

        // Draw water refraction overlay
        refractionMat.uniforms.uVelocity.value = velocity.read.texture;
        var refractionMesh = new THREE.Mesh(quadGeom, refractionMat);
        fluidScene.add(refractionMesh);
        renderer.render(fluidScene, fluidCamera);
        fluidScene.remove(refractionMesh);

        // Draw particles on top
        renderer.render(particleScene, particleCamera);
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
