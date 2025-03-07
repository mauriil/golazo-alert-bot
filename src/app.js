/**
 * Punto de entrada principal de la aplicación
 */
require('dotenv').config();
const express = require('express');
const controller = require('./core/controller');
const db = require('./data/db');

// Inicializar Express para endpoints de simulación/prueba
const app = express();
const port = process.env.PORT || 3000;

// Rutas básicas para control manual
app.get('/', (req, res) => {
    res.send('GolazoAlerts funcionando');
});

// Ruta para simulación manual
app.get('/simulate/:matchId', async (req, res) => {
    const matchId = req.params.matchId;
    const plan = req.query.plan || 'estratega';

    const result = await controller.simulateMatch(matchId, plan);
    res.json(result);
});

// Ruta para ver partidos disponibles
app.get('/matches', async (req, res) => {
    const matchSelector = require('./core/match-selector');
    const matches = await matchSelector.getAvailableMatches();
    res.json(matches);
});

// Iniciar servidor y controlador principal
app.listen(port, () => {
    console.log(`Servidor iniciado en puerto ${port}`);
    controller.start();
});