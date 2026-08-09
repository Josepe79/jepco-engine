# Jepco Engine — despliegue y operación

Asistente conversacional con RAG sobre manuales propios. Cada *marca* es un
asistente independiente con su propia personalidad y su propia base de
conocimiento.

---

## 1. Arquitectura

```
Navegador                 Railway                        Servicios externos
─────────                 ───────                        ──────────────────
snfplus-widget.js  ──▶  Fastify (src/index.js)
                          │
                          ├─▶ PostgreSQL + pgvector  ──  conversaciones
                          │                              y fragmentos
                          │
                          ├─▶ Gemini embeddings      ──▶ Google
                          │   (gemini-embedding-001, 3072 dims)
                          │
                          ├─▶ Gemini generación      ──▶ Google
                          │   (gemini-2.5-flash-lite)
                          │
                          └─▶ Bot de Telegram        ──▶ avisos de escalado
```

**Flujo de una consulta:**

1. El widget envía `{ brandId, userId, message, category }` a `/api/chat`
2. El servidor convierte el mensaje en un vector (embedding)
3. Busca en `KnowledgeChunk` los 3 fragmentos más próximos por similitud coseno,
   filtrando por `brandId` y, si viene, por `category`
4. Si la categoría no devuelve nada, reintenta sin filtro de categoría
5. Pasa esos fragmentos a Gemini como `systemInstruction` con la orden de
   responder **solo** con eso
6. Si Gemini no encuentra la respuesta, devuelve `[ESCALAR_A_HUMANO]` y se
   dispara un aviso por Telegram

---

## 2. Variables de entorno

### Imprescindibles

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL. Requiere la extensión `pgvector`. |
| `GEMINI_API_KEY` | Clave de la API de Google Gemini. |
| `UPLOAD_SECRET` | Secreto compartido de los endpoints de administración e ingesta. |

### Seguridad — revisar antes de abrir a usuarios

| Variable | Por defecto | Descripción |
|---|---|---|
| `CORS_ORIGINS` | `*` | Dominios autorizados a llamar a `/api/*`. **Hay que fijarlo en producción.** Ver §4. |
| `RATE_LIMIT_MAX` | `30` | Peticiones/minuto por IP en `/api/chat`. |
| `RATE_LIMIT_GLOBAL_MAX` | `120` | Peticiones/minuto por IP en el resto de rutas. |
| `ADMIN_USERS` | vacío | Cuentas del panel `/admin`. Sin ella, el panel queda deshabilitado. Ver §8. |

### Telegram — avisos de escalado

| Variable | Descripción |
|---|---|
| `ADMIN_BOT_TOKEN` | Bot que envía los avisos al administrador. |
| `ADMIN_TELEGRAM_CHAT_ID` | Chat que los recibe. |
| `SNFPLUS_USUARIO_BOT_TOKEN` | Bot del perfil usuario. Acepta también el nombre antiguo `SNFPLUS_BOT_TOKEN`. |
| `SNFPLUS_RRHH_BOT_TOKEN` | Bot del perfil RRHH (opcional). |
| `SNFPLUS_GESTOR_BOT_TOKEN` | Bot del perfil gestor (opcional). |

Sin `ADMIN_BOT_TOKEN` y `ADMIN_TELEGRAM_CHAT_ID`, el escalado sigue
funcionando de cara al usuario pero **nadie recibe el aviso**.

### Otras

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Railway la inyecta automáticamente. |

---

## 3. Puesta en marcha desde cero

Para levantar una instancia nueva — por ejemplo si el cliente autoaloja.

```bash
# 1. Base de datos: PostgreSQL con pgvector
#    En Railway, añadir el servicio Postgres y habilitar la extensión:
#    CREATE EXTENSION IF NOT EXISTS vector;

# 2. Esquema
npx prisma db push

# 3. Variables de entorno (ver §2)

# 4. Cargar el conocimiento de cada perfil
node scratch/load-snfplus-manual.js   # usuario
node scratch/load-rrhh-manual.js      # RRHH
node scratch/load-gestor-manual.js    # gestor

# 5. Arrancar
npm start
```

**Comprobación:** `GET /health` debe devolver `{"status":"ok"}`, y los logs de
arranque deben mostrar la política de CORS y los límites activos.

---

## 4. CORS

Controla qué webs pueden llamar a `/api/*`. Sin esto, cualquier sitio puede
incrustar el widget y consumir la cuota de Gemini a vuestra costa.

