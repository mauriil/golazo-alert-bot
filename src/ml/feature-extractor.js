/**
 * Feature Extractor para Machine Learning
 * Extrae y normaliza características de partidos para alimentar modelos predictivos
 */
const logger = require('../utils/logger');
const timeUtils = require('../utils/time-utils');

class FeatureExtractor {
    constructor() {
        // Definir rangos de normalización para cada característica
        this.normalizers = {
            // Rangos típicos para cada característica
            minute: { min: 0, max: 90 },
            score: { min: 0, max: 5 },
            shotOnTarget: { min: 0, max: 20 },
            corners: { min: 0, max: 15 },
            possession: { min: 0, max: 100 },
            cards: { min: 0, max: 10 },
            odds: { min: 1, max: 10 }
        };
    }

    /**
     * Extraer vector de características para predicción ML
     * @param {Object} matchData - Datos del partido
     * @param {string} market - Mercado para el que se extraen características
     * @returns {Array} - Vector de características normalizadas
     */
    extractFeatures(matchData, market = null) {
        try {
            // 1. Vector base de características comunes a todos los mercados
            const baseFeatures = this.extractBaseFeatures(matchData);

            // 2. Características específicas según mercado
            const marketFeatures = market ?
                this.extractMarketSpecificFeatures(matchData, market) : [];

            // 3. Combinar y devolver vector completo
            return [...baseFeatures, ...marketFeatures];
        } catch (error) {
            logger.error(`Error extrayendo características: ${error.message}`);
            // En caso de error, devolver vector de características vacío
            return new Array(this.getExpectedFeaturesLength(market)).fill(0.5);
        }
    }

    /**
     * Extrae características base comunes a todos los mercados
     * @param {Object} matchData - Datos del partido
     * @returns {Array} - Vector de características base
     */
    extractBaseFeatures(matchData) {
        // Extraer datos necesarios del objeto matchData
        const minute = matchData.minute || matchData.fixture?.status?.elapsed || 0;
        const scoreHome = matchData.score?.home || 0;
        const scoreAway = matchData.score?.away || 0;

        // Extraer estadísticas clave
        const stats = this.extractStatistics(matchData);

        // Extraer información de eventos recientes
        const recentEvents = this.extractRecentEvents(matchData, minute);

        // Extraer información de momentum
        const momentum = this.calculateMomentum(matchData, minute, recentEvents);

        // Normalizar y devolver vector de características base
        return [
            // 1. Características temporales
            this.normalize(minute, 'minute'),               // Minuto normalizado
            this.normalizeGamePhase(minute),                // Fase del partido (0-1)

            // 2. Características de resultado
            this.normalize(scoreHome, 'score'),             // Goles local
            this.normalize(scoreAway, 'score'),             // Goles visitante
            this.normalize(scoreHome - scoreAway, 'score'), // Diferencia de goles
            this.normalize(scoreHome + scoreAway, 'score'), // Total de goles

            // 3. Características de estadísticas
            this.normalize(stats.possessionHome, 'possession'),    // Posesión local (%)
            this.normalize(stats.shotsOnTargetHome, 'shotOnTarget'), // Tiros a puerta local
            this.normalize(stats.shotsOnTargetAway, 'shotOnTarget'), // Tiros a puerta visitante
            this.normalize(stats.cornersHome, 'corners'),           // Córners local
            this.normalize(stats.cornersAway, 'corners'),           // Córners visitante
            this.normalize(stats.yellowCardsHome, 'cards'),         // Tarjetas amarillas local
            this.normalize(stats.yellowCardsAway, 'cards'),         // Tarjetas amarillas visitante

            // 4. Características de eventos recientes
            this.normalize(recentEvents.recentCornersHome, 'corners'),  // Córners recientes local
            this.normalize(recentEvents.recentCornersAway, 'corners'),  // Córners recientes visitante
            this.normalize(recentEvents.recentShotsHome, 'shotOnTarget'), // Tiros recientes local
            this.normalize(recentEvents.recentShotsAway, 'shotOnTarget'), // Tiros recientes visitante

            // 5. Características de momentum
            momentum.homeAttacking,         // Momentum ofensivo local (0-1)
            momentum.awayAttacking,         // Momentum ofensivo visitante (0-1)
            momentum.momentumShift          // Cambio de momentum (-1 a 1)
        ];
    }

