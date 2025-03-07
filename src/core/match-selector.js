/**
 * Selecciona los partidos más relevantes para monitorear
 * basándose en criterios de relevancia y potencial
 */
class MatchSelector {
    constructor() {
        this.apiService = require('../api/api-service');
        this.predictor = require('../ml/predictor');

        // Límites por plan
        this.planLimits = {
            free: 3,      // 3 partidos/día
            insider: 8,    // 8 partidos/día
            estratega: 15  // 15 partidos/día
        };
    }

    // Obtener partidos disponibles
    async getAvailableMatches() {... }

    // Calcular relevancia cultural/deportiva (0-10)
    async calculateRelevanceScore(match) {... }

    // Calcular potencial de oportunidades (0-10)
    async calculatePotentialScore(match) {... }

    // Seleccionar partidos según plan
    async selectMatchesToMonitor(userPlan) {... }
}