**Formatos admitidos** en `CORS_ORIGINS`, separados por coma:

| Valor | Efecto |
|---|---|
| `*` | Cualquier origen. **Solo desarrollo.** |
| `https://app.snfplus.com` | Origen exacto (esquema + host + puerto). |
| `*.snfplus.com` | Cualquier subdominio, y el dominio raíz. |

```
CORS_ORIGINS=https://app.snfplus.com,*.snfplus.com
```

**Qué NO bloquea:** la carga del propio widget. Una etiqueta `<script src>` no
pasa por CORS, así que `/public/snfplus-widget.js` se sirve a cualquiera —
igual que un CDN. Lo que se protege son las llamadas a la API.

**Comportamiento:**

- Origen permitido → pasa, con cabecera `Access-Control-Allow-Origin`
- Origen no permitido en `/api/*` → **403** antes de tocar Gemini
- Peticiones sin cabecera `Origin` (health checks, curl, servidor a servidor) →
  pasan. CORS es una protección del navegador; sin `Origin` no hay navegador que
  proteger, y bloquear aquí rompería el monitor de Railway sin aportar nada.

Al arrancar, los logs dicen qué política está activa. Si está en `*`, sale un
aviso destacado.

---

## 5. Rate limiting

| Ruta | Límite |
|---|---|
| `/api/chat` | `RATE_LIMIT_MAX` (30/min) por IP |
| `/api/my-data/:userId` | 5/min por IP, fijo |
| Resto | `RATE_LIMIT_GLOBAL_MAX` (120/min) por IP |

Verificable con las cabeceras `x-ratelimit-limit`, `x-ratelimit-remaining` y
`x-ratelimit-reset` en cualquier respuesta.

### Dos detalles que importan

**`trustProxy` es obligatorio en Railway.** El servidor está detrás de un proxy;
sin `trustProxy: true` en el constructor de Fastify, `req.ip` devuelve la IP
interna del proxy y **todos los usuarios comparten la misma cuota**.

**El contador vive en memoria.** Si escaláis a varias instancias, cada una lleva
su propio recuento y el límite efectivo se multiplica por el número de
instancias. Con una sola instancia no hay problema; para varias hace falta un
store compartido en Redis.

### Orden de arranque — no reordenar sin leer esto

Fastify solo aplica los hooks `onRequest` a las rutas registradas **después** de
que el hook exista, y `fastify.register()` es diferido: encola el plugin y no lo
carga hasta `listen()`.

Si las rutas se declaran a nivel de módulo, el plugin de rate limit todavía no ha
instalado su hook cuando entran en el árbol, y **el límite no se aplica nunca** —
ni el global ni el de cada ruta. El síntoma es que todas las peticiones pasan y
no aparece ninguna cabecera `x-ratelimit-*`.

Por eso `src/index.js` sigue esta secuencia:

```js
await registerPlugins();   // 1. hooks instalados
registerRoutes();          // 2. rutas heredan los hooks
await fastify.listen();    // 3. escuchar
```

---

## 6. Incrustar el widget

```html
<script
    src="https://TU-DOMINIO/public/snfplus-widget.js"
    data-brand-id="snfplus_usuario"
    data-env-label="SNF+"
    data-app-url="https://app.snfplus.com"
    data-mediador="Nombre del mediador">
</script>
```

| Atributo | Por defecto | Descripción |
|---|---|---|
| `data-brand-id` | `snfplus_usuario` | Perfil del asistente. Determina personalidad y base de conocimiento. |
| `data-env-label` | `SNF+` | Nombre mostrado en la cabecera del widget. |
| `data-app-url` | — | URL de la aplicación en ese entorno. La IA la usa para indicar dónde acceder. |
| `data-mediador` | — | Mediador de seguros del cliente. La IA lo nombra al derivar consultas de póliza. |
| `data-api-url` | origen del script | Backend. Se deduce del `src`; solo hace falta si difieren. |

**Un mismo fichero JS sirve para todos los entornos.** La configuración va en los
atributos, así que quien incrusta el widget decide su entorno sin que haya que
tocar el código.

### Perfiles disponibles

| `data-brand-id` | Para quién | Secciones del menú |
|---|---|---|
| `snfplus_usuario` | Empleado | Retribución flexible, productos, dudas de la app |
| `snfplus_rrhh` | Responsable de RRHH | 7 secciones de gestión |
| `snfplus_gestor` | Gestor de plataforma | 5 secciones de administración |