    /**
     * Extrae características específicas para un mercado particular
     * @param {Object} matchData - Datos del partido
     * @param {string} market - Mercado para el que se extraen características
     * @returns {Array} - Vector de características específicas
     */
    extractMarketSpecificFeatures(matchData, market) {
        switch (market) {
            case 'nextGoal':
                return this.extractNextGoalFeatures(matchData);
            case 'over05':
            case 'over15':
            case 'over25':
                return this.extractOverUnderFeatures(matchData, market);
            case 'btts':
                return this.extractBttsFeatures(matchData);
            case 'cornerNext10Min':
                return this.extractCornerFeatures(matchData);
            default:
                return []; // Mercado desconocido
        }
    }

    /**
     * Extrae características para mercado de próximo gol
     * @param {Object} matchData - Datos del partido
     * @returns {Array} - Vector de características
     */
    extractNextGoalFeatures(matchData) {
        const minute = matchData.minute || matchData.fixture?.status?.elapsed || 0;
        const scoreHome = matchData.score?.home || 0;
        const scoreAway = matchData.score?.away || 0;
        const stats = this.extractStatistics(matchData);

        // Recuperar cuotas relevantes
        const homeWinOdds = this.extractOdds(matchData, 'h2h', 'home');
        const drawOdds = this.extractOdds(matchData, 'h2h', 'draw');
        const awayWinOdds = this.extractOdds(matchData, 'h2h', 'away');

        // Extracción para próximo gol
        return [
            // Características ofensivas normalizadas
            stats.shotsOnTargetHome / (stats.shotsOnTargetHome + stats.shotsOnTargetAway + 0.001),
            stats.cornersHome / (stats.cornersHome + stats.cornersAway + 0.001),

            // Características de cuotas normalizadas
            this.normalizeOdds(homeWinOdds),
            this.normalizeOdds(drawOdds),
            this.normalizeOdds(awayWinOdds),

            // Histórico de goles según minuto
            this.getHistoricalGoalProbability(minute, 'home'),
            this.getHistoricalGoalProbability(minute, 'away')
        ];
    }

    /**
     * Extrae características para mercados over/under
     * @param {Object} matchData - Datos del partido 
     * @param {string} market - Tipo específico (over05, over15, over25)
     * @returns {Array} - Vector de características
     */
    extractOverUnderFeatures(matchData, market) {
        const minute = matchData.minute || matchData.fixture?.status?.elapsed || 0;
        const scoreHome = matchData.score?.home || 0;
        const scoreAway = matchData.score?.away || 0;
        const totalGoals = scoreHome + scoreAway;

        // Determinar umbral según mercado
        let threshold = 0.5;
        if (market === 'over15') threshold = 1.5;
        if (market === 'over25') threshold = 2.5;

        // Calcular goles necesarios
        const goalsNeeded = Math.max(0, Math.ceil(threshold - totalGoals));

        // Normalizar tiempo restante
        const minutesLeft = Math.max(0, 90 - minute);
        const normalizedTimeLeft = minutesLeft / 90;

        // Extraer cuotas de over/under
        const overOdds = this.extractOdds(matchData, 'totals', 'Over', threshold);

        // Ritmo de goles actual
        const goalRate = minute > 0 ? totalGoals / minute : 0;
        const projectedGoals = goalRate * 90;

        return [
            // Goles actuales vs umbral
            this.normalize(totalGoals, 'score'),
            goalsNeeded / 3, // Normalizado (máximo razonable: 3 goles)

            // Tiempo restante y proyección
            normalizedTimeLeft,
            this.normalize(projectedGoals, 'score'),

            // Cuota normalizada
            this.normalizeOdds(overOdds),

            // Probabilidad histórica
            this.getHistoricalOverProbability(minute, totalGoals, threshold)
        ];
    }

