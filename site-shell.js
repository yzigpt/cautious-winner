const header = document.querySelector(".site-header");

if (header) {
  const hiddenClass = "site-header--hidden";
  const scrolledClass = "site-header--scrolled";
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
