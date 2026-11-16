(() => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
  if (new URLSearchParams(location.search).get("install") !== "1") return;
  if (matchMedia("(display-mode: standalone)").matches) return;
  let pending;
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Install Long Haul");
  panel.style.cssText = "position:fixed;z-index:10000;bottom:20px;left:20px;right:20px;max-width:520px;padding:20px;background:#17140f;color:#f1e9d8;border:1px solid #f2aa2e;border-radius:6px;font:16px/1.5 system-ui";
  const text = document.createElement("p");
  text.textContent = "Install Long Haul from Chrome’s menu → Cast, save, and share → Install page as app. If your Chromebook is managed, installation may depend on your school or organization’s settings.";
  const install = document.createElement("button");
  install.textContent = "Install Long Haul";
  install.hidden = true;
  install.style.cssText = "padding:10px 16px;background:#f2aa2e;border:0;border-radius:3px;cursor:pointer;font:inherit";
  const close = document.createElement("button");
  close.textContent = "Close";
  close.style.cssText = "margin-left:12px;padding:10px;background:transparent;color:inherit;border:1px solid #cdbfa2;border-radius:3px;cursor:pointer";
  close.onclick = () => panel.remove();
  install.onclick = async () => {
    if (!pending) return;
    const prompt = pending;
    pending = null;
    install.hidden = true;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") panel.remove();
  };
  addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    pending = event;
    text.textContent = "Add Long Haul to your Chromebook launcher and play in its own window. Internet required.";
    install.hidden = false;
  });
  addEventListener("appinstalled", () => panel.remove());
  panel.append(text, install, close);
  document.body.append(panel);
})();
