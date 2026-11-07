# Beauty Salon – Sistema de citas y panel de administración (versión salón de belleza)

> **Versión salón.** Es una copia independiente del sistema de la barbería: tiene su propia base de datos, su propio panel y su propio enlace.
> Diferencias principales:
> - **Varios servicios por cita** (ej: uñas + cejas). La clienta marca los que quiere y ve el **total**; la cita guarda todos los servicios y la suma de precios.
> - **Bloques de 1 hora** por profesional (se cambia en `config.js` → `intervaloMin`).
> - Servicios iniciales (uñas, depilación, pestañas, cabello, maquillaje) y profesionales **Ana, Laura y Marta**: son de ejemplo, cámbialos desde el panel (*Servicios* y *Profesionales*) o en `db.js`.
> - Nombre del salón: busca "Beauty Salon" en `public/index.html`, `public/cita.html`, `public/admin.html` y `public/manifest.json`, y pon la variable `NEGOCIO` en Railway.
> - Colores rosa: variables al inicio de `public/css/style.css`. Ícono: carpeta `public/icons/` (ahora un "BS" genérico; reemplázalo por tu logo en PNG de 192 y 512).
> - Si un servicio dura más de 1 hora, la cita solo bloquea 1 hora. Si lo necesitas, se puede agregar duración por servicio.


Los clientes reservan su cita en una página web y el administrador ve las citas, clientes, ingresos y gastos en un panel.

## 1. ¿Qué base de datos necesito?

**SQLite.** Es una base de datos real (SQL) que vive en **un solo archivo**: `salonpro.db`.
No tienes que instalar ni configurar ningún servidor de base de datos, y para una salón (cientos de citas al mes) sobra.

- Se crea sola la primera vez que arrancas el proyecto (lo hace `db.js`).
- **Respaldo:** copia el archivo `salonpro.db` de vez en cuando.
- **Cuándo cambiar a PostgreSQL/MySQL:** si tuvieras varias sucursales o miles de usuarios a la vez. No es tu caso hoy.

### Tablas (están en `db.js`)

| Tabla | Para qué sirve |
|---|---|
| `services` | Servicios y precios (corte, barba…) |
| `barbers` | Profesionales |
| `clients` | Clientes (el teléfono los identifica) |
| `appointments` | Citas: cliente, servicio, profesional, fecha, hora, estado, precio |
| `expenses` | Gastos del negocio |
| `admins` | Usuario y contraseña (encriptada) del administrador |

## 2. Cómo ponerlo a funcionar en Visual Studio Code

1. Instala **Node.js** (versión LTS) desde https://nodejs.org
2. Abre esta carpeta en VS Code: *Archivo → Abrir carpeta*.
3. Abre la terminal de VS Code (*Terminal → Nueva terminal*) y ejecuta:
   ```
   npm install
   ```
4. Copia `.env.example` y renómbralo a **`.env`**. Ábrelo y cambia:
   - `JWT_SECRET` → un texto largo y aleatorio
   - `ADMIN_USER` y `ADMIN_PASSWORD` → tu usuario y contraseña de administrador
5. *(Opcional)* Datos de prueba para ver el dashboard con información: `npm run seed`
6. Inicia el sistema:
   ```
   npm start
   ```
7. Abre en el navegador:
   - Reservas de clientes: http://localhost:3000
   - Panel del administrador: http://localhost:3000/admin.html

> El usuario y la contraseña del administrador se crean **la primera vez** que arranca. Si los cambias en `.env` después, no se actualizan: borra `salonpro.db` (se pierden los datos) o crea la base de nuevo.

## 3. Qué archivo modificar según lo que quieras cambiar

| Quiero cambiar… | Archivo |
|---|---|
| Horario de atención, intervalo de citas, moneda | `config.js` |
| Usuario/contraseña del admin, puerto, clave secreta | `.env` |
| Servicios y profesionales iniciales | `db.js` (sección DATOS INICIALES) – o desde el panel, secciones *Servicios* y *Profesionales* |
| Agregar/cambiar tablas o campos | `db.js` |
| Reglas de reserva (validaciones, horas disponibles) | `routes/public.js` |
| Números del dashboard, citas, gastos, clientes | `routes/admin.js` |
| Protección del panel (login) | `middleware/auth.js` |
| Colores y diseño | `public/css/style.css` (variables al inicio) |
| Textos y estructura de la página de reservas | `public/index.html` |
| Comportamiento de la página de reservas | `public/js/reservar.js` |
| Estructura del panel admin | `public/admin.html` |
| Comportamiento del panel admin (gráficas, tablas, botones) | `public/js/admin.js` |

## 4. Estructura de carpetas

