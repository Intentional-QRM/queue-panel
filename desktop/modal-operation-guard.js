function createModalOperationGuard(getWindow) {
  let activeOperations = 0;

  function shouldAutoHide() {
    return activeOperations === 0;
  }

  async function run(operation) {
    activeOperations += 1;

    try {
      return await operation();
    } finally {
      try {
        const window = getWindow();
        if (window && !window.isDestroyed()) {
          if (!window.isVisible()) window.show();
          window.focus();
        }
      } finally {
        activeOperations -= 1;
      }
    }
  }

  return {
    isActive: () => activeOperations > 0,
    shouldAutoHide,
    run
  };
}

module.exports = { createModalOperationGuard };