    /**
     * Extrae características para mercado BTTS (ambos equipos marcan)
     * @param {Object} matchData - Datos del partido
     * @returns {Array} - Vector de características 
     */
    extractBttsFeatures(matchData) {
        const minute = matchData.minute || matchData.fixture?.status?.elapsed || 0;
        const scoreHome = matchData.score?.home || 0;
        const scoreAway = matchData.score?.away || 0;
        const stats = this.extractStatistics(matchData);

        // Estado actual de goles
        const homeScored = scoreHome > 0 ? 1 : 0;
        const awayScored = scoreAway > 0 ? 1 : 0;
        const bothScored = homeScored && awayScored ? 1 : 0;

        // Extraer cuota de BTTS
        const bttsOdds = this.extractOdds(matchData, 'btts', 'Yes');

        return [
            // Estado de goles
            homeScored,
            awayScored,
            bothScored,

            // Características ofensivas del equipo que no ha marcado
            homeScored ? 1 : stats.shotsOnTargetHome / 10,
            awayScored ? 1 : stats.shotsOnTargetAway / 10,

            // Tiempo restante normalizado
            (90 - minute) / 90,

            // Cuota normalizada
            this.normalizeOdds(bttsOdds),

            // Probabilidad histórica
            this.getHistoricalBttsProbability(minute, homeScored, awayScored)
        ];
    }

    /**
     * Extrae características para mercado de córner
     * @param {Object} matchData - Datos del partido
     * @returns {Array} - Vector de características
     */
    extractCornerFeatures(matchData) {
        const minute = matchData.minute || matchData.fixture?.status?.elapsed || 0;
        const stats = this.extractStatistics(matchData);
        const recentEvents = this.extractRecentEvents(matchData, minute);

        // Ritmo de córners
        const totalCorners = stats.cornersHome + stats.cornersAway;
        const cornerRate = minute > 0 ? totalCorners / minute : 0;

        // Presión reciente
        const recentPressureHome = recentEvents.recentShotsHome + recentEvents.recentCornersHome;
        const recentPressureAway = recentEvents.recentShotsAway + recentEvents.recentCornersAway;

        return [
            // Estadísticas de córners
            this.normalize(totalCorners, 'corners'),
            cornerRate / 0.2, // Normalizado (0.2 = 1 córner cada 5 minutos)

            // Presión reciente
            this.normalize(recentPressureHome, 'corners'),
            this.normalize(recentPressureAway, 'corners'),

            // Fase del partido (ciertos minutos tienen más córners)
            this.isCornerHotspot(minute) ? 1 : 0,

            // Probabilidad histórica
            this.getHistoricalCornerProbability(minute)
        ];
    }

