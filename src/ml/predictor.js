/**
 * Predictor basado en Machine Learning
 * Combina modelos de ML y sistema de reglas para realizar predicciones
 */
const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const featureExtractor = require('./feature-extractor');
const ruleEngine = require('./rule-engine');
const logger = require('../utils/logger');

class Predictor {
    constructor() {
        // Mapa de modelos ML cargados
        this.models = {};

        // Estado de carga de modelos
        this.modelsLoaded = false;
        this.isLoadingModels = false;

        // Mercados soportados
        this.supportedMarkets = [
            'nextGoal',
            'over05',
            'over15',
            'over25',
            'btts',
            'cornerNext10Min'
        ];

        // Configuración de niveles de confianza para fusión de predicciones
        this.confidenceWeights = {
            ml: 0.7,      // Peso para predicciones de ML (cuando están disponibles)
            rules: 0.3    // Peso para predicciones basadas en reglas
        };
    }

    /**
     * Cargar modelos de ML
     * @returns {Promise<boolean>} - True si se cargaron correctamente
     */
    async loadModels() {
        if (this.modelsLoaded || this.isLoadingModels) {
            return this.modelsLoaded;
        }

        this.isLoadingModels = true;
        let success = true;

        try {
            logger.info('Cargando modelos de ML...');

            // Intentar cargar modelo para cada mercado
            for (const market of this.supportedMarkets) {
                try {
                    const modelPath = `file://${path.join(__dirname, '../../models', market, 'model.json')}`;

                    logger.debug(`Intentando cargar modelo para ${market} desde ${modelPath}`);
                    this.models[market] = await tf.loadLayersModel(modelPath);
                    logger.info(`Modelo para ${market} cargado correctamente`);
                } catch (error) {
                    logger.warn(`No se pudo cargar el modelo para ${market}: ${error.message}`);
                    // No lanzar excepción, simplemente continuar con el siguiente modelo
                    success = false;
                }
            }

            this.modelsLoaded = success || Object.keys(this.models).length > 0;
            logger.info(`Carga de modelos completada. ${Object.keys(this.models).length} modelos disponibles.`);

            return this.modelsLoaded;
        } catch (error) {
            logger.error(`Error al cargar modelos: ${error.message}`);
            this.modelsLoaded = false;
            return false;
        } finally {
            this.isLoadingModels = false;
        }
    }

    /**
     * Predecir resultado para un mercado específico
     * @param {string} market - Mercado a predecir
     * @param {Object} matchData - Datos del partido
     * @returns {Promise<Object>} - Predicción {probability, confidence}
     */
    async predict(market, matchData) {
        try {
            // Verificar que el mercado esté soportado
            if (!this.supportedMarkets.includes(market)) {
                logger.warn(`Mercado no soportado: ${market}`);
                return { probability: 0.5, confidence: 0.2 };
            }

            // 1. Obtener predicción basada en reglas
            const rulesPrediction = await this.getPredictionFromRules(market, matchData);

            // 2. Intentar obtener predicción de ML si está disponible
            const mlPrediction = await this.getPredictionFromML(market, matchData);

            // 3. Combinar predicciones según disponibilidad
            if (mlPrediction) {
                // Ambas predicciones disponibles - combinar con pesos
                return this.combinePredictions(mlPrediction, rulesPrediction);
            } else {
                // Solo predicción de reglas disponible
                return rulesPrediction;
            }
        } catch (error) {
            logger.error(`Error en predicción para ${market}: ${error.message}`);
            // Fallback a sistema de reglas en caso de error
            return ruleEngine.evaluate(market, matchData);
        }
    }

