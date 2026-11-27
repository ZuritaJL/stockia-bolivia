"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Crown,
  Loader2,
  LogOut,
  Mic,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import {
  actualizarCuotaVozGlobal,
  useVoiceQuota,
} from "@/lib/voice-quota-store";
import { useRole } from "@/context/RoleContext";

/**
 * Matriz determinista 21x21 estilo QR Simple Bolivia para demostración visual limpia.
 */
const QR_MATRIX_21: number[][] = Array.from({ length: 21 }, (_, r) =>
  Array.from({ length: 21 }, (__, c) => {
    const inFinder = (fr: number, fc: number) =>
      r >= fr &&
      r < fr + 7 &&
      c >= fc &&
      c < fc + 7 &&
      (r === fr ||
        r === fr + 6 ||
        c === fc ||
        c === fc + 6 ||
        (r >= fr + 2 && r <= fr + 4 && c >= fc + 2 && c <= fc + 4));

    const inFinderQuiet = (fr: number, fc: number) =>
      r >= fr && r < fr + 7 && c >= fc && c < fc + 7;

    if (inFinderQuiet(0, 0)) return inFinder(0, 0) ? 1 : 0;
    if (inFinderQuiet(0, 14)) return inFinder(0, 14) ? 1 : 0;
    if (inFinderQuiet(14, 0)) return inFinder(14, 0) ? 1 : 0;

    if (r === 6 || c === 6) return (r + c) % 2 === 0 ? 1 : 0;
    return (r * 17 + c * 31 + r * c) % 3 === 0 ? 1 : 0;
  })
);

