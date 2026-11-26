"use client";

import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Barcode, Calendar, Package } from "lucide-react";
import {
  calcularEstadoLote,
  dbOffline,
  ordenarLotesFEFO,
} from "@/lib/db-offline";
import { useOfflineSync } from "@/hooks/useOfflineSync";

export default function InventarioPage() {
  useOfflineSync();

  const catalogo = useLiveQuery(() => dbOffline.catalogo.toArray(), []) ?? [];
  const lotes = useLiveQuery(() => dbOffline.lotes.toArray(), []) ?? [];

  const mapaCatalogo = new Map(catalogo.map((c) => [c.id, c]));
  const lotesOrdenados = ordenarLotesFEFO(lotes);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-brand-primary" />
            Inventario por Lotes (FEFO)
          </h1>
          <p className="text-xs text-slate-600">
            Ordenado por vencimiento más próximo · Sincronizado con Dexie.js
          </p>
        </div>
        <span className="rounded-full bg-brand-primary-tint px-3 py-1 text-xs font-bold text-brand-primary">
          {lotesOrdenados.length} Lotes
        </span>
      </div>

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
    </div>
  );
}
