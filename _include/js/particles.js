/**
 * Interactive Particle Canvas
 * Abstract constellation effect that reacts to mouse movement.
 * Scoped to the .intro section only.
 */
(function () {
    'use strict';

    var canvas, ctx, particles, mouse, animId, container;
    var CONFIG = {
        particleCount: 80,
        particleMinSize: 1,
        particleMaxSize: 3,
        lineDistance: 150,
        mouseRadius: 200,
        mouseForce: 0.08,
        speed: 0.3,
        colors: [
            'rgba(219, 207, 127, 0.6)',  // gold
            'rgba(219, 207, 127, 0.3)',  // gold faint
            'rgba(255, 255, 255, 0.4)',  // white
            'rgba(255, 255, 255, 0.2)',  // white faint
        ],
        lineColor: 'rgba(219, 207, 127,',  // alpha appended dynamically
    };

    mouse = { x: -9999, y: -9999 };

    function init() {
        container = document.querySelector('.intro');
        if (!container) return;

        // Ensure container is a positioning context
        var pos = window.getComputedStyle(container).position;
        if (pos === 'static') {
            container.style.position = 'relative';
        }

        canvas = document.createElement('canvas');
        canvas.id = 'particle-canvas';
        canvas.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;' +
            'pointer-events:none;z-index:0;';
        container.appendChild(canvas);
        ctx = canvas.getContext('2d');

        resize();
        createParticles();
        bindEvents();
        animate();
    }

    function resize() {
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
    }

    function createParticles() {
        particles = [];
        for (var i = 0; i < CONFIG.particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * CONFIG.speed,
                vy: (Math.random() - 0.5) * CONFIG.speed,
                size: CONFIG.particleMinSize + Math.random() * (CONFIG.particleMaxSize - CONFIG.particleMinSize),
                color: CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)],
                baseAlpha: 0.3 + Math.random() * 0.5,
                pulse: Math.random() * Math.PI * 2
            });
        }
    }

    function bindEvents() {
        window.addEventListener('resize', function () {
            resize();
        });

        container.addEventListener('mousemove', function (e) {
            var rect = container.getBoundingClientRect();
            mouse.x = e.clientX - rect.left;
            mouse.y = e.clientY - rect.top;
        });

        container.addEventListener('mouseleave', function () {
            mouse.x = -9999;
            mouse.y = -9999;
        });
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        updateParticles();
        drawLines();
        drawParticles();
        animId = requestAnimationFrame(animate);
    }

    function updateParticles() {
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];

            // Gentle pulse
            p.pulse += 0.01;

            // Mouse interaction — soft repel
            var dx = p.x - mouse.x;
            var dy = p.y - mouse.y;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < CONFIG.mouseRadius && dist > 0) {
                var force = (CONFIG.mouseRadius - dist) / CONFIG.mouseRadius;
                var angle = Math.atan2(dy, dx);
                p.vx += Math.cos(angle) * force * CONFIG.mouseForce;
                p.vy += Math.sin(angle) * force * CONFIG.mouseForce;
            }

            // Dampen velocity
            p.vx *= 0.99;
            p.vy *= 0.99;

            // Move
            p.x += p.vx;
            p.y += p.vy;

            // Wrap around edges of the container
            if (p.x < -20) p.x = canvas.width + 20;
            if (p.x > canvas.width + 20) p.x = -20;
            if (p.y < -20) p.y = canvas.height + 20;
            if (p.y > canvas.height + 20) p.y = -20;
        }
    }

    function drawParticles() {
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            var pulseAlpha = p.baseAlpha + Math.sin(p.pulse) * 0.15;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0.1, Math.min(1, pulseAlpha));
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawLines() {
        for (var i = 0; i < particles.length; i++) {
            for (var j = i + 1; j < particles.length; j++) {
                var dx = particles[i].x - particles[j].x;
                var dy = particles[i].y - particles[j].y;
                var dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < CONFIG.lineDistance) {
                    var alpha = (1 - dist / CONFIG.lineDistance) * 0.15;

                    // Brighter lines near mouse
                    var mx = (particles[i].x + particles[j].x) / 2;
                    var my = (particles[i].y + particles[j].y) / 2;
                    var mouseDist = Math.sqrt(
                        (mx - mouse.x) * (mx - mouse.x) +
                        (my - mouse.y) * (my - mouse.y)
                    );
                    if (mouseDist < CONFIG.mouseRadius) {
                        alpha += (1 - mouseDist / CONFIG.mouseRadius) * 0.2;
                    }

                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = CONFIG.lineColor + alpha.toFixed(3) + ')';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