    /**
     * Extrae estadísticas del partido
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Estadísticas relevantes
     */
    extractStatistics(matchData) {
        const stats = {
            possessionHome: 50,
            shotsOnTargetHome: 0,
            shotsOnTargetAway: 0,
            cornersHome: 0,
            cornersAway: 0,
            yellowCardsHome: 0,
            yellowCardsAway: 0
        };

        // Si no hay estadísticas, devolver valores por defecto
        if (!matchData.statistics || !matchData.statistics.length) {
            return stats;
        }

        try {
            // Extraer estadísticas del equipo local
            const homeStats = matchData.statistics[0]?.statistics || [];
            homeStats.forEach(stat => {
                if (stat.type === 'Ball Possession') {
                    stats.possessionHome = parseInt(stat.value?.replace('%', '') || 50);
                } else if (stat.type === 'Shots on Goal') {
                    stats.shotsOnTargetHome = parseInt(stat.value || 0);
                } else if (stat.type === 'Corner Kicks') {
                    stats.cornersHome = parseInt(stat.value || 0);
                } else if (stat.type === 'Yellow Cards') {
                    stats.yellowCardsHome = parseInt(stat.value || 0);
                }
            });

            // Extraer estadísticas del equipo visitante
            const awayStats = matchData.statistics[1]?.statistics || [];
            awayStats.forEach(stat => {
                if (stat.type === 'Shots on Goal') {
                    stats.shotsOnTargetAway = parseInt(stat.value || 0);
                } else if (stat.type === 'Corner Kicks') {
                    stats.cornersAway = parseInt(stat.value || 0);
                } else if (stat.type === 'Yellow Cards') {
                    stats.yellowCardsAway = parseInt(stat.value || 0);
                }
            });

            // Calcular estadísticas derivadas
            stats.possessionAway = 100 - stats.possessionHome;
            stats.totalShots = stats.shotsOnTargetHome + stats.shotsOnTargetAway;
            stats.totalCorners = stats.cornersHome + stats.cornersAway;

            return stats;
        } catch (error) {
            logger.error(`Error extrayendo estadísticas: ${error.message}`);
            return stats;
        }
    }

    /**
     * Extrae eventos recientes del partido
     * @param {Object} matchData - Datos del partido
     * @param {number} currentMinute - Minuto actual
     * @returns {Object} - Eventos recientes agregados
     */
    extractRecentEvents(matchData, currentMinute) {
        const result = {
            recentCornersHome: 0,
            recentCornersAway: 0,
            recentShotsHome: 0,
            recentShotsAway: 0,
            recentCards: 0
        };

        if (!matchData.events || !matchData.events.length) {
            return result;
        }

        try {
            // Considerar eventos de los últimos 15 minutos
            const recentEvents = matchData.events.filter(event => {
                const eventMinute = event.time?.elapsed || 0;
                return currentMinute - eventMinute <= 15;
            });

            recentEvents.forEach(event => {
                const isHomeTeam = event.team?.id === matchData.teams?.home?.id;

                // Contar tipos de eventos
                if (event.type === 'Goal') {
                    if (isHomeTeam) result.recentShotsHome++;
                    else result.recentShotsAway++;
                } else if (event.type === 'Card') {
                    result.recentCards++;
                } else if (event.type === 'Corner') {
                    if (isHomeTeam) result.recentCornersHome++;
                    else result.recentCornersAway++;
                } else if (event.detail === 'Shot on Goal') {
                    if (isHomeTeam) result.recentShotsHome++;
                    else result.recentShotsAway++;
                }
            });

            return result;
        } catch (error) {
            logger.error(`Error extrayendo eventos recientes: ${error.message}`);
            return result;
        }
    }

    /**
     * Calcula el momentum actual del partido
     * @param {Object} matchData - Datos del partido
     * @param {number} currentMinute - Minuto actual
     * @param {Object} recentEvents - Eventos recientes
     * @returns {Object} - Indicadores de momentum
     */
    calculateMomentum(matchData, currentMinute, recentEvents) {
        const result = {
            homeAttacking: 0.5,    // 0-1 (0.5 = neutral)
            awayAttacking: 0.5,    // 0-1 (0.5 = neutral)
            momentumShift: 0       // -1 a 1 (0 = neutral)
        };

        try {
            const stats = this.extractStatistics(matchData);

            // 1. Momentum basado en posesión
            const possessionFactor = (stats.possessionHome - 50) / 50; // -1 a 1

            // 2. Momentum basado en eventos recientes
            const homeRecentEvents = recentEvents.recentShotsHome + recentEvents.recentCornersHome;
            const awayRecentEvents = recentEvents.recentShotsAway + recentEvents.recentCornersAway;
            const totalRecentEvents = homeRecentEvents + awayRecentEvents;

            const recentEventsFactor = totalRecentEvents > 0 ?
                (homeRecentEvents - awayRecentEvents) / totalRecentEvents : 0; // -1 a 1

            // 3. Combinar factores (ponderados)
            const combinedFactor = (possessionFactor * 0.3) + (recentEventsFactor * 0.7);

            // 4. Calcular valores finales
            result.momentumShift = combinedFactor;
            result.homeAttacking = 0.5 + (combinedFactor / 2); // 0-1
            result.awayAttacking = 0.5 - (combinedFactor / 2); // 0-1

            return result;
        } catch (error) {
            logger.error(`Error calculando momentum: ${error.message}`);
            return result;
        }
    }

