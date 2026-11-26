# StockIA Bolivia 🇧🇴

> **"Controla tus productos, protege tus ganancias."**
> Aplicación Web Progresiva (PWA) Adaptativa (*Mobile-First* y *Offline-First*) con Inteligencia Artificial por Voz para comercios minoristas de La Paz y El Alto, integrada con un Portal Ejecutivo Web B2B de Inteligencia Comercial Zonal Anonimizada para distribuidoras.

---

## 1. Arquitectura General del Sistema

**StockIA Bolivia** está construida como un **Monolito Modular Adaptativo** sobre **Next.js 16 (App Router + TypeScript)** que adapta su experiencia según el rol activo:

### Rol `COMERCIANTE` (Móvil · *Offline-First* · `< 5s` por operación)
- **Mostrador Móvil Ultrarrápido (`/mostrador`):**
  - Persistencia local primaria en **IndexedDB (`Dexie.js`)** con cola transaccional FIFO (`colaSincronizacion`) y sincronización diferencial automática (`/api/sync`) al recuperar señal de internet.
  - **Escáner EAN-13 (`777...`)** mediante cámara trasera con `html5-qrcode` y retroalimentación háptica (`navigator.vibrate`).
  - **Despacho automático FEFO (*First Expired, First Out*):** Descuenta siempre primero el lote con fecha de vencimiento más próxima.
- **Asistente Operativo de Voz con IA (`VoiceAssistantButton` + `/api/voice-assistant`):**
  - Captura de dictado en español (`Web Speech API`) y lectura en voz alta sin costo de datos (`window.speechSynthesis`).
  - *Function Calling* con `@google/genai` en cascada tolerante a alta demanda (`gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.0-flash` → Parser Local Determinista en español).
  - Ventana de seguridad **"Deshacer (6s)"** (`/api/voice-assistant/undo`) para revertir dictados erróneos de forma transaccional.
- **Motor Predictivo & Preventista (`/alertas` + `src/lib/fefo-engine.ts`):**
  - Velocidad de Rotación Diaria (**VRD** 14 días), Punto de Reorden automático para cubrir 7 días + botón **"Copiar pedido para WhatsApp"**.
  - Semáforo FEFO (`ROJO_CRITICO` 0-3d, `AMBAR_PREVENTIVO` 4-10d, `VERDE_OPTIMO` >10d) y **Detector de Capital Dormido** (> 21 días sin ventas).
- **Modelo Freemium & QR Simple Bolivia (`/plan`):**
  - **Plan Básico (Bs 0/mes):** 15 comandos de voz gratuitos por día.
  - **Plan Asistente Voz Pro (Bs 25/mes):** Comandos de voz ilimitados 24/7 con activación demostrativa vía **QR Simple Bolivia**.

### Rol `DISTRIBUIDORA_B2B` (Escritorio · Inteligencia Zonal k-Anonimizada)
- **Dashboard Ejecutivo (`/dashboard` + `/api/b2b/analytics`):**
  - Mapa de Calor Zonal Interactivo de los macrodistritos de **La Paz** (*Miraflores, Sopocachi, Max Paredes, Villa Fátima, Zona Sur*) y **El Alto** (*Ceja, Ciudad Satélite*).
  - Gráficos analíticos apilados en `Recharts` (*Demanda Proyectada vs. Stock Disponible por Categoría*), campañas de reposición sugerida y exportación directa a **CSV**.
  - **Ética y Privacidad por Diseño:** Agregaciones estrictas (`groupBy`) que jamás exponen `nombreTienda`, `usuarioId` ni ventas monetarias individuales.

---

## 2. Stack Tecnológico

| Capa | Tecnología |
| --- | --- |
| Framework Full-Stack | **Next.js 16.4** (App Router, Cache Components, TypeScript 5) |
| Interfaz & Estilos | **React 19**, **Tailwind CSS v4**, `lucide-react`, `recharts` |
| Base de Datos Cloud | **PostgreSQL** (Neon / Supabase) + **Prisma ORM v6** (`prisma.config.ts`) |
| Motor Offline Local | **Dexie.js v4** (`IndexedDB` + `dexie-react-hooks`) |
| Empaquetado PWA | `@ducanh2912/next-pwa`, `manifest.json` + Service Worker Offline |
| Inteligencia Artificial & Voz | SDK oficial `@google/genai` + Web Speech API (`SpeechRecognition` & `speechSynthesis`) |
| Lector Código de Barras | `html5-qrcode` (EAN-13, EAN-8, CODE-128, QR) |

