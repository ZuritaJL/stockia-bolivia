"use client";

import React from "react";
import Link from "next/link";
import { Crown, Mic } from "lucide-react";
import { useVoiceQuota } from "@/lib/voice-quota-store";

interface VoiceQuotaPillProps {
  compact?: boolean;
}

export function VoiceQuotaPill({ compact = false }: VoiceQuotaPillProps) {
  const cuota = useVoiceQuota();

  if (cuota.plan === "VOZ_PRO") {
    return (
      <Link
        href="/plan"
        className={`inline-flex items-center gap-1 rounded-full bg-brand-primary-tint text-brand-primary font-extrabold ring-1 ring-brand-primary/25 transition hover:bg-brand-primary hover:text-white ${
          compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"
        }`}
      >
        <Crown className={compact ? "h-3 w-3 text-brand-amber" : "h-3.5 w-3.5 text-brand-amber"} />
        <span>Voz Pro Ilimitado</span>
      </Link>
    );
  }

  const restantes = cuota.restantes ?? Math.max(0, cuota.limite - cuota.usados);
  const pocosComandos = restantes <= 3;

  return (
    <Link
      href="/plan"
      className={`inline-flex items-center gap-1 rounded-full font-bold transition ${
        pocosComandos
          ? "bg-brand-amber-tint text-brand-amber-dark ring-1 ring-brand-amber/40"
          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-primary/40"
      } ${compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs shadow-2xs"}`}
    >
      <Mic
        className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"} text-brand-amber shrink-0`}
      />
      <span>
        {restantes}/{cuota.limite} comandos gratis hoy
      </span>
    </Link>
  );
}
