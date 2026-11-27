"use client";

import React, { useMemo, useState } from "react";
import {
  Barcode,
  Calendar,
  Camera,
  CheckCircle2,
  PackagePlus,
  Sparkles,
  X,
} from "lucide-react";
import {
  registrarIngresoLoteLocal,
  registrarNuevoProductoYLoteLocal,
  type CatalogoLocal,
  type LoteLocal,
  type UnidadMedidaLocal,
} from "@/lib/db-offline";
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal";

interface IngresoLoteModalProps {
  abierto: boolean;
  catalogo: CatalogoLocal[];
  lotesActuales: LoteLocal[];
  productoInicialId?: string | null;
  codigoBarrasNuevoInicial?: string | null;
  onClose: () => void;
  onSuccess: (
    mensaje: string,
    creado?: { producto: CatalogoLocal; lote: LoteLocal }
  ) => void;
}

const CATEGORIAS_SUGERIDAS = [
  "Abarrotes",
  "Bebidas",
  "Lácteos",
  "Snacks",
  "Panadería",
  "Limpieza",
  "Cuidado Personal",
];

const UNIDADES_OPCIONES: Array<{ valor: UnidadMedidaLocal; etiqueta: string }> =
  [
    { valor: "UNIDAD", etiqueta: "Unidad" },
    { valor: "PAQUETE", etiqueta: "Paquete" },
    { valor: "CAJA", etiqueta: "Caja" },
    { valor: "LITRO", etiqueta: "Litro" },
    { valor: "KILO", etiqueta: "Kilo" },
  ];

