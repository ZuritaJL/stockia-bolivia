import { NextResponse, connection } from "next/server";
import prisma from "@/lib/prisma";
import {
  Ciudad,
  EstadoLote,
  MetodoRegistro,
  PlanSuscripcion,
  Prisma,
  RolUsuario,
  TipoComercio,
} from "@/generated/prisma/client";

export type NivelUrgenciaZonal = "ALTO" | "MEDIO" | "BAJO";

interface ConfigZonaGeografica {
  ciudad: Ciudad;
  macrodistrito: string;
  altitudMsnm: number;
  latBase: number;
  lngBase: number;
  svgX: number;
  svgY: number;
  cantidadTiendasSim: number;
  factorEstresQuiebre: number; // Mayor valor = más comercios con stock crítico
}

const MACRODISTRITOS_RED: ConfigZonaGeografica[] = [
  {
    ciudad: Ciudad.EL_ALTO,
    macrodistrito: "Ceja",
    altitudMsnm: 4070,
    latBase: -16.5047,
    lngBase: -68.1633,
    svgX: 115,
    svgY: 62,
    cantidadTiendasSim: 14,
    factorEstresQuiebre: 0.48,
  },
  {
    ciudad: Ciudad.EL_ALTO,
    macrodistrito: "Ciudad Satélite",
    altitudMsnm: 4040,
    latBase: -16.5194,
    lngBase: -68.1539,
    svgX: 95,
    svgY: 142,
    cantidadTiendasSim: 11,
    factorEstresQuiebre: 0.28,
  },
  {
    ciudad: Ciudad.LA_PAZ,
    macrodistrito: "Max Paredes",
    altitudMsnm: 3740,
    latBase: -16.4935,
    lngBase: -68.1462,
    svgX: 235,
    svgY: 85,
    cantidadTiendasSim: 13,
    factorEstresQuiebre: 0.39,
  },
  {
    ciudad: Ciudad.LA_PAZ,
    macrodistrito: "Villa Fátima",
    altitudMsnm: 3680,
    latBase: -16.4795,
    lngBase: -68.1165,
    svgX: 365,
    svgY: 65,
    cantidadTiendasSim: 10,
    factorEstresQuiebre: 0.22,
  },
  {
    ciudad: Ciudad.LA_PAZ,
    macrodistrito: "Miraflores",
    altitudMsnm: 3590,
    latBase: -16.5048,
    lngBase: -68.1206,
    svgX: 335,
    svgY: 138,
    cantidadTiendasSim: 11, // +1 Tienda Doña Martha = 12
    factorEstresQuiebre: 0.35,
  },
  {
    ciudad: Ciudad.LA_PAZ,
    macrodistrito: "Sopocachi",
    altitudMsnm: 3540,
    latBase: -16.5116,
    lngBase: -68.1287,
    svgX: 250,
    svgY: 175,
    cantidadTiendasSim: 10,
    factorEstresQuiebre: 0.25,
  },
  {
    ciudad: Ciudad.LA_PAZ,
    macrodistrito: "Zona Sur",
    altitudMsnm: 3280,
    latBase: -16.5408,
    lngBase: -68.0792,
    svgX: 390,
    svgY: 205,
    cantidadTiendasSim: 10,
    factorEstresQuiebre: 0.14,
  },
];

const CATEGORIAS_PRINCIPALES = ["Bebidas", "Lácteos", "Abarrotes", "Limpieza"];

function clasificarUrgenciaZonal(porcentajeCritico: number): NivelUrgenciaZonal {
  if (porcentajeCritico >= 32) return "ALTO";
  if (porcentajeCritico >= 18) return "MEDIO";
  return "BAJO";
}

function construirRutaSugerida(
  ciudad: string,
  macrodistrito: string,
  urgencia: NivelUrgenciaZonal,
  topProductos: string[]
): string {
  const foco =
    topProductos.length > 0
      ? topProductos.slice(0, 2).join(" y ")
      : "canasta básica";

  if (urgencia === "ALTO") {
    return `Despacho prioritario 07:00 AM hacia ${macrodistrito} (${ciudad.replace("_", " ")}): reforzar preventa inmediata de ${foco} por alto índice de quiebre.`;
  }
  if (urgencia === "MEDIO") {
    return `Ruta preventiva media mañana en ${macrodistrito}: programar reposición escalonada de ${foco} en ventana de 48 horas.`;
  }
  return `Cobertura estable en ${macrodistrito}: mantener frecuencia semanal estándar y promocionar surtido complementario.`;
}

