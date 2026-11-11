(() => {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isMobile) {
    location.replace('/jitter/');
    return;
  }

  // Browsers can move the installer tab into the app window without reloading.
  const appWindow = matchMedia('(display-mode: standalone)');
  function launchApp() {
    location.replace('/jittery.html?app=pwa');
  }
  if (appWindow.matches) {
    launchApp();
    return;
  }
  appWindow.addEventListener('change', event => {
    if (event.matches) launchApp();
  });

  const buttons = document.querySelectorAll('[data-install]');
  const status = document.getElementById('install-status');
  const guide = document.getElementById('install-guide');
  let installPrompt = null;
  let installed = false;

  function setButtonsDisabled(disabled) {
    for (const button of buttons) button.disabled = disabled;
  }

  function showGuide() {
    status.textContent = 'Use the installation steps for your browser.';
    guide.open = true;
    guide.querySelector('summary').focus();
    guide.scrollIntoView({ block: 'center' });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });

  async function install() {
    if (!installPrompt) {
      showGuide();
      return;
    }

    // A browser prompt can only be used once, even if the user dismisses it.
    const prompt = installPrompt;
    installPrompt = null;
    setButtonsDisabled(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (!installed) {
        status.textContent = outcome === 'accepted'
          ? 'Your browser is installing Jitter.'
          : 'Installation canceled.';
      }
    } catch {
      if (!installed) showGuide();
    } finally {
      setButtonsDisabled(installed);
    }
  }
  for (const button of buttons) button.addEventListener('click', install);

  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    status.textContent = 'Jitter is installed. Open it from your apps.';
    for (const button of buttons) button.textContent = 'Installed';
    setButtonsDisabled(true);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Jitter service worker registration failed.', error);
    });
  }
})();
