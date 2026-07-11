let canvas = document.getElementById("scene-canvas");
const page = document.querySelector(".page--site");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const deviceMemory = navigator.deviceMemory || 8;
const lowPowerDevice = window.matchMedia("(max-width: 760px)").matches
  || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
  || deviceMemory <= 4;

if (lowPowerDevice) {
  document.documentElement.classList.add("performance-mode");
}

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
    <span class="ambient-3d__ring ambient-3d__ring--one"></span>
    <span class="ambient-3d__ring ambient-3d__ring--two"></span>
  `;

  canvas = document.createElement("canvas");
  canvas.className = "scene-canvas scene-canvas--page";
  canvas.setAttribute("aria-hidden", "true");
  page.prepend(ambient, canvas);
}

const ambientLayer = document.querySelector(".ambient-3d");
if (ambientLayer && !ambientLayer.querySelector(".ambient-3d__cube")) {
  ambientLayer.insertAdjacentHTML(
    "beforeend",
    '<span class="ambient-3d__cube ambient-3d__cube--one"></span><span class="ambient-3d__cube ambient-3d__cube--two"></span>',
  );
}

if (page && page.classList.contains("page--with-scene")) {
  const cards = Array.from(page.querySelectorAll(".card"));
  cards.forEach((card, index) => {
    card.classList.add("card--with-model");
    if (!card.querySelector(".card-3d")) {
      const variant = index % 2 === 0 ? "card-3d--cyan" : "card-3d--gold";
      card.insertAdjacentHTML("beforeend", `<span class="card-3d ${variant}" aria-hidden="true"></span>`);
    }
  });
}

function observeSceneActivity(setActive) {
  let inViewport = true;
  const host = canvas?.closest(".hero-card") || canvas;

  const update = () => setActive(inViewport && document.visibilityState === "visible");

  let observer = null;
  if (host && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      update();
    }, { threshold: 0.04 });
    observer.observe(host);
  }

  document.addEventListener("visibilitychange", update);
  update();

  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", update);
  };
}

function initFallbackScene() {
  if (!canvas || prefersReducedMotion) return;

  const context = canvas.getContext("2d");
  if (!context) return;
  const isCompact = window.matchMedia("(max-width: 640px)").matches;
  const particles = [];
  const pointer = { x: 0, y: 0 };
  const count = isCompact ? 24 : 48;
  const frameDuration = 1000 / (isCompact ? 20 : 30);
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let frameId = null;
  let lastRenderedAt = -Infinity;

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
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.15);
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
    if (time - lastRenderedAt < frameDuration) {
      frameId = window.requestAnimationFrame(draw);
      return;
    }
    lastRenderedAt = time;
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

  observeSceneActivity((active) => {
    if (!active && frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    } else if (active && !frameId) {
      frameId = window.requestAnimationFrame(draw);
    }
  });

  createParticles();
  resize();
  window.addEventListener("resize", resize, { passive: true });
}

function initWebglScene(THREE) {
  if (!canvas) return;

  const reducedMotion = prefersReducedMotion;
  const isCompact = window.matchMedia("(max-width: 640px)").matches;
  const isLanding = page?.classList.contains("page--landing");
  const frameDuration = 1000 / (isCompact ? 20 : isLanding ? 30 : 24);
  canvas.classList.add("scene-canvas--webgl");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const stage = new THREE.Group();
  const pointer = { x: 0, y: 0 };
  let frameId = null;
  let lastRenderedAt = -Infinity;
  let width = 0;
  let height = 0;

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCompact ? 1 : isLanding ? 1.1 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  camera.position.set(0, 0, 8.2);
  scene.add(stage);

  const cyanMaterial = new THREE.MeshStandardMaterial({
    color: 0x66d9ff,
    emissive: 0x0d5b78,
    emissiveIntensity: 0.8,
    metalness: 0.68,
    roughness: 0.2,
    transparent: true,
    opacity: 0.78,
    wireframe: true,
  });
  const goldMaterial = new THREE.MeshStandardMaterial({
    color: 0xf6d37a,
    emissive: 0x5a3e0b,
    emissiveIntensity: 0.72,
    metalness: 0.6,
    roughness: 0.24,
    transparent: true,
    opacity: 0.68,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x8ce6ff,
    emissive: 0x164d68,
    emissiveIntensity: 0.54,
    metalness: 0.2,
    roughness: 0.12,
    transparent: true,
    opacity: 0.38,
  });

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.18, 0.28, 84, 12), cyanMaterial);
  knot.position.set(2.45, 0.55, -0.8);
  knot.rotation.set(0.35, -0.7, 0.2);
  stage.add(knot);

  const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), goldMaterial);
  crystal.position.set(-2.7, -1.18, -1.15);
  crystal.rotation.set(0.18, 0.5, -0.12);
  stage.add(crystal);

  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.82, 20, 20), glassMaterial);
  orb.position.set(1.05, -2.05, -0.2);
  stage.add(orb);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.52, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x9aeaff, transparent: true, opacity: 0.56 }),
  );
  ring.position.set(-1.6, 1.7, -1.5);
  ring.rotation.set(1.05, 0.22, -0.52);
  stage.add(ring);

  scene.add(new THREE.AmbientLight(0x9ccfff, 1.3));
  const keyLight = new THREE.PointLight(0x8ce6ff, 26, 18, 2);
  keyLight.position.set(3.5, 4.5, 5);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight(0xf6d37a, 18, 14, 2);
  warmLight.position.set(-4, -2, 4);
  scene.add(warmLight);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function render(time = 0) {
    if (!reducedMotion && time - lastRenderedAt < frameDuration) {
      frameId = window.requestAnimationFrame(render);
      return;
    }
    lastRenderedAt = time;
    const elapsed = time * 0.00012;
    stage.rotation.y += (pointer.x * 0.18 - stage.rotation.y) * 0.018;
    stage.rotation.x += (-pointer.y * 0.12 - stage.rotation.x) * 0.018;
    knot.rotation.x = 0.35 + elapsed * 1.2;
    knot.rotation.z = 0.2 + elapsed * 0.75;
    crystal.rotation.y = 0.5 - elapsed * 0.82;
    crystal.rotation.x = 0.18 + elapsed * 0.35;
    orb.position.y = -2.05 + Math.sin(elapsed * 3) * 0.18;
    ring.rotation.z = -0.52 + elapsed * 0.44;
    renderer.render(scene, camera);
    if (!reducedMotion) frameId = window.requestAnimationFrame(render);
  }

  window.addEventListener("pointermove", (event) => {
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  window.addEventListener("resize", resize, { passive: true });
  observeSceneActivity((active) => {
    if (reducedMotion) return;
    if (!active && frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    } else if (active && !frameId) {
      frameId = window.requestAnimationFrame(render);
    }
  });

  resize();
}

if (canvas && !lowPowerDevice && !prefersReducedMotion) {
  import("https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js")
    .then(initWebglScene)
    .catch(initFallbackScene);
} else if (canvas) {
  canvas.remove();
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
