import path from "path";
import crypto from "crypto";
import express from "express";

import config from "./config";
import { rutaNoEncontrada, manejadorErrores } from "./middleware/errores";
import { leerCookies, obtenerSesion } from "./middleware/sesion";
import authRoutes from "./routes/auth.routes";
import productosRoutes from "./routes/productos.routes";
import pedidosRoutes from "./routes/pedidos.routes";
import reportesRoutes from "./routes/reportes.routes";
import comentariosRoutes from "./routes/comentarios.routes";
import adminRoutes from "./routes/admin.routes";
import debugRoutes from "./routes/debug.routes";

const app = express();

/**
 * FALLA — Ajustes de configuración (OWASP A05:2021)
 *
 * Faltan:
 *  - helmet (cabeceras de seguridad: CSP, X-Content-Type-Options, HSTS...)
 *  - límite de tamaño del cuerpo más estricto por ruta
 *  - rate limiting global
 *  - política de CORS restringida al propio origen
 *  - helmet CSP además sirve como capa extra frente al XSS
 */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Archivos subidos por el panel de administración.
app.use("/uploads", express.static(config.uploadsDir));

// Sitio web estático
app.use(express.static(path.join(__dirname, "public")));

// --- API --------------------------------------------------------------------
app.get("/api/salud", (req, res) => {
  res.json({
    ok: true,
    servicio: "cafeteria-origen",
    hora: new Date().toISOString(),
  });
});

// Fix VUL-09 (CSRF-01, CSRF-03): generación y validación de token anti-CSRF
app.get("/api/csrf-token", (req, res) => {
  const sesion = obtenerSesion(req);
  const cookies = leerCookies(req);
  const token =
    sesion?.csrfToken || cookies.csrf || crypto.randomBytes(32).toString("hex");

  res.cookie("csrf", token, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.json({ token, csrfToken: token });
});

app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path === "/auth/login") return next();

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return res.status(403).json({ error: "Origen no permitido." });
      }
    } catch {
      return res.status(403).json({ error: "Origen inválido." });
    }
  }

  const sesion = obtenerSesion(req);
  const cookies = leerCookies(req);
  const esperado = sesion?.csrfToken || cookies.csrf;
  const recibido =
    (req.headers["x-csrf-token"] as string | undefined) ||
    req.body?._csrf ||
    (req.query?._csrf as string | undefined);

  if (!esperado || !recibido || recibido !== esperado) {
    return res
      .status(403)
      .json({ error: "Token anti-CSRF inválido o ausente." });
  }

  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/comentarios", comentariosRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/_diagnostico", debugRoutes);

app.use("/api", rutaNoEncontrada);

app.use(manejadorErrores);

export default app;
