import prisma from "@/lib/prisma";

export type NivelSemaforoFEFO =
  | "ROJO_CRITICO"
  | "AMBAR_PREVENTIVO"
  | "VERDE_OPTIMO";

export type FuenteVRD =
  | "HISTORIAL_14D"
  | "HISTORIAL_RECIENTE"
  | "ESTADISTICO_CATEGORIA";

export interface ItemReposicionSugerida {
  productoId: string;
  codigoBarras: string;
  nombreProducto: string;
  marca: string;
  categoria: string;
  unidadMedida: string;
  stockTotal: number;
  vrd: number;
  fuenteVRD: FuenteVRD;
  diasCobertura: number;
  cantidadSugerida: number;
  precioCompraUnitario: number;
  costoEstimadoBs: number;
  etiquetaUrgencia: "Reponer Urgente";
  nivelSemaforo: "ROJO_CRITICO" | "AMBAR_PREVENTIVO";
}

export interface AlertaLoteFEFO {
  loteId: string;
  productoId: string;
  codigoBarras: string;
  nombreProducto: string;
  marca: string;
  categoria: string;
  stockActual: number;
  precioCompra: number;
  precioVenta: number;
  valorEnRiesgoBs: number;
  fechaVencimiento: string;
  diasRestantes: number;
  semaforo: NivelSemaforoFEFO;
  colorHex: "#DC2626" | "#D97706" | "#10563E";
  accionSugerida: string;
}

export interface ItemCapitalDormido {
  productoId: string;
  codigoBarras: string;
  nombreProducto: string;
  marca: string;
  categoria: string;
  stockTotal: number;
  precioCompraPromedio: number;
  precioVentaActual: number;
  montoInmovilizadoBs: number;
  diasSinVenta: number;
  sugerenciaLiquidez: string;
}

export interface PuntoRotacionDiaria {
  fechaCorta: string;
  fechaIso: string;
  totalBs: number;
  unidades: number;
}

export interface ResumenFinancieroHoy {
  totalVendidoHoyBs: number;
  margenGananciaHoyBs: number;
  cantidadVentasHoy: number;
  ahorroPotencialFefoBs: number;
}

export interface ResultadoInteligenciaComerciante {
  comercio: {
    id: string;
    nombreTienda: string;
    macrodistrito: string;
    ciudad: string;
  };
  resumenFinancieroHoy: ResumenFinancieroHoy;
  conteoSemaforoFefo: {
    rojoCritico: number;
    ambarPreventivo: number;
    verdeOptimo: number;
  };
  listaReposicion: ItemReposicionSugerida[];
  alertasFefo: AlertaLoteFEFO[];
  lotesVerdeOptimoCount: number;
  capitalDormido: {
    totalInmovilizadoBs: number;
    cantidadProductos: number;
    items: ItemCapitalDormido[];
  };
  serieRotacion14d: PuntoRotacionDiaria[];
  generadoEn: string;
}

// ============================================================================
// FUNCIONES PURAS DEL MOTOR PREDICTIVO Y FEFO
// ============================================================================

const VRD_FALLBACK_POR_CATEGORIA: Record<string, number> = {
  bebidas: 2.6,
  lacteos: 2.3,
  lácteos: 2.3,
  panaderia: 1.9,
  panadería: 1.9,
  snacks: 1.5,
  abarrotes: 1.2,
  limpieza: 0.6,
};

export function obtenerFallbackEstadisticoCategoria(categoria: string): number {
  const clave = categoria.trim().toLowerCase();
  return VRD_FALLBACK_POR_CATEGORIA[clave] ?? 1.0;
}

export function calcularDiasCalendario(
  fechaObjetivo: Date,
  referencia: Date
): number {
  const inicioRef = new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    referencia.getDate()
  ).getTime();
  const inicioObj = new Date(
    fechaObjetivo.getFullYear(),
    fechaObjetivo.getMonth(),
    fechaObjetivo.getDate()
  ).getTime();
  return Math.ceil((inicioObj - inicioRef) / (1000 * 60 * 60 * 24));
}

/**
 * Calcula la Velocidad de Rotación Diaria (VRD) en los últimos 14 días,
 * aplicando un fallback estadístico o proporcional si el producto tiene menos de 14 días
 * desde su primer ingreso para evitar divisiones por cero.
 */
