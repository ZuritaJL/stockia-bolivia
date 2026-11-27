import "dotenv/config";
import {
  Ciudad,
  EstadoLote,
  PlanSuscripcion,
  Prisma,
  PrismaClient,
  RolUsuario,
  TipoComercio,
  UnidadMedida,
} from "@prisma/client";

const prisma = new PrismaClient();

interface ProductoSeed {
  codigoBarras: string;
  nombreProducto: string;
  marca: string;
  categoria: string;
  unidadMedida: UnidadMedida;
  imagenUrl?: string;
}

const CATALOGO_BOLIVIA: ProductoSeed[] = [
  // Bebidas
  {
    codigoBarras: "7771609000124",
    nombreProducto: "Coca-Cola 2L",
    marca: "Coca-Cola",
    categoria: "Bebidas",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7771702001058",
    nombreProducto: "Cascada Orgullosa Papaya 2L",
    marca: "La Cascada",
    categoria: "Bebidas",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7771609002081",
    nombreProducto: "Agua Vital Sin Gas 2L",
    marca: "Vital",
    categoria: "Bebidas",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7771101001049",
    nombreProducto: "Cerveza Paceña Lata 473ml",
    marca: "CBN Paceña",
    categoria: "Bebidas",
    unidadMedida: UnidadMedida.UNIDAD,
  },
  {
    codigoBarras: "7771101002107",
    nombreProducto: "Maltín CBN 330ml",
    marca: "CBN",
    categoria: "Bebidas",
    unidadMedida: UnidadMedida.UNIDAD,
  },

  // Lácteos y Derivados
  {
    codigoBarras: "7771207002115",
    nombreProducto: "Pilfrut Durazno 190ml",
    marca: "PIL Andina",
    categoria: "Lácteos",
    unidadMedida: UnidadMedida.UNIDAD,
  },
  {
    codigoBarras: "7771207001019",
    nombreProducto: "Leche Pil Natural 1L",
    marca: "PIL Andina",
    categoria: "Lácteos",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7771207003051",
    nombreProducto: "Yogurt Pil Frutilla 1L",
    marca: "PIL Andina",
    categoria: "Lácteos",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7771201003095",
    nombreProducto: "Mantequilla Regia con Sal 200g",
    marca: "Regia",
    categoria: "Lácteos",
    unidadMedida: UnidadMedida.UNIDAD,
  },
  {
    codigoBarras: "7772301001088",
    nombreProducto: "Leche Deslactosada Delizia 1L",
    marca: "Delizia",
    categoria: "Lácteos",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7771207004195",
    nombreProducto: "Chicolac PIL Chocolate 1L",
    marca: "PIL Andina",
    categoria: "Lácteos",
    unidadMedida: UnidadMedida.LITRO,
  },

  // Abarrotes
  {
    codigoBarras: "7771201001015",
    nombreProducto: "Aceite Fino 900ml",
    marca: "Fino",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.LITRO,
  },
  {
    codigoBarras: "7772104001014",
    nombreProducto: "Arroz Grano de Oro 1kg",
    marca: "Grano de Oro",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.KILO,
  },
  {
    codigoBarras: "7771402001083",
    nombreProducto: "Fideo Lazaroni 400g",
    marca: "Lazaroni",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.PAQUETE,
  },
  {
    codigoBarras: "7771503001011",
    nombreProducto: "Azúcar Guabirá 1kg",
    marca: "Guabirá",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.KILO,
  },
  {
    codigoBarras: "7771806001047",
    nombreProducto: "Café Copacabana Clásico 200g",
    marca: "Copacabana",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.PAQUETE,
  },
  {
    codigoBarras: "7771401001024",
    nombreProducto: "Harina Blanca Flor Famosa 1kg",
    marca: "Famosa",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.KILO,
  },
  {
    codigoBarras: "7772203001053",
    nombreProducto: "Avena Instantánea Princesa 400g",
    marca: "Princesa",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.PAQUETE,
  },
  {
    codigoBarras: "7772901001012",
    nombreProducto: "Sal Yodada Universo 1kg",
    marca: "Universo",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.KILO,
  },
  {
    codigoBarras: "7772504001031",
    nombreProducto: "Té Windsor Canela Caja x20",
    marca: "Windsor",
    categoria: "Abarrotes",
    unidadMedida: UnidadMedida.CAJA,
  },

  // Panadería y Snacks
  {
    codigoBarras: "7773105001022",
    nombreProducto: "Pan Molde San Gabriel 500g",
    marca: "San Gabriel",
    categoria: "Panadería",
    unidadMedida: UnidadMedida.PAQUETE,
  },
  {
    codigoBarras: "7771308001129",
    nombreProducto: "Galletas Mabel's Rosquitas 400g",
    marca: "Mabel's",
    categoria: "Snacks",
    unidadMedida: UnidadMedida.PAQUETE,
  },

  // Limpieza y Hogar
  {
    codigoBarras: "7774102001082",
    nombreProducto: "Detergente OMO Multiacción 800g",
    marca: "OMO",
    categoria: "Limpieza",
    unidadMedida: UnidadMedida.PAQUETE,
  },
  {
    codigoBarras: "7774201001045",
    nombreProducto: "Lavavajillas Ola Limón 500ml",
    marca: "Ola",
    categoria: "Limpieza",
    unidadMedida: UnidadMedida.UNIDAD,
  },
  {
    codigoBarras: "7774305001091",
    nombreProducto: "Papel Higiénico Scott Rindemax x4",
    marca: "Scott",
    categoria: "Limpieza",
    unidadMedida: UnidadMedida.PAQUETE,
  },
];

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