```
salonpro/
├── server.js            Arranca el servidor
├── config.js            Horario, moneda, puerto
├── db.js                Base de datos (tablas)
├── utils.js             Funciones de fechas y horas
├── seed.js              Datos de prueba (opcional)
├── .env                 Contraseñas (lo creas tú, NO se comparte)
├── routes/
│   ├── public.js        API de clientes (reservar)
│   └── admin.js         API del administrador
├── middleware/
│   └── auth.js          Verifica que el admin esté logueado
└── public/              Lo que ve el navegador
    ├── index.html       Página de reservas
    ├── admin.html       Panel del administrador
    ├── css/style.css
    └── js/reservar.js, admin.js
```

## 5. Qué muestra el panel del administrador

- **Dashboard:** citas de hoy y de mañana, clientes registrados, ingresos de hoy, ingresos del mes, gastos del mes, ganancia del mes, clientes nuevos, gráfica de ingresos de 7 días, servicios más solicitados, citas por estado y próximas citas de hoy.
- **Citas:** filtra Hoy / Mañana / Todas y cambia el estado (confirmar, completar, cancelar).
- **Clientes:** lista con cantidad de citas y total gastado.
- **Gastos:** registra y borra gastos; muestra ingresos, gastos y ganancia del mes.
- **Servicios y Profesionales:** agrega, cambia precios, oculta o desactiva.

> Los **ingresos** se cuentan solo de las citas marcadas como **completada**.

## 6. Publicarlo en internet

Necesitas un hosting que ejecute Node.js **y conserve el archivo `salonpro.db`** (disco persistente). Opciones: Railway, Render (con disco), o un VPS.
Antes de publicar:
- Usa una `JWT_SECRET` larga y una contraseña de admin fuerte.
- Activa HTTPS (casi todos los hostings lo dan).
- Configura la zona horaria del servidor a `America/Santo_Domingo` (variable `TZ`) para que "hoy" y las horas coincidan con tu país.
- Haz respaldos periódicos de `salonpro.db`.

## 7. Posibles mejoras

Aviso por WhatsApp/SMS al cliente, cancelar cita desde un enlace, horarios distintos por profesional, ventas de productos y reportes en Excel.

## 8. Usuario empleado (solo ver y confirmar citas)

Además del administrador puedes tener un usuario **empleado**: ve todo el panel (dashboard, citas, clientes, gastos, servicios y profesionales) pero **no puede modificar nada**, salvo **confirmar citas pendientes**. Los botones Completar y Cancelar, los formularios y los botones de guardar/borrar no le aparecen, y aunque alguien intentara saltárselos el servidor lo rechaza (`routes/admin.js` + `middleware/auth.js`).

Se crea con dos variables (en `.env`, o en *Variables* de Railway):

```
STAFF_USER=recepcion
STAFF_PASSWORD=una-clave-fuerte
```

- Para cambiarle la contraseña: cambia la variable y reinicia.
- Para quitarlo: borra las dos variables y reinicia (el usuario se elimina).
- Solo puede haber **un** administrador y **un** empleado.

## 9. Horario de cada profesional

Cada profesional tiene sus **días de trabajo** y su **hora de entrada y salida**. Se editan en el panel: *Profesionales → marcar días, cambiar horas → Guardar horario*.

- El cliente, al elegir un profesional, solo ve las horas de ese horario, y se le muestra el horario escrito.
- Si el profesional no trabaja ese día, la página lo avisa.
- Un profesional sin horario propio usa el general de `config.js` y trabaja todos los días.
- La hora de salida es la de cierre: con entrada 9:00, salida 19:00 e intervalo de 60 min, la última cita es a las 6:00 PM.
- Las citas que ya estaban reservadas no se tocan al cambiar un horario.

Una hora ya reservada con un profesional no la puede tomar otro cliente con ese mismo profesional (sí con otro profesional). Esto lo garantiza la base de datos (índice único en `db.js`), incluso si dos personas reservan en el mismo segundo. Las citas **canceladas** liberan la hora. La página refresca las horas cada 30 segundos.

## 10. Botón "Instalar app"

Arriba de la página de reservas y de "Mi cita" sale un aviso **"Instala la app en tu celular"**. Deja el ícono de la salón en la pantalla de inicio y abre la página a pantalla completa (no es una app de tienda, es tu página instalada). Lo controla `public/js/instalar.js`:

- **Android / Chrome / Edge:** el botón abre el cuadro oficial de instalación.
- **iPhone / iPad:** Apple no permite instalar con un botón, así que se muestran los 3 pasos (Compartir → Agregar a pantalla de inicio → Agregar).
- Si la página ya está instalada, el aviso no sale. Si el cliente lo cierra con la ✕, no vuelve en 7 días.
- **Textos:** edita `PASOS` en `instalar.js` y el texto del aviso en `index.html` y `cita.html`. **Colores/estilo:** `.instalar` en `style.css`.
- **Nombre e ícono que se ven en el celular:** `name` y `short_name` en `public/manifest.json` (y `apple-mobile-web-app-title` en `index.html` y `cita.html`); las imágenes están en `public/icons/` (192, 512 y maskable 512).
