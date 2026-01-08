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
    // Permitir acceso público SOLO cuando se consulta por 'order'
    // Esto permite que la página de éxito muestre los datos sin requerir login
    const isPublicOrderQuery = req.query.order && !req.user;
    const isAdmin = req.user && req.user.role === 'admin';

    // Si hay usuario autenticado pero NO es admin, solo mostrar SUS transacciones
    if (req.user && !isAdmin) {
      filters.createdBy = req.user._id;
    }

    // Construimos la consulta base
    let query = Transaction.find(filters);

    // Campos a seleccionar según el tipo de acceso
    let projection = 'beneficiary_first_name beneficiary_last_name company_name createdAt amount currency status country order bank_code account_bank rateTracking amountsTracking destCountry metadata beneficiary_cc account_type concept purpose';

    if (isAdmin) {
      projection += ' vitaResponse createdBy fee feePercent feeOriginAmount feeAudit';
      // --- Populamos los datos del usuario creador ---
      query = query.populate('createdBy', 'name email');
    } else if (isPublicOrderQuery) {
      // Para consultas públicas por order, mostrar solo datos básicos (sin info financiera sensible del negocio)
      projection = 'beneficiary_first_name beneficiary_last_name company_name createdAt amount currency status country order bank_code account_bank rateTracking amountsTracking destCountry metadata beneficiary_cc account_type concept purpose';
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

// GET /api/transactions/:id - Obtener detalle de una transacción
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Buscamos por ID
    // Importante: .populate('ipnEvents') trae los detalles de los webhooks recibidos
    const transaction = await Transaction.findById(id).populate('ipnEvents');

    if (!transaction) {
      return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });
    }

    // Seguridad básica: Verificar que la transacción pertenezca al usuario (si no es admin)
    // Asumimos que req.user existe gracias al middleware 'protect'
    if (req.user.role !== 'admin' && transaction.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ ok: false, error: 'No tienes permiso para ver esta transacción.' });
    }

    res.json({ ok: true, transaction });
  } catch (err) {
    console.error('[transactions] Error obteniendo detalle:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener el detalle de la transacción.' });
  }
});

export default router;