export default function SuscripcionPlanPage() {
  const cuota = useVoiceQuota();
  const { sesion, cerrarSesion } = useRole();
  const router = useRouter();

  const [modalQrAbierto, setModalQrAbierto] = useState(false);
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [restableciendo, setRestableciendo] = useState(false);
  const [mensajeConfirmacion, setMensajeConfirmacion] = useState<string | null>(
    null
  );

  const esPro = cuota.plan === "VOZ_PRO";
  const usadosHoy = Math.min(cuota.limite, cuota.usados);
  const porcentajeUsado = Math.min(
    100,
    Math.round((usadosHoy / cuota.limite) * 100)
  );

  const actualizarPlanEnServidor = async (
    nuevoPlan: "VOZ_PRO" | "BASICO_GRATIS"
  ) => {
    const esUpgrade = nuevoPlan === "VOZ_PRO";
    if (esUpgrade) setProcesandoPago(true);
    else setRestableciendo(true);

    setMensajeConfirmacion(null);

    try {
      const res = await fetch("/api/comerciante/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuarioId: cuota.usuarioId ?? undefined,
          plan: nuevoPlan,
          referenciaQr: esUpgrade ? `QRSIMPLE-BO-${Date.now()}` : undefined,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        mensaje?: string;
        cuota?: {
          usuarioId?: string;
          plan: "BASICO_GRATIS" | "VOZ_PRO";
          usados: number;
          limite: number;
          restantes: number | null;
        };
      };

      if (res.ok && data.ok && data.cuota) {
        actualizarCuotaVozGlobal({
          usuarioId: data.cuota.usuarioId ?? cuota.usuarioId,
          plan: data.cuota.plan,
          usados: data.cuota.usados,
          limite: data.cuota.limite,
          restantes: data.cuota.restantes,
        });

        setModalQrAbierto(false);
        setMensajeConfirmacion(
          data.mensaje ?? "Plan actualizado correctamente."
        );
      }
    } finally {
      setProcesandoPago(false);
      setRestableciendo(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Ficha de Perfil de Usuario Activo + Cerrar Sesión */}
      {sesion && (
        <section className="rounded-2xl border border-border-subtle bg-white p-4 shadow-2xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#10563E] text-white">
              <Store className="h-5 w-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900 truncate">
                {sesion.nombreEntidad}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {sesion.nombreUsuario} · {sesion.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              cerrarSesion();
              router.push("/");
            }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar Sesión
          </button>
        </section>
      )}

      {/* Encabezado */}
      <div>
        <h1 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
          <Crown className="h-5 w-5 text-[#D97706]" />
          Planes y Suscripción StockIA
        </h1>
        <p className="text-xs text-slate-600">
          Elige cómo potenciar la atención de tu tienda en horas pico
        </p>
      </div>

      {mensajeConfirmacion && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#10563E]/30 bg-brand-primary-tint px-4 py-3 text-xs font-bold text-[#10563E]">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {mensajeConfirmacion}
          </span>
          <button
            type="button"
            onClick={() => setMensajeConfirmacion(null)}
            className="text-[#10563E]/70 hover:text-[#10563E] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TARJETA 1: PLAN ASISTENTE VOZ PRO (Bs 25 / mes - RECOMENDADO)        */}
      {/* ==================================================================== */}
      <section
        className={`relative rounded-3xl p-5 shadow-sm space-y-4 transition ${
          esPro
            ? "border-2 border-[#10563E] bg-gradient-to-br from-white via-white to-brand-primary-tint/50"
            : "border-2 border-[#D97706] bg-gradient-to-br from-white via-white to-brand-amber-tint/45"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold text-white ${
                esPro ? "bg-[#10563E]" : "bg-[#D97706]"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              {esPro
                ? "ACTIVO · VOZ PRO ILIMITADO"
                : "RECOMENDADO · ASISTENTE VOZ PRO"}
            </span>
            <h2 className="mt-1.5 text-lg font-black text-slate-900">
              Plan Asistente Voz Pro
            </h2>
          </div>

          <div className="text-right shrink-0">
            <span className="text-2xl font-black text-[#10563E]">Bs 25</span>
            <span className="block text-[11px] font-semibold text-slate-500">
              por mes
            </span>
          </div>
        </div>

        <ul className="space-y-2 text-xs text-slate-700">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-[#10563E] shrink-0 stroke-[2.5]" />
            <span>
              <strong>Comandos de voz ilimitados 24/7</strong> con IA sin tope
              diario
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-[#10563E] shrink-0 stroke-[2.5]" />
            <span>
              Registro múltiple de ventas y lotes nuevos solo hablando
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-[#10563E] shrink-0 stroke-[2.5]" />
            <span>
              Sugerencias automáticas de compra para preventistas y detector de
              capital dormido
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-[#10563E] shrink-0 stroke-[2.5]" />
            <span>Todo lo incluido en el Plan Básico + soporte prioritario</span>
          </li>
        </ul>

        {esPro ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-[#10563E] px-4 py-3 text-xs font-extrabold text-white">
            <ShieldCheck className="h-4 w-4 text-amber-300" />
            Tu tienda cuenta con Voz Pro Ilimitado activo
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setModalQrAbierto(true)}
            className="w-full min-h-12 flex items-center justify-center gap-2 rounded-2xl bg-[#D97706] px-4 py-3 text-sm font-extrabold text-white shadow-sm transition active:scale-[0.99] hover:bg-brand-amber-dark cursor-pointer"
          >
            <QrCode className="h-4 w-4" />
            Activar con QR Simple Bolivia · Bs 25
          </button>
        )}
      </section>

      {/* ==================================================================== */}
      {/* TARJETA 2: PLAN BÁSICO GRATIS (Bs 0 / mes + BARRA DE CUOTA 15/DÍA)   */}
      {/* ==================================================================== */}
      <section
        className={`rounded-3xl bg-white p-5 shadow-2xs space-y-4 ${
          !esPro
            ? "border-2 border-[#10563E]/60"
            : "border border-border-subtle"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
              {!esPro ? "TU PLAN ACTUAL" : "PLAN GRATUITO"}
            </span>
            <h2 className="mt-1 text-base font-extrabold text-slate-900">
              Plan Básico
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xl font-black text-slate-900">Bs 0</span>
            <span className="block text-[11px] text-slate-500">por siempre</span>
          </div>
        </div>

        {/* Barra de progreso de cuota diaria de voz */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
              <Mic className="h-3.5 w-3.5 text-[#D97706]" />
              Uso de comandos de voz hoy
            </span>
            <span className="font-extrabold text-slate-900">
              {esPro ? "Ilimitado (Voz Pro)" : `${usadosHoy} / ${cuota.limite} usados`}
            </span>
          </div>

          <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                esPro
                  ? "bg-[#10563E]"
                  : porcentajeUsado >= 80
                    ? "bg-[#D97706]"
                    : "bg-[#10563E]"
              }`}
              style={{ width: esPro ? "100%" : `${porcentajeUsado}%` }}
            />
          </div>
        </div>

        <ul className="space-y-1.5 text-xs text-slate-600">
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-[#10563E] shrink-0" />
            Mostrador Offline-First ilimitado con respaldo local
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-[#10563E] shrink-0" />
            Escáner de códigos de barras EAN-13 con cámara trasera
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-[#10563E] shrink-0" />
            Alertas FEFO básicas y hasta 15 comandos de voz diarios
          </li>
        </ul>

        {/* Botón discreto de demostración para volver a Básico Gratis */}
        {esPro && (
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={restableciendo}
              onClick={() => void actualizarPlanEnServidor("BASICO_GRATIS")}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 cursor-pointer"
            >
              {restableciendo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Restablecer a Plan Básico (15/día) · Demo
            </button>
          </div>
        )}
      </section>

      {/* ==================================================================== */}
      {/* MODAL DE PAGO RÁPIDO CON QR SIMPLE BOLIVIA (Bs 25.00)                */}
      {/* ==================================================================== */}
      {modalQrAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-qr-simple"
        >
          <div className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#10563E] px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-amber-300" />
                <div>
                  <h3 id="titulo-qr-simple" className="text-sm font-extrabold">
                    Pago Rápido con QR Simple Bolivia
                  </h3>
                  <p className="text-[11px] text-emerald-100/85">
                    Interoperable con todos los bancos y billeteras
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalQrAbierto(false)}
                aria-label="Cerrar modal QR"
                className="rounded-xl bg-white/15 p-1.5 text-white hover:bg-white/25 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-center">
              {/* Marco visual QR Simple */}
              <div className="mx-auto w-52 rounded-2xl border-2 border-[#10563E] bg-white p-3 shadow-xs">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-extrabold uppercase text-[#10563E]">
                  <span>QR SIMPLE</span>
                  <span className="text-[#D97706]">BOLIVIA</span>
                </div>

                <svg
                  viewBox="0 0 21 21"
                  className="w-full h-auto rounded-lg bg-white p-1"
                  shapeRendering="crispEdges"
                  aria-label="Código QR Simple Bolivia por Bs 25.00"
                >
                  {QR_MATRIX_21.map((fila, r) =>
                    fila.map((celda, c) =>
                      celda === 1 ? (
                        <rect
                          key={`${r}-${c}`}
                          x={c}
                          y={r}
                          width={1}
                          height={1}
                          fill="#0F172A"
                        />
                      ) : null
                    )
                  )}
                </svg>

                <p className="mt-1.5 text-[10px] font-semibold text-slate-500">
                  BNB · Unión · BCP · Mercantil · Yape · Tigo Money
                </p>
              </div>

              {/* Resumen de Glosa y Monto */}
              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Concepto:</span>
                  <strong className="text-slate-900">
                    StockIA Voz Pro (1 Mes)
                  </strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Importe exacto:</span>
                  <strong className="text-base font-black text-[#10563E]">
                    Bs 25.00
                  </strong>
                </div>
              </div>

              {/* Botón Confirmar Pago Simulado */}
              <button
                type="button"
                disabled={procesandoPago}
                onClick={() => void actualizarPlanEnServidor("VOZ_PRO")}
                className="w-full min-h-12 flex items-center justify-center gap-2 rounded-2xl bg-[#10563E] px-4 py-3 text-sm font-extrabold text-white shadow-md hover:bg-brand-primary-light disabled:opacity-60 cursor-pointer"
              >
                {procesandoPago ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verificando transferencia...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-amber-300" />
                    Confirmar Pago Simulado
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
