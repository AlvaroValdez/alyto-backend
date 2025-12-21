import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// 1. Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. Configuración del Almacenamiento (Storage)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'avf-remesas-kyc', // Carpeta en tu Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf'], // Formatos permitidos
    // Opcional: transformación para reducir tamaño
    transformation: [{ width: 1000, crop: "limit" }],
  },
});

// 3. Inicialización de Multer
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Límite de 5MB por archivo
});

export default upload;