async function calcularAnaliticaAnonimizada(filtros: {
  ciudad: string;
  macrodistrito: string;
  categoria: string;
}) {
  const ciudadFiltro =
    filtros.ciudad === "LA_PAZ" || filtros.ciudad === "EL_ALTO"
      ? (filtros.ciudad as Ciudad)
      : undefined;

  const macroFiltro =
    filtros.macrodistrito && filtros.macrodistrito !== "TODOS"
      ? filtros.macrodistrito
      : undefined;

  const categoriaFiltro =
    filtros.categoria && filtros.categoria !== "TODAS"
      ? filtros.categoria
      : undefined;

  const ahora = new Date();
  const hace7Dias = new Date(ahora);
  hace7Dias.setDate(hace7Dias.getDate() - 7);

  const hace14Dias = new Date(ahora);
  hace14Dias.setDate(hace14Dias.getDate() - 14);

  // REGLA ESTRICTA DE PRIVACIDAD:
  // 1. Conteo agregado con groupBy por ciudad y macrodistrito
  // 2. NUNCA se selecciona `nombreTienda`, `usuarioId` ni `totalBs` individual
  const [
    conteoComerciosZona,
    comerciosAnonimos,
    catalogo,
    agregadoStockComercioProd,
    detallesUltimos14d,
  ] = await Promise.all([
    prisma.comercio.groupBy({
      by: ["ciudad", "macrodistrito"],
      where: {
        ...(ciudadFiltro ? { ciudad: ciudadFiltro } : {}),
        ...(macroFiltro ? { macrodistrito: macroFiltro } : {}),
      },
      _count: { id: true },
    }),
    prisma.comercio.findMany({
      where: {
        ...(ciudadFiltro ? { ciudad: ciudadFiltro } : {}),
        ...(macroFiltro ? { macrodistrito: macroFiltro } : {}),
      },
      // Selección estrictamente anónima (sin nombreTienda ni usuarioId)
      select: {
        id: true,
        ciudad: true,
        macrodistrito: true,
      },
    }),
    prisma.catalogoCurado.findMany({
      where: categoriaFiltro ? { categoria: categoriaFiltro } : undefined,
      select: {
        id: true,
        nombreProducto: true,
        marca: true,
        categoria: true,
      },
    }),
    prisma.inventarioLote.groupBy({
      by: ["comercioId", "productoId"],
      where: {
        comercio: {
          ...(ciudadFiltro ? { ciudad: ciudadFiltro } : {}),
          ...(macroFiltro ? { macrodistrito: macroFiltro } : {}),
        },
        ...(categoriaFiltro
          ? { producto: { categoria: categoriaFiltro } }
          : {}),
      },
      _sum: { stockActual: true },
    }),
    prisma.detalleVenta.findMany({
      where: {
        venta: {
          fechaHora: { gte: hace14Dias },
          comercio: {
            ...(ciudadFiltro ? { ciudad: ciudadFiltro } : {}),
            ...(macroFiltro ? { macrodistrito: macroFiltro } : {}),
          },
        },
        ...(categoriaFiltro
          ? { producto: { categoria: categoriaFiltro } }
          : {}),
      },
      // Selección sin montos monetarios individuales (solo unidades y zona)
      select: {
        productoId: true,
        cantidad: true,
        venta: {
          select: {
            fechaHora: true,
            comercio: {
              select: {
                ciudad: true,
                macrodistrito: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const mapaCatalogo = new Map(catalogo.map((c) => [c.id, c]));
  const mapaComercioZona = new Map(
    comerciosAnonimos.map((c) => [
      c.id,
      { ciudad: c.ciudad, macrodistrito: c.macrodistrito },
    ])
  );

  const tiendasPorClaveZona = new Map<string, number>();
  let totalComerciosMonitoreados = 0;
  for (const g of conteoComerciosZona) {
    const key = `${g.ciudad}::${g.macrodistrito}`;
    tiendasPorClaveZona.set(key, g._count.id);
    totalComerciosMonitoreados += g._count.id;
  }

  // Acumuladores por zona, categoría, marca y oportunidad SKU
  const statsZona = new Map<
    string,
    {
      totalRegistrosSku: number;
      criticosSku: number;
      demanda7dPorProd: Map<string, number>;
      quiebresPorProd: Map<string, number>;
    }
  >();

  for (const cfg of MACRODISTRITOS_RED) {
    statsZona.set(`${cfg.ciudad}::${cfg.macrodistrito}`, {
      totalRegistrosSku: 0,
      criticosSku: 0,
      demanda7dPorProd: new Map(),
      quiebresPorProd: new Map(),
    });
  }

  let totalParesComercioProducto = 0;
  let totalParesCriticos = 0;
  const stockPorCategoria = new Map<string, number>();

  for (const fila of agregadoStockComercioProd) {
    const zona = mapaComercioZona.get(fila.comercioId);
    const prod = mapaCatalogo.get(fila.productoId);
    if (!zona || !prod) continue;

    const stockTotal = fila._sum.stockActual ?? 0;
    const keyZona = `${zona.ciudad}::${zona.macrodistrito}`;
    let z = statsZona.get(keyZona);
    if (!z) {
      z = {
        totalRegistrosSku: 0,
        criticosSku: 0,
        demanda7dPorProd: new Map(),
        quiebresPorProd: new Map(),
      };
      statsZona.set(keyZona, z);
    }

    totalParesComercioProducto += 1;
    z.totalRegistrosSku += 1;

    // Punto de reorden agregado: <= 5 unidades se considera bajo punto de reorden / crítico B2B
    if (stockTotal <= 5) {
      totalParesCriticos += 1;
      z.criticosSku += 1;
      z.quiebresPorProd.set(
        prod.id,
        (z.quiebresPorProd.get(prod.id) ?? 0) + 1
      );
    }

    stockPorCategoria.set(
      prod.categoria,
      (stockPorCategoria.get(prod.categoria) ?? 0) + Math.max(0, stockTotal)
    );
  }

  // Procesar unidades vendidas semana actual (últimos 7d) vs semana previa (8..14d)
  const ventas7dActualCat = new Map<string, number>();
  const ventas7dPreviaCat = new Map<string, number>();
  const unidades7dPorMarca = new Map<string, number>();
  let totalUnidadesUltimos7d = 0;

  for (const det of detallesUltimos14d) {
    const prod = mapaCatalogo.get(det.productoId);
    if (!prod) continue;

    const esUltimos7d = det.venta.fechaHora.getTime() >= hace7Dias.getTime();
    const keyZona = `${det.venta.comercio.ciudad}::${det.venta.comercio.macrodistrito}`;

    if (esUltimos7d) {
      totalUnidadesUltimos7d += det.cantidad;
      ventas7dActualCat.set(
        prod.categoria,
        (ventas7dActualCat.get(prod.categoria) ?? 0) + det.cantidad
      );
      unidades7dPorMarca.set(
        prod.marca,
        (unidades7dPorMarca.get(prod.marca) ?? 0) + det.cantidad
      );

      const z = statsZona.get(keyZona);
      if (z) {
        z.demanda7dPorProd.set(
          prod.id,
          (z.demanda7dPorProd.get(prod.id) ?? 0) + det.cantidad
        );
      }
    } else {
      ventas7dPreviaCat.set(
        prod.categoria,
        (ventas7dPreviaCat.get(prod.categoria) ?? 0) + det.cantidad
      );
    }
  }

  // 1. Construir `mapaCalorZonal`
  const zonasConfiguradasFiltradas = MACRODISTRITOS_RED.filter((z) => {
    if (ciudadFiltro && z.ciudad !== ciudadFiltro) return false;
    if (macroFiltro && z.macrodistrito !== macroFiltro) return false;
    return true;
  });

  const mapaCalorZonal = zonasConfiguradasFiltradas.map((cfg) => {
    const key = `${cfg.ciudad}::${cfg.macrodistrito}`;
    const tiendasActivas = tiendasPorClaveZona.get(key) ?? 0;
    const st = statsZona.get(key);

    const pctCritico =
      st && st.totalRegistrosSku > 0
        ? Number(((st.criticosSku / st.totalRegistrosSku) * 100).toFixed(1))
        : 0;

    const nivelUrgencia =
      tiendasActivas === 0 ? "BAJO" : clasificarUrgenciaZonal(pctCritico);

    // Top 3 productos más demandados (combinando rotación semanal y urgencia de reposición)
    const puntajesProd: Array<{
      productoId: string;
      nombreProducto: string;
      marca: string;
      categoria: string;
      unidadesDemandadas: number;
      comerciosBajoStock: number;
      score: number;
    }> = [];

    if (st) {
      const idsInvolucrados = new Set<string>([
        ...st.demanda7dPorProd.keys(),
        ...st.quiebresPorProd.keys(),
      ]);

      for (const pid of idsInvolucrados) {
        const pInfo = mapaCatalogo.get(pid);
        if (!pInfo) continue;
        const uDem = st.demanda7dPorProd.get(pid) ?? 0;
        const cQuiebre = st.quiebresPorProd.get(pid) ?? 0;
        puntajesProd.push({
          productoId: pid,
          nombreProducto: pInfo.nombreProducto,
          marca: pInfo.marca,
          categoria: pInfo.categoria,
          unidadesDemandadas: uDem + cQuiebre * 6,
          comerciosBajoStock: cQuiebre,
          score: uDem + cQuiebre * 12,
        });
      }
    }

    puntajesProd.sort((a, b) => b.score - a.score);
    const top3 = puntajesProd.slice(0, 3).map((x) => ({
      nombreProducto: x.nombreProducto,
      marca: x.marca,
      categoria: x.categoria,
      unidadesDemandadas: x.unidadesDemandadas,
      comerciosBajoStock: x.comerciosBajoStock,
    }));

    const demandaZona7d = st
      ? Array.from(st.demanda7dPorProd.values()).reduce((a, b) => a + b, 0) +
        st.criticosSku * 8
      : 0;

    return {
      ciudad: cfg.ciudad,
      macrodistrito: cfg.macrodistrito,
      altitudMsnm: cfg.altitudMsnm,
      svgX: cfg.svgX,
      svgY: cfg.svgY,
      tiendasActivas,
      porcentajeCriticoAgotado: pctCritico,
      nivelUrgencia,
      demandaProyectadaZona: demandaZona7d,
      topProductosDemandados: top3,
      rutaPreventaSugerida: construirRutaSugerida(
        cfg.ciudad,
        cfg.macrodistrito,
        nivelUrgencia,
        top3.map((t) => t.nombreProducto)
      ),
    };
  });

  // 2. Construir `rotacionPorCategoria`
  const categoriasEvaluar = categoriaFiltro
    ? [categoriaFiltro]
    : Array.from(
        new Set([
          ...CATEGORIAS_PRINCIPALES,
          ...catalogo.map((c) => c.categoria),
        ])
      );

  const rotacionPorCategoria = categoriasEvaluar.map((cat) => {
    const actual = ventas7dActualCat.get(cat) ?? 0;
    const previa = ventas7dPreviaCat.get(cat) ?? 0;
    const stockDisp = stockPorCategoria.get(cat) ?? 0;

    const tendenciaPct =
      previa > 0
        ? Number((((actual - previa) / previa) * 100).toFixed(1))
        : actual > 0
          ? 100
          : 0;

    const demandaEstimada = Math.max(actual, Math.ceil(stockDisp * 0.45));

    return {
      categoria: cat,
      volumenSemanalUnidades: actual,
      volumenSemanaPrevia: previa,
      tendenciaPct,
      demandaActualUnidades: demandaEstimada,
      stockDisponibleUnidades: stockDisp,
    };
  });

  // 3. Construir `oportunidadesReposicionB2B`
  const oportunidadesReposicionB2B: Array<{
    id: string;
    ciudad: string;
    macrodistrito: string;
    marca: string;
    nombreProducto: string;
    categoria: string;
    comerciosBajoReorden: number;
    tiendasTotalesZona: number;
    porcentajeZonaAfectada: number;
    unidadesSugeridasCamion: number;
    nivelUrgencia: NivelUrgenciaZonal;
  }> = [];

  for (const cfg of zonasConfiguradasFiltradas) {
    const key = `${cfg.ciudad}::${cfg.macrodistrito}`;
    const st = statsZona.get(key);
    const totalTiendasZona = tiendasPorClaveZona.get(key) ?? 0;
    if (!st || totalTiendasZona === 0) continue;

    for (const [prodId, cantComerciosCriticos] of st.quiebresPorProd.entries()) {
      if (cantComerciosCriticos <= 0) continue;
      const pInfo = mapaCatalogo.get(prodId);
      if (!pInfo) continue;

      const pctAfectada = Number(
        ((cantComerciosCriticos / totalTiendasZona) * 100).toFixed(1)
      );

      oportunidadesReposicionB2B.push({
        id: `${cfg.macrodistrito}-${prodId}`,
        ciudad: cfg.ciudad,
        macrodistrito: cfg.macrodistrito,
        marca: pInfo.marca,
        nombreProducto: pInfo.nombreProducto,
        categoria: pInfo.categoria,
        comerciosBajoReorden: cantComerciosCriticos,
        tiendasTotalesZona: totalTiendasZona,
        porcentajeZonaAfectada: pctAfectada,
        unidadesSugeridasCamion: cantComerciosCriticos * 18,
        nivelUrgencia: clasificarUrgenciaZonal(pctAfectada),
      });
    }
  }

  oportunidadesReposicionB2B.sort(
    (a, b) => b.comerciosBajoReorden - a.comerciosBajoReorden
  );

  // 4. KPIs Globales
  const tasaQuiebreStockZonalPct =
    totalParesComercioProducto > 0
      ? Number(
          ((totalParesCriticos / totalParesComercioProducto) * 100).toFixed(1)
        )
      : 0;

  const marcasConMovimiento = Math.max(1, unidades7dPorMarca.size);
  const velocidadRotacionPromedioMarca = Number(
    (totalUnidadesUltimos7d / 7 / marcasConMovimiento).toFixed(1)
  );

  const marcaLider =
    Array.from(unidades7dPorMarca.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "PIL Andina";

  const demandaProyectada7DiasUnidades = Math.max(
    Math.ceil(totalUnidadesUltimos7d * 1.08),
    totalParesCriticos * 14
  );

  return {
    kpisGlobales: {
      totalComerciosMonitoreados,
      tasaQuiebreStockZonalPct,
      velocidadRotacionPromedioMarca,
      marcaLiderRotacion: marcaLider,
      demandaProyectada7DiasUnidades,
      alertasReposicionActivas: oportunidadesReposicionB2B.length,
    },
    mapaCalorZonal,
    rotacionPorCategoria,
    oportunidadesReposicionB2B: oportunidadesReposicionB2B.slice(0, 18),
    cumplimientoPrivacidad: {
      kAnonimato: true,
      datosExcluidos: ["nombreTienda", "usuarioId", "montosFinancierosIndividuales"],
    },
    generadoEn: ahora.toISOString(),
  };
}

/**
 * GET /api/b2b/analytics
 * Retorna inteligencia comercial zonal 100% agregada y anonimizada.
 */
export async function GET(request: Request) {
  await connection();

  try {
    const { searchParams } = new URL(request.url);
    const ciudad = searchParams.get("ciudad") ?? "TODAS";
    const macrodistrito = searchParams.get("macrodistrito") ?? "TODOS";
    const categoria = searchParams.get("categoria") ?? "TODAS";

    const resultado = await calcularAnaliticaAnonimizada({
      ciudad,
      macrodistrito,
      categoria,
    });

    return NextResponse.json({
      ok: true,
      ...resultado,
    });
  } catch (error) {
    console.error("[GET /api/b2b/analytics] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Error calculando analítica zonal anonimizada." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/b2b/analytics
 * Simulador de Red Zonal de 80 Comercios (La Paz y El Alto) para demostración ejecutiva.
 * Usa inserción masiva (`createMany`) idempotente y respeta intacta la Tienda Doña Martha.
 */
export async function POST() {
  try {
    const catalogo = await prisma.catalogoCurado.findMany({
      orderBy: { codigoBarras: "asc" },
    });

    if (catalogo.length < 8) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Catálogo insuficiente. Ejecuta primero `npx prisma db seed`.",
        },
        { status: 400 }
      );
    }

    const ahora = new Date();
    const tiposComercio: TipoComercio[] = [
      TipoComercio.ABARROTES,
      TipoComercio.MICROMERCADO,
      TipoComercio.ABARROTES,
      TipoComercio.FARMACIA,
    ];

    // Seleccionar 10 SKUs estratégicos de consumo masivo para poblar la red de 80 comercios
    const skusRed = catalogo.slice(0, 10);

    const usuariosCrear: Prisma.UsuarioCreateManyInput[] = [];
    const comerciosCrear: Prisma.ComercioCreateManyInput[] = [];
    const lotesCrear: Prisma.InventarioLoteCreateManyInput[] = [];
    const ventasCrear: Prisma.VentaCreateManyInput[] = [];
    const detallesCrear: Prisma.DetalleVentaCreateManyInput[] = [];

    let indiceGlobal = 1;

    for (const zona of MACRODISTRITOS_RED) {
      for (let t = 0; t < zona.cantidadTiendasSim; t += 1) {
        const uid = `b2bsim_usr_${indiceGlobal}`;
        const cid = `b2bsim_com_${indiceGlobal}`;

        usuariosCrear.push({
          id: uid,
          nombre: `Afiliado Zonal #${indiceGlobal}`,
          email: `afiliado.${indiceGlobal}@zonal.stockia.bo`,
          passwordHash: "$2b$10$stockiaAnonB2BNetworkDemoHash2026",
          rol: RolUsuario.COMERCIANTE,
          plan:
            indiceGlobal % 4 === 0
              ? PlanSuscripcion.VOZ_PRO
              : PlanSuscripcion.BASICO_GRATIS,
        });

        comerciosCrear.push({
          id: cid,
          usuarioId: uid,
          nombreTienda: `Nodo Minorista ${indiceGlobal}`, // Jamás expuesto por GET /api/b2b/analytics
          tipoComercio: tiposComercio[indiceGlobal % tiposComercio.length],
          ciudad: zona.ciudad,
          macrodistrito: zona.macrodistrito,
          latitud: zona.latBase + ((t % 5) - 2) * 0.0025,
          longitud: zona.lngBase + ((t % 4) - 1.5) * 0.0025,
        });

        // Cada tienda maneja 6 productos representativos con presión de stock según la zona
        const lotesDeEstaTienda: Array<{
          id: string;
          productoId: string;
          precioVenta: number;
        }> = [];

        for (let pIdx = 0; pIdx < 6; pIdx += 1) {
          const prod = skusRed[(indiceGlobal + pIdx) % skusRed.length];
          const lid = `b2bsim_lote_${indiceGlobal}_${pIdx}`;

          // Determinar de forma determinista si este comercio entró en punto crítico de quiebre
          const umbral = ((indiceGlobal * 7 + pIdx * 13) % 100) / 100;
          const enQuiebre = umbral < zona.factorEstresQuiebre;

          const stockSim = enQuiebre
            ? (indiceGlobal + pIdx) % 4 // 0..3 unidades (bajo punto de reorden)
            : 14 + ((indiceGlobal * 3 + pIdx * 5) % 28); // 14..41 unidades saludables

          const fechaVenc = new Date(ahora);
          fechaVenc.setDate(fechaVenc.getDate() + (enQuiebre ? 6 : 45 + pIdx * 15));

          lotesCrear.push({
            id: lid,
            comercioId: cid,
            productoId: prod.id,
            stockActual: stockSim,
            precioCompra: new Prisma.Decimal("8.00"),
            precioVenta: new Prisma.Decimal("10.50"),
            fechaVencimiento: fechaVenc,
            estado:
              stockSim === 0
                ? EstadoLote.AGOTADO
                : enQuiebre
                  ? EstadoLote.POR_VENCER
                  : EstadoLote.ACTIVO,
          });

          lotesDeEstaTienda.push({
            id: lid,
            productoId: prod.id,
            precioVenta: 10.5,
          });
        }

        // Generar 2 ventas de la semana previa (días -11 y -9) y 2 de la semana actual (días -4 y -1)
        const offsetsDias = [-11, -9, -4, -1];
        offsetsDias.forEach((diaOffset, vIdx) => {
          const vid = `b2bsim_vta_${indiceGlobal}_${vIdx}`;
          const fechaVta = new Date(ahora);
          fechaVta.setDate(fechaVta.getDate() + diaOffset);

          const loteA = lotesDeEstaTienda[vIdx % lotesDeEstaTienda.length];
          const loteB = lotesDeEstaTienda[(vIdx + 2) % lotesDeEstaTienda.length];

          // Mayor demanda en la semana actual para reflejar crecimiento real en bebidas/lácteos
          const factorSemanaActual = diaOffset >= -7 ? 1.25 : 1.0;
          const cantA = Math.max(
            2,
            Math.round((3 + ((indiceGlobal + vIdx) % 5)) * factorSemanaActual)
          );
          const cantB = Math.max(
            1,
            Math.round((2 + ((indiceGlobal + vIdx) % 4)) * factorSemanaActual)
          );

          const subA = Number((cantA * loteA.precioVenta).toFixed(2));
          const subB = Number((cantB * loteB.precioVenta).toFixed(2));

          ventasCrear.push({
            id: vid,
            comercioId: cid,
            fechaHora: fechaVta,
            totalBs: new Prisma.Decimal((subA + subB).toFixed(2)),
            metodoRegistro:
              vIdx % 2 === 0 ? MetodoRegistro.ESCANER : MetodoRegistro.VOZ,
            sincronizadoOffline: vIdx === 3,
          });

          detallesCrear.push(
            {
              id: `b2bsim_det_${indiceGlobal}_${vIdx}_a`,
              ventaId: vid,
              loteId: loteA.id,
              productoId: loteA.productoId,
              cantidad: cantA,
              precioUnitario: new Prisma.Decimal(loteA.precioVenta.toFixed(2)),
              subtotal: new Prisma.Decimal(subA.toFixed(2)),
            },
            {
              id: `b2bsim_det_${indiceGlobal}_${vIdx}_b`,
              ventaId: vid,
              loteId: loteB.id,
              productoId: loteB.productoId,
              cantidad: cantB,
              precioUnitario: new Prisma.Decimal(loteB.precioVenta.toFixed(2)),
              subtotal: new Prisma.Decimal(subB.toFixed(2)),
            }
          );
        });

        indiceGlobal += 1;
      }
    }

    await prisma.$transaction(async (tx) => {
      // Limpieza en cascada de cualquier red B2B simulada previa
      await tx.usuario.deleteMany({
        where: { email: { endsWith: "@zonal.stockia.bo" } },
      });

      await tx.usuario.createMany({ data: usuariosCrear });
      await tx.comercio.createMany({ data: comerciosCrear });
      await tx.inventarioLote.createMany({ data: lotesCrear });
      await tx.venta.createMany({ data: ventasCrear });
      await tx.detalleVenta.createMany({ data: detallesCrear });
    });

    const analitica = await calcularAnaliticaAnonimizada({
      ciudad: "TODAS",
      macrodistrito: "TODOS",
      categoria: "TODAS",
    });

    return NextResponse.json({
      ok: true,
      mensaje:
        "Red zonal de 80 comercios en La Paz y El Alto simulada exitosamente.",
      ...analitica,
    });
  } catch (error) {
    console.error("[POST /api/b2b/analytics] Error:", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo simular la red de 80 comercios." },
      { status: 500 }
    );
  }
}
