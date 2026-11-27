"use client";

import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Barcode,
  Calendar,
  Camera,
  CheckCircle2,
  Package,
  PackagePlus,
} from "lucide-react";
import {
  calcularEstadoLote,
  dbOffline,
  ordenarLotesFEFO,
  type CatalogoLocal,
  type LoteLocal,
} from "@/lib/db-offline";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal";
import { IngresoLoteModal } from "@/components/IngresoLoteModal";

const EMPTY_CATALOGO: CatalogoLocal[] = [];
const EMPTY_LOTES: LoteLocal[] = [];

export default function InventarioPage() {
  useOfflineSync();

  const catalogo = useLiveQuery(
    () => dbOffline.catalogo.toArray(),
    [],
    EMPTY_CATALOGO
  );
  const lotes = useLiveQuery(() => dbOffline.lotes.toArray(), [], EMPTY_LOTES);

  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [modalIngresoAbierto, setModalIngresoAbierto] = useState(false);
  const [productoPreseleccionado, setProductoPreseleccionado] = useState<
    string | null
  >(null);
  const [codigoNuevoEscaneado, setCodigoNuevoEscaneado] = useState<
    string | null
  >(null);
  const [avisoExito, setAvisoExito] = useState<string | null>(null);

  const mapaCatalogo = new Map(catalogo.map((c) => [c.id, c]));
  const lotesOrdenados = ordenarLotesFEFO(lotes);

  const manejarCodigoEscaneadoInventario = (codigoBarras: string) => {
    setEscanerAbierto(false);
    const limpio = codigoBarras.trim();
    const existente = catalogo.find((c) => c.codigoBarras === limpio);

    if (existente) {
      setCodigoNuevoEscaneado(null);
      setProductoPreseleccionado(existente.id);
    } else {
      // Código EAN-13 no registrado: abrir formulario de Nuevo Producto con codigoBarras prellenado
      setProductoPreseleccionado(null);
      setCodigoNuevoEscaneado(limpio);
    }
    setModalIngresoAbierto(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-brand-primary" />
            Inventario por Lotes (FEFO)
          </h1>
          <p className="text-xs text-slate-600">
            Ordenado por vencimiento más próximo · Sincronizado con Dexie.js
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-primary-tint px-3 py-1 text-xs font-bold text-brand-primary">
          {lotesOrdenados.length} Lotes
        </span>
      </div>

      {/* Acciones rápidas de recepción de mercadería por escáner o alta directa */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => setEscanerAbierto(true)}
          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-brand-primary bg-white px-3.5 py-3 text-xs font-extrabold text-brand-primary shadow-2xs hover:bg-brand-primary-tint/50 cursor-pointer"
        >
          <Camera className="h-4 w-4 shrink-0" />
          Escanear Ingreso EAN-13
        </button>

        <button
          type="button"
          onClick={() => {
            setProductoPreseleccionado(null);
            setCodigoNuevoEscaneado(null);
            setModalIngresoAbierto(true);
          }}
          className="flex items-center justify-center gap-2 rounded-2xl bg-brand-amber px-3.5 py-3 text-xs font-extrabold text-white shadow-2xs hover:bg-brand-amber-dark cursor-pointer"
        >
          <PackagePlus className="h-4 w-4 shrink-0" />
          + Lote / Nuevo Producto
        </button>
      </div>

      {avisoExito && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-brand-primary/30 bg-brand-primary-tint px-4 py-3 text-xs font-bold text-brand-primary">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {avisoExito}
          </span>
          <button
            type="button"
            onClick={() => setAvisoExito(null)}
            className="text-brand-primary/70 hover:text-brand-primary cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {lotesOrdenados.map((lote) => {
          const prod = mapaCatalogo.get(lote.productoId);
          const estadoVig = calcularEstadoLote(
            lote.stockActual,
            lote.fechaVencimiento
          );

          return (
            <div
              key={lote.id}
              className="flex items-center justify-between rounded-2xl border border-border-subtle bg-white p-3.5 shadow-2xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
                    <Barcode className="h-3.5 w-3.5" />
                    {prod?.codigoBarras ?? "---"}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {prod?.categoria ?? "General"}
                  </span>
                  {!lote.sincronizado && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      Local
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm font-bold text-slate-900 truncate">
                  {prod?.nombreProducto ?? "Cargando producto..."}
                </p>
                {lote.fechaVencimiento && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Calendar className="h-3 w-3" />
                    Vence:{" "}
                    {new Date(lote.fechaVencimiento).toLocaleDateString("es-BO")}
                  </p>
                )}
              </div>

              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-extrabold text-brand-primary">
                  Bs {lote.precioVenta.toFixed(2)}
                </p>
                <span
                  className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    estadoVig === "POR_VENCER"
                      ? "bg-brand-amber-tint text-brand-amber-dark"
                      : estadoVig === "AGOTADO" || estadoVig === "VENCIDO"
                        ? "bg-slate-200 text-slate-600"
                        : "bg-brand-primary-tint text-brand-primary"
                  }`}
                >
                  Stock: {lote.stockActual} ·{" "}
                  {estadoVig === "POR_VENCER" ? "Por vencer" : estadoVig}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <BarcodeScannerModal
        abierto={escanerAbierto}
        onClose={() => setEscanerAbierto(false)}
        onDetected={manejarCodigoEscaneadoInventario}
      />

      <IngresoLoteModal
        key={`${productoPreseleccionado ?? "inv"}-${codigoNuevoEscaneado ?? "exist"}`}
        abierto={modalIngresoAbierto}
        catalogo={catalogo}
        lotesActuales={lotes}
        productoInicialId={productoPreseleccionado}
        codigoBarrasNuevoInicial={codigoNuevoEscaneado}
        onClose={() => {
          setModalIngresoAbierto(false);
          setCodigoNuevoEscaneado(null);
        }}
        onSuccess={(mensaje) => setAvisoExito(mensaje)}
      />
    </div>
  );
}
