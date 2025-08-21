// /api/portfolio/upload.js
import { v2 as cloudinary } from 'cloudinary';

// Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const file = req.body.image; // Attend une image en base64 ou lien
    if (!file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    // Upload vers Cloudinary
    const result = await cloudinary.uploader.upload(file, {
      folder: 'portfolio',
      resource_type: 'image',
    });

    res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Échec de l’upload' });
  }
}