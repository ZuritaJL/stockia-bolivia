export type OperacionDeshacerVoz =
  | {
      undoToken: string;
      creadoEnMs: number;
      usuarioId: string;
      descontoCuota: boolean;
      tipo: "INGRESO_LOTE";
      loteId: string;
      productoCreadoId?: string | null;
      descripcion: string;
    }
  | {
      undoToken: string;
      creadoEnMs: number;
      usuarioId: string;
      descontoCuota: boolean;
      tipo: "INCREMENTO_LOTE";
      loteId: string;
      cantidadSumada: number;
      descripcion: string;
    }
  | {
      undoToken: string;
      creadoEnMs: number;
      usuarioId: string;
      descontoCuota: boolean;
      tipo: "VENTA";
      ventaId: string;
      restauracionesLotes: Array<{
        loteId: string;
        cantidadRestaurada: number;
      }>;
      descripcion: string;
    };

const TTL_MS = 5 * 60 * 1000;

const globalForUndo = globalThis as unknown as {
  stockiaVoiceUndoMap?: Map<string, OperacionDeshacerVoz>;
};

const undoMap =
  globalForUndo.stockiaVoiceUndoMap ?? new Map<string, OperacionDeshacerVoz>();

if (!globalForUndo.stockiaVoiceUndoMap) {
  globalForUndo.stockiaVoiceUndoMap = undoMap;
}

function limpiarExpirados() {
  const ahora = Date.now();
  for (const [key, val] of undoMap.entries()) {
    if (ahora - val.creadoEnMs > TTL_MS) {
      undoMap.delete(key);
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export function guardarOperacionDeshacer(
  op: DistributiveOmit<OperacionDeshacerVoz, "undoToken" | "creadoEnMs">
): string {
  limpiarExpirados();
  const undoToken = `undo_${crypto.randomUUID()}`;
  const registro = {
    ...op,
    undoToken,
    creadoEnMs: Date.now(),
  } as OperacionDeshacerVoz;

  undoMap.set(undoToken, registro);
  return undoToken;
}

export function consumirOperacionDeshacer(
  undoToken: string
): OperacionDeshacerVoz | null {
  limpiarExpirados();
  const encontrado = undoMap.get(undoToken) ?? null;
  if (encontrado) {
    undoMap.delete(undoToken);
  }
  return encontrado;
}
