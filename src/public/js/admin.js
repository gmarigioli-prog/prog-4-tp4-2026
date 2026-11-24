/* =============================================================================
   Cafetería Origen — lógica del panel de administración
   ============================================================================= */
(function () {
  "use strict";

  var API = "/api";
  var usuario = null;
  var productosCache = {};

  function $(sel) {
    return document.querySelector(sel);
  }
  function $$(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  function money(valor) {
    return Number(valor || 0).toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
    });
  }

  function raw(valor) {
    return String(valor == null ? "" : valor);
  }

  function crearElemento(tag, clase, texto) {
    var elemento = document.createElement(tag);
    if (clase) elemento.className = clase;
    if (texto != null) elemento.textContent = String(texto);
    return elemento;
  }

  function api(url, opciones) {
    return fetch(API + url, opciones).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
    });
  }

  function apiConTokenCsrf(url, opciones) {
    return api("/csrf-token").then(function (csrf) {
      var token = csrf.data && (csrf.data.token || csrf.data.csrfToken);
      var headers = Object.assign({}, opciones.headers || {});
      if (token) headers["X-CSRF-Token"] = token;
      return api(url, Object.assign({}, opciones, { headers: headers }));
    });
  }

  function postJSON(url, cuerpo) {
    return apiConTokenCsrf(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function putJSON(url, cuerpo) {
    return apiConTokenCsrf(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function patchJSON(url, cuerpo) {
    return apiConTokenCsrf(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function deleteJSON(url) {
    return apiConTokenCsrf(url, { method: "DELETE" });
  }

  function feedback(el, mensaje, ok) {
    el.className = "form-feedback " + (ok ? "is-ok" : "is-error");
    el.textContent = mensaje;
  }

  /* ------------------------------------------------------------------ login */
  function iniciarSesion(evento) {
    evento.preventDefault();
    var caja = $("#login-feedback");
    caja.className = "form-feedback";

    postJSON("/auth/login", {
      username: $("#login-usuario").value,
      password: $("#login-password").value,
    }).then(function (resp) {
      if (!resp.ok) {
        feedback(
          caja,
          "No pudimos iniciar sesión: " +
            (resp.data.error || "error desconocido"),
          false,
        );
        return;
      }
      usuario = resp.data.usuario;
      mostrarPanel();
    });
  }

  function cerrarSesion() {
    postJSON("/auth/logout", {}).then(function () {
      usuario = null;
      $("#vista-login").hidden = false;
      $("#vista-panel").hidden = true;
      $("#admin-user").replaceChildren();
    });
  }

  function mostrarPanel() {
    $("#vista-login").hidden = true;
    $("#vista-panel").hidden = false;
    var datosUsuario = $("#admin-user");
    datosUsuario.replaceChildren();
    datosUsuario.appendChild(document.createTextNode("Sesión de "));
    datosUsuario.appendChild(crearElemento("strong", "", usuario.nombre));
    datosUsuario.appendChild(document.createTextNode(" · rol: "));
    datosUsuario.appendChild(crearElemento("strong", "", usuario.rol));
    $("#panel-bienvenida").textContent = "Hola, " + usuario.nombre;
    cargarTodo();
  }

  function cargarTodo() {
    cargarResumen();
    cargarPedidos();
    cargarProductos();
    cargarReportes();
    cargarUsuarios();
  }

  /* ---------------------------------------------------------------- resumen */
  function cargarResumen() {
    api("/reportes/facturacion").then(function (f) {
      api("/reportes/mas-vendido").then(function (m) {
        api("/reportes/cantidad-vendida").then(function (c) {
          var mas = m.data.producto;
          var kpis = [
            { label: "Facturación total", value: money(f.data.facturado) },
            { label: "Pedidos registrados", value: f.data.pedidos },
            {
              label: "Producto más vendido",
              value: mas ? raw(mas.nombre) : "—",
            },
            {
              label: "Unidades por tipo",
              value:
                Object.keys(c.data.cantidadVendida || {})
                  .map(function (k) {
                    return k + ": " + c.data.cantidadVendida[k];
                  })
                  .join(" · ") || "—",
            },
          ];

          var contenedor = $("#kpis");
          contenedor.replaceChildren();
          kpis.forEach(function (k) {
            var tarjeta = crearElemento("div", "kpi");
            tarjeta.appendChild(crearElemento("div", "kpi-label", k.label));
            tarjeta.appendChild(crearElemento("div", "kpi-value", k.value));
            contenedor.appendChild(tarjeta);
          });
        });
      });
    });
  }

  /* --------------------------------------------------------------- pedidos */
  function tablaPedidos(filas, conAcciones) {
    var tabla = document.createDocumentFragment();
    var encabezado = document.createElement("thead");
    var filaEncabezado = document.createElement("tr");
    ["#", "Mesa", "Cliente", "Estado", "Total", "Fecha"]
      .concat(conAcciones ? ["Acciones"] : [])
      .forEach(function (titulo, indice) {
        filaEncabezado.appendChild(
          crearElemento("th", indice === 4 ? "num" : "", titulo),
        );
      });
    encabezado.appendChild(filaEncabezado);
    tabla.appendChild(encabezado);

    var cuerpo = document.createElement("tbody");
    if (!filas || filas.length === 0) {
      var filaVacia = document.createElement("tr");
      var celdaVacia = crearElemento("td", "empty", "No hay pedidos.");
      celdaVacia.colSpan = conAcciones ? 7 : 6;
      filaVacia.appendChild(celdaVacia);
      cuerpo.appendChild(filaVacia);
      tabla.appendChild(cuerpo);
      return tabla;
    }

    filas.forEach(function (p) {
      var fila = document.createElement("tr");
      fila.appendChild(crearElemento("td", "", p.id));
      fila.appendChild(crearElemento("td", "", p.mesa));
      fila.appendChild(crearElemento("td", "", p.cliente));
      var estado = crearElemento("span", "badge badge-" + p.estado, p.estado);
      var celdaEstado = document.createElement("td");
      celdaEstado.appendChild(estado);
      fila.appendChild(celdaEstado);
      fila.appendChild(crearElemento("td", "num", money(p.total)));
      fila.appendChild(
        crearElemento("td", "", new Date(p.creado_en).toLocaleString("es-AR")),
      );
      if (conAcciones) {
        var celdaAcciones = document.createElement("td");
        var select = crearElemento("select", "sel-estado");
        select.setAttribute("data-pedido", p.id);
        ["abierto", "preparando", "listo", "entregado"].forEach(
          function (opcion) {
            var elementoOpcion = crearElemento("option", "", opcion);
            elementoOpcion.value = opcion;
            elementoOpcion.selected = opcion === p.estado;
            select.appendChild(elementoOpcion);
          },
        );
        celdaAcciones.appendChild(select);
        fila.appendChild(celdaAcciones);
      }
      cuerpo.appendChild(fila);
    });

    tabla.appendChild(cuerpo);
    return tabla;
  }

  function cargarPedidos() {
    api("/pedidos").then(function (resp) {
      var pedidos = resp.data.pedidos || [];
      $("#tabla-pedidos").replaceChildren(tablaPedidos(pedidos, true));
      $("#tabla-ultimos").replaceChildren(
        tablaPedidos(pedidos.slice(0, 5), false),
      );
    });
  }

  function cambiarEstado(evento) {
    var select = evento.target.closest(".sel-estado");
    if (!select) return;
    var id = select.getAttribute("data-pedido");
    patchJSON("/pedidos/" + id + "/estado", { estado: select.value }).then(
      function (resp) {
        if (!resp.ok) {
          alert(
            "No se pudo cambiar el estado: " + (resp.data.error || "error"),
          );
        }
        cargarPedidos();
      },
    );
  }

  /* ------------------------------------------------------------- productos */
  function cargarProductos() {
    api("/productos").then(function (resp) {
      var productos = resp.data.productos || [];
      productosCache = {};
      var tabla = $("#tabla-productos");
      var fragmento = document.createDocumentFragment();
      var encabezado = document.createElement("thead");
      var filaEncabezado = document.createElement("tr");
      ["#", "Nombre", "Tipo", "Origen", "Precio", "Acciones"].forEach(
        function (titulo, indice) {
          filaEncabezado.appendChild(
            crearElemento("th", indice === 4 ? "num" : "", titulo),
          );
        },
      );
      encabezado.appendChild(filaEncabezado);
      fragmento.appendChild(encabezado);
      var cuerpo = document.createElement("tbody");

      productos.forEach(function (p) {
        productosCache[p.id] = p;
        var fila = document.createElement("tr");
        fila.appendChild(crearElemento("td", "", p.id));
        fila.appendChild(crearElemento("td", "", p.nombre));
        fila.appendChild(crearElemento("td", "", p.tipo));
        fila.appendChild(crearElemento("td", "", p.variedad || "—"));
        fila.appendChild(crearElemento("td", "num", money(p.precio)));
        var celdaAcciones = document.createElement("td");
        var borrar = crearElemento("button", "link-danger", "Borrar");
        borrar.setAttribute("data-borrar", p.id);
        celdaAcciones.appendChild(borrar);
        fila.appendChild(celdaAcciones);
        cuerpo.appendChild(fila);
      });

      fragmento.appendChild(cuerpo);
      tabla.replaceChildren(fragmento);
    });
  }

  function guardarProducto(evento) {
    evento.preventDefault();
    var caja = $("#producto-feedback");
    var id = $("#producto-id").value;

    var cuerpo = {
      nombre: $("#p-nombre").value,
      tipo: $("#p-tipo").value,
      variedad: $("#p-variedad").value || null,
      tamano: $("#p-tamano").value || null,
      gramos: $("#p-gramos").value ? Number($("#p-gramos").value) : null,
      precio_base: Number($("#p-precio-base").value || 0),
      precio_por_gramo: Number($("#p-precio-gramo").value || 0),
      descripcion: $("#p-descripcion").value,
    };

    var peticion = id
      ? putJSON("/admin/productos/" + id, cuerpo)
      : postJSON("/admin/productos", cuerpo);

    peticion.then(function (resp) {
      if (!resp.ok) {
        feedback(
          caja,
          "No se pudo guardar: " + (resp.data.error || "error desconocido"),
          false,
        );
        return;
      }
      feedback(caja, "Producto guardado correctamente.", true);
      $("#form-producto").reset();
      $("#producto-id").value = "";
      cargarProductos();
    });
  }

  function borrarProducto(evento) {
    var btn = evento.target.closest("[data-borrar]");
    if (!btn) return;
    var id = btn.getAttribute("data-borrar");
    if (!confirm("¿Borrar el producto #" + id + "?")) return;

    deleteJSON("/admin/productos/" + id).then(function (resp) {
      if (!resp.ok) alert("No se pudo borrar: " + (resp.data.error || "error"));
      cargarProductos();
    });
  }

  function limpiarFormularioProducto() {
    $("#form-producto").reset();
    $("#producto-id").value = "";
  }

  /* ---------------------------------------------------------------- upload */
  function subirArchivo(evento) {
    evento.preventDefault();
    var caja = $("#upload-feedback");
    var input = $("#archivo-subida");
    if (!input.files || !input.files[0]) {
      feedback(caja, "Elegí un archivo primero.", false);
      return;
    }

    var archivo = input.files[0];
    var lector = new FileReader();

    lector.onload = function () {
      var base64 = String(lector.result).split(",")[1] || "";
      postJSON("/admin/subir-archivo", {
        nombre: archivo.name,
        contenidoBase64: base64,
      }).then(function (resp) {
        if (!resp.ok) {
          feedback(
            caja,
            "No se pudo subir: " + (resp.data.error || "error desconocido"),
            false,
          );
          return;
        }
        feedback(caja, "Archivo subido a " + resp.data.url, true);
      });
    };

    lector.readAsDataURL(archivo);
  }

  /* -------------------------------------------------------------- reportes */
  function cargarReportes() {
    api("/reportes/facturacion").then(function (f) {
      api("/reportes/ticket-promedio").then(function (t) {
        api("/reportes/mas-vendido").then(function (m) {
          var mas = m.data.producto;
          var kpis = [
            { label: "Facturación", value: money(f.data.facturado) },
            { label: "Pedidos", value: f.data.pedidos },
            { label: "Ticket promedio", value: money(t.data.promedio) },
            {
              label: "Más vendido",
              value: mas
                ? raw(mas.nombre) + " (" + raw(mas.unidades) + ")"
                : "—",
            },
          ];
          var contenedor = $("#kpis-reportes");
          contenedor.replaceChildren();
          kpis.forEach(function (k) {
            var tarjeta = crearElemento("div", "kpi");
            tarjeta.appendChild(crearElemento("div", "kpi-label", k.label));
            tarjeta.appendChild(crearElemento("div", "kpi-value", k.value));
            contenedor.appendChild(tarjeta);
          });
        });
      });
    });
  }

  function consultarVentas() {
    var caja = $("#reporte-feedback");
    var variedad = $("#reporte-variedad").value;

    api(
      "/reportes/ventas-por-variedad?variedad=" + encodeURIComponent(variedad),
    ).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, "Error: " + (resp.data.error || "desconocido"), false);
        $("#tabla-ventas").replaceChildren();
        return;
      }
      var ventas = resp.data.ventas || [];
      var tabla = $("#tabla-ventas");
      var fragmento = document.createDocumentFragment();
      var encabezado = document.createElement("thead");
      var filaEncabezado = document.createElement("tr");
      ["Origen", "Producto", "Unidades", "Total"].forEach(
        function (titulo, indice) {
          filaEncabezado.appendChild(
            crearElemento("th", indice > 1 ? "num" : "", titulo),
          );
        },
      );
      encabezado.appendChild(filaEncabezado);
      fragmento.appendChild(encabezado);
      var cuerpo = document.createElement("tbody");
      ventas.forEach(function (v) {
        var fila = document.createElement("tr");
        fila.appendChild(crearElemento("td", "", v.variedad));
        fila.appendChild(crearElemento("td", "", v.nombre));
        fila.appendChild(crearElemento("td", "num", v.unidades));
        fila.appendChild(crearElemento("td", "num", money(v.total)));
        cuerpo.appendChild(fila);
      });
      fragmento.appendChild(cuerpo);
      tabla.replaceChildren(fragmento);
      feedback(caja, "Consulta realizada.", true);
    });
  }

  /* -------------------------------------------------------------- usuarios */
  function cargarUsuarios() {
    api("/admin/usuarios").then(function (resp) {
      var usuarios = resp.data.usuarios || [];
      var tabla = $("#tabla-usuarios");
      var fragmento = document.createDocumentFragment();
      var encabezado = document.createElement("thead");
      var filaEncabezado = document.createElement("tr");
      ["#", "Usuario", "Nombre", "Rol", "Acciones"].forEach(function (titulo) {
        filaEncabezado.appendChild(crearElemento("th", "", titulo));
      });
      encabezado.appendChild(filaEncabezado);
      fragmento.appendChild(encabezado);
      var cuerpo = document.createElement("tbody");
      usuarios.forEach(function (u) {
        var fila = document.createElement("tr");
        fila.appendChild(crearElemento("td", "", u.id));
        fila.appendChild(crearElemento("td", "", u.username));
        fila.appendChild(crearElemento("td", "", u.nombre));
        var celdaRol = document.createElement("td");
        celdaRol.appendChild(
          crearElemento(
            "span",
            "badge" + (u.rol === "admin" ? " badge-admin" : ""),
            u.rol,
          ),
        );
        fila.appendChild(celdaRol);
        var celdaAcciones = document.createElement("td");
        var select = crearElemento("select", "sel-rol");
        select.setAttribute("data-usuario", u.id);
        ["cliente", "mozo", "barista", "admin"].forEach(function (rol) {
          var opcion = crearElemento("option", "", rol);
          opcion.value = rol;
          opcion.selected = rol === u.rol;
          select.appendChild(opcion);
        });
        celdaAcciones.appendChild(select);
        fila.appendChild(celdaAcciones);
        cuerpo.appendChild(fila);
      });
      fragmento.appendChild(cuerpo);
      tabla.replaceChildren(fragmento);
    });
  }

  function cambiarRol(evento) {
    var select = evento.target.closest(".sel-rol");
    if (!select) return;
    var id = select.getAttribute("data-usuario");

    putJSON("/admin/usuarios/" + id, { rol: select.value }).then(
      function (resp) {
        if (!resp.ok)
          alert("No se pudo actualizar: " + (resp.data.error || "error"));
        cargarUsuarios();
      },
    );
  }

  function cambiarPassword(evento) {
    evento.preventDefault();
    var caja = $("#password-feedback");
    postJSON("/admin/cambiar-contrasena", {
      nueva: $("#nueva-password").value,
    }).then(function (resp) {
      if (!resp.ok) {
        feedback(
          caja,
          "No se pudo cambiar: " + (resp.data.error || "error desconocido"),
          false,
        );
        return;
      }
      feedback(caja, "Contraseña actualizada.", true);
      $("#nueva-password").value = "";
    });
  }

  /* ----------------------------------------------------------- herramientas */
  function probarConexion(evento) {
    evento.preventDefault();
    var salida = $("#salida-conexion");
    salida.textContent = "Probando…";

    postJSON("/admin/probar-conexion", {
      host: $("#conexion-host").value,
    }).then(function (resp) {
      if (!resp.ok) {
        salida.textContent = "Error: " + (resp.data.error || "desconocido");
        return;
      }
      salida.textContent =
        "$ " +
        resp.data.comando +
        "\n\n" +
        (resp.data.salida || "") +
        (resp.data.error ? "\n[stderr]\n" + resp.data.error : "");
    });
  }

  function verDiagnostico() {
    var salida = $("#salida-diagnostico");
    salida.textContent = "Cargando…";
    api("/_diagnostico").then(function (resp) {
      salida.textContent = JSON.stringify(resp.data, null, 2);
    });
  }

  /* ------------------------------------------------------------------ tabs */
  function activarTab(evento) {
    var tab = evento.target.closest(".tab");
    if (!tab) return;
    var vista = tab.getAttribute("data-vista");
    $$(".tab").forEach(function (t) {
      t.classList.remove("is-active");
    });
    tab.classList.add("is-active");
    $$(".tab-panel").forEach(function (p) {
      p.classList.toggle("is-active", p.getAttribute("data-panel") === vista);
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    var params = new URLSearchParams(window.location.search);
    var objetivo = params.get("vista");
    if (objetivo) {
      $("#panel-bienvenida").textContent = "Panel " + objetivo;
    }

    $("#form-login").addEventListener("submit", iniciarSesion);
    $("#btn-logout").addEventListener("click", cerrarSesion);
    $("#btn-refrescar").addEventListener("click", cargarTodo);
    $("#tabs").addEventListener("click", activarTab);
    $("#tabla-pedidos").addEventListener("change", cambiarEstado);
    $("#tabla-productos").addEventListener("click", borrarProducto);
    $("#form-producto").addEventListener("submit", guardarProducto);
    $("#btn-limpiar-producto").addEventListener(
      "click",
      limpiarFormularioProducto,
    );
    $("#form-upload").addEventListener("submit", subirArchivo);
    $("#form-password").addEventListener("submit", cambiarPassword);
    $("#btn-reporte-variedad").addEventListener("click", consultarVentas);
    $("#tabla-usuarios").addEventListener("change", cambiarRol);
    $("#form-conexion").addEventListener("submit", probarConexion);
    $("#btn-diagnostico").addEventListener("click", verDiagnostico);

    // ¿Ya hay sesión?
    api("/auth/yo").then(function (resp) {
      if (resp.ok) {
        usuario = resp.data.usuario;
        mostrarPanel();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