export function calcularVRDProducto(params: {
  unidadesVendidas14d: number;
  diasHistorial: number;
  categoria: string;
}): { vrd: number; fuenteVRD: FuenteVRD } {
  const { unidadesVendidas14d, diasHistorial, categoria } = params;

  if (diasHistorial >= 14 && unidadesVendidas14d > 0) {
    return {
      vrd: Number((unidadesVendidas14d / 14).toFixed(2)),
      fuenteVRD: "HISTORIAL_14D",
    };
  }

  if (diasHistorial < 14 && unidadesVendidas14d > 0) {
    const ventana = Math.max(1, diasHistorial);
    return {
      vrd: Number((unidadesVendidas14d / ventana).toFixed(2)),
      fuenteVRD: "HISTORIAL_RECIENTE",
    };
  }

  if (diasHistorial < 14 && unidadesVendidas14d === 0) {
    return {
      vrd: obtenerFallbackEstadisticoCategoria(categoria),
      fuenteVRD: "ESTADISTICO_CATEGORIA",
    };
  }

  // Producto con >= 14 días y 0 ventas recientes: VRD real es 0
  return {
    vrd: 0,
    fuenteVRD: "HISTORIAL_14D",
  };
}

/**
 * Evalúa punto de reorden (`diasCobertura <= 3` o `stockTotal <= 3` sin historial reciente)
 * y sugiere compra exacta para cubrir 7 días de demanda: `ceil((VRD * 7) - stockTotal)`.
 */
export function calcularSugerenciaReorden(params: {
  stockTotal: number;
  vrd: number;
  unidadesVendidas14d: number;
  categoria: string;
}): {
  requiereReposicion: boolean;
  diasCobertura: number;
  cantidadSugerida: number;
  nivelSemaforo: "ROJO_CRITICO" | "AMBAR_PREVENTIVO";
} {
  const { stockTotal, vrd, unidadesVendidas14d, categoria } = params;

  if (vrd > 0) {
    const diasCobertura = Number((stockTotal / vrd).toFixed(1));
    if (diasCobertura <= 3) {
      const sugerida = Math.max(1, Math.ceil(vrd * 7 - stockTotal));
      return {
        requiereReposicion: true,
        diasCobertura,
        cantidadSugerida: sugerida,
        nivelSemaforo:
          stockTotal === 0 || diasCobertura <= 1.2
            ? "ROJO_CRITICO"
            : "AMBAR_PREVENTIVO",
      };
    }
    return {
      requiereReposicion: false,
      diasCobertura,
      cantidadSugerida: 0,
      nivelSemaforo: "AMBAR_PREVENTIVO",
    };
  }

  // Sin ventas recientes pero con stock crítico (<= 3 unidades)
  if (unidadesVendidas14d === 0 && stockTotal <= 3) {
    const vrdBase = Math.max(
      0.8,
      obtenerFallbackEstadisticoCategoria(categoria) * 0.75
    );
    const sugerida = Math.max(2, Math.ceil(vrdBase * 7 - stockTotal));
    return {
      requiereReposicion: true,
      diasCobertura: Number((stockTotal / vrdBase).toFixed(1)),
      cantidadSugerida: sugerida,
      nivelSemaforo: stockTotal === 0 ? "ROJO_CRITICO" : "AMBAR_PREVENTIVO",
    };
  }

  return {
    requiereReposicion: false,
    diasCobertura: 99,
    cantidadSugerida: 0,
    nivelSemaforo: "AMBAR_PREVENTIVO",
  };
}

/**
 * Clasifica cada lote activo según la regla FEFO respecto a `ahora`:
 * - ROJO_CRITICO (<= 3 días o vencido): #DC2626
 * - AMBAR_PREVENTIVO (4 a 10 días): #D97706
 * - VERDE_OPTIMO (> 10 días): #10563E
 */
export function clasificarCaducidadFEFO(
  fechaVencimiento: Date,
  ahora: Date
): {
  diasRestantes: number;
  semaforo: NivelSemaforoFEFO;
  colorHex: "#DC2626" | "#D97706" | "#10563E";
  accionSugerida: string;
} {
  const diasRestantes = calcularDiasCalendario(fechaVencimiento, ahora);

  if (diasRestantes <= 3) {
    return {
      diasRestantes,
      semaforo: "ROJO_CRITICO",
      colorHex: "#DC2626",
      accionSugerida:
        "Liquidar hoy: aplicar promo 2x1 o -25% en mostrador",
    };
  }

  if (diasRestantes <= 10) {
    return {
      diasRestantes,
      semaforo: "AMBAR_PREVENTIVO",
      colorHex: "#D97706",
      accionSugerida:
        "Mover lote al frente de la vitrina / ofrecer primero",
    };
  }

  return {
    diasRestantes,
    semaforo: "VERDE_OPTIMO",
    colorHex: "#10563E",
    accionSugerida: "Rotación saludable: mantener orden FEFO en estantería",
  };
}

