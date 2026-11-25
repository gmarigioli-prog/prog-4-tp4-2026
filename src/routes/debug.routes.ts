import express from 'express';
import { requiereSesion, requiereRol } from '../middleware/auth';

const router = express.Router();

/**
 * Endpoint de diagnóstico.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Exposición de información sensible (OWASP A01:2021 / A05:2021)
 * -----------------------------------------------------------------------------
 * Devuelve el contenido completo de `process.env`: credenciales de la base de
 * datos, secretos, configuración interna... y NO requiere autenticación.
 *
 * En un entorno real estos endpoints quedan detrás de autenticación y no
 * deberían existir en producción.
 */
router.use(requiereSesion);
router.use(requiereRol('admin'));

router.get('/', (_req, res) => {
  res.json({
    mensaje: 'Diagnóstico del servidor',
    estado: 'ok',
  });
});

export default router;