    /**
     * Extrae las cuotas para un mercado y outcome específicos
     * @param {Object} matchData - Datos del partido
     * @param {string} marketKey - Clave del mercado
     * @param {string} outcomeName - Nombre del resultado
     * @param {number} point - Punto (para mercados con punto como over/under)
     * @returns {number} - Cuota o valor por defecto
     */
    extractOdds(matchData, marketKey, outcomeName, point = null) {
        if (!matchData.odds || !matchData.odds.bookmakers || !matchData.odds.bookmakers.length) {
            return 2.0; // Valor por defecto
        }

        try {
            // Buscar bookmaker que ofrezca este mercado
            for (const bookmaker of matchData.odds.bookmakers) {
                const marketData = bookmaker.markets.find(m => m.key === marketKey);

                if (marketData && marketData.outcomes) {
                    let outcome;

                    if (point !== null) {
                        // Para mercados con punto (over/under)
                        outcome = marketData.outcomes.find(o =>
                            o.name === outcomeName && o.point === point
                        );
                    } else {
                        // Para mercados sin punto
                        outcome = marketData.outcomes.find(o => o.name === outcomeName);
                    }

                    if (outcome && outcome.price) {
                        return outcome.price;
                    }
                }
            }

            // No se encontró, devolver valor por defecto
            return 2.0;
        } catch (error) {
            logger.error(`Error extrayendo cuotas: ${error.message}`);
            return 2.0;
        }
    }

    /**
     * Normaliza un valor dentro de un rango específico a 0-1
     * @param {number} value - Valor a normalizar
     * @param {string} featureType - Tipo de característica
     * @returns {number} - Valor normalizado (0-1)
     */
    normalize(value, featureType) {
        if (value === undefined || value === null) return 0.5;

        const range = this.normalizers[featureType];
        if (!range) return 0.5;

        // Limitar al rango y normalizar
        const clampedValue = Math.max(range.min, Math.min(range.max, value));
        const normalizedValue = (clampedValue - range.min) / (range.max - range.min);

        return normalizedValue;
    }

    /**
     * Normaliza una cuota a probabilidad (0-1)
     * @param {number} odds - Cuota (formato europeo)
     * @returns {number} - Probabilidad implícita (0-1)
     */
    normalizeOdds(odds) {
        if (!odds || odds < 1) return 0.5;

        // Convertir cuota a probabilidad implícita
        const impliedProbability = 1 / odds;

        // Ajustar por margen típico de casa de apuestas
        const adjustedProbability = impliedProbability * 0.95;

        return Math.min(1, Math.max(0, adjustedProbability));
    }

    /**
     * Normaliza la fase del partido (0-1)
     * @param {number} minute - Minuto actual
     * @returns {number} - Fase normalizada (0-1)
     */
    normalizeGamePhase(minute) {
        return Math.min(1, Math.max(0, minute / 90));
    }

    /**
     * Determina si el minuto actual es un "punto caliente" para córners
     * @param {number} minute - Minuto actual
     * @returns {boolean} - True si es un punto caliente
     */
    isCornerHotspot(minute) {
        // Minutos típicos con alta frecuencia de córners
        const hotspots = [
            [35, 45],  // Final primera parte
            [75, 90]   // Final segunda parte
        ];

        return hotspots.some(([start, end]) => minute >= start && minute <= end);
    }

