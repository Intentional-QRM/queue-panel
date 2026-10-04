(function () {
  function touchDistance(touches) {
    if (!touches || touches.length < 2) return null;
    return Math.hypot(
      touches[1].clientX - touches[0].clientX,
      touches[1].clientY - touches[0].clientY
    );
  }

  function createPinchTextSizeGesture(onSizeChange) {
    let active = false;
    let triggered = false;
    let startingDistance = null;

    function reset() {
      active = false;
      triggered = false;
      startingDistance = null;
    }

    return {
      begin(touches) {
        const distance = touchDistance(touches);
        if (!distance) return false;
        active = true;
        triggered = false;
        startingDistance = distance;
        return true;
      },
      move(touches) {
        if (!active || triggered) return false;
        const distance = touchDistance(touches);
        if (!distance) return false;

        const threshold = Math.max(32, startingDistance * 0.1);
        const change = distance - startingDistance;
        if (Math.abs(change) < threshold) return false;

        triggered = true;
        onSizeChange(change > 0 ? "large" : "small");
        return true;
      },
      end(remainingTouchCount) {
        if (remainingTouchCount === 0) reset();
      },
      cancel: reset,
      isActive: () => active
    };
  }

  const PinchTextSize = { touchDistance, createPinchTextSizeGesture };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PinchTextSize;
  }

  if (typeof window !== "undefined") {
    window.QueuePanelPinchTextSize = PinchTextSize;
  }
})();
