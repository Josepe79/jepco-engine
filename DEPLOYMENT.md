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
6. Si no encuentra la respuesta, deriva al mediador o al soporte según el caso,
   marca el intercambio como escalado y dispara un aviso por Telegram (ver §8)

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

**`trustProxy` es obligatorio en Railway, pero con un número, no con `true`.**
El servidor está detrás de un proxy: sin `trustProxy`, `req.ip` devuelve la IP
interna del proxy y todos los usuarios comparten la misma cuota.

El valor correcto es `trustProxy: 1`. Con `true` se confía en **toda** la cadena
`X-Forwarded-For`, incluida la parte que escribe el cliente, así que bastaba
mandar una cabecera inventada distinta en cada petición para estrenar cupo cada
vez — el límite no servía absolutamente de nada. Comprobado: siete peticiones
con siete IPs falsas pasaban todas.

Con `1` solo se confía en el salto que añade Railway, que es el único que no se
puede falsificar desde fuera. Si algún día hay más proxies delante (un CDN),
hay que subir el número al total de saltos de confianza.

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
    data-mediador="Correduría Ejemplo S.L."
    data-mediador-email="consultas@ejemplo.es"
    data-mediador-tel="+34 911 234 567">
</script>
```

| Atributo | Por defecto | Descripción |
|---|---|---|
| `data-brand-id` | `snfplus_usuario` | Perfil del asistente. Determina personalidad y base de conocimiento. |
| `data-env-label` | `SNF+` | Nombre mostrado en la cabecera del widget. |
| `data-app-url` | — | URL de la aplicación en ese entorno. La IA la usa para indicar dónde acceder. |
| `data-mediador` | — | Mediador de seguros del cliente. |
| `data-mediador-email` | — | Su email de contacto. |
| `data-mediador-tel` | — | Su teléfono. |
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

### Proveedores de tarjeta

En Comida, Guardería y Transporte hay dos capas de información:

| Capa | Ejemplo | Dónde vive |
|---|---|---|
| **Fiscal** — igual para todos | 136,36 €/mes, 1.500 €/año, territorios forales | `provider = NULL` |
| **Operativa** — cambia con el emisor | Dónde se usa, qué app, atención al cliente | `provider = 'edenred'` |

Por eso hay una columna `provider` en vez de categorías tipo `transporte_edenred`:
con 3 productos y 4 emisores serían doce categorías, y habría que duplicar la
parte fiscal cuatro veces. Cuando cambie un límite legal, se toca una sola fila.

La búsqueda aplica `provider IS NULL OR provider = ?`, así que lo genérico entra
siempre y lo específico solo para su emisor. **Sin proveedor conocido solo se
devuelve lo genérico**: es preferible no responder a responder con los datos del
emisor equivocado.

Emisores configurados: `edenred`, `pluxee`, `up_spain`, `up_one`. El id debe
coincidir en tres sitios: `ALLOWED_PROVIDERS` (`src/index.js`), `PROVIDERS` (el
widget) y el campo `provider` de los fragmentos.

**Cómo sabe el widget el emisor.** Por orden de preferencia:

1. El atributo `data-proveedor`, que renderiza la aplicación según la empresa
   del usuario. Es la vía buena: el dato es fiable y no hay fricción.
2. Si no viene, el widget pregunta una vez al entrar en Comedor, Guardería o
   Transporte, y lo recuerda en `localStorage`. Aparece un enlace en el pie para
   corregirlo si se eligió mal.

Preguntar es el plan B a propósito: mucha gente no distingue Up Spain de Up One,
y una respuesta correcta del emisor equivocado es peor que no responder.

```bash
node scratch/load-provider-faq.js            # todos los proveedores
node scratch/load-provider-faq.js edenred    # solo uno
```

**Estado del contenido por emisor:**

| | Comida | Guardería | Transporte |
|---|---|---|---|
| Edenred | 5 | 4 | 4 |
| Pluxee | 4 | 3 | 4 |
| Up Spain | 2 | 3 | 3 |

Los nueve pares emisor/producto están cubiertos.

**Hubo un cuarto emisor, `up_one`, que se retiró.** No era tal: venía de un
cambio de productos de Up Spain, y UpONE es su plataforma digital. Se quitó de
`ALLOWED_PROVIDERS`, del widget y de `PROVIDER_LABELS`. Nunca llegó a tener
fragmentos ni interacciones asociadas.

Al recopilar las FAQs de un emisor conviene revisar primero qué **no** cubre su
web, y sobre todo distinguir qué es suyo y qué es normativa.

Ha pasado cuatro veces, siempre igual: algo que parecía dato de un emisor
resulta ser normativa que aplica a todos.

| Dato | Aparecía en | En realidad es |
|---|---|---|
| Guardería cubre de 0 a 3 años | Pluxee | Primer ciclo de Educación Infantil |
| Comida no vale en supermercados | Pluxee | La exención del IRPF solo ampara restauración |
| Guardería sin tope anual, salvo 1.000 € en el País Vasco | Up Spain | Régimen fiscal |
| 136,36 € durante once mensualidades | Up Spain | Los once meses aplican a los tres productos |

El último es el más ilustrativo. Se cargó como fragmento de Up Spain porque era
su web la que lo decía; al preguntar por los meses sin escolarización se
confirmó que **los once meses son norma general y agosto está cerrado por
defecto en los tres productos**. El fragmento se movió al genérico y se retiró
del de Up Spain, donde solo añadía ruido.

Los cuatro viven ahora en los fragmentos genéricos y los responde cualquier
emisor, también aquellos cuya web no los menciona. Archivados bajo quien los
aportó, el hueco habría seguido abierto para todos los demás.

**Saldo y tarjeta son cosas distintas**, y conviene que no se confundan: la
tarjeta de Pluxee caduca a los 48 meses, pero el saldo no caduca nunca, se
acumula de mes a mes y viaja a la tarjeta nueva si hay que reponerla.

Al actualizar un fragmento genérico con `update-chunk.js`, el borrado filtra por
`provider IS NULL`. Sin ese filtro, tocar el texto genérico de transporte se
llevaría por delante las FAQs de todos los emisores, que comparten categoría.

### Categorías reconocidas

Al añadir una categoría nueva hay que darla de alta en `ALLOWED_CATEGORIES`
(`src/index.js`); si no, el backend rechaza la petición con `Invalid category`.

| Perfil | Categorías |
|---|---|
| usuario | `acceso_navegacion`, `perfil`, `familiares`, `productos_general`, `retribucion_general`, `ahorro`, `salud`, `guarderia`, `comida`, `transporte`, `formacion`, `renting`, `contrato_novacion` |
| rrhh | `acceso_navegacion`, `administracion_empresas_sucursales`, `administracion_grupos`, `importacion_y_actualizacion_masiva`, `gestion_usuarios`, `seguimiento_planes`, `informes` |
| gestor | `onboarding_companias`, `administrar_companias`, `resumen_salud`, `control_companias`, `contrataciones` |

---

## 8. Qué pasa cuando el bot no sabe

El bot **nunca dice que ha avisado a nadie**. No sería cierto: no hay ningún
canal de vuelta hacia un usuario web, así que prometer una llamada es una
promesa que el sistema no puede cumplir.

En su lugar da un destino concreto, según de qué trate la duda:

| Tipo de duda | A dónde deriva |
|---|---|
| Coberturas y condiciones de la póliza | Al mediador, con nombre, teléfono y email |
| Cualquier otra cosa | Al `escalationFallback` de esa marca |

### Seguro de salud: qué responde y qué deriva

Es la distinción más delicada del prompt, porque las dos cosas suenan igual
para el usuario pero solo una está en el manual.

| Responde el bot | Deriva al mediador |
|---|---|
| Límites de importe (500 € / 1.500 €) | Qué incluye o excluye la póliza |
| Quién puede incluirse y hasta qué edad | Cuadro médico y especialidades |
| Discapacidad y su límite | Reembolsos y reclamaciones |
| Duración del contrato y requisitos | Altas y bajas con la aseguradora |
| Cómo se contrata en la aplicación | |

Si la pregunta es ambigua — "tengo dudas sobre el seguro de salud" — responde
primero la parte fiscal y cierra mencionando al mediador para coberturas. **No
escala**, porque sí ha respondido.

Los botones de producto envían una pregunta explícita ("cómo funciona el seguro
de Salud, qué límites tiene y quién puede incluirse") en lugar de un genérico
"tengo dudas sobre X". Mejora la búsqueda semántica, y en Salud evita que una
pregunta vaga se lea como consulta de coberturas y acabe derivada sin dar antes
lo que sí sabemos.

Los datos del mediador llegan por atributos del widget, así que cada empresa
cliente configura el suyo al incrustarlo. **Mostrarlos no implica ninguna cesión
de datos**: son datos de contacto profesional de una empresa, no datos
personales del usuario.

**El contacto lo pone el código, no el modelo.** Aunque el prompt le pasa los
datos, el modelo unas veces los escribía enteros, otras los resumía a "contacta
con tu mediador" y otras se los saltaba para no pasarse del límite de frases.
Como el dato es fijo y no depende de la conversación, `ensureMediadorContact()`
lo impone después de generar la respuesta: sustituye las referencias genéricas
por los datos reales, y en consultas de salud añade el cierre si el modelo lo
omitió. Si los datos ya están completos, no toca nada.

`escalationFallback` se define por marca en `config.js`, porque el destino
depende del perfil: un empleado tiene un departamento de RRHH al que preguntar,
pero un gestor de la plataforma no.

### Enviar la consulta al mediador

No se hace, y es deliberado. El mediador es un tercero independiente, no un
encargado del tratamiento, así que remitirle la consulta de un empleado sería
una **cesión a un tercero** y necesitaría base legal, transparencia y constar en
el registro de tratamientos del responsable.

Si en algún momento se quiere hacer, la forma limpia es que **lo dispare el
usuario**: el bot ofrece enviarlo, pide el email, y solo entonces se remite. Así
la acción es explícita e informada, va solo esa consulta, y de paso se resuelve
el problema del contacto de vuelta.

### Suite de regresión

```bash
# Con el servidor levantado y sin límite de peticiones estorbando:
NODE_ENV=development PORT=3999 RATE_LIMIT_MAX=300 node src/index.js
node scratch/regression.js
```

Comprueba 56 casos: que responda lo que sabe, que escale lo que no, que cada
emisor dé sus propios datos y que no aparezcan invenciones concretas
(`absent: ['cualquier sitio']`, `absent: ['cheque gourmet']`, `absent:
['931 110 086']` en respuestas de Pluxee).

Cada emisor nuevo debería traer sus casos: basta con el nombre comercial de la
tarjeta, su teléfono con `absent` del teléfono del otro emisor, y un control
anti-invención sobre algo que su web no diga.

**Existe porque afinar el prompt a ojo no funciona.** Cada retoque arreglaba unos
casos y aflojaba otros, y sin medir el conjunto era imposible saber si un cambio
mejoraba o empeoraba. Con la suite, una idea que suena razonable se descarta en
cinco minutos si no mueve el número.

Marca actual: **54/56**, estable en dos ejecuciones seguidas.

Los dos fallos que quedan son el mismo comportamiento: cuando falta el dato
concreto que se pregunta, el modelo responde con lo genérico que sí tiene en vez
de reconocer que no lo sabe, o al revés, escala teniendo algo aprovechable.

Es poco útil, pero conviene ver qué **no** hace: no se inventa datos ni toma
prestados los de otro emisor. Up Spain no publica teléfono en ninguna de sus
páginas; preguntado por él, escala sin ofrecer el de Edenred ni el de Pluxee,
que tiene en el mismo contexto. Todos los controles `absent` pasan.

De los cuatro fallos que había al crear la suite, tres se resolvieron **sin
tocar una línea de código**, solo cargando el contenido que faltaba.

**Sobre la variabilidad:** con temperatura 0.2 el resultado es casi estable, pero
no del todo. Entre ejecuciones puede bailar un caso, normalmente alguno que ya
estaba en el límite. Si un cambio mueve el número en uno, repite antes de sacar
conclusiones; si lo mueve en tres o más, es real.

### Cómo se detecta un escalado

**Por el texto de la respuesta, no por la etiqueta del modelo.**

La etiqueta `[ESCALAR_A_HUMANO]` falla en las dos direcciones. Unas veces el
modelo responde que no sabe y se olvida de ponerla: ese hueco no se registraba,
no salía en el panel ni avisaba por Telegram, y el fallo era invisible porque al
usuario le llegaba la respuesta correcta. Otras veces la pone y a continuación
responde perfectamente: eso llenaba el panel de huecos que no existían.

El texto sí es fiable porque su redacción la imponemos nosotros: toda respuesta
de "no lo sé" empieza por "No tengo esa información". La etiqueta se sigue
limpiando de la salida, pero ya no decide nada.

---

## 9. Telemetría y mejora del bot

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

**Acceso.** Página de login en `/admin`, contra cuentas nominales. Se crean así:

```bash
node scratch/admin-user.js josep
```

Imprime una contraseña aleatoria (que solo se muestra una vez) y la cadena
`usuario:salt:hash` para pegar en `ADMIN_USERS`. Varias cuentas se separan por
coma. Sin `ADMIN_USERS` definida, el panel responde 503.

Hay dos vías de entrada, ambas contra las mismas cuentas:

| Vía | Para qué |
|---|---|
| Formulario de login → cookie de sesión | El navegador. Dura 8 horas y permite cerrar sesión. |
| Autenticación básica HTTP | `curl` y scripts, sin pasar por el formulario. |

La cookie va firmada con HMAC, es `httpOnly` (el JavaScript de la página no
puede leerla) y `SameSite=Strict` (no viaja desde otros sitios, lo que corta el
CSRF). **La clave de firma se deriva de `ADMIN_USERS`**, así que quitar una
cuenta de esa variable invalida además todas sus sesiones abiertas.

El login está limitado a 10 intentos por minuto y por IP; sumado al coste de
scrypt, hace inviable la fuerza bruta.

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

**Recorridos.** La vista principal del panel: la secuencia real de pasos de cada
sesión, en orden, con un semáforo por paso según lo bien que fue la
recuperación. Las sesiones que acabaron escalando salen primero.

Es lo que distingue "falta contenido" de "falta *este* contenido": un escalado
suelto dice que hay un hueco, pero el recorrido dice qué estaba intentando hacer
la persona cuando se atascó, que es lo que permite escribir el fragmento
correcto en lugar de uno genérico.

Debajo, **saltos entre secciones** agrega esos recorridos: qué se pregunta
después de qué. Un salto que se repite mucho suele significar que el menú obliga
a dar un rodeo.

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

## 10. Protección de datos

| Medida | Implementación |
|---|---|
| Retención | 90 días. `cleanupOldConversations()` se ejecuta en cada arranque. |
| Supresión | `DELETE /api/my-data/:userId` borra las conversaciones de ese identificador. |
| Identificador | UUID generado en `localStorage`, sin vínculo con la identidad real. |

**Dónde van los datos:** el contenido de cada mensaje se envía a Google (Gemini)
para generar la respuesta. Quien despliegue esto debe reflejarlo en su política
de privacidad y en su registro de actividades de tratamiento.

---

## 11. Endpoints

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

## 12. Notas operativas

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
