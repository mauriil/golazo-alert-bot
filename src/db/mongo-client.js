/**
 * Cliente de conexión a MongoDB
 * Gestiona la conexión y proporciona acceso a la base de datos
 */
const mongoose = require('mongoose');
const config = require('../config/db-config');
const logger = require('../utils/logger');

class MongoClient {
    constructor() {
        this.isConnected = false;
        this.connectionString = process.env.MONGODB_URI || config.mongoUri;
        this.options = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            // Otras opciones de conexión
        };
    }

    // Conectar a MongoDB
    async connect() {
        if (this.isConnected) return;

        try {
            await mongoose.connect(this.connectionString, this.options);
            this.isConnected = true;
            logger.info('Conexión a MongoDB establecida');
        } catch (error) {
            logger.error(`Error conectando a MongoDB: ${error.message}`);
            // Fallback a base de datos local
            this.useFallbackDatabase();
        }
    }

    // Desconectar de MongoDB
    async disconnect() {
        if (!this.isConnected) return;

        try {
            await mongoose.disconnect();
            this.isConnected = false;
            logger.info('Conexión a MongoDB cerrada');
        } catch (error) {
            logger.error(`Error al cerrar conexión MongoDB: ${error.message}`);
        }
    }

    // Usar base de datos local como fallback
    useFallbackDatabase() {
        logger.warn('Usando base de datos local como fallback');
        this.localDb = require('./local-db');
        // Configurar para usar localDb en vez de MongoDB
    }

    // Verificar estado de conexión
    isHealthy() {
        return mongoose.connection.readyState === 1;
    }
}

module.exports = new MongoClient();