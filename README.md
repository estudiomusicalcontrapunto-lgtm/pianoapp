# PianoApp — Contrapunto

App web del estudio de piano Contrapunto (Pereira). Frontend en React + Vite + Tailwind; backend en Express + Sequelize (SQLite en local, MySQL en producción).

## Puesta en marcha

```bash
npm install
cd server && npm install
```

1. Copia `server/.env.example` a `server/.env` y completa `JWT_SECRET` (obligatoria) y, si la base está vacía, `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Backend: `cd server && npm run dev` (puerto 5000). Al arrancar aplica las migraciones pendientes.
3. Frontend: `npm run dev` (puerto 5173). Para apuntar a otra API: `VITE_API_URL=http://localhost:5001/api`.

## Producción (Hostinger con MySQL)

Un solo servidor Node sirve la app y la API en la misma dirección (`server/app.js` sirve la carpeta `dist`).

1. En este computador: `npm install` y `npm run build`. Se crea la carpeta `dist`.
2. En Hostinger, crea la base MySQL (nombre, usuario y contraseña) y una aplicación Node.js.
3. Sube el proyecto **sin** `node_modules`, `server/node_modules`, `server/.env`, `server/database.sqlite` ni `server/uploads`. Sí sube `dist`.
4. En la aplicación Node.js de Hostinger:
   - carpeta de la aplicación: `server`; archivo de inicio: `server.js` (o comando `npm start`);
   - ejecuta `npm install` dentro de `server`;
   - variables de entorno (o un `server/.env` creado allá): `JWT_SECRET` (una nueva, generada con el comando de `.env.example`), `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
5. Arranca la aplicación. La primera vez crea todas las tablas (migraciones), la ciudad Pereira (260.000 / 65.000), el piano con sus niveles y la cuenta de la academia.
6. Entra con la cuenta de la academia y cambia la contraseña. Luego quita `ADMIN_PASSWORD` de las variables.
7. Configura en la app: Ajustes → Ciudades (texto de pago de Pereira), Grados (agrega Violín y los requisitos), Salones, Profesores y Términos (publícalos antes de crear estudiantes).

Los comprobantes de pago quedan en `server/uploads`: inclúyelos en las copias de seguridad junto con la base MySQL.

## Base de datos

- Las migraciones viven en `server/migrations` y se ejecutan con Umzug: `npm run migrate`, `npm run migrate:down`, o `node db/migrator.js pending`.
- Ya no se usa `sequelize.sync()`. Cualquier cambio de esquema va en una migración nueva.
- Datos de ejemplo: `npm run seed` (academia, 2 profesores que comparten el Salón 2, 4 estudiantes). La contraseña de prueba está en `server/db/seed.js`. Para no mezclarlos con tus datos: `DB_STORAGE=./seed.sqlite npm run seed`.

## Tests

```bash
cd server && npm test
```

`npm test -- settings` ejecuta solo los archivos cuyo nombre contiene "settings". Las reglas de negocio están en `server/domain` (sin base de datos) y se prueban en `server/test`.

## Tareas automáticas

`server/services/maintenanceService.js` libera los cupos apartados vencidos, aplica los días de cierre, vence los ciclos (lo no marcado pasa a `perdida`; las reposiciones que debe el profesor o la academia siguen pendientes), marca como vencidas las mensualidades nunca pagadas y envía los recordatorios de pago.

Todas las tareas son idempotentes y corren:
- al arrancar el servidor y cada `MAINTENANCE_INTERVAL_MINUTES` (10 por defecto);
- al iniciar sesión, como mucho cada 5 minutos, por si el hosting durmió el proceso;
- con el botón "Ejecutar tareas ahora" del panel de la academia.

Además, un cupo apartado deja de bloquear el horario en cuanto vence, aunque la tarea todavía no haya corrido.

## Reglas de negocio

Están en `server/domain` (sin base de datos) y son configurables en **Ajustes**: horas mínimas de aviso, reprogramaciones por ciclo, duración del ciclo, horas del cupo apartado, precios, duración de la clase, días del recordatorio de pago y horario de la academia. Las reservas se validan en el backend dentro de una transacción con bloqueo (`services/bookingTransaction.js`), así que dos personas no pueden tomar el mismo cupo.

## Roles

- **academy**: crea cuentas, gestiona salones, ciclos, pagos, valoraciones y ajustes.
- **teacher**: su agenda, sus estudiantes, cancelaciones y asistencia.
- **student**: sus clases, mensualidad, reprogramaciones y práctica. El acudiente usa la misma cuenta; su nombre y teléfono se guardan como contacto.

No hay registro público: la academia crea todas las cuentas.