    /**
     * Obtiene probabilidad histórica de gol según minuto
     * @param {number} minute - Minuto actual
     * @param {string} team - Equipo (home/away)
     * @returns {number} - Probabilidad (0-1)
     */
    getHistoricalGoalProbability(minute, team) {
        // Simulación para MVP - en producción vendría de análisis de datos históricos
        const baseProbability = team === 'home' ? 0.55 : 0.45;

        // Ajuste por minuto (más goles al final de cada parte)
        let minuteFactor = 1.0;
        if (minute > 40 && minute <= 45) minuteFactor = 1.3;
        if (minute > 75 && minute <= 90) minuteFactor = 1.5;

        return Math.min(1, baseProbability * minuteFactor);
    }

    /**
     * Obtiene probabilidad histórica para mercados over
     * @param {number} minute - Minuto actual
     * @param {number} currentGoals - Goles actuales
     * @param {number} threshold - Umbral (0.5, 1.5, 2.5)
     * @returns {number} - Probabilidad (0-1)
     */
    getHistoricalOverProbability(minute, currentGoals, threshold) {
        // Simulación para MVP - en producción vendría de análisis de datos históricos

        // Si ya se superó el umbral, probabilidad 1
        if (currentGoals > threshold) return 1.0;

        // Goles necesarios
        const goalsNeeded = Math.ceil(threshold - currentGoals);

        // Probabilidad base según goles necesarios
        let baseProbability;
        if (goalsNeeded <= 0) baseProbability = 1.0;
        else if (goalsNeeded === 1) baseProbability = 0.7;
        else if (goalsNeeded === 2) baseProbability = 0.4;
        else baseProbability = 0.2;

        // Ajuste por tiempo restante
        const minutesLeft = 90 - minute;
        const timeFactor = Math.min(1, minutesLeft / (goalsNeeded * 30));

        return Math.min(1, Math.max(0, baseProbability * timeFactor));
    }

    /**
     * Obtiene probabilidad histórica para BTTS
     * @param {number} minute - Minuto actual
     * @param {number} homeScored - Si local ha marcado (0/1)
     * @param {number} awayScored - Si visitante ha marcado (0/1)
     * @returns {number} - Probabilidad (0-1)
     */
    getHistoricalBttsProbability(minute, homeScored, awayScored) {
        // Simulación para MVP - en producción vendría de análisis de datos históricos

        // Si ambos ya han marcado, probabilidad 1
        if (homeScored && awayScored) return 1.0;

        // Probabilidad base según tiempo restante
        const minutesLeft = 90 - minute;
        let baseProbability = minutesLeft / 90;

        // Ajuste según cuántos equipos ya han marcado
        if (homeScored || awayScored) {
            // Solo falta un equipo por marcar
            baseProbability = Math.min(1, baseProbability * 1.5);
        }

        return Math.min(1, Math.max(0, baseProbability));
    }

    /**
     * Obtiene probabilidad histórica de córner
     * @param {number} minute - Minuto actual
     * @returns {number} - Probabilidad (0-1)
     */
    getHistoricalCornerProbability(minute) {
        // Simulación para MVP - en producción vendría de análisis de datos históricos

        // Probabilidad base
        let baseProbability = 0.6;

        // Ajuste por fase de partido
        if (minute > 75) baseProbability = 0.75;
        else if (minute > 35 && minute <= 45) baseProbability = 0.7;

        return baseProbability;
    }

    /**
     * Obtiene el número esperado de características para un mercado
     * @param {string} market - Mercado o null
     * @returns {number} - Longitud esperada del vector
     */
    getExpectedFeaturesLength(market) {
        // Número de características base
        const baseLength = 20;

        // Añadir características específicas según mercado
        switch (market) {
            case 'nextGoal': return baseLength + 7;
            case 'over05':
            case 'over15':
            case 'over25': return baseLength + 6;
            case 'btts': return baseLength + 8;
            case 'cornerNext10Min': return baseLength + 6;
            default: return baseLength;
        }
    }
}

module.exports = new FeatureExtractor();