---

## 3. Instalación y Configuración Local

### Requisitos previos
- **Node.js** `>= 22.0.0` (verificado en `v24.19.0`)
- Base de datos **PostgreSQL** activa (Neon, Supabase o instancia local)
- Clave de API de Google AI Studio (`GEMINI_API_KEY`)

### Paso 1: Instalar dependencias
```bash
npm install
```

### Paso 2: Configurar variables de entorno (`.env`)
Crea o edita el archivo `.env` en la raíz del proyecto con las siguientes variables:

```env
# Cadena de conexión PostgreSQL (Neon / Supabase)
DATABASE_URL="postgresql://USUARIO:PASSWORD@HOST/NOMBRE_BD?sslmode=require"

# Clave de API de Google Gemini AI Studio
GEMINI_API_KEY="AIzaSy..."
```

### Paso 3: Generar cliente Prisma, sincronizar esquema y poblar semilla boliviana
```bash
# 1. Generar el cliente tipado de Prisma en src/generated/prisma
npx prisma generate

# 2. Aplicar tablas, enums e índices compuestos en PostgreSQL
npx prisma db push

# 3. Cargar los 25 productos bolivianos (777...), Tienda Doña Martha y Distribuidora Andina
npx prisma db seed
```

### Paso 4: Iniciar en desarrollo
```bash
npm run dev
```
Abre `http://localhost:3000` (redirige automáticamente a `/mostrador`).

---

## 4. Guía Rápida para Demostración / Defensa del Proyecto

1. **Mostrador Offline-First (`/mostrador`):**
   - Prueba escanear o tocar productos, presiona **"Probar Offline"**, cobra una venta con descuento **FEFO** y pulsa **"Reconectar Red"** para demostrar la sincronización automática hacia PostgreSQL.
2. **Asistente de Voz IA (Botón central Ámbar/Esmeralda):**
   - Toca el micrófono (o *"Escribir"* en PC) y prueba: *"Vendí 2 Yogurt Pil Frutilla"*, *"Aumenta 10 unidades de Coca-Cola 2L"* o *"Crea el producto Galletas Oreo a 5 bolivianos con 10 unidades"*. Prueba también el botón **"Deshacer (6s)"**.
3. **Motor Predictivo (`/alertas`):**
   - Haz clic en **"Simular historial de 14 días"** para poblar la curva de rotación, ver qué pedir hoy, copiar el pedido formateado para **WhatsApp** y revisar el **Capital Dormido**.
4. **Suscripción QR Simple Bolivia (`/plan`):**
   - Abre **"Activar con QR Simple Bolivia · Bs 25"** y pulsa **"Confirmar Pago Simulado"** para desbloquear al instante la insignia **"Voz Pro Ilimitado"**.
5. **Portal Ejecutivo B2B (`/dashboard`):**
   - Cambia el selector superior a **B2B Zonal**, presiona **"Simular Red de 80 Comercios Zonal"**, explora el mapa de calor interactivo entre El Alto y La Paz, y descarga el **Reporte Zonal (CSV)**.

---

## 5. Despliegue en Producción (Vercel)

1. Sube el repositorio a **GitHub / GitLab**.
2. En [Vercel](https://vercel.com), selecciona **Add New Project** e importa el repositorio.
3. En **Environment Variables**, configura:
   - `DATABASE_URL`
   - `GEMINI_API_KEY`
4. Asegúrate de que el *Build Command* ejecute la generación de Prisma antes del build de Next.js (o configúralo en Vercel como):
   ```bash
   npx prisma generate && next build
   ```
5. Despliega el proyecto. Al servirse sobre **HTTPS**, los comerciantes en Android/iOS podrán instalar **StockIA** directamente en su pantalla de inicio como PWA nativa independiente (`standalone`).