---

## 7. Gestión del conocimiento

El conocimiento vive en la tabla `KnowledgeChunk`, con un vector de 3072
dimensiones por fragmento. Cada fragmento pertenece a un `brandId` y,
opcionalmente, a una `category`.

**Por qué importa la categoría:** el widget la envía junto al mensaje y acota la
búsqueda a los fragmentos de esa categoría. Sin ella, la búsqueda va contra todo
el conocimiento de la marca y pierde precisión — que es lo que provocaba que la
IA rellenara huecos con conocimiento general en vez de con el manual.

### Añadir o corregir fragmentos

Los scripts de `scratch/` siguen todos el mismo patrón: borran el fragmento de
esa `brandId` + `category` y lo reinsertan con un embedding nuevo.

```bash
node scratch/load-rrhh-manual.js     # recarga los 7 de RRHH
node scratch/load-gestor-manual.js   # recarga los 5 de gestor
node scratch/update-chunk.js         # editar el array UPDATES para casos sueltos
```

### Categorías reconocidas

Al añadir una categoría nueva hay que darla de alta en `ALLOWED_CATEGORIES`
(`src/index.js`); si no, el backend rechaza la petición con `Invalid category`.

| Perfil | Categorías |
|---|---|
| usuario | `acceso_navegacion`, `perfil`, `familiares`, `productos_general`, `retribucion_general`, `ahorro`, `salud`, `guarderia`, `comida`, `transporte`, `formacion`, `renting`, `contrato_novacion` |
| rrhh | `acceso_navegacion`, `administracion_empresas_sucursales`, `administracion_grupos`, `importacion_y_actualizacion_masiva`, `gestion_usuarios`, `seguimiento_planes`, `informes` |
| gestor | `onboarding_companias`, `administrar_companias`, `resumen_salud`, `control_companias`, `contrataciones` |

---

## 8. Telemetría y mejora del bot

### Qué se registra

Cada intercambio deja una fila en `Interaction` con el porqué de la respuesta,
no solo el texto:

| Campo | Para qué sirve |
|---|---|
| `category` | Categoría enviada por el widget. `null` = el usuario escribió a mano. |
| `categoryFallback` | La categoría pedida no tenía contenido y hubo que buscar en el fondo general. |
| `chunksFound` | `0` significa que no hay nada parecido en el conocimiento. |
| `topSimilarity` | Similitud del mejor fragmento (0–1). Bajo = existe contenido pero no encaja. |
| `chunkIds` | Qué fragmentos se usaron. Revela cuáles cargan el peso y cuáles no se usan nunca. |
| `escalated` | Inmutable, a diferencia de `Conversation.status`. |
| `latencyMs` | Tiempo total de respuesta. |

Es una tabla aparte de `Conversation.history` a propósito: `history` guarda el
diálogo para dárselo a la IA; esto guarda el diagnóstico.

**El registro nunca puede tumbar una conversación.** `recordInteraction()` traga
sus propios errores: si falla, se pierde esa fila y el usuario no se entera.

### El panel: `/admin`

Interfaz web con todos los patrones, filtrable por marca y periodo.

**Acceso.** Autenticación básica HTTP con cuentas nominales. Se crean así:

```bash
node scratch/admin-user.js josep
```

Imprime una contraseña aleatoria (que solo se muestra una vez) y la cadena
`usuario:salt:hash` para pegar en `ADMIN_USERS`. Varias cuentas se separan por
coma. Sin `ADMIN_USERS` definida, el panel responde 503.

**Por qué nominal y no una llave compartida:** detrás del panel hay
conversaciones de empleados. Con un secreto único es imposible responder a
"quién accedió a este registro". Con cuentas por persona, cada acceso queda
atribuido en los logs — y el detalle de una conversación individual se registra
con nivel `warn`, separado de las consultas agregadas.

Las contraseñas se guardan con scrypt y salt por usuario; la comparación es en
tiempo constante y no revela si el usuario existe.

**Nota de implementación:** el script del panel va en línea y helmet aplica
`script-src 'self'`, que lo bloquearía. Se autoriza con un nonce distinto en
cada petición, en lugar de abrir la política con `'unsafe-inline'` — que valdría
para cualquier inyección, no solo para el script legítimo.

### Por línea de comandos

```bash
node scratch/patterns.js                  # 7 días, todas las marcas
node scratch/patterns.js snfplus_rrhh     # una marca
node scratch/patterns.js snfplus_rrhh 30  # una marca, 30 días
```

