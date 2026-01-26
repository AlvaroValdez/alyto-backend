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
    // ✅ FIX: Incluir bank_name, account_type_name, beneficiary_document_number
    let projection = 'beneficiary_first_name beneficiary_last_name company_name createdAt amount currency status country order bank_code bank_name account_bank account_type account_type_name rateTracking amountsTracking destCountry metadata beneficiary_cc beneficiary_document_number concept purpose paymentMethod';

    if (isAdmin) {
      projection += ' vitaResponse createdBy fee feePercent feeOriginAmount feeAudit';
      // --- Populamos los datos del usuario creador ---
      query = query.populate('createdBy', 'name email');
    } else if (isPublicOrderQuery) {
      // Para consultas públicas por order, mostrar datos completos del beneficiario
      projection = 'beneficiary_first_name beneficiary_last_name company_name createdAt amount currency status country order bank_code bank_name account_bank account_type account_type_name rateTracking amountsTracking destCountry metadata beneficiary_cc beneficiary_document_number concept purpose paymentMethod';
    }

    // 3. Consulta a la Base de Datos
    const total = await Transaction.countDocuments(filters);

    // Aseguramos traer withdrawalPayload para extraer datos bancarios si faltan en root
    const projectionWithPayload = projection + ' withdrawalPayload';

    const transactionsDocs = await query
      .select(projectionWithPayload)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('ipnEvents');

    // 4. Procesamiento: Hoist de datos bancarios y limpieza
    const transactions = transactionsDocs.map(doc => {
      const tx = doc.toObject(); // Convertir a objeto plano

      // ✅ FIX: Hoist con múltiples fallbacks (withdrawalPayload, deferredWithdrawalPayload, metadata)
      if (!tx.account_bank) {
        tx.account_bank =
          tx.withdrawalPayload?.account_bank ||
          tx.deferredWithdrawalPayload?.account_bank ||
          tx.withdrawalPayload?.account_number ||
          tx.metadata?.beneficiary?.account_bank;
      }

      if (!tx.bank_code) {
        tx.bank_code =
          tx.withdrawalPayload?.bank_code ||
          tx.deferredWithdrawalPayload?.bank_code ||
          tx.metadata?.beneficiary?.bank_code;
      }

      if (!tx.account_type) {
        tx.account_type =
          tx.withdrawalPayload?.account_type_bank ||
          tx.deferredWithdrawalPayload?.account_type_bank ||
          tx.metadata?.beneficiary?.account_type;
      }

      // ✅ FIX: Hoist para bank_name (nombre legible del banco)
      if (!tx.bank_name) {
        tx.bank_name =
          tx.withdrawalPayload?.bank_name ||
          tx.deferredWithdrawalPayload?.bank_name ||
          tx.metadata?.beneficiary?.bank_name;
      }

      // ✅ FIX: Hoist para account_type_name (nombre legible del tipo de cuenta)
      if (!tx.account_type_name) {
        tx.account_type_name =
          tx.withdrawalPayload?.account_type_name ||
          tx.deferredWithdrawalPayload?.account_type_name ||
          tx.metadata?.beneficiary?.account_type_name;
      }

      // ✅ FIX: Hoist para beneficiary_document_number
      if (!tx.beneficiary_document_number && !tx.beneficiary_cc) {
        tx.beneficiary_document_number =
          tx.withdrawalPayload?.beneficiary_document_number ||
          tx.deferredWithdrawalPayload?.beneficiary_document_number ||
          tx.metadata?.beneficiary?.document_number;
      }

      // Para seguridad en public query, podríamos borrar el payload completo si se desea,
      // pero por ahora lo dejamos por si el frontend necesita algo más.
      if (isPublicOrderQuery) {
        // Opcional: delete tx.withdrawalPayload; 
      }

      return tx;
    });

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