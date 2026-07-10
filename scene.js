let canvas = document.getElementById("scene-canvas");
const page = document.querySelector(".page--site");

if (!canvas && page) {
  page.classList.add("page--with-scene");

  const ambient = document.createElement("div");
  ambient.className = "ambient-3d ambient-3d--page";
  ambient.setAttribute("aria-hidden", "true");
  ambient.innerHTML = `
    <span class="ambient-3d__orb ambient-3d__orb--cyan"></span>
    <span class="ambient-3d__orb ambient-3d__orb--gold"></span>
    <span class="ambient-3d__plane ambient-3d__plane--one"></span>
    <span class="ambient-3d__plane ambient-3d__plane--two"></span>
  `;

  canvas = document.createElement("canvas");
  canvas.className = "scene-canvas scene-canvas--page";
  canvas.setAttribute("aria-hidden", "true");
  page.prepend(ambient, canvas);
}

if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const context = canvas.getContext("2d");
  const isCompact = window.matchMedia("(max-width: 640px)").matches;
  const particles = [];
  const pointer = { x: 0, y: 0 };
  const count = isCompact ? 38 : 82;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let frameId = null;

  function createParticles() {
    particles.length = 0;
    for (let index = 0; index < count; index += 1) {
      particles.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 1.8 + 0.15,
        speed: 0.0001 + Math.random() * 0.00022,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function project(particle, time) {
    const angle = time * particle.speed + particle.phase;
    const orbitX = particle.x * Math.cos(angle) - particle.z * Math.sin(angle) * 0.18;
    const depth = particle.z + Math.sin(angle * 1.7) * 0.16;
    const perspective = 1 / (depth + 0.75);
    return {
      x: width * 0.5 + (orbitX * width * 0.58 + pointer.x * 18) * perspective,
      y: height * 0.44 + (particle.y * height * 0.52 + pointer.y * 14) * perspective,
      depth,
      size: Math.max(0.7, 2.4 * perspective),
    };
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);
    const points = particles.map((particle) => project(particle, time));

    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const dx = points[first].x - points[second].x;
        const dy = points[first].y - points[second].y;
        const distance = Math.hypot(dx, dy);
        if (distance > 120) continue;
        const alpha = (1 - distance / 120) * 0.16;
        context.strokeStyle = `rgba(102, 217, 255, ${alpha})`;
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(points[first].x, points[first].y);
        context.lineTo(points[second].x, points[second].y);
        context.stroke();
      }
    }

    points.forEach((point) => {
      const alpha = Math.min(0.68, 0.18 + (1 / (point.depth + 0.4)) * 0.2);
      context.fillStyle = `rgba(210, 247, 255, ${alpha})`;
      context.beginPath();
      context.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      context.fill();
    });

    frameId = window.requestAnimationFrame(draw);
  }

  window.addEventListener("pointermove", (event) => {
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    } else if (document.visibilityState === "visible" && !frameId) {
      frameId = window.requestAnimationFrame(draw);
    }
  });

  createParticles();
  resize();
  window.addEventListener("resize", resize, { passive: true });
  frameId = window.requestAnimationFrame(draw);
}

const sections = Array.from(document.querySelectorAll(".page--landing > .card, .page--landing .trust-rail"));
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("is-reveal-ready");
  sections.forEach((section) => section.classList.add("reveal"));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  sections.forEach((section) => observer.observe(section));
}
