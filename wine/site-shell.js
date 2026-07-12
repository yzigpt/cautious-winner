const header = document.querySelector(".site-header, .wine-header");

if (header) {
  const isWineHeader = header.classList.contains("wine-header");
  const hiddenClass = isWineHeader ? "wine-header--hidden" : "site-header--hidden";
  const scrolledClass = isWineHeader ? "wine-header--scrolled" : "site-header--scrolled";
  const revealThreshold = 12;
  const startThreshold = 172;
  const compactThreshold = 28;
  const hideTravelThreshold = 36;
  const showTravelThreshold = 84;
  let lastY = window.scrollY;
  let upwardTravel = 0;
  let downwardTravel = 0;
  let ticking = false;

  const applyState = () => {
    const currentY = window.scrollY;
    const delta = currentY - lastY;
    const scrollingDown = delta > revealThreshold;
    const scrollingUp = delta < -revealThreshold;
    const isHidden = header.classList.contains(hiddenClass);

    header.classList.toggle(scrolledClass, currentY > compactThreshold);

    if (currentY <= startThreshold) {
      header.classList.remove(hiddenClass);
      upwardTravel = 0;
      downwardTravel = 0;
    } else if (scrollingDown) {
      downwardTravel += delta;
      upwardTravel = 0;

      if (downwardTravel >= hideTravelThreshold) {
        header.classList.add(hiddenClass);
      }
    } else if (scrollingUp) {
      upwardTravel += Math.abs(delta);
      downwardTravel = 0;

      if (isHidden && upwardTravel >= showTravelThreshold) {
        header.classList.remove(hiddenClass);
        upwardTravel = 0;
      }
    }

    lastY = currentY;
    ticking = false;
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyState);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  applyState();
}

const winePage = document.body.classList.contains("wine-page");

if (winePage && "IntersectionObserver" in window) {
  const title = document.querySelector(".wine-hero__title");

  if (title) {
    const text = title.textContent || "";
    title.setAttribute("aria-label", text);
    title.textContent = "";

    Array.from(text).forEach((character, index) => {
      if (character === " ") {
        const space = document.createElement("span");
        space.className = "space";
        space.setAttribute("aria-hidden", "true");
        space.innerHTML = "&nbsp;";
        title.appendChild(space);
        return;
      }

      const char = document.createElement("span");
      char.className = "char";
      char.setAttribute("aria-hidden", "true");
      char.style.setProperty("--char-index", String(index));
      char.textContent = character;
      title.appendChild(char);
    });
  }

  const revealTargets = Array.from(
    document.querySelectorAll(
      [
        ".wine-hero__copy > *",
        ".wine-hero__visual",
        ".wine-trust__grid > div",
        ".wine-pairing__copy > *",
        ".wine-pairing__card",
        ".wine-pairing__visual",
        ".wine-brand-story__copy > *",
        ".wine-brand-story__media",
        ".wine-section__head > *",
        ".wine-card",
        ".wine-story__visual",
        ".wine-story__copy > *",
        ".wine-list li",
        ".wine-experience__card",
      ].join(", ")
    )
  );

  revealTargets.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.setProperty("--reveal-delay", "0ms");
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
      {
        root: null,
        threshold: 0,
        rootMargin: "0px",
      }
  );

  revealTargets.forEach((element) => observer.observe(element));

  const hero = document.querySelector(".wine-hero");
  const bottle = document.querySelector(".wine-bottle");
  const ambientOne = document.querySelector(".wine-hero__ambient--one");
  const ambientTwo = document.querySelector(".wine-hero__ambient--two");
  let parallaxTicking = false;

  const applyParallax = () => {
    const scrollY = window.scrollY;
    const heroHeight = hero ? hero.offsetHeight : window.innerHeight;
    const progress = Math.min(scrollY / Math.max(heroHeight, 1), 1);
    const bottleY = Math.min(scrollY * 0.04, 32);
    const bottleX = Math.sin(scrollY / 520) * 7;
    const bottleRot = Math.sin(scrollY / 900) * 0.8;
    const ambientShiftX = Math.sin(scrollY / 720) * 14;
    const ambientShiftY = Math.min(scrollY * 0.02, 12);
    const ambientShiftX2 = Math.cos(scrollY / 780) * 12;
    const ambientShiftY2 = Math.min(scrollY * 0.03, 18);

    if (hero) {
      hero.style.setProperty("--wine-hero-progress", progress.toFixed(3));
    }

    if (bottle) {
      bottle.style.setProperty("--wine-bottle-x", `${bottleX}px`);
      bottle.style.setProperty("--wine-bottle-y", `${bottleY}px`);
      bottle.style.setProperty("--wine-bottle-rot", `${bottleRot}deg`);
    }

    if (ambientOne) {
      ambientOne.style.setProperty("--wine-ambient-x", `${ambientShiftX}px`);
      ambientOne.style.setProperty("--wine-ambient-y", `${ambientShiftY}px`);
    }

    if (ambientTwo) {
      ambientTwo.style.setProperty("--wine-ambient-x", `${-ambientShiftX2}px`);
      ambientTwo.style.setProperty("--wine-ambient-y", `${ambientShiftY2}px`);
    }

    parallaxTicking = false;
  };

  const onWineScroll = () => {
    if (parallaxTicking) return;
    parallaxTicking = true;
    window.requestAnimationFrame(applyParallax);
  };

  window.addEventListener("scroll", onWineScroll, { passive: true });
  window.addEventListener("resize", onWineScroll, { passive: true });
  applyParallax();
}