    /**
     * Obtener predicción utilizando modelos ML
     * @param {string} market - Mercado a predecir
     * @param {Object} matchData - Datos del partido
     * @returns {Promise<Object|null>} - Predicción ML o null si no disponible
     */
    async getPredictionFromML(market, matchData) {
        // Si los modelos no están cargados, intentar cargarlos
        if (!this.modelsLoaded && !this.isLoadingModels) {
            await this.loadModels();
        }

        // Verificar si tenemos modelo para este mercado
        if (!this.models[market]) {
            return null;
        }

        try {
            // 1. Extraer características para el modelo
            const features = featureExtractor.extractFeatures(matchData, market);

            // 2. Realizar predicción con TensorFlow.js
            const tensor = tf.tensor2d([features]);
            const prediction = this.models[market].predict(tensor);

            // 3. Obtener valor escalar
            const probabilityArray = await prediction.data();
            const probability = probabilityArray[0];

            // 4. Calcular confianza basada en la certeza de la predicción
            // Más cerca de 0 o 1 = mayor confianza
            const certainty = Math.abs(probability - 0.5) * 2;
            const confidence = 0.5 + (certainty * 0.4); // 0.5 a 0.9

            // 5. Liberar tensores
            tensor.dispose();
            prediction.dispose();

            return { probability, confidence };
        } catch (error) {
            logger.error(`Error en predicción ML para ${market}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener predicción utilizando sistema de reglas
     * @param {string} market - Mercado a predecir
     * @param {Object} matchData - Datos del partido
     * @returns {Promise<Object>} - Predicción basada en reglas
     */
    async getPredictionFromRules(market, matchData) {
        return ruleEngine.evaluate(market, matchData);
    }

    /**
     * Combinar predicciones de ML y reglas
     * @param {Object} mlPrediction - Predicción de ML
     * @param {Object} rulesPrediction - Predicción de reglas
     * @returns {Object} - Predicción combinada
     */
    combinePredictions(mlPrediction, rulesPrediction) {
        // Calcular pesos normalizados
        const mlWeight = this.confidenceWeights.ml * mlPrediction.confidence;
        const rulesWeight = this.confidenceWeights.rules * rulesPrediction.confidence;
        const totalWeight = mlWeight + rulesWeight;

        // Combinar probabilidades con pesos
        const combinedProbability =
            ((mlPrediction.probability * mlWeight) +
                (rulesPrediction.probability * rulesWeight)) / totalWeight;

        // Combinar confianza (preferencia a la mayor)
        const combinedConfidence = Math.max(
            mlPrediction.confidence * this.confidenceWeights.ml,
            rulesPrediction.confidence * this.confidenceWeights.rules
        );

        return {
            probability: combinedProbability,
            confidence: combinedConfidence
        };
    }

    /**
     * Predicción de potencial de momentos dorados
     * Utilizado por match-selector para priorizar partidos
     * @param {Object} match - Datos del partido
     * @returns {Promise<Object>} - Predicción {score}
     */
    async predictPotential(match) {
        try {
            // 1. Intentar usar potentialModel si está disponible
            if (this.models.potential) {
                // Extraer características simplificadas
                const features = featureExtractor.extractBaseFeatures(match);

                // Realizar predicción
                const tensor = tf.tensor2d([features]);
                const prediction = this.models.potential.predict(tensor);

                // Obtener valor escalar
                const scoreArray = await prediction.data();
                const score = scoreArray[0];

                // Liberar tensores
                tensor.dispose();
                prediction.dispose();

                return { score };
            }

            // 2. Fallback a sistema de reglas
            return ruleEngine.predictPotential(match);
        } catch (error) {
            logger.error(`Error en predicción de potencial: ${error.message}`);
            return ruleEngine.predictPotential(match);
        }
    }

    /**
     * Verificar si está disponible el modelo ML para un mercado
     * @param {string} market - Mercado a consultar
     * @returns {boolean} - True si hay modelo disponible
     */
    hasModelForMarket(market) {
        return !!this.models[market];
    }

    /**
     * Obtener lista de modelos disponibles
     * @returns {Array<string>} - Lista de mercados con modelos
     */
    getAvailableModels() {
        return Object.keys(this.models);
    }

    /**
     * Entrenar un modelo simple para propósitos de prueba
     * @param {string} market - Mercado a entrenar
     * @param {Array} trainingData - Datos de entrenamiento
     * @returns {Promise<Object>} - Resultado del entrenamiento
     */
    async trainTestModel(market, trainingData) {
        if (!trainingData || trainingData.length < 10) {
            throw new Error('Datos de entrenamiento insuficientes');
        }

        try {
            logger.info(`Entrenando modelo de prueba para ${market}...`);

            // Extraer características y etiquetas
            const features = trainingData.map(item => item.features);
            const labels = trainingData.map(item => item.label);

            // Crear modelo
            const model = tf.sequential();

            // Capa de entrada
            model.add(tf.layers.dense({
                units: 16,
                activation: 'relu',
                inputShape: [features[0].length]
            }));

            // Capa oculta
            model.add(tf.layers.dense({
                units: 8,
                activation: 'relu'
            }));

            // Capa de salida
            model.add(tf.layers.dense({
                units: 1,
                activation: 'sigmoid'
            }));

            // Compilar modelo
            model.compile({
                optimizer: tf.train.adam(),
                loss: 'binaryCrossentropy',
                metrics: ['accuracy']
            });

            // Convertir a tensores
            const xs = tf.tensor2d(features);
            const ys = tf.tensor2d(labels, [labels.length, 1]);

            // Entrenar modelo
            const history = await model.fit(xs, ys, {
                epochs: 50,
                validationSplit: 0.2,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        logger.debug(`Época ${epoch}: loss = ${logs.loss}, accuracy = ${logs.acc}`);
                    }
                }
            });

            // Guardar modelo
            const saveDir = path.join(__dirname, '../../models', market);
            await model.save(`file://${saveDir}`);

            // Actualizar modelo en memoria
            this.models[market] = model;

            // Liberar tensores
            xs.dispose();
            ys.dispose();

            logger.info(`Modelo para ${market} entrenado y guardado correctamente`);

            return {
                success: true,
                market,
                metrics: {
                    finalLoss: history.history.loss[history.history.loss.length - 1],
                    finalAccuracy: history.history.acc[history.history.acc.length - 1]
                }
            };
        } catch (error) {
            logger.error(`Error entrenando modelo para ${market}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new Predictor();