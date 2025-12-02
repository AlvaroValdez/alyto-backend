import { Router } from 'express';
import upload from '../middleware/uploadMiddleware.js'; // Reutilizamos la config de Multer/Cloudinary
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// POST /api/upload
// Sube una imagen genérica y devuelve la URL
router.post('/', protect, upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, error: 'No se subió ninguna imagen.' });
        }

        // Cloudinary ya subió la imagen, devolvemos la URL segura
        res.json({
            ok: true,
            url: req.file.path,
            public_id: req.file.filename
        });
    } catch (error) {
        console.error('[upload] Error:', error);
        res.status(500).json({ ok: false, error: 'Error al subir la imagen.' });
    }
});

export default router;