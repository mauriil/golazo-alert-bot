/**
 * Extrae características relevantes para modelos de ML
 * a partir de datos de partidos
 */
class FeatureExtractor {
    constructor() {
        this.timeUtils = require('../utils/time-utils');
    }

    // Extraer features para predicción
    extractFeatures(matchData) {
        return [
            // Características de tiempo
            this.normalizeMinute(matchData.minute),

            // Características de resultado
            matchData.homeGoals,
            matchData.awayGoals,
            Math.abs(matchData.homeGoals - matchData.awayGoals),

            // Características de estadísticas
            this.normalizeStats(matchData.stats),

            // Características de momentum
            this.calculateMomentum(matchData),

            // Características de cuotas
            this.normalizeOdds(matchData.odds)
        ].flat();
    }

    // Métodos auxiliares de normalización
    normalizeMinute(minute) {... }
    normalizeStats(stats) {... }
    calculateMomentum(matchData) {... }
    normalizeOdds(odds) {... }
}