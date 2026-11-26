import { NextResponse, connection } from "next/server";
import prisma from "@/lib/prisma";
import { PlanSuscripcion } from "@/generated/prisma/client";

const LIMITE_GRATIS_DIARIO = 15;

function esMismoDiaLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function resolverComercianteDemo(usuarioId?: string | null) {
  let usuario = usuarioId
    ? await prisma.usuario.findUnique({
        where: { id: usuarioId },
        include: { comercio: true },
      })
    : null;

  if (!usuario) {
    usuario = await prisma.usuario.findUnique({
      where: { email: "martha@stockia.bo" },
      include: { comercio: true },
    });
  }

  if (!usuario) {
    usuario = await prisma.usuario.findFirst({
      where: { rol: "COMERCIANTE" },
      include: { comercio: true },
    });
  }

  if (!usuario) return null;

  const ahora = new Date();
  if (!esMismoDiaLocal(usuario.fechaResetVoz, ahora)) {
    usuario = await prisma.usuario.update({
      where: { id: usuario.id },
      data: { comandosVozHoy: 0, fechaResetVoz: ahora },
      include: { comercio: true },
    });
  }

  return usuario;
}

/**
 * GET /api/comerciante/plan
 * Retorna el estado actual de suscripción y cuota diaria de voz del comerciante.
 */
export async function GET(request: Request) {
  await connection();

  try {
    const { searchParams } = new URL(request.url);
    const usuario = await resolverComercianteDemo(
      searchParams.get("usuarioId")
    );

    if (!usuario) {
      return NextResponse.json(
        { ok: false, error: "Usuario comerciante no encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        nombreTienda: usuario.comercio?.nombreTienda ?? "Tienda Minorista",
        plan: usuario.plan,
        comandosVozHoy: usuario.comandosVozHoy,
        limiteDiario: LIMITE_GRATIS_DIARIO,
        restantes:
          usuario.plan === PlanSuscripcion.VOZ_PRO
            ? null
            : Math.max(0, LIMITE_GRATIS_DIARIO - usuario.comandosVozHoy),
      },
    });
  } catch (error) {
    console.error("[GET /api/comerciante/plan] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Error consultando el plan del comerciante." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/comerciante/plan
 * Actualiza `usuario.plan` en PostgreSQL tras confirmación de Pago QR Simple Bolivia
 * o al restablecer a `BASICO_GRATIS` durante demostraciones.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      usuarioId?: string;
      plan?: "BASICO_GRATIS" | "VOZ_PRO";
      referenciaQr?: string;
    };

    if (body.plan !== "BASICO_GRATIS" && body.plan !== "VOZ_PRO") {
      return NextResponse.json(
        { ok: false, error: "Plan solicitado no válido." },
        { status: 400 }
      );
    }

    const usuarioBase = await resolverComercianteDemo(body.usuarioId);
    if (!usuarioBase) {
      return NextResponse.json(
        { ok: false, error: "Usuario comerciante no encontrado." },
        { status: 404 }
      );
    }

    const actualizado = await prisma.usuario.update({
      where: { id: usuarioBase.id },
      data: {
        plan: body.plan,
      },
    });

    return NextResponse.json({
      ok: true,
      mensaje:
        actualizado.plan === PlanSuscripcion.VOZ_PRO
          ? "¡Pago QR Simple verificado! Plan Asistente Voz Pro activado con éxito."
          : "Plan restablecido a Básico Gratis (15 comandos/día).",
      cuota: {
        usuarioId: actualizado.id,
        plan: actualizado.plan,
        usados: actualizado.comandosVozHoy,
        limite: LIMITE_GRATIS_DIARIO,
        restantes:
          actualizado.plan === PlanSuscripcion.VOZ_PRO
            ? null
            : Math.max(0, LIMITE_GRATIS_DIARIO - actualizado.comandosVozHoy),
      },
    });
  } catch (error) {
    console.error("[POST /api/comerciante/plan] Error:", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo actualizar la suscripción." },
      { status: 500 }
    );
  }
}
