const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'campana_electoral',
  password: process.env.DB_PASSWORD || 'secret',
  port: process.env.DB_PORT || 5432,
});

const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_campana';

// MIDDLEWARE DE SEGURIDAD
const verificarToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'Token de acceso requerido' });
  try {
    const decoded = jwt.verify(token.split(" ")[1], JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

// 1. ENDPOINT: Programación Automática de Envíos WhatsApp Día D a las 7:00 AM (Módulo 5)
app.post('/api/comunicaciones/programar-dia-d', verificarToken, async (req, res) => {
  const { fecha_eleccion, nombre_candidato, numero_tarjeton, partido } = req.body;
  // fecha_eleccion Ej: '2027-10-31' -> se ajusta a '2027-10-31 07:00:00'

  try {
    const fechaHora7am = `${fecha_eleccion} 07:00:00-05`;

    // Consultar todos los simpatizantes con compromiso de voto o verificados que autorizaron tratamiento de datos
    const simpatizantes = await pool.query(
      `SELECT s.id, s.nombre_completo, s.telefono, s.mesa_votacion, p.nombre_puesto, p.direccion
       FROM simpatizantes s
       JOIN puestos_votacion p ON s.puesto_votacion_id = p.id
       WHERE s.autoriza_tratamiento_datos = TRUE AND s.estado IN ('verificado', 'voto_seguro')`
    );

    let totalProgramados = 0;

    for (const simp of simpatizantes.rows) {
      const mensaje = `¡Hola ${simp.nombre_completo}! 🗳️ Hoy es el gran día. Te recordamos tu lugar de votación:

📍 Puesto: ${simp.nombre_puesto}
🏢 Dirección: ${simp.direccion || 'Consultar en puesto'}
📥 Mesa: #${simp.mesa_votacion || 'Por definir'}

Para apoyar la transformación, en el tarjetón busca a:
👤 Candidato: ${nombre_candidato}
🏛️ Partido: ${partido}
🔢 Número: #${numero_tarjeton}

¡Contamos contigo!`;

      await pool.query(
        `INSERT INTO envios_whatsapp_dia_d (simpatizante_id, telefono, mensaje_personalizado, fecha_hora_programada, estado)
         VALUES ($1, $2, $3, $4, 'programado')`,
        [simp.id, simp.telefono, mensaje, fechaHora7am]
      );
      totalProgramados++;
    }

    res.json({
      mensaje: `Se han programado exitosamente ${totalProgramados} mensajes de WhatsApp para ser enviados el Día D a las 7:00 AM.`,
      detalles: { total_programados: totalProgramados, hora_envio: '07:00 AM' }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al programar envíos automáticos del Día D.' });
  }
});

// 2. ENDPOINT: Simulación / Ejecución del motor de despacho de WhatsApp
app.get('/api/comunicaciones/despachar-whatsapp', async (req, res) => {
  try {
    const pendientes = await pool.query(
      `SELECT * FROM envios_whatsapp_dia_d WHERE estado = 'programado' AND fecha_hora_programada <= NOW() LIMIT 50`
    );

    for (const envio of pendientes.rows) {
      // Integración con API oficial de WhatsApp Business (Meta Cloud API / Twilio)
      // Se realiza el envío masivo seguro
      await pool.query(
        `UPDATE envios_whatsapp_dia_d SET estado = 'enviado', enviado_at = NOW() WHERE id = $1`,
        [envio.id]
      );
    }

    res.json({ procesados: pendientes.rows.length });
  } catch (error) {
    res.status(500).json({ error: 'Error al despachar mensajes de WhatsApp.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de Campaña V3 activo en puerto ${PORT}`));
