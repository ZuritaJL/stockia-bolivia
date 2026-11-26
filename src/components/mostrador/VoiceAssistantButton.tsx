"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Volume2,
  X,
} from "lucide-react";
import {
  actualizarCuotaVozGlobal,
  notificarMutacionNubeStockia,
  useVoiceQuota,
} from "@/lib/voice-quota-store";
import {
  sincronizarInventarioLocalDesdeNube,
  type CatalogoLocal,
  type LoteLocal,
} from "@/lib/db-offline";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstanceLike;

interface RespuestaAsistenteVoz {
  ok: boolean;
  estado?: "EJECUTADO" | "LIMITE_ALCANZADO";
  mensajeVoz?: string;
  error?: string;
  operacion?: {
    tipo: string;
    titulo: string;
    detalle: string;
  };
  undoToken?: string | null;
  mutoBaseDatos?: boolean;
  cambiosLocales?: {
    productos?: CatalogoLocal[];
    lotes?: LoteLocal[];
  };
  cuota?: {
    plan: "BASICO_GRATIS" | "VOZ_PRO";
    usados: number;
    limite: number;
    restantes: number | null;
  };
}

interface TarjetaResultadoVoz {
  estado: "EJECUTADO" | "LIMITE_ALCANZADO" | "ERROR" | "REVERTIDO";
  comandoDictado: string;
  mensajeVoz: string;
  titulo: string;
  detalle: string;
  undoToken: string | null;
}

const EJEMPLOS_RAPIDOS = [
  "Aumenta 10 unidades de Coca-Cola 2L",
  "Crea el producto Galletas Oreo a 5 bolivianos con 10 unidades",
  "Vendí 2 Yogurt Pil Frutilla",
];

function hablarTextoEspañol(texto: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = "es-BO";
    utterance.rate = 1.04;
    utterance.pitch = 1.0;

    const voces = window.speechSynthesis.getVoices();
    const vozEspanol =
      voces.find((v) => v.lang.toLowerCase().startsWith("es-bo")) ??
      voces.find((v) => v.lang.toLowerCase().startsWith("es-419")) ??
      voces.find((v) => v.lang.toLowerCase().startsWith("es-mx")) ??
      voces.find((v) => v.lang.toLowerCase().startsWith("es"));

    if (vozEspanol) {
      utterance.voice = vozEspanol;
      utterance.lang = vozEspanol.lang;
    }

    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignorar si el navegador restringe síntesis automática
  }
}

