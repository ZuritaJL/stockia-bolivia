"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import { Barcode, Camera, Loader2, Sparkles, X } from "lucide-react";

interface BarcodeScannerModalProps {
  abierto: boolean;
  onClose: () => void;
  onDetected: (codigoBarras: string) => void;
}

const CODIGOS_DEMO_RAPIDOS = [
  { codigo: "7771609000124", etiqueta: "Coca-Cola 2L" },
  { codigo: "7771207003051", etiqueta: "Yogurt Pil (FEFO)" },
  { codigo: "7779900112233", etiqueta: "EAN-13 Nuevo (Alta)" },
];

export function BarcodeScannerModal({
  abierto,
  onClose,
  onDetected,
}: BarcodeScannerModalProps) {
  const reactId = useId().replace(/:/g, "");
  const containerId = `stockia-qr-reader-${reactId}`;

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const detectadoRef = useRef(false);

  const [iniciando, setIniciando] = useState(true);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [codigoManual, setCodigoManual] = useState("");

  const dispararDeteccion = (codigoLimpio: string) => {
    if (detectadoRef.current || !codigoLimpio) return;
    detectadoRef.current = true;

    // Vibración háptica al detectar código de barras en dispositivos móviles
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([120, 40, 120]);
      } catch {
        // Ignorar si el navegador bloquea vibración
      }
    }

    onDetected(codigoLimpio);
  };

  useEffect(() => {
    if (!abierto) return;

    let cancelado = false;
    detectadoRef.current = false;

    const iniciarEscaner = async () => {
      await Promise.resolve();
      if (cancelado) return;
      setIniciando(true);
      setErrorCamara(null);

      try {
        const instancia = new Html5Qrcode(containerId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          useBarCodeDetectorIfSupported: true,
        });

        scannerRef.current = instancia;

        const configLectura = {
          fps: 12,
          qrbox: { width: 260, height: 150 },
          aspectRatio: 1.5,
        };

        const callbackExito = (decodedText: string) => {
          if (cancelado) return;
          dispararDeteccion(decodedText.trim());
        };

        try {
          // Priorizar cámara trasera del celular
          await instancia.start(
            { facingMode: "environment" },
            configLectura,
            callbackExito,
            () => {}
          );
        } catch {
          // Respaldo automático a la primera cámara disponible (ej. laptop/webcam)
          const camaras = await Html5Qrcode.getCameras();
          if (!camaras || camaras.length === 0) {
            throw new Error(
              "No se detectó una cámara disponible o el permiso fue denegado."
            );
          }
          await instancia.start(
            camaras[0].id,
            configLectura,
            callbackExito,
            () => {}
          );
        }

        if (!cancelado) {
          setIniciando(false);
        }
      } catch (err) {
        if (!cancelado) {
          setIniciando(false);
          setErrorCamara(
            err instanceof Error
              ? err.message
              : "No se pudo acceder a la cámara trasera."
          );
        }
      }
    };

    void iniciarEscaner();

    return () => {
      cancelado = true;
      const actual = scannerRef.current;
      scannerRef.current = null;
      if (actual) {
        void (async () => {
          try {
            if (actual.isScanning) {
              await actual.stop();
            }
            actual.clear();
          } catch {
            // Limpieza silenciosa al desmontar
          }
        })();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, containerId]);

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-escaner"
    >
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Cabecera */}
        <div className="flex items-center justify-between bg-brand-primary px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <Camera className="h-5 w-5 text-amber-300" />
            <div>
              <h2 id="titulo-escaner" className="text-base font-extrabold">
                Escanear Código de Barras
              </h2>
              <p className="text-[11px] text-emerald-100/85">
                Apunta al código EAN-13 (777...) con la cámara trasera
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar escáner"
            className="rounded-xl bg-white/15 p-2 text-white hover:bg-white/25 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Visor de Cámara html5-qrcode */}
          <div className="relative min-h-56 rounded-2xl bg-slate-900 overflow-hidden flex items-center justify-center ring-2 ring-brand-primary/30">
            <div id={containerId} className="w-full" />

            {iniciando && !errorCamara && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90 text-white text-xs">
                <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
                <span>Activando cámara trasera...</span>
              </div>
            )}

            {errorCamara && (
              <div className="p-5 text-center text-xs text-amber-200 space-y-2">
                <p className="font-bold text-sm text-white">
                  Cámara no disponible en este dispositivo
                </p>
                <p>{errorCamara}</p>
                <p className="text-emerald-200">
                  Puedes ingresar el código abajo o usar los botones rápidos de prueba.
                </p>
              </div>
            )}
          </div>

          {/* Entrada rápida manual / lector láser USB */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (codigoManual.trim()) {
                dispararDeteccion(codigoManual.trim());
              }
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Barcode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                inputMode="numeric"
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value)}
                placeholder="Ej. 7771609000124"
                className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2.5 text-sm font-mono focus:border-brand-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-brand-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-primary-light cursor-pointer"
            >
              Usar código
            </button>
          </form>

          {/* Simulador rápido de códigos 777 para pruebas en escritorio */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
              <Sparkles className="h-3.5 w-3.5 text-brand-amber" />
              Simulación rápida EAN-13 (Pruebas sin cámara):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CODIGOS_DEMO_RAPIDOS.map((item) => (
                <button
                  key={item.codigo}
                  type="button"
                  onClick={() => dispararDeteccion(item.codigo)}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-brand-primary-tint hover:text-brand-primary cursor-pointer"
                >
                  {item.etiqueta}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
