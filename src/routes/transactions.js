import { Router } from 'express';
import Transaction from '../models/Transaction.js';

const router = Router();

// Define la ruta GET para listar transacciones con filtros y paginación
router.get('/', async (req, res) => {
  try {
    // 1. Paginación: Parsea los parámetros de la URL de forma segura
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // 2. Filtros Dinámicos: Construye un objeto de consulta solo con los filtros que llegan
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.country) filters.country = req.query.country;
    if (req.query.order) filters.order = req.query.order;

    // --- LÓGICA DE ROLES ---
    const isAdmin = req.user && req.user.role === 'admin';

    // Construimos la consulta base
    let query = Transaction.find(filters);

    // Campos a seleccionar. Por defecto, los básicos.
    let projection = 'beneficiary_first_name beneficiary_last_name company_name createdAt amount currency status'; 
    if (isAdmin) {
      projection += ' order country vitaResponse createdBy'; // Añadimos 'createdBy'
      // --- CORRECCIÓN: Populamos los datos del usuario creador ---
      query = query.populate('createdBy', 'name email');
    }

    // 3. Consulta a la Base de Datos: Realiza dos consultas eficientes
    //    a) Obtiene el conteo total de documentos que coinciden con los filtros
    const total = await Transaction.countDocuments(filters);
    //    b) Obtiene los documentos de la página actual, ordenados y con datos relacionados
    const transactions = await query // Ejecutamos la consulta ya construida
      .select(projection)
      .sort({ createdAt: -1 }) // Ordena por fecha de creación descendente
      .skip(skip)               // Salta los documentos de páginas anteriores
      .limit(limit)             // Limita al número de resultados por página
      .populate('ipnEvents');   // Trae los datos de los eventos IPN asociados

    // 4. Respuesta Exitosa: Devuelve un objeto completo para el frontend
    res.json({
      ok: true,
      page,
      total,
      filters,
      transactions,
    });
  } catch (err) {
    // 5. Manejo de Errores: Captura cualquier error de la base de datos
    console.error('[transactions] Error listando transacciones:', err);
    res.status(500).json({ ok: false, error: 'Error al listar transacciones' });
  }
});

export default router;