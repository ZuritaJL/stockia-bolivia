"use client";

import React, { useMemo, useState } from "react";
import { Calendar, CheckCircle2, PackagePlus, X } from "lucide-react";
import {
  registrarIngresoLoteLocal,
  type CatalogoLocal,
  type LoteLocal,
} from "@/lib/db-offline";

interface IngresoLoteModalProps {
  abierto: boolean;
  catalogo: CatalogoLocal[];
  lotesActuales: LoteLocal[];
  productoInicialId?: string | null;
  onClose: () => void;
  onSuccess: (mensaje: string) => void;
}

function sumarFechaInput( tipo: "7d" | "1m" | "3m" | "6m" ): string {
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
  onClose,
  onSuccess,
}: IngresoLoteModalProps) {
  const primerProductoId = productoInicialId || catalogo[0]?.id || "";
  const [productoId, setProductoId] = useState<string>(primerProductoId);
  const [filtroProducto, setFiltroProducto] = useState("");
  const [stockActual, setStockActual] = useState<string>("12");
  const [precioCompra, setPrecioCompra] = useState<string>("8.00");
  const [precioVenta, setPrecioVenta] = useState<string>("10.50");
  const [fechaVencimiento, setFechaVencimiento] = useState<string>(() =>
    sumarFechaInput("1m")
  );
  const [atajoActivo, setAtajoActivo] = useState<string>("1m");
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const idSeleccionadoEfectivo =
    productoInicialId && productoId === "" ? productoInicialId : productoId || primerProductoId;

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
    // Autocompletar precios sugeridos a partir del último lote registrado del producto
    const lotePrevio = lotesActuales.find((l) => l.productoId === nuevoId);
    if (lotePrevio) {
      setPrecioCompra(lotePrevio.precioCompra.toFixed(2));
      setPrecioVenta(lotePrevio.precioVenta.toFixed(2));
    }
  };

  if (!abierto) return null;

  const aplicarVencimientoRapido = (atajo: "7d" | "1m" | "3m" | "6m" | "sin") => {
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

    if (!idSeleccionadoEfectivo) {
      setErrorForm("Selecciona un producto del catálogo.");
      return;
    }
    if (!Number.isFinite(cant) || cant <= 0) {
      setErrorForm("Ingresa una cantidad válida mayor a 0.");
      return;
    }
    if (!Number.isFinite(compra) || compra < 0 || !Number.isFinite(venta) || venta <= 0) {
      setErrorForm("Revisa los precios de compra y venta en Bs.");
      return;
    }

    try {
      setGuardando(true);
      const fechaIso = fechaVencimiento
        ? new Date(`${fechaVencimiento}T23:59:59`).toISOString()
        : null;

      await registrarIngresoLoteLocal({
        productoId: idSeleccionadoEfectivo,
        stockActual: cant,
        precioCompra: compra,
        precioVenta: venta,
        fechaVencimiento: fechaIso,
      });

      const prod = catalogo.find((c) => c.id === idSeleccionadoEfectivo);
      onSuccess(
        `Ingreso guardado: +${cant} u. de ${prod?.nombreProducto ?? "producto"}`
      );
      onClose();
    } catch (err) {
      setErrorForm(
        err instanceof Error ? err.message : "No se pudo guardar el lote."
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
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
                Registrar Ingreso / Lote
              </h2>
              <p className="text-[11px] text-emerald-100/85">
                Guardado instantáneo en dispositivo + cola FEFO
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
          {errorForm && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              {errorForm}
            </div>
          )}

          {/* Selección de Producto */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              Producto del Catálogo (777...)
            </label>
            <input
              type="search"
              value={filtroProducto}
              onChange={(e) => setFiltroProducto(e.target.value)}
              placeholder="Filtrar producto por nombre o código..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-brand-primary focus:bg-white focus:outline-none"
            />
            <select
              value={idSeleccionadoEfectivo}
              onChange={(e) => seleccionarProducto(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-brand-primary focus:outline-none"
            >
              {productosFiltrados.map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.nombreProducto} ({prod.marca}) · {prod.codigoBarras}
                </option>
              ))}
            </select>
          </div>

          {/* Cantidad con botones rápidos */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">
                Cantidad Recibida (Unidades)
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
            {guardando ? "Guardando lote..." : "Guardar Lote en Inventario"}
          </button>
        </form>
      </div>
    </div>
  );
}
