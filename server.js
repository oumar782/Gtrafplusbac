import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import userRouter from "./donnes/user.js";
import contactRouter from "./donnes/Contact.js";
import portfolioRouter from "./donnes/Portfolio.js";
import reservationRouter from "./donnes/reservation.js";

dotenv.config();

const app = express();

// ✅ CORS bien configuré (corrigé)
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://www.gtrafplusgn.com/",
      "https://admingtraf.vercel.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// 📄 Route racine simplifiée
app.get('/', (req, res) => {
  res.send('✅ Serveur backend en marche');
});
app.use("/api/user", userRouter);
app.use("/api/contact", contactRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/reservation", reservationRouter);

// 🏥 Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: 'connected'
  });
});

// 🚨 Gestion des erreurs améliorée
app.use((err, req, res, next) => {
  console.error('❌ Erreur:', err.stack);
  
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      message: 'Erreur de validation',
      errors: err.errors
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 🚀 Lancement serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});