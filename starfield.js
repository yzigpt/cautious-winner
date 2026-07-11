const canvas = document.getElementById("starfield-canvas");
const host = canvas?.closest(".hero-card");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const saveData = navigator.connection?.saveData;
const compact = window.matchMedia("(max-width: 760px)").matches;
const lowPower = compact
  || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
  || (navigator.deviceMemory && navigator.deviceMemory <= 4)
  || saveData;

if (canvas && host && !reducedMotion && !saveData) {
  const context = canvas.getContext("2d", { alpha: true });

  if (context) {
    const count = lowPower ? 20 : 46;
    const frameDuration = 1000 / (lowPower ? 18 : 30);
    const connectionDistance = lowPower ? 86 : 118;
    const stars = [];
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frameId = null;
    let lastFrame = -Infinity;
    let active = true;
    let inViewport = true;

    function createStars() {
      stars.length = 0;

      for (let index = 0; index < count; index += 1) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          speedX: (Math.random() - 0.5) * (lowPower ? 0.18 : 0.32),
          speedY: (Math.random() - 0.5) * (lowPower ? 0.14 : 0.25),
          radius: Math.random() * 1.15 + 0.45,
          shimmer: Math.random() * Math.PI * 2,
        });
      }
    }

    function resize() {
      const bounds = host.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.25);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      createStars();
    }

    function updateStar(star) {
      star.x += star.speedX;
      star.y += star.speedY;

      if (star.x < -4) star.x = width + 4;
      if (star.x > width + 4) star.x = -4;
      if (star.y < -4) star.y = height + 4;
      if (star.y > height + 4) star.y = -4;
    }

    function draw(time) {
      if (!active) {
        frameId = null;
        return;
      }

      if (time - lastFrame < frameDuration) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      lastFrame = time;
      context.clearRect(0, 0, width, height);

      for (let first = 0; first < stars.length; first += 1) {
        const star = stars[first];
        updateStar(star);

        for (let second = first + 1; second < stars.length; second += 1) {
          const neighbour = stars[second];
          const distanceX = star.x - neighbour.x;
          const distanceY = star.y - neighbour.y;
          const distance = Math.hypot(distanceX, distanceY);

          if (distance >= connectionDistance) continue;

          const opacity = (1 - distance / connectionDistance) * 0.18;
          context.strokeStyle = `rgba(145, 221, 255, ${opacity})`;
          context.lineWidth = 0.6;
          context.beginPath();
          context.moveTo(star.x, star.y);
          context.lineTo(neighbour.x, neighbour.y);
          context.stroke();
        }
      }

      stars.forEach((star) => {
        const pulse = 0.55 + Math.sin(time * 0.001 + star.shimmer) * 0.25;
        context.fillStyle = `rgba(219, 247, 255, ${pulse})`;
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
      });

      frameId = window.requestAnimationFrame(draw);
    }

    function setActive(nextActive) {
      active = nextActive;
      if (!active && frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      } else if (active && !frameId) {
        frameId = window.requestAnimationFrame(draw);
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      setActive(inViewport && document.visibilityState === "visible");
    }, { threshold: 0.04 });

    document.addEventListener("visibilitychange", () => {
      setActive(inViewport && document.visibilityState === "visible");
    });
    window.addEventListener("resize", resize, { passive: true });

    observer.observe(host);
    resize();
    setActive(true);
  }
}