function sumarFechaInput(tipo: "7d" | "1m" | "3m" | "6m"): string {
  const fecha = new Date();
  if (tipo === "7d") fecha.setDate(fecha.getDate() + 7);
  if (tipo === "1m") fecha.setMonth(fecha.getMonth() + 1);
  if (tipo === "3m") fecha.setMonth(fecha.getMonth() + 3);
  if (tipo === "6m") fecha.setMonth(fecha.getMonth() + 6);

  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function IngresoLoteModal({
  abierto,
  catalogo,
  lotesActuales,
  productoInicialId,
  codigoBarrasNuevoInicial,
  onClose,
  onSuccess,
}: IngresoLoteModalProps) {
  const iniciarEnModoNuevo = Boolean(codigoBarrasNuevoInicial?.trim());
  const [modo, setModo] = useState<"EXISTENTE" | "NUEVO_PRODUCTO">(
    iniciarEnModoNuevo ? "NUEVO_PRODUCTO" : "EXISTENTE"
  );

  // Estado modo producto existente
  const primerProductoId = productoInicialId || catalogo[0]?.id || "";
  const [productoId, setProductoId] = useState<string>(primerProductoId);
  const [filtroProducto, setFiltroProducto] = useState("");

  // Estado modo registrar nuevo producto en CatalogoCurado
  const [codigoBarrasNuevo, setCodigoBarrasNuevo] = useState<string>(
    codigoBarrasNuevoInicial?.trim() || ""
  );
  const [nombreProductoNuevo, setNombreProductoNuevo] = useState<string>("");
  const [marcaNueva, setMarcaNueva] = useState<string>("");
  const [categoriaNueva, setCategoriaNueva] = useState<string>("Abarrotes");
  const [unidadNueva, setUnidadNueva] = useState<UnidadMedidaLocal>("UNIDAD");

  // Estado compartido del lote inicial en InventarioLote
  const [stockActual, setStockActual] = useState<string>("12");
  const [precioCompra, setPrecioCompra] = useState<string>("8.00");
  const [precioVenta, setPrecioVenta] = useState<string>("10.50");
  const [fechaVencimiento, setFechaVencimiento] = useState<string>(() =>
    sumarFechaInput("1m")
  );
  const [atajoActivo, setAtajoActivo] = useState<string>("1m");

  const [escanerInternoAbierto, setEscanerInternoAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const idSeleccionadoEfectivo =
    productoInicialId && productoId === ""
      ? productoInicialId
      : productoId || primerProductoId;

  const productosFiltrados = useMemo(() => {
    const q = filtroProducto.trim().toLowerCase();
    if (!q) return catalogo;
    return catalogo.filter(
      (c) =>
        c.nombreProducto.toLowerCase().includes(q) ||
        c.codigoBarras.includes(q) ||
        c.marca.toLowerCase().includes(q)
    );
  }, [catalogo, filtroProducto]);

  const seleccionarProducto = (nuevoId: string) => {
    setProductoId(nuevoId);
    const lotePrevio = lotesActuales.find((l) => l.productoId === nuevoId);
    if (lotePrevio) {
      setPrecioCompra(lotePrevio.precioCompra.toFixed(2));
      setPrecioVenta(lotePrevio.precioVenta.toFixed(2));
    }
  };

  const manejarLecturaCodigoEnModal = (codigoDetectado: string) => {
    setEscanerInternoAbierto(false);
    setErrorForm(null);
    const limpio = codigoDetectado.trim();
    const existente = catalogo.find((c) => c.codigoBarras === limpio);

    if (existente) {
      setModo("EXISTENTE");
      setFiltroProducto("");
      seleccionarProducto(existente.id);
    } else {
      // Si el código EAN-13 no existe en CatalogoCurado, cambiar automáticamente a Registrar Nuevo Producto prellenado
      setModo("NUEVO_PRODUCTO");
      setCodigoBarrasNuevo(limpio);
    }
  };

  if (!abierto) return null;

  const aplicarVencimientoRapido = (
    atajo: "7d" | "1m" | "3m" | "6m" | "sin"
  ) => {
    setAtajoActivo(atajo);
    if (atajo === "sin") {
      setFechaVencimiento("");
    } else {
      setFechaVencimiento(sumarFechaInput(atajo));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorForm(null);

    const cant = Number.parseInt(stockActual, 10);
    const compra = Number.parseFloat(precioCompra);
    const venta = Number.parseFloat(precioVenta);

    if (!Number.isFinite(cant) || cant <= 0) {
      setErrorForm("Ingresa una cantidad válida mayor a 0.");
      return;
    }
    if (
      !Number.isFinite(compra) ||
      compra < 0 ||
      !Number.isFinite(venta) ||
      venta <= 0
    ) {
      setErrorForm("Revisa los precios de compra y venta en Bs.");
      return;
    }

    const fechaIso = fechaVencimiento
      ? new Date(`${fechaVencimiento}T23:59:59`).toISOString()
      : null;

    try {
      setGuardando(true);

      if (modo === "NUEVO_PRODUCTO") {
        const nombreLimpio = nombreProductoNuevo.trim();
        if (!nombreLimpio) {
          setErrorForm("Escribe el nombre del nuevo producto.");
          setGuardando(false);
          return;
        }

        const codigoFinal =
          codigoBarrasNuevo.trim() || `INT-${Date.now()}`;
        const marcaFinal =
          marcaNueva.trim() ||
          nombreLimpio.split(" ").find((p) => p.length > 2) ||
          "Genérico";

        const creado = await registrarNuevoProductoYLoteLocal({
          codigoBarras: codigoFinal,
          nombreProducto: nombreLimpio,
          marca: marcaFinal,
          categoria: categoriaNueva,
          unidadMedida: unidadNueva,
          stockActual: cant,
          precioCompra: compra,
          precioVenta: venta,
          fechaVencimiento: fechaIso,
        });

        onSuccess(
          `Nuevo producto "${creado.producto.nombreProducto}" (${creado.producto.codigoBarras}) guardado con ${cant} u. en inventario.`,
          creado
        );
        onClose();
        return;
      }

      if (!idSeleccionadoEfectivo) {
        setErrorForm("Selecciona un producto del catálogo.");
        setGuardando(false);
        return;
      }

      const loteCreado = await registrarIngresoLoteLocal({
        productoId: idSeleccionadoEfectivo,
        stockActual: cant,
        precioCompra: compra,
        precioVenta: venta,
        fechaVencimiento: fechaIso,
      });

      const prod = catalogo.find((c) => c.id === idSeleccionadoEfectivo);
      onSuccess(
        `Ingreso guardado: +${cant} u. de ${prod?.nombreProducto ?? "producto"}`,
        prod ? { producto: prod, lote: loteCreado } : undefined
      );
      onClose();
    } catch (err) {
      setErrorForm(
        err instanceof Error ? err.message : "No se pudo guardar el registro."
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-ingreso-lote"
      >
        <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl">
          {/* Cabecera */}
          <div className="sticky top-0 z-10 flex items-center justify-between bg-brand-primary px-5 py-4 text-white">
            <div className="flex items-center gap-2.5">
              <PackagePlus className="h-5 w-5 text-amber-300" />
              <div>
                <h2 id="titulo-ingreso-lote" className="text-base font-extrabold">
                  {modo === "NUEVO_PRODUCTO"
                    ? "Registrar Nuevo Producto y Lote"
                    : "Registrar Ingreso / Lote"}
                </h2>
                <p className="text-[11px] text-emerald-100/85">
                  {modo === "NUEVO_PRODUCTO"
                    ? "Guarda en Catálogo Curado + primer lote FEFO en un solo paso"
                    : "Guardado instantáneo en dispositivo + cola FEFO"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar modal"
              className="rounded-xl bg-white/15 p-2 text-white hover:bg-white/25 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Selector de modo + botón de escáner directo */}
            <div className="flex items-center gap-2">
              <div className="grid grid-cols-2 flex-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setModo("EXISTENTE");
                    setErrorForm(null);
                  }}
                  className={`rounded-lg py-1.5 transition cursor-pointer ${
                    modo === "EXISTENTE"
                      ? "bg-brand-primary text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Del Catálogo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModo("NUEVO_PRODUCTO");
                    setErrorForm(null);
                  }}
                  className={`rounded-lg py-1.5 transition cursor-pointer ${
                    modo === "NUEVO_PRODUCTO"
                      ? "bg-brand-amber text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  + Nuevo Producto
                </button>
              </div>

              <button
                type="button"
                onClick={() => setEscanerInternoAbierto(true)}
                title="Escanear código EAN-13"
                className="inline-flex items-center gap-1.5 rounded-xl border-2 border-brand-primary px-3 py-2 text-xs font-extrabold text-brand-primary hover:bg-brand-primary-tint cursor-pointer shrink-0"
              >
                <Camera className="h-4 w-4" />
                Escanear
              </button>
            </div>

            {iniciarEnModoNuevo && modo === "NUEVO_PRODUCTO" && (
              <div className="flex items-start gap-2 rounded-2xl border border-brand-amber/40 bg-brand-amber-tint/70 px-3.5 py-2.5 text-xs font-semibold text-brand-amber-dark">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-amber" />
                <span>
                  El código{" "}
                  <strong className="font-mono">{codigoBarrasNuevo}</strong> aún
                  no estaba en el catálogo. Completa su nombre y primer lote
                  abajo para registrarlo al instante.
                </span>
              </div>
            )}

            {errorForm && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                {errorForm}
              </div>
            )}

            {/* ============================================================== */}
            {/* MODO A: SELECCIONAR PRODUCTO EXISTENTE                         */}
            {/* ============================================================== */}
            {modo === "EXISTENTE" ? (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Producto del Catálogo (777...)
                </label>
                <input
                  type="search"
                  value={filtroProducto}
                  onChange={(e) => setFiltroProducto(e.target.value)}
                  placeholder="Filtrar producto por nombre o código EAN-13..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-brand-primary focus:bg-white focus:outline-none"
                />

                {productosFiltrados.length === 0 && filtroProducto.trim() ? (
                  <div className="rounded-xl border border-brand-amber/40 bg-brand-amber-tint/50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-800">
                      No encontramos &ldquo;{filtroProducto.trim()}&rdquo; en el
                      catálogo actual.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const txt = filtroProducto.trim();
                        const pareceCodigo = /^\d{6,14}$/.test(txt);
                        if (pareceCodigo) {
                          setCodigoBarrasNuevo(txt);
                        } else {
                          setNombreProductoNuevo(txt);
                        }
                        setModo("NUEVO_PRODUCTO");
                      }}
                      className="w-full rounded-xl bg-brand-amber px-3 py-2 text-xs font-extrabold text-white hover:bg-brand-amber-dark cursor-pointer"
                    >
                      + Registrar como Nuevo Producto en un paso
                    </button>
                  </div>
                ) : (
                  <select
                    value={idSeleccionadoEfectivo}
                    onChange={(e) => seleccionarProducto(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-brand-primary focus:outline-none"
                  >
                    {productosFiltrados.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {prod.nombreProducto} ({prod.marca}) ·{" "}
                        {prod.codigoBarras}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              /* ============================================================== */
              /* MODO B: REGISTRAR NUEVO PRODUCTO EN CATALOGO CURADO            */
              /* ============================================================== */
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5">
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <Barcode className="h-3.5 w-3.5 text-brand-primary" />
                    Código de Barras EAN-13
                  </label>
                  <input
                    type="text"
                    value={codigoBarrasNuevo}
                    onChange={(e) => setCodigoBarrasNuevo(e.target.value)}
                    placeholder="Ej. 7771234567890 (o se autogenera INT-...)"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono font-bold text-slate-900 focus:border-brand-primary focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={nombreProductoNuevo}
                    onChange={(e) => setNombreProductoNuevo(e.target.value)}
                    placeholder="Ej. Atún Van Camp's Lomitos 160g"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-brand-primary focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Marca
                    </label>
                    <input
                      type="text"
                      value={marcaNueva}
                      onChange={(e) => setMarcaNueva(e.target.value)}
                      placeholder="Ej. Van Camp's"
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-brand-primary focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Categoría
                    </label>
                    <select
                      value={categoriaNueva}
                      onChange={(e) => setCategoriaNueva(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-brand-primary focus:outline-none"
                    >
                      {CATEGORIAS_SUGERIDAS.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Unidad
                    </label>
                    <select
                      value={unidadNueva}
                      onChange={(e) =>
                        setUnidadNueva(e.target.value as UnidadMedidaLocal)
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-brand-primary focus:outline-none"
                    >
                      {UNIDADES_OPCIONES.map((u) => (
                        <option key={u.valor} value={u.valor}>
                          {u.etiqueta}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Cantidad con botones rápidos */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  Cantidad del Primer Lote / Ingreso
                </label>
                <div className="flex gap-1.5">
                  {[6, 12, 24, 36].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStockActual(String(n))}
                      className={`rounded-lg px-2 py-0.5 text-xs font-bold cursor-pointer ${
                        stockActual === String(n)
                          ? "bg-brand-primary text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      +{n}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                min={1}
                required
                value={stockActual}
                onChange={(e) => setStockActual(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-extrabold text-slate-900 focus:border-brand-primary focus:outline-none"
              />
            </div>

            {/* Precios Compra y Venta en Bs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Costo Unitario (Bs)
                </label>
                <input
                  type="number"
                  step="0.10"
                  min="0"
                  required
                  value={precioCompra}
                  onChange={(e) => setPrecioCompra(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-900 focus:border-brand-primary focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Precio Venta (Bs)
                </label>
                <input
                  type="number"
                  step="0.10"
                  min="0.10"
                  required
                  value={precioVenta}
                  onChange={(e) => setPrecioVenta(e.target.value)}
                  className="w-full rounded-xl border border-brand-primary/50 bg-brand-primary-tint/30 px-3 py-2.5 text-sm font-extrabold text-brand-primary focus:border-brand-primary focus:outline-none"
                />
              </div>
            </div>

            {/* Botones de Vencimiento Rápido + Calendario */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Calendar className="h-3.5 w-3.5 text-brand-amber" />
                Fecha de Vencimiento del Lote (FEFO)
              </label>

              <div className="grid grid-cols-5 gap-1.5">
                {(
                  [
                    { id: "7d", label: "+7 días" },
                    { id: "1m", label: "+1 mes" },
                    { id: "3m", label: "+3 meses" },
                    { id: "6m", label: "+6 meses" },
                    { id: "sin", label: "No vence" },
                  ] as const
                ).map((btn) => (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => aplicarVencimientoRapido(btn.id)}
                    className={`rounded-xl py-2 px-1 text-[11px] font-bold transition cursor-pointer ${
                      atajoActivo === btn.id
                        ? "bg-brand-amber text-white shadow-xs"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => {
                  setFechaVencimiento(e.target.value);
                  setAtajoActivo("calendario");
                }}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-800 focus:border-brand-primary focus:outline-none"
              />
            </div>

            {/* Botón Guardar */}
            <button
              type="submit"
              disabled={guardando}
              className="w-full min-h-13 flex items-center justify-center gap-2 rounded-2xl bg-brand-primary px-5 py-3.5 text-base font-extrabold text-white shadow-md hover:bg-brand-primary-light disabled:opacity-60 cursor-pointer"
            >
              <CheckCircle2 className="h-5 w-5" />
              {guardando
                ? "Guardando..."
                : modo === "NUEVO_PRODUCTO"
                  ? "Guardar Nuevo Producto y Primer Lote"
                  : "Guardar Lote en Inventario"}
            </button>
          </form>
        </div>
      </div>

      {/* Escáner secundario cuando se invoca desde dentro del formulario de ingreso */}
      <BarcodeScannerModal
        abierto={escanerInternoAbierto}
        onClose={() => setEscanerInternoAbierto(false)}
        onDetected={manejarLecturaCodigoEnModal}
      />
    </>
  );
}
