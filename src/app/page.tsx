"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/context/RoleContext";
import { WelcomeLoginScreen } from "@/components/auth/WelcomeLoginScreen";

export default function HomeEntryPage() {
  const { sesion, hidratado } = useRole();
  const router = useRouter();

  useEffect(() => {
    if (!hidratado || !sesion) return;
    if (sesion.rol === "DISTRIBUIDORA_B2B") {
      router.replace("/dashboard");
    } else {
      router.replace("/mostrador");
    }
  }, [hidratado, sesion, router]);

  if (!hidratado) {
    return null;
  }

  return <WelcomeLoginScreen />;
}