export function VoiceAssistantButton() {
  const cuota = useVoiceQuota();

  const [escuchando, setEscuchando] = useState(false);
  const [procesandoIA, setProcesandoIA] = useState(false);
  const [deshaciendo, setDeshaciendo] = useState(false);

  const [transcripcionEnVivo, setTranscripcionEnVivo] = useState("");
  const [mostrarCampoTexto, setMostrarCampoTexto] = useState(false);
  const [textoManual, setTextoManual] = useState("");

  const [tarjeta, setTarjeta] = useState<TarjetaResultadoVoz | null>(null);
  const [segundosDeshacer, setSegundosDeshacer] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const textoAcumuladoRef = useRef("");
  const enviadoEnSesionRef = useRef(false);

  // Temporizador regresivo de 6 segundos para el botón "Deshacer"
  useEffect(() => {
    if (!tarjeta?.undoToken || segundosDeshacer <= 0) return;

    const intervalo = window.setInterval(() => {
      setSegundosDeshacer((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalo);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalo);
  }, [tarjeta?.undoToken, segundosDeshacer]);

  const enviarComandoAlServidor = useCallback(
    async (comando: string) => {
      const limpio = comando.trim();
      if (!limpio || procesandoIA) return;

      setProcesandoIA(true);
      setTranscripcionEnVivo(limpio);

      try {
        const res = await fetch("/api/voice-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textoComando: limpio,
            usuarioId: cuota.usuarioId ?? undefined,
            comercioId: cuota.comercioId ?? undefined,
          }),
        });

        const data = (await res.json()) as RespuestaAsistenteVoz;

        if (data.cuota) {
          actualizarCuotaVozGlobal({
            plan: data.cuota.plan,
            usados: data.cuota.usados,
            limite: data.cuota.limite,
            restantes: data.cuota.restantes,
          });
        }

        if (data.estado === "LIMITE_ALCANZADO") {
          const msg =
            data.mensajeVoz ??
            "Alcanzaste tus 15 comandos gratuitos de hoy. Activa el Plan Asistente Voz Pro por Bs 25 al mes.";
          hablarTextoEspañol(msg);
          setTarjeta({
            estado: "LIMITE_ALCANZADO",
            comandoDictado: limpio,
            mensajeVoz: msg,
            titulo: data.operacion?.titulo ?? "Límite gratuito alcanzado",
            detalle:
              data.operacion?.detalle ??
              "Activa el Plan Asistente Voz Pro (Bs 25/mes).",
            undoToken: null,
          });
          setSegundosDeshacer(0);
          return;
        }

        if (!res.ok || !data.ok) {
          const errTexto =
            data.error ?? "No pude procesar el comando en este momento.";
          hablarTextoEspañol(errTexto);
          setTarjeta({
            estado: "ERROR",
            comandoDictado: limpio,
            mensajeVoz: errTexto,
            titulo: "Atención",
            detalle: errTexto,
            undoToken: null,
          });
          setSegundosDeshacer(0);
          return;
        }

        const respuestaHablada =
          data.mensajeVoz ?? "Operación completada correctamente.";
        hablarTextoEspañol(respuestaHablada);

        if (data.mutoBaseDatos) {
          await sincronizarInventarioLocalDesdeNube(data.cambiosLocales);
          notificarMutacionNubeStockia();
        }

        const tieneUndo = Boolean(data.undoToken);
        setTarjeta({
          estado: "EJECUTADO",
          comandoDictado: limpio,
          mensajeVoz: respuestaHablada,
          titulo: data.operacion?.titulo ?? "Comando ejecutado",
          detalle: data.operacion?.detalle ?? respuestaHablada,
          undoToken: data.undoToken ?? null,
        });
        setSegundosDeshacer(tieneUndo ? 6 : 0);
        setMostrarCampoTexto(false);
        setTextoManual("");
      } catch {
        const msgRed =
          "El asistente de voz requiere conexión a internet. Usa el mostrador táctil o escáner en modo sin conexión.";
        hablarTextoEspañol(msgRed);
        setTarjeta({
          estado: "ERROR",
          comandoDictado: limpio,
          mensajeVoz: msgRed,
          titulo: "Sin conexión para IA de Voz",
          detalle: msgRed,
          undoToken: null,
        });
      } finally {
        setProcesandoIA(false);
        setTranscripcionEnVivo("");
      }
    },
    [cuota.comercioId, cuota.usuarioId, procesandoIA]
  );

  const obtenerConstructorReconocimiento =
    (): SpeechRecognitionConstructor | null => {
      if (typeof window === "undefined") return null;
      const win = window as unknown as {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      };
      return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
    };

  const alternarEscuchaVoz = () => {
    if (procesandoIA) return;

    // Si ya está escuchando, detener y procesar lo capturado
    if (escuchando && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const SpeechConstructor = obtenerConstructorReconocimiento();
    if (!SpeechConstructor) {
      // Si el navegador de escritorio no soporta Web Speech API, desplegar campo de texto
      setMostrarCampoTexto(true);
      return;
    }

    try {
      const recognition = new SpeechConstructor();
      recognition.lang = "es-BO";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      textoAcumuladoRef.current = "";
      enviadoEnSesionRef.current = false;
      setTranscripcionEnVivo("");
      setTarjeta(null);

      recognition.onresult = (event) => {
        let parcial = "";
        let final = "";

        for (let i = 0; i < event.results.length; i += 1) {
          const res = event.results[i];
          if (res.isFinal) {
            final += `${res[0].transcript} `;
          } else {
            parcial += res[0].transcript;
          }
        }

        const combinado = `${final}${parcial}`.trim();
        textoAcumuladoRef.current = combinado;
        setTranscripcionEnVivo(combinado);
      };

      recognition.onerror = (event) => {
        setEscuchando(false);
        if (event.error === "not-allowed" || event.error === "audio-capture") {
          setMostrarCampoTexto(true);
        }
      };

      recognition.onend = () => {
        setEscuchando(false);
        const dictadoFinal = textoAcumuladoRef.current.trim();
        if (dictadoFinal && !enviadoEnSesionRef.current) {
          enviadoEnSesionRef.current = true;
          void enviarComandoAlServidor(dictadoFinal);
        }
      };

      recognitionRef.current = recognition;
      setEscuchando(true);
      recognition.start();
    } catch {
      setEscuchando(false);
      setMostrarCampoTexto(true);
    }
  };

  const ejecutarDeshacer = async () => {
    if (!tarjeta?.undoToken || deshaciendo || segundosDeshacer <= 0) return;

    setDeshaciendo(true);
    try {
      const res = await fetch("/api/voice-assistant/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undoToken: tarjeta.undoToken }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        mensajeVoz?: string;
        error?: string;
        cuota?: {
          plan: "BASICO_GRATIS" | "VOZ_PRO";
          usados: number;
          limite: number;
          restantes: number | null;
        } | null;
      };

      if (res.ok && data.ok) {
        if (data.cuota) {
          actualizarCuotaVozGlobal({
            plan: data.cuota.plan,
            usados: data.cuota.usados,
            limite: data.cuota.limite,
            restantes: data.cuota.restantes,
          });
        }
        await sincronizarInventarioLocalDesdeNube();
        notificarMutacionNubeStockia();

        const msgUndo = data.mensajeVoz ?? "Operación revertida correctamente.";
        hablarTextoEspañol(msgUndo);
        setTarjeta({
          estado: "REVERTIDO",
          comandoDictado: tarjeta.comandoDictado,
          mensajeVoz: msgUndo,
          titulo: "Operación revertida",
          detalle: msgUndo,
          undoToken: null,
        });
        setSegundosDeshacer(0);
      }
    } finally {
      setDeshaciendo(false);
    }
  };

  return (
    <>
      {/* PANEL FLOTANTE EMERGENTE: ESCUCHA EN VIVO / ESCRIBIR COMANDO / RESULTADO + DESHACER 6s */}
      {(escuchando || procesandoIA || mostrarCampoTexto || tarjeta) && (
        <div className="fixed inset-x-0 bottom-22 z-50 px-4 pointer-events-none">
          <div className="max-w-md mx-auto pointer-events-auto rounded-3xl border-2 border-brand-primary/30 bg-white p-4 shadow-2xl space-y-3">
            {/* Estado 1: Escuchando por micrófono con animación de ondas sonoras */}
            {escuchando && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs font-extrabold text-brand-amber">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-amber animate-ping" />
                    Escuchando en español... (Toca el micrófono para enviar)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      textoAcumuladoRef.current = "";
                      recognitionRef.current?.abort();
                      setEscuchando(false);
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Ondas sonoras animadas */}
                <div className="flex items-center justify-center gap-1.5 py-2">
                  {[16, 28, 36, 22, 34, 18, 26].map((altura, idx) => (
                    <span
                      key={idx}
                      style={{
                        height: `${altura}px`,
                        animationDelay: `${idx * 110}ms`,
                      }}
                      className="w-1.5 rounded-full bg-brand-amber animate-pulse"
                    />
                  ))}
                </div>

                <div className="rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-800 min-h-11">
                  {transcripcionEnVivo || (
                    <span className="text-slate-400 font-normal">
                      Ej: &ldquo;Vendí 2 Coca-Cola 2 litros&rdquo; o &ldquo;¿Qué está por vencer?&rdquo;
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Estado 2: Procesando con Gemini Function Calling */}
            {procesandoIA && (
              <div className="flex items-center gap-3 py-2">
                <Loader2 className="h-6 w-6 animate-spin text-brand-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-brand-primary">
                    StockIA procesando comando...
                  </p>
                  <p className="text-xs text-slate-600 truncate">
                    &ldquo;{transcripcionEnVivo}&rdquo;
                  </p>
                </div>
              </div>
            )}

            {/* Estado 3: Campo alternativo "Escribir comando" para PC sin micrófono */}
            {mostrarCampoTexto && !escuchando && !procesandoIA && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-brand-primary flex items-center gap-1.5">
                    <Keyboard className="h-4 w-4 text-brand-amber" />
                    Escribir comando de voz (Modo PC)
                  </span>
                  <button
                    type="button"
                    onClick={() => setMostrarCampoTexto(false)}
                    className="rounded-lg p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (textoManual.trim()) {
                      void enviarComandoAlServidor(textoManual);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={textoManual}
                    onChange={(e) => setTextoManual(e.target.value)}
                    placeholder="Ej. Vendí 2 Yogurt Pil Frutilla"
                    autoFocus
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-primary focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!textoManual.trim()}
                    className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-3.5 py-2 text-xs font-extrabold text-white hover:bg-brand-primary-light disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Enviar
                  </button>
                </form>

                <div className="flex flex-wrap gap-1.5">
                  {EJEMPLOS_RAPIDOS.map((ej) => (
                    <button
                      key={ej}
                      type="button"
                      onClick={() => void enviarComandoAlServidor(ej)}
                      className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-brand-primary-tint hover:text-brand-primary cursor-pointer text-left"
                    >
                      &ldquo;{ej}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Estado 4: Tarjeta de Respuesta + Síntesis TTS + Botón Deshacer (6s) */}
            {tarjeta && !escuchando && !procesandoIA && (
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {tarjeta.estado === "LIMITE_ALCANZADO" ||
                      tarjeta.estado === "ERROR" ? (
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-amber" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">
                        {tarjeta.titulo}
                      </p>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {tarjeta.mensajeVoz}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => hablarTextoEspañol(tarjeta.mensajeVoz)}
                      title="Repetir lectura en voz alta"
                      className="rounded-lg p-1.5 text-brand-primary hover:bg-brand-primary-tint cursor-pointer"
                    >
                      <Volume2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTarjeta(null)}
                      aria-label="Cerrar tarjeta"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Botón "Deshacer" activo durante 6 segundos */}
                {tarjeta.undoToken && segundosDeshacer > 0 && (
                  <div className="pt-1 flex items-center justify-between gap-3 border-t border-slate-100">
                    <span className="text-[11px] text-slate-500">
                      ¿Error de dictado?
                    </span>
                    <button
                      type="button"
                      disabled={deshaciendo}
                      onClick={() => void ejecutarDeshacer()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-amber px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-brand-amber-dark disabled:opacity-60 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {deshaciendo
                        ? "Revirtiendo..."
                        : `Deshacer (${segundosDeshacer}s)`}
                    </button>
                  </div>
                )}

                {/* CTA directo si alcanzó el límite diario */}
                {tarjeta.estado === "LIMITE_ALCANZADO" && (
                  <Link
                    href="/plan"
                    onClick={() => setTarjeta(null)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-amber px-4 py-2.5 text-xs font-extrabold text-white shadow-xs hover:bg-brand-amber-dark"
                  >
                    <Crown className="h-4 w-4" />
                    Activar Plan Asistente Voz Pro (Bs 25/mes)
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* BOTÓN CENTRAL FLOTANTE EN LA BARRA INFERIOR MÓVIL */}
      <div className="relative flex flex-col items-center justify-center">
        <div className="relative flex items-center justify-center">
          {escuchando && (
            <span className="absolute -inset-1.5 rounded-full bg-brand-amber/40 animate-ping" />
          )}

          <button
            type="button"
            onClick={alternarEscuchaVoz}
            aria-label={
              escuchando ? "Detener y enviar comando de voz" : "Tocar para hablar"
            }
            title="Tocar para hablar con StockIA"
            className={`relative -mt-7 flex h-15 w-15 items-center justify-center rounded-full shadow-lg ring-4 ring-brand-primary transition-transform active:scale-95 cursor-pointer ${escuchando
                ? "bg-brand-amber text-white"
                : "bg-white text-brand-amber hover:bg-brand-amber-tint"
              }`}
          >
            {procesandoIA ? (
              <Loader2 className="h-7 w-7 animate-spin text-brand-primary" />
            ) : escuchando ? (
              <MicOff className="h-7 w-7 text-white" />
            ) : (
              <Mic className="h-7 w-7 text-brand-amber stroke-[2.4]" />
            )}
          </button>
        </div>

        {/* Enlace compacto desplegable "Escribir comando" para pruebas en PC */}
        <button
          type="button"
          onClick={() => {
            setTarjeta(null);
            setMostrarCampoTexto((prev) => !prev);
          }}
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-extrabold tracking-tight text-brand-primary hover:text-brand-amber cursor-pointer"
        >
          <Keyboard className="h-2.5 w-2.5 text-brand-amber" />
          <span>Escribir</span>
        </button>
      </div>
    </>
  );
}
