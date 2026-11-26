"use client";

import React, { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "stockia_pwa_banner_cerrado_v1";

export function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [guiaManualVisible, setGuiaManualVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Registrar Service Worker en producción para soporte offline garantizado
    if (
      process.env.NODE_ENV === "production" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const yaInstalada =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);

    const fueCerrado = window.sessionStorage.getItem(DISMISS_KEY) === "1";
    if (yaInstalada || fueCerrado) return;

    const manejarBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const manejarAppInstalled = () => {
      setDeferredPrompt(null);
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", manejarBeforeInstallPrompt);
    window.addEventListener("appinstalled", manejarAppInstalled);

    // En navegadores móviles iOS/Safari donde no existe beforeinstallprompt, mostrar invitación discreta
    const timerIos = window.setTimeout(() => {
      const ua = window.navigator.userAgent.toLowerCase();
      const esMovil = /iphone|ipad|ipod|android/.test(ua);
      if (esMovil && !yaInstalada && !fueCerrado) {
        setVisible(true);
      }
    }, 800);

    return () => {
      window.clearTimeout(timerIos);
      window.removeEventListener(
        "beforeinstallprompt",
        manejarBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", manejarAppInstalled);
    };
  }, []);

  const cerrarBanner = () => {
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignorar modo privado
    }
  };

  const instalarAplicacion = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const eleccion = await deferredPrompt.userChoice;
      if (eleccion.outcome === "accepted") {
        setVisible(false);
      }
      setDeferredPrompt(null);
    } else {
      setGuiaManualVisible((prev) => !prev);
    }
  };

  if (!visible) return null;

  return (
    <div className="rounded-2xl border border-[#10563E]/30 bg-brand-primary-tint/85 px-3.5 py-3 shadow-2xs space-y-2">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#10563E] text-white">
            <Smartphone className="h-4 w-4 text-amber-300" />
          </div>
          <p className="text-xs font-semibold text-slate-800 leading-snug">
            Instala StockIA en tu celular (funciona sin internet y ocupa menos
            de 2 MB)
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void instalarAplicacion()}
            className="inline-flex items-center gap-1 rounded-xl bg-[#10563E] px-3 py-1.5 text-xs font-extrabold text-white shadow-2xs hover:bg-brand-primary-light cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Instalar App
          </button>

          <button
            type="button"
            onClick={cerrarBanner}
            aria-label="Cerrar aviso de instalación"
            className="rounded-lg p-1 text-slate-500 hover:bg-white/70 hover:text-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {guiaManualVisible && (
        <p className="rounded-xl bg-white px-3 py-2 text-[11px] text-slate-600 border border-slate-200">
          En tu navegador móvil abre el menú <strong>(⋮)</strong> o{" "}
          <strong>Compartir</strong> y selecciona{" "}
          <strong className="text-[#10563E]">
            &ldquo;Agregar a la pantalla principal&rdquo;
          </strong>
          .
        </p>
      )}
    </div>
  );
}