El panel y el CLI comparten `src/services/analytics.service.js`, así que nunca
pueden decir cosas distintas.

Cada patrón apunta a un fallo distinto, y cada uno se corrige de forma distinta:

| Patrón | Qué significa | Cómo se corrige |
|---|---|---|
| **Hueco total** | La búsqueda no encontró nada | Falta el fragmento: escribirlo |
| **Match débil** | Encontró algo pero encaja mal | Reescribir con el vocabulario que usa la gente |
| **Categoría vacía** | El botón apunta a la nada | Mapeo incorrecto, o falta contenido en esa categoría |
| **Escalado** | La IA se rindió | Hueco confirmado, máxima prioridad |
| **Reformulación** | Repreguntó en menos de 90s | La respuesta no convenció |
| **Fragmento muerto** | Nunca se recupera | Sobra, o está redactado de forma que no matchea |
| **Texto libre** | Escribió en vez de usar el menú | El menú de botones no cubre ese caso |

### El límite de las métricas

Los patrones detectan fallos **de recuperación**. No detectan fallos **de
fidelidad**: que la IA recupere el fragmento correcto y aun así responda con
conocimiento propio.

Ejemplo real observado durante las pruebas:

> **Pregunta:** «¿Puedo deducir esto en la declaración de la renta?»
> **Recuperación:** 3 fragmentos, similitud 0.717, sin escalado
> **Respuesta:** *«…se reduce la cuota tributaria a pagar»* — extrapolación
> desde la Ley del IRPF, no del manual.

Todas las métricas salen sanas. Solo se ve leyendo la respuesta.

Por eso la revisión humana debe centrarse, contra toda intuición, en los
intercambios de **similitud alta que no escalaron** — no en los que fallaron de
forma evidente.

---

## 9. Protección de datos

| Medida | Implementación |
|---|---|
| Retención | 90 días. `cleanupOldConversations()` se ejecuta en cada arranque. |
| Supresión | `DELETE /api/my-data/:userId` borra las conversaciones de ese identificador. |
| Identificador | UUID generado en `localStorage`, sin vínculo con la identidad real. |

**Dónde van los datos:** el contenido de cada mensaje se envía a Google (Gemini)
para generar la respuesta. Quien despliegue esto debe reflejarlo en su política
de privacidad y en su registro de actividades de tratamiento.

---

## 10. Endpoints

### Públicos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Estado del servicio. |
| `POST` | `/api/chat` | Mensaje del widget. |
| `DELETE` | `/api/my-data/:userId` | Supresión de datos del usuario. |
| `GET` | `/public/*` | Ficheros estáticos, incluido el widget. |

### Protegidos con `Authorization: Bearer $UPLOAD_SECRET`

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/history/:brandId/:userId` | Historial de una conversación. |
| `POST` | `/api/knowledge/upload` | Subida de fichero por formulario. |
| `POST` | `/upload` | Subida por CLI, admite `category`. |
| `GET` | `/debug/chat-test` | Diagnóstico de la cadena RAG + Gemini. |

### Protegidos con autenticación básica (`ADMIN_USERS`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/admin` | Panel de análisis. |
| `GET` | `/api/admin/overview` | Todos los patrones. Parámetros: `brand`, `days`. |
| `GET` | `/api/admin/conversation/:id` | Conversación completa. Acceso registrado con `warn`. |

El secreto se compara en tiempo constante (`crypto.timingSafeEqual`) para no
filtrar información por diferencias de tiempo de respuesta.

---

## 11. Notas operativas

**El widget no está versionado.** El cliente apunta directamente a
`/public/snfplus-widget.js`, así que cualquier despliegue entra en su producción
al instante. Antes de crecer conviene servir rutas versionadas (`/public/v1/…`) y
publicar los cambios de ruptura como `v2`.

**Los despliegues de Railway pueden servir ficheros desfasados.** Se ha
observado que un fichero nuevo en `public/` devolvía 404 varios minutos después
de completarse el despliegue. Si pasa, forzar una reconstrucción.

**Sin entorno de pruebas.** Todo va directo a producción. Un segundo servicio
apuntando a una rama `staging`, con su propia base de datos, es media hora de
configuración.

**Cuota de Gemini.** El código distingue los errores 429 y 503 y responde al
usuario con un mensaje comprensible en vez de fallar, pero nadie recibe aviso
cuando ocurre.
