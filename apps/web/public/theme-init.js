// Modo oscuro antes de pintar (evita el destello blanco). Fichero aparte para no necesitar
// scripts en línea (la política de seguridad de contenido solo permite scripts propios).
try {
  var m = localStorage.getItem("agendario-theme");
  if (m === "dark" || (m !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch (e) {}