export function generarSugerenciaCapitalDormido(
  categoria: string,
  nombreProducto: string
): string {
  const cat = categoria.toLowerCase();
  if (cat.includes("limpieza")) {
    return `Armar "Pack Ahorro Hogar" combinando ${nombreProducto} con detergente o papel higiénico (-12%).`;
  }
  if (cat.includes("abarrotes")) {
    return `Crear combo casero de fin de semana junto a Arroz o Aceite Fino con Bs 2 de descuento.`;
  }
  if (cat.includes("snacks") || cat.includes("bebidas")) {
    return `Ubicar junto a la caja registradora en promo "Lleva 2 con 15% menos" para recuperar efectivo.`;
  }
  return `Aplicar descuento directo del 15% y pausar recompra hasta liberar el capital estancado.`;
}

// ============================================================================
// CONSULTA INTEGRAL OPTIMIZADA PARA UN COMERCIO (PRISMA)
// ============================================================================

export async function analizarInteligenciaComercio(
  comercioId: string,
  ahora: Date = new Date()
): Promise<ResultadoInteligenciaComerciante> {
  const inicioHoy = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate()
  );

  const hace14Dias = new Date(inicioHoy);
  hace14Dias.setDate(hace14Dias.getDate() - 13);

  const hace21Dias = new Date(inicioHoy);
  hace21Dias.setDate(hace21Dias.getDate() - 21);

  const [comercio, lotes, ventas21d] = await Promise.all([
    prisma.comercio.findUniqueOrThrow({
      where: { id: comercioId },
    }),
    prisma.inventarioLote.findMany({
      where: { comercioId },
      include: { producto: true },
      orderBy: [{ fechaVencimiento: "asc" }, { fechaIngreso: "asc" }],
    }),
    prisma.venta.findMany({
      where: {
        comercioId,
        fechaHora: { gte: hace21Dias },
      },
      include: {
        detalles: {
          include: {
            lote: {
              select: { precioCompra: true, fechaVencimiento: true },
            },
          },
        },
      },
      orderBy: { fechaHora: "asc" },
    }),
  ]);

  // 1. Agregar ventas de hoy, últimos 14 días y últimos 21 días en una sola pasada O(N)
  const unidades14dPorProducto = new Map<string, number>();
  const unidades21dPorProducto = new Map<string, number>();

  let totalVendidoHoyBs = 0;
  let margenGananciaHoyBs = 0;
  let cantidadVentasHoy = 0;

  const mapaSerie14d = new Map<string, { totalBs: number; unidades: number }>();
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(hace14Dias);
    d.setDate(d.getDate() + i);
    const isoKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
    mapaSerie14d.set(isoKey, { totalBs: 0, unidades: 0 });
  }

  for (const venta of ventas21d) {
    const esUltimos14d = venta.fechaHora.getTime() >= hace14Dias.getTime();
    const esHoy = venta.fechaHora.getTime() >= inicioHoy.getTime();

    const keyDia = `${venta.fechaHora.getFullYear()}-${String(
      venta.fechaHora.getMonth() + 1
    ).padStart(2, "0")}-${String(venta.fechaHora.getDate()).padStart(2, "0")}`;

    if (esHoy) {
      cantidadVentasHoy += 1;
      totalVendidoHoyBs += Number(venta.totalBs);
    }

    const bucketDia = mapaSerie14d.get(keyDia);
    if (bucketDia) {
      bucketDia.totalBs = Number(
        (bucketDia.totalBs + Number(venta.totalBs)).toFixed(2)
      );
    }

    for (const det of venta.detalles) {
      unidades21dPorProducto.set(
        det.productoId,
        (unidades21dPorProducto.get(det.productoId) ?? 0) + det.cantidad
      );

      if (esUltimos14d) {
        unidades14dPorProducto.set(
          det.productoId,
          (unidades14dPorProducto.get(det.productoId) ?? 0) + det.cantidad
        );
        if (bucketDia) {
          bucketDia.unidades += det.cantidad;
        }
      }

      if (esHoy) {
        const costoUnit = Number(det.lote.precioCompra);
        const ventaUnit = Number(det.precioUnitario);
        margenGananciaHoyBs += det.cantidad * Math.max(0, ventaUnit - costoUnit);
      }
    }
  }

  // 2. Agrupar lotes por producto y evaluar Semáforo FEFO lote a lote
  const lotesPorProducto = new Map<string, typeof lotes>();
  const alertasFefo: AlertaLoteFEFO[] = [];
  let rojoCritico = 0;
  let ambarPreventivo = 0;
  let verdeOptimo = 0;
  let ahorroPotencialFefoBs = 0;

  for (const lote of lotes) {
    const arr = lotesPorProducto.get(lote.productoId) ?? [];
    arr.push(lote);
    lotesPorProducto.set(lote.productoId, arr);

    if (lote.stockActual > 0 && lote.fechaVencimiento) {
      const evalFefo = clasificarCaducidadFEFO(lote.fechaVencimiento, ahora);
      const costoLote = Number(
        (lote.stockActual * Number(lote.precioCompra)).toFixed(2)
      );

      if (evalFefo.semaforo === "ROJO_CRITICO") {
        rojoCritico += 1;
        ahorroPotencialFefoBs += costoLote;
      } else if (evalFefo.semaforo === "AMBAR_PREVENTIVO") {
        ambarPreventivo += 1;
        ahorroPotencialFefoBs += costoLote;
      } else {
        verdeOptimo += 1;
      }

      if (
        evalFefo.semaforo === "ROJO_CRITICO" ||
        evalFefo.semaforo === "AMBAR_PREVENTIVO"
      ) {
        alertasFefo.push({
          loteId: lote.id,
          productoId: lote.productoId,
          codigoBarras: lote.producto.codigoBarras,
          nombreProducto: lote.producto.nombreProducto,
          marca: lote.producto.marca,
          categoria: lote.producto.categoria,
          stockActual: lote.stockActual,
          precioCompra: Number(lote.precioCompra),
          precioVenta: Number(lote.precioVenta),
          valorEnRiesgoBs: costoLote,
          fechaVencimiento: lote.fechaVencimiento.toISOString(),
          diasRestantes: evalFefo.diasRestantes,
          semaforo: evalFefo.semaforo,
          colorHex: evalFefo.colorHex,
          accionSugerida: evalFefo.accionSugerida,
        });
      }
    }
  }

  alertasFefo.sort(
    (a, b) =>
      new Date(a.fechaVencimiento).getTime() -
      new Date(b.fechaVencimiento).getTime()
  );

  // 3. Evaluar VRD, Punto de Reorden y Detector de Capital Dormido por producto
  const listaReposicion: ItemReposicionSugerida[] = [];
  const itemsCapitalDormido: ItemCapitalDormido[] = [];

  for (const [productoId, lotesProd] of lotesPorProducto.entries()) {
    const prodInfo = lotesProd[0].producto;

    const lotesVendibles = lotesProd.filter((l) => {
      if (l.stockActual <= 0) return false;
      if (!l.fechaVencimiento) return true;
      return calcularDiasCalendario(l.fechaVencimiento, ahora) >= 0;
    });

    const stockTotal = lotesVendibles.reduce(
      (sum, l) => sum + l.stockActual,
      0
    );

    const primerIngresoMs = Math.min(
      ...lotesProd.map((l) => l.fechaIngreso.getTime())
    );
    const diasHistorial = Math.max(
      1,
      Math.ceil((ahora.getTime() - primerIngresoMs) / (1000 * 60 * 60 * 24))
    );

    const loteMasReciente = [...lotesProd].sort(
      (a, b) => b.fechaIngreso.getTime() - a.fechaIngreso.getTime()
    )[0];
    const precioCompraRef = Number(loteMasReciente.precioCompra);
    const precioVentaRef = Number(loteMasReciente.precioVenta);

    const vendidas14d = unidades14dPorProducto.get(productoId) ?? 0;
    const vendidas21d = unidades21dPorProducto.get(productoId) ?? 0;

    const { vrd, fuenteVRD } = calcularVRDProducto({
      unidadesVendidas14d: vendidas14d,
      diasHistorial,
      categoria: prodInfo.categoria,
    });

    const evalReorden = calcularSugerenciaReorden({
      stockTotal,
      vrd,
      unidadesVendidas14d: vendidas14d,
      categoria: prodInfo.categoria,
    });

    if (evalReorden.requiereReposicion) {
      listaReposicion.push({
        productoId,
        codigoBarras: prodInfo.codigoBarras,
        nombreProducto: prodInfo.nombreProducto,
        marca: prodInfo.marca,
        categoria: prodInfo.categoria,
        unidadMedida: prodInfo.unidadMedida,
        stockTotal,
        vrd:
          vrd > 0
            ? vrd
            : Number(
                (
                  obtenerFallbackEstadisticoCategoria(prodInfo.categoria) * 0.75
                ).toFixed(2)
              ),
        fuenteVRD,
        diasCobertura: evalReorden.diasCobertura,
        cantidadSugerida: evalReorden.cantidadSugerida,
        precioCompraUnitario: precioCompraRef,
        costoEstimadoBs: Number(
          (evalReorden.cantidadSugerida * precioCompraRef).toFixed(2)
        ),
        etiquetaUrgencia: "Reponer Urgente",
        nivelSemaforo: evalReorden.nivelSemaforo,
      });
    }

    // Detector de Capital Dormido: stockTotal > 0 y cero ventas en los últimos 21 días
    const lotesConStock = lotesProd.filter((l) => l.stockActual > 0);
    const stockFisicoTotal = lotesConStock.reduce(
      (sum, l) => sum + l.stockActual,
      0
    );

    if (stockFisicoTotal > 0 && vendidas21d === 0) {
      const montoInmovilizado = lotesConStock.reduce(
        (sum, l) => sum + l.stockActual * Number(l.precioCompra),
        0
      );
      const precioCompraPond = montoInmovilizado / stockFisicoTotal;

      itemsCapitalDormido.push({
        productoId,
        codigoBarras: prodInfo.codigoBarras,
        nombreProducto: prodInfo.nombreProducto,
        marca: prodInfo.marca,
        categoria: prodInfo.categoria,
        stockTotal: stockFisicoTotal,
        precioCompraPromedio: Number(precioCompraPond.toFixed(2)),
        precioVentaActual: precioVentaRef,
        montoInmovilizadoBs: Number(montoInmovilizado.toFixed(2)),
        diasSinVenta: Math.max(21, diasHistorial),
        sugerenciaLiquidez: generarSugerenciaCapitalDormido(
          prodInfo.categoria,
          prodInfo.nombreProducto
        ),
      });
    }
  }

  listaReposicion.sort((a, b) => a.diasCobertura - b.diasCobertura);
  itemsCapitalDormido.sort(
    (a, b) => b.montoInmovilizadoBs - a.montoInmovilizadoBs
  );

  const totalCapitalDormidoBs = Number(
    itemsCapitalDormido
      .reduce((sum, item) => sum + item.montoInmovilizadoBs, 0)
      .toFixed(2)
  );

  const serieRotacion14d: PuntoRotacionDiaria[] = Array.from(
    mapaSerie14d.entries()
  ).map(([iso, val]) => {
    const [, mm, dd] = iso.split("-");
    return {
      fechaIso: iso,
      fechaCorta: `${dd}/${mm}`,
      totalBs: val.totalBs,
      unidades: val.unidades,
    };
  });

  return {
    comercio: {
      id: comercio.id,
      nombreTienda: comercio.nombreTienda,
      macrodistrito: comercio.macrodistrito,
      ciudad: comercio.ciudad,
    },
    resumenFinancieroHoy: {
      totalVendidoHoyBs: Number(totalVendidoHoyBs.toFixed(2)),
      margenGananciaHoyBs: Number(margenGananciaHoyBs.toFixed(2)),
      cantidadVentasHoy,
      ahorroPotencialFefoBs: Number(ahorroPotencialFefoBs.toFixed(2)),
    },
    conteoSemaforoFefo: {
      rojoCritico,
      ambarPreventivo,
      verdeOptimo,
    },
    listaReposicion,
    alertasFefo,
    lotesVerdeOptimoCount: verdeOptimo,
    capitalDormido: {
      totalInmovilizadoBs: totalCapitalDormidoBs,
      cantidadProductos: itemsCapitalDormido.length,
      items: itemsCapitalDormido,
    },
    serieRotacion14d,
    generadoEn: ahora.toISOString(),
  };
}
