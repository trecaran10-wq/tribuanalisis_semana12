"use strict";
document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const registering = tab.dataset.authTab === "register";
    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.getElementById("auth-action").value = tab.dataset.authTab;
    document.getElementById("confirm-label").hidden = !registering;
    document.getElementById("confirm-password").required = registering;
    document.getElementById("auth-password").autocomplete = registering ? "new-password" : "current-password";
    document.getElementById("auth-submit-label").textContent = registering ? "Crear cuenta" : "Ingresar a mi cuenta";
  });
});

document.getElementById("toggle-password").addEventListener("click", (event) => {
  const password = document.getElementById("auth-password");
  const button = event.currentTarget;
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  button.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  button.setAttribute("aria-pressed", String(visible));
});