async function main() {
  console.log("🇧🇴 Iniciando seed idempotente de StockIA Bolivia...");

  // 1. Catálogo Curado de 25 productos bolivianos (777...)
  const productosPorCodigo = new Map<string, string>();

  for (const item of CATALOGO_BOLIVIA) {
    const producto = await prisma.catalogoCurado.upsert({
      where: { codigoBarras: item.codigoBarras },
      update: {
        nombreProducto: item.nombreProducto,
        marca: item.marca,
        categoria: item.categoria,
        unidadMedida: item.unidadMedida,
        imagenUrl: item.imagenUrl ?? null,
      },
      create: {
        codigoBarras: item.codigoBarras,
        nombreProducto: item.nombreProducto,
        marca: item.marca,
        categoria: item.categoria,
        unidadMedida: item.unidadMedida,
        imagenUrl: item.imagenUrl ?? null,
      },
    });
    productosPorCodigo.set(item.codigoBarras, producto.id);
  }
  console.log(`✔ Catálogo curado sincronizado: ${productosPorCodigo.size} productos.`);

  // 2. Usuario COMERCIANTE + Comercio ("Tienda Doña Martha" - Miraflores, La Paz)
  const usuarioComerciante = await prisma.usuario.upsert({
    where: { email: "martha@stockia.bo" },
    update: {
      nombre: "Martha Quispe Mamani",
      rol: RolUsuario.COMERCIANTE,
      plan: PlanSuscripcion.BASICO_GRATIS,
    },
    create: {
      nombre: "Martha Quispe Mamani",
      email: "martha@stockia.bo",
      // Hash demostrativo para entorno de pruebas MVP
      passwordHash: "$2b$10$stockiaDemoHashMarthaQuispeBolivia2026",
      rol: RolUsuario.COMERCIANTE,
      plan: PlanSuscripcion.BASICO_GRATIS,
      comandosVozHoy: 2,
    },
  });

  const comercioMartha = await prisma.comercio.upsert({
    where: { usuarioId: usuarioComerciante.id },
    update: {
      nombreTienda: "Tienda Doña Martha",
      tipoComercio: TipoComercio.ABARROTES,
      ciudad: Ciudad.LA_PAZ,
      macrodistrito: "Miraflores",
      latitud: -16.5048,
      longitud: -68.1206,
    },
    create: {
      usuarioId: usuarioComerciante.id,
      nombreTienda: "Tienda Doña Martha",
      tipoComercio: TipoComercio.ABARROTES,
      ciudad: Ciudad.LA_PAZ,
      macrodistrito: "Miraflores",
      latitud: -16.5048,
      longitud: -68.1206,
    },
  });
  console.log(`✔ Comercio configurado: ${comercioMartha.nombreTienda} (${comercioMartha.macrodistrito}, La Paz).`);

  // 3. 10 Lotes iniciales de inventario (incluyendo 2 lotes próximos a vencer en < 5 días para alertas FEFO)
  const ahora = new Date();
  const lotesIniciales = [
    // ALERTA FEFO #1: Vence en 2 días (< 5 días)
    {
      id: "seed-lote-martha-01",
      codigoBarras: "7771207003051", // Yogurt Pil Frutilla 1L
      stockActual: 8,
      precioCompra: "10.50",
      precioVenta: "13.00",
      fechaVencimiento: addDays(ahora, 2),
      estado: EstadoLote.POR_VENCER,
    },
    // ALERTA FEFO #2: Vence en 4 días (< 5 días)
    {
      id: "seed-lote-martha-02",
      codigoBarras: "7773105001022", // Pan Molde San Gabriel 500g
      stockActual: 6,
      precioCompra: "11.00",
      precioVenta: "14.00",
      fechaVencimiento: addDays(ahora, 4),
      estado: EstadoLote.POR_VENCER,
    },
    // Lotes ACTIVOS regulares
    {
      id: "seed-lote-martha-03",
      codigoBarras: "7771609000124", // Coca-Cola 2L
      stockActual: 24,
      precioCompra: "10.20",
      precioVenta: "13.00",
      fechaVencimiento: addDays(ahora, 90),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-04",
      codigoBarras: "7771201001015", // Aceite Fino 900ml
      stockActual: 18,
      precioCompra: "11.50",
      precioVenta: "14.50",
      fechaVencimiento: addDays(ahora, 180),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-05",
      codigoBarras: "7771207002115", // Pilfrut Durazno 190ml
      stockActual: 36,
      precioCompra: "1.50",
      precioVenta: "2.00",
      fechaVencimiento: addDays(ahora, 25),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-06",
      codigoBarras: "7771207001019", // Leche Pil Natural 1L
      stockActual: 20,
      precioCompra: "6.20",
      precioVenta: "7.50",
      fechaVencimiento: addDays(ahora, 12),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-07",
      codigoBarras: "7772104001014", // Arroz Grano de Oro 1kg
      stockActual: 30,
      precioCompra: "8.00",
      precioVenta: "10.00",
      fechaVencimiento: addDays(ahora, 240),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-08",
      codigoBarras: "7771402001083", // Fideo Lazaroni 400g
      stockActual: 25,
      precioCompra: "4.80",
      precioVenta: "6.50",
      fechaVencimiento: addDays(ahora, 210),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-09",
      codigoBarras: "7771503001011", // Azúcar Guabirá 1kg
      stockActual: 28,
      precioCompra: "5.80",
      precioVenta: "7.50",
      fechaVencimiento: addDays(ahora, 300),
      estado: EstadoLote.ACTIVO,
    },
    {
      id: "seed-lote-martha-10",
      codigoBarras: "7771308001129", // Galletas Mabel's Rosquitas 400g
      stockActual: 15,
      precioCompra: "7.20",
      precioVenta: "9.50",
      fechaVencimiento: addDays(ahora, 75),
      estado: EstadoLote.ACTIVO,
    },
  ];

  for (const lote of lotesIniciales) {
    const productoId = productosPorCodigo.get(lote.codigoBarras);
    if (!productoId) {
      throw new Error(`Producto no encontrado para código ${lote.codigoBarras}`);
    }

    await prisma.inventarioLote.upsert({
      where: { id: lote.id },
      update: {
        comercioId: comercioMartha.id,
        productoId,
        stockActual: lote.stockActual,
        precioCompra: new Prisma.Decimal(lote.precioCompra),
        precioVenta: new Prisma.Decimal(lote.precioVenta),
        fechaVencimiento: lote.fechaVencimiento,
        estado: lote.estado,
      },
      create: {
        id: lote.id,
        comercioId: comercioMartha.id,
        productoId,
        stockActual: lote.stockActual,
        precioCompra: new Prisma.Decimal(lote.precioCompra),
        precioVenta: new Prisma.Decimal(lote.precioVenta),
        fechaVencimiento: lote.fechaVencimiento,
        estado: lote.estado,
      },
    });
  }
  console.log(`✔ Inventario inicial sincronizado: ${lotesIniciales.length} lotes (2 en alerta FEFO < 5 días).`);

  // 4. Usuario DISTRIBUIDORA_B2B ("Distribuidora Andina S.R.L.")
  const usuarioDistribuidora = await prisma.usuario.upsert({
    where: { email: "inteligencia@andina-b2b.bo" },
    update: {
      nombre: "Distribuidora Andina S.R.L.",
      rol: RolUsuario.DISTRIBUIDORA_B2B,
      plan: PlanSuscripcion.VOZ_PRO,
    },
    create: {
      nombre: "Distribuidora Andina S.R.L.",
      email: "inteligencia@andina-b2b.bo",
      passwordHash: "$2b$10$stockiaDemoHashDistribuidoraAndinaB2B2026",
      rol: RolUsuario.DISTRIBUIDORA_B2B,
      plan: PlanSuscripcion.VOZ_PRO,
    },
  });
  console.log(`✔ Usuario B2B sincronizado: ${usuarioDistribuidora.nombre} (${usuarioDistribuidora.email}).`);

  console.log("✅ Seed de StockIA Bolivia completado exitosamente.");
}

main()
  .catch((error) => {
    console.error("❌ Error ejecutando seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
