import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import config from '../config';
import * as catalogo from '../services/catalogo.service';
import * as usuarios from '../services/usuarios.service';
import { requiereSesion, requiereRol } from '../middleware/auth';
import type { Usuario } from '../tipos';

const router = express.Router();
const HOSTS_PERMITIDOS = new Set(['proveedor.origen.com', '127.0.0.1']);
const TAMANO_MAXIMO_ARCHIVO = 700 * 1024;
const MIME_POR_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function detectarMimeImagen(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Rutas del panel de administración.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Autorización ausente / escalada de privilegios (OWASP A01:2021)
 * -----------------------------------------------------------------------------
 * Se exige estar autenticado, pero NO se comprueba el rol: `requiereRol` está
 * importado y no se usa. Cualquier usuario autenticado (incluso con rol
 * "cliente") entra al panel y puede:
 *   - crear, editar y BORRAR productos,
 *   - cambiar contraseñas,
 *   - dar de alta usuarios y cambiarles el rol (escalada de privilegios),
 *   - ejecutar comandos en el servidor.
 *
 * Corrección: `router.use(requiereRol('admin'))` sobre las rutas sensibles.
 * -----------------------------------------------------------------------------
 */
router.use(requiereSesion);
router.use(requiereRol ('admin'));

/** GET /api/admin/usuarios */
router.get('/usuarios', async (req, res, next) => {
  try {
    res.json({ usuarios: await usuarios.listar() });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id
 *
 * FALLA — Asignación masiva: se actualiza cualquier campo que llegue en el
 * cuerpo, incluido el `rol`. Un usuario con rol "cliente" puede mandarse
 * `{"rol": "admin"}` y convertirse en administrador.
 */
router.put('/usuarios/:id', async (req, res, next) => {
  try {
    const { username, nombre, rol, password } = req.body || {};
    const cambios: Partial<Usuario> = {};
    if (username !== undefined) cambios.username = username;
    if (nombre !== undefined) cambios.nombre = nombre;
    if (rol !== undefined) cambios.rol = rol;
    if (password !== undefined) cambios.password = password;

    const usuario = await usuarios.actualizar(req.params.id, cambios);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    res.json(usuario);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/productos — alta de producto. */
router.post('/productos', async (req, res, next) => {
  try {
    const producto = await catalogo.crear(req.body || {});
    res.status(201).json(producto);
  } catch (err) {
    // El nombre del producto es único en la base.
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Ya existe un producto con ese nombre.' });
    }
    next(err);
  }
});

/** PUT /api/admin/productos/:id */
router.put('/productos/:id', async (req, res, next) => {
  try {
    const producto = await catalogo.actualizar(req.params.id, req.body || {});
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/productos/:id
 *
 * FALLA — CSRF: la petición que borra un producto no lleva ningún token y se
 * acepta con un simple GET/POST desde cualquier origen.
 */
router.delete('/productos/:id', async (req, res, next) => {
  try {
    const producto = await catalogo.eliminar(req.params.id);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/cambiar-contrasena
 *
 * FALLAS: sin token anti-CSRF, sin límite de intentos, y la contraseña nueva
 * se guarda en texto plano.
 */
router.post('/cambiar-contrasena', async (req, res, next) => {
  try {
    const { nueva } = req.body || {};
    if (!nueva) {
      return res.status(400).json({ error: 'Falta la contraseña nueva.' });
    }
    // FALLA: no se valida la longitud ni la complejidad de la contraseña.
    // (`req.usuario!`: requiereSesion ya garantizó que hay un usuario.)
    const usuario = await usuarios.cambiarPassword(req.usuario!.id, nueva);
    res.json({ mensaje: 'Contraseña actualizada.', usuario });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/probar-conexion
 *
 * -----------------------------------------------------------------------------
 * FALLA — Inyección de comandos del sistema operativo (OWASP A03:2021)
 * -----------------------------------------------------------------------------
 * La dirección del proveedor se mete dentro de una cadena de shell.
 * Como `exec` launches /bin/sh -c, los operadores del shell (|, ;, &&, $())
 * se interpretan y permiten ejecutar comandos arbitrarios en el contenedor.
 *
 * Corrección: validar el host contra una LISTA BLANCA y ejecutar el proceso
 * con `spawn('ping', ['-c', '3', host], { shell: false })`, sin pasar por el
 * shell.
 * -----------------------------------------------------------------------------
 */
router.post('/probar-conexion', (req, res) => {
  const host = req.body?.host;

  // Lista blanca: sólo se permite probar destinos explícitamente aprobados
  if (typeof host !== 'string' || !HOSTS_PERMITIDOS.has(host)) {
    return res.status(400).json({ error: 'Host no permitido.' });
  }

  const proceso = spawn('ping', ['-c', '3', host], {
    shell: false,
    timeout: 5000,
  });

  let salida = '';
  let error = '';

  proceso.stdout.on('data', (parte) => {
    salida += parte.toString();
  });

  proceso.stderr.on('data', (parte) => {
    error += parte.toString();
  });

  proceso.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo iniciar la prueba de conexión.' });
    }
  });

  proceso.on('close', (codigo) => {
    if (!res.headersSent) {
      res.status(codigo === 0 ? 200 : 502).json({
        salida,
        error: codigo === 0 ? null : error || 'No se pudo conectar al host.',
      });
    }
  });
});

/**
 * POST /api/admin/subir-archivo
 *
 * -----------------------------------------------------------------------------
 * Validación de archivos subidos (OWASP A04:2021)
 * -----------------------------------------------------------------------------
 * La extensión debe estar permitida y coincidir con la firma del contenido.
 * Se limita el tamaño y el servidor genera el nombre para evitar path traversal.
 * -----------------------------------------------------------------------------
 */
router.post('/subir-archivo', express.json({ limit: '8mb' }), (req, res, next) => {
  try {
    const { nombre, contenidoBase64 } = req.body || {};

    if (typeof nombre !== 'string' || typeof contenidoBase64 !== 'string' || !nombre || !contenidoBase64) {
      return res.status(400).json({ error: 'Falta el archivo.' });
    }

    const maximoBase64 = 4 * Math.ceil(TAMANO_MAXIMO_ARCHIVO / 3);
    if (contenidoBase64.length > maximoBase64) {
      return res.status(413).json({ error: 'El archivo supera el tamaño máximo de 700 KB.' });
    }

    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contenidoBase64)) {
      return res.status(400).json({ error: 'El contenido del archivo no es base64 válido.' });
    }

    const buffer = Buffer.from(contenidoBase64, 'base64');
    if (buffer.toString('base64') !== contenidoBase64) {
      return res.status(400).json({ error: 'El contenido del archivo no es base64 válido.' });
    }
    if (buffer.length > TAMANO_MAXIMO_ARCHIVO) {
      return res.status(413).json({ error: 'El archivo supera el tamaño máximo de 700 KB.' });
    }

    const extension = path.extname(nombre).toLowerCase();
    const mimePorExtension = MIME_POR_EXTENSION[extension];
    if (!mimePorExtension || detectarMimeImagen(buffer) !== mimePorExtension) {
      return res.status(415).json({ error: 'Solo se permiten imágenes PNG, JPEG o WEBP válidas.' });
    }

    fs.mkdirSync(config.uploadsDir, { recursive: true });

    const nombreGuardado = `${crypto.randomUUID()}${extension}`;
    const destino = path.join(config.uploadsDir, nombreGuardado);
    fs.writeFileSync(destino, buffer);

    res.json({
      mensaje: 'Archivo subido.',
      url: `/uploads/${nombreGuardado}`,
      bytes: buffer.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
