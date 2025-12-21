import { Router } from 'express';
import upload from '../middleware/uploadMiddleware.js'; // Reutilizamos tu config de Cloudinary

const router = Router();

// POST /api/upload
// Sube una imagen genérica y devuelve la URL
// Usa el middleware 'upload.single' esperando un campo llamado 'image'
router.post('/', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, error: 'No se subió ninguna imagen.' });
        }

        // Cloudinary ya procesó la subida, devolvemos los datos
        res.json({
            ok: true,
            message: 'Imagen subida correctamente',
            url: req.file.path,      // URL pública
            public_id: req.file.filename // ID en Cloudinary
        });
    } catch (error) {
        console.error('[upload] Error:', error);
        res.status(500).json({ ok: false, error: 'Error interno al subir la imagen.' });
    }
});

export default router;