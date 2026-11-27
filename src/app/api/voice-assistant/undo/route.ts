import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { EstadoLote, PlanSuscripcion } from "@prisma/client";
import { consumirOperacionDeshacer } from "@/lib/voice-undo-store";

const LIMITE_GRATIS_DIARIO = 15;

function recalcularEstado(
  stockActual: number,
  fechaVencimiento: Date | null
): EstadoLote {
  if (stockActual <= 0) return EstadoLote.AGOTADO;
  if (!fechaVencimiento) return EstadoLote.ACTIVO;

  const ahora = new Date();
  const inicioHoy = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate()
  ).getTime();
  const inicioVenc = new Date(
    fechaVencimiento.getFullYear(),
    fechaVencimiento.getMonth(),
    fechaVencimiento.getDate()
  ).getTime();
  const dias = Math.ceil((inicioVenc - inicioHoy) / (1000 * 60 * 60 * 24));

  if (dias < 0) return EstadoLote.VENCIDO;
  if (dias <= 5) return EstadoLote.POR_VENCER;
  return EstadoLote.ACTIVO;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { undoToken?: string };
    if (!body.undoToken) {
      return NextResponse.json(
        { ok: false, error: "Token de reversión requerido." },
        { status: 400 }
      );
    }

    const op = consumirOperacionDeshacer(body.undoToken);
    if (!op) {
      return NextResponse.json(
        {
          ok: false,
          error: "La operación ya fue revertida o el tiempo para deshacer expiró.",
        },
        { status: 404 }
      );
    }

    const resultado = await prisma.$transaction(async (tx) => {
      if (op.tipo === "INGRESO_LOTE") {
        await tx.inventarioLote.deleteMany({
          where: { id: op.loteId },
        });
        if (op.productoCreadoId) {
          const otrosLotes = await tx.inventarioLote.count({
            where: { productoId: op.productoCreadoId },
          });
          if (otrosLotes === 0) {
            await tx.catalogoCurado.deleteMany({
              where: { id: op.productoCreadoId },
            });
          }
        }
      } else if (op.tipo === "INCREMENTO_LOTE") {
        const loteExistente = await tx.inventarioLote.findUnique({
          where: { id: op.loteId },
        });
        if (loteExistente) {
          const nuevoStock = Math.max(
            0,
            loteExistente.stockActual - op.cantidadSumada
          );
          await tx.inventarioLote.update({
            where: { id: op.loteId },
            data: {
              stockActual: nuevoStock,
              estado: recalcularEstado(
                nuevoStock,
                loteExistente.fechaVencimiento
              ),
            },
          });
        }
      } else if (op.tipo === "VENTA") {
        for (const rest of op.restauracionesLotes) {
          const loteActual = await tx.inventarioLote.findUnique({
            where: { id: rest.loteId },
          });
          if (loteActual) {
            const stockRestaurado =
              loteActual.stockActual + rest.cantidadRestaurada;
            await tx.inventarioLote.update({
              where: { id: rest.loteId },
              data: {
                stockActual: stockRestaurado,
                estado: recalcularEstado(
                  stockRestaurado,
                  loteActual.fechaVencimiento
                ),
              },
            });
          }
        }

        await tx.venta.deleteMany({
          where: { id: op.ventaId },
        });
      }

      const usuarioActual = await tx.usuario.findUnique({
        where: { id: op.usuarioId },
      });

      let usuarioFinal = usuarioActual;
      if (op.descontoCuota && usuarioActual && usuarioActual.comandosVozHoy > 0) {
        usuarioFinal = await tx.usuario.update({
          where: { id: op.usuarioId },
          data: { comandosVozHoy: { decrement: 1 } },
        });
      }

      return { usuarioFinal };
    });

    const u = resultado.usuarioFinal;
    const cuota = u
      ? {
          plan: u.plan,
          usados: u.comandosVozHoy,
          limite: LIMITE_GRATIS_DIARIO,
          restantes:
            u.plan === PlanSuscripcion.VOZ_PRO
              ? null
              : Math.max(0, LIMITE_GRATIS_DIARIO - u.comandosVozHoy),
        }
      : null;

    return NextResponse.json({
      ok: true,
      mensajeVoz: `Deshecho: se revirtió ${op.descripcion.toLowerCase()}.`,
      cuota,
    });
  } catch (error) {
    console.error("[POST /api/voice-assistant/undo] Error:", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo revertir la operación." },
      { status: 500 }
    );
  }
}
