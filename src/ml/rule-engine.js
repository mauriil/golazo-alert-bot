/**
 * Motor de Reglas
 * Implementa sistema basado en reglas para predicciones cuando no se usa ML
 * o como complemento/fallback para los modelos de ML
 */
const logger = require('../utils/logger');
const oddsCalculator = require('../utils/odds-calculator');
const mathUtils = require('../utils/math-utils');

class RuleEngine {
    constructor() {
        // Configuración de umbrales para diferentes mercados
        this.thresholds = {
            // Configuración para próximo gol
            nextGoal: {
                possession: 65,       // % posesión para considerar ventaja
                shotsAdvantage: 3,    // Diferencia de tiros para ventaja
                cornersAdvantage: 2,  // Diferencia de córners para ventaja
                momentumThreshold: 0.5 // Umbral para momentum significativo
            },

            // Configuración para over/under
            over: {
                highShotsThreshold: 10, // Total de tiros para considerar partido ofensivo
                highCornersThreshold: 8, // Total de córners para considerar partido activo
                minuteFactors: {
                    // Factores de peso por minuto para over/under
                    early: 0.6,  // 0-30 minutos
                    middle: 0.8, // 31-60 minutos
                    late: 1.0    // 61-90 minutos
                }
            },

            // Configuración para BTTS
            btts: {
                minShotsPerTeam: 3,   // Mínimo de tiros por equipo para ser ofensivo
                lateGameFactor: 0.6   // Factor de penalización en minutos finales
            },

            // Configuración para córner
            corner: {
                pressureThreshold: 3, // Nivel de presión para esperar córner
                cornerRateThreshold: 0.12 // Corners por minuto (1 cada ~8 min)
            }
        };

        // Factores de confianza base para diferentes mercados
        this.baseConfidence = {
            nextGoal: 0.5,
            over05: 0.6,
            over15: 0.5,
            over25: 0.4,
            btts: 0.5,
            cornerNext10Min: 0.4
        };
    }

    /**
     * Evalúa mercado según reglas definidas
     * @param {string} market - Mercado a evaluar
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Resultado {probability, confidence}
     */
    evaluate(market, matchData) {
        try {
            // Seleccionar método de evaluación según mercado
            switch (market) {
                case 'nextGoal':
                    return this.evaluateNextGoal(matchData);
                case 'over05':
                    return this.evaluateOver(matchData, 0.5);
                case 'over15':
                    return this.evaluateOver(matchData, 1.5);
                case 'over25':
                    return this.evaluateOver(matchData, 2.5);
                case 'btts':
                    return this.evaluateBtts(matchData);
                case 'cornerNext10Min':
                    return this.evaluateCorner(matchData);
                default:
                    logger.warn(`Mercado no soportado en reglas: ${market}`);
                    return { probability: 0.5, confidence: 0.2 };
            }
        } catch (error) {
            logger.error(`Error en sistema de reglas para ${market}: ${error.message}`);
            return { probability: 0.5, confidence: 0.2 };
        }
    }

    /**
     * Evalúa mercado de próximo gol
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Resultado {probability, confidence}
     */
    evaluateNextGoal(matchData) {
        // Extraer datos relevantes
        const minute = matchData.minute || 0;
        const homeTeam = matchData.teams?.home?.name || 'Local';
        const awayTeam = matchData.teams?.away?.name || 'Visitante';

        // Extraer estadísticas
        const stats = this.extractStatistics(matchData);

        // Factores que favorecen al equipo local
        const homeFactors = [];
        // Factores que favorecen al equipo visitante
        const awayFactors = [];

        // 1. Factor de posesión
        if (stats.possessionHome > this.thresholds.nextGoal.possession) {
            homeFactors.push({ name: 'posesión', weight: 2 });
        } else if ((100 - stats.possessionHome) > this.thresholds.nextGoal.possession) {
            awayFactors.push({ name: 'posesión', weight: 2 });
        }

        // 2. Factor de tiros a puerta
        if (stats.shotsOnTargetHome > stats.shotsOnTargetAway + this.thresholds.nextGoal.shotsAdvantage) {
            homeFactors.push({ name: 'tiros', weight: 3 });
        } else if (stats.shotsOnTargetAway > stats.shotsOnTargetHome + this.thresholds.nextGoal.shotsAdvantage) {
            awayFactors.push({ name: 'tiros', weight: 3 });
        }

        // 3. Factor de córners
        if (stats.cornersHome > stats.cornersAway + this.thresholds.nextGoal.cornersAdvantage) {
            homeFactors.push({ name: 'córners', weight: 1 });
        } else if (stats.cornersAway > stats.cornersHome + this.thresholds.nextGoal.cornersAdvantage) {
            awayFactors.push({ name: 'córners', weight: 1 });
        }

        // 4. Análisis de eventos recientes
        const recentEvents = this.extractRecentEvents(matchData);

        if (recentEvents.homeAttacking > this.thresholds.nextGoal.momentumThreshold) {
            homeFactors.push({ name: 'momentum', weight: 2 });
        } else if (recentEvents.awayAttacking > this.thresholds.nextGoal.momentumThreshold) {
            awayFactors.push({ name: 'momentum', weight: 2 });
        }

        // 5. Calcular probabilidades según factores acumulados
        const homeTotalWeight = homeFactors.reduce((sum, factor) => sum + factor.weight, 0);
        const awayTotalWeight = awayFactors.reduce((sum, factor) => sum + factor.weight, 0);
        const totalWeight = homeTotalWeight + awayTotalWeight;

        let homeProbability = 0.5; // Base neutral
        let confidence = this.baseConfidence.nextGoal;

        if (totalWeight > 0) {
            // Ajustar probabilidad según pesos acumulados
            homeProbability = 0.5 + ((homeTotalWeight - awayTotalWeight) / (totalWeight * 2));

            // Ajustar confianza según cantidad de factores
            const totalFactors = homeFactors.length + awayFactors.length;
            confidence = Math.min(0.9, this.baseConfidence.nextGoal + (totalFactors * 0.05));
        }

        // Limitar a rango válido
        homeProbability = Math.max(0.1, Math.min(0.9, homeProbability));

        return {
            probability: homeProbability, // Probabilidad para el equipo local
            confidence
        };
    }

    /**
     * Evalúa mercados over/under
     * @param {Object} matchData - Datos del partido
     * @param {number} threshold - Umbral (0.5, 1.5, 2.5)
     * @returns {Object} - Resultado {probability, confidence}
     */
    evaluateOver(matchData, threshold) {
        // Extraer datos relevantes
        const minute = matchData.minute || 0;
        const scoreHome = matchData.score?.home || 0;
        const scoreAway = matchData.score?.away || 0;
        const totalGoals = scoreHome + scoreAway;

        // Si ya se superó el umbral, probabilidad máxima
        if (totalGoals > threshold) {
            return { probability: 1.0, confidence: 1.0 };
        }

        // Extraer estadísticas
        const stats = this.extractStatistics(matchData);

        // Goles necesarios para superar umbral
        const goalsNeeded = Math.ceil(threshold - totalGoals);

        // Determinar fase del partido
        let phaseFactor;
        if (minute <= 30) phaseFactor = this.thresholds.over.minuteFactors.early;
        else if (minute <= 60) phaseFactor = this.thresholds.over.minuteFactors.middle;
        else phaseFactor = this.thresholds.over.minuteFactors.late;

        // Tiempo restante
        const minutesLeft = 90 - minute;

        // Factores favorables para over
        const overFactors = [];

        // 1. Ritmo de goles actual
        const currentRate = minute > 0 ? totalGoals / minute : 0;
        const projectedGoals = currentRate * 90;

        if (projectedGoals > threshold) {
            overFactors.push({ name: 'ritmo', weight: 3 });
        }

        // 2. Actividad ofensiva
        if (stats.totalShots > this.thresholds.over.highShotsThreshold) {
            overFactors.push({ name: 'tiros', weight: 2 });
        }

        if (stats.totalCorners > this.thresholds.over.highCornersThreshold) {
            overFactors.push({ name: 'córners', weight: 1 });
        }

        // 3. Tiempo restante vs. goles necesarios
        // Tiempo promedio esperado para un gol (en minutos)
        const avgTimePerGoal = 30;
        const timeNeeded = goalsNeeded * avgTimePerGoal;

        if (minutesLeft > timeNeeded * 1.5) {
            // Tiempo de sobra
            overFactors.push({ name: 'tiempo', weight: 2 });
        } else if (minutesLeft < timeNeeded * 0.5) {
            // Poco tiempo - factor negativo
            overFactors.push({ name: 'tiempo', weight: -3 });
        }

        // 4. Calcular probabilidad
        let baseProbability;

        if (threshold === 0.5) {
            // Over 0.5 tiene alta probabilidad base
            baseProbability = 0.75;
        } else if (threshold === 1.5) {
            // Over 1.5 tiene probabilidad base media
            baseProbability = 0.6;
        } else {
            // Over 2.5 tiene probabilidad base más baja
            baseProbability = 0.5;
        }

        // Ajustar por factores
        const totalWeight = overFactors.reduce((sum, factor) => sum + factor.weight, 0);
        const maxPossibleWeight = 8; // Suma máxima de pesos positivos

        // Ajuste de probabilidad
        let probability = baseProbability + (totalWeight / maxPossibleWeight) * 0.4;

        // Ajuste por fase temporal
        probability *= phaseFactor;

        // Ajuste final por tiempo restante vs. goles necesarios
        if (minutesLeft < goalsNeeded * 15) {
            // Penalización cuando queda muy poco tiempo para goles necesarios
            probability *= (minutesLeft / (goalsNeeded * 15));
        }

        // Limitar a rango válido
        probability = Math.max(0.05, Math.min(0.95, probability));

        // Confianza basada en cantidad de factores y tiempo transcurrido
        let confidence = this.baseConfidence[`over${threshold.toString().replace('.', '')}`];
        confidence += (Math.abs(totalWeight) / maxPossibleWeight) * 0.3;
        confidence += (minute / 90) * 0.2; // Mayor confianza conforme avanza el partido

        // Limitar confianza
        confidence = Math.max(0.2, Math.min(0.9, confidence));

        return { probability, confidence };
    }

    /**
     * Evalúa mercado BTTS (ambos equipos marcan)
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Resultado {probability, confidence}
     */
    evaluateBtts(matchData) {
        // Extraer datos relevantes
        const minute = matchData.minute || 0;
        const scoreHome = matchData.score?.home || 0;
        const scoreAway = matchData.score?.away || 0;

        // Estado actual de goles
        const homeScored = scoreHome > 0;
        const awayScored = scoreAway > 0;

        // Si ambos ya han marcado, probabilidad máxima
        if (homeScored && awayScored) {
            return { probability: 1.0, confidence: 1.0 };
        }

        // Extraer estadísticas
        const stats = this.extractStatistics(matchData);

        // Minutos restantes
        const minutesLeft = 90 - minute;

        // Factores favorables para BTTS
        const bttsFactors = [];

        // 1. Actividad ofensiva de ambos equipos
        if (stats.shotsOnTargetHome >= this.thresholds.btts.minShotsPerTeam) {
            bttsFactors.push({ name: 'tirosLocal', weight: 2 });
        }

        if (stats.shotsOnTargetAway >= this.thresholds.btts.minShotsPerTeam) {
            bttsFactors.push({ name: 'tirosVisitante', weight: 2 });
        }

        // 2. Avance del partido
        if (minute > 75) {
            // Poco tiempo restante - factor negativo
            bttsFactors.push({ name: 'tiempoRestante', weight: -3 });
        } else if (minute < 30) {
            // Mucho tiempo restante - factor positivo
            bttsFactors.push({ name: 'tiempoRestante', weight: 2 });
        }

        // 3. Equipo ya ha marcado
        if (homeScored || awayScored) {
            bttsFactors.push({ name: 'unEquipoYaMarcó', weight: 3 });
        }

        // 4. Calcular probabilidad
        let baseProbability = 0.5; // Base neutral
        const totalWeight = bttsFactors.reduce((sum, factor) => sum + factor.weight, 0);
        const maxPossibleWeight = 9; // Suma máxima de pesos positivos

        // Ajuste de probabilidad
        let probability = baseProbability + (totalWeight / maxPossibleWeight) * 0.4;

        // Ajuste por tiempo restante
        if (minute > 75) {
            probability *= this.thresholds.btts.lateGameFactor;
        }

        // Limitar a rango válido
        probability = Math.max(0.05, Math.min(0.95, probability));

        // Confianza basada en cantidad de factores y estado del partido
        let confidence = this.baseConfidence.btts;
        confidence += (Math.abs(totalWeight) / maxPossibleWeight) * 0.3;

        // Mayor confianza si un equipo ya marcó
        if (homeScored || awayScored) {
            confidence += 0.1;
        }

        // Limitar confianza
        confidence = Math.max(0.2, Math.min(0.9, confidence));

        return { probability, confidence };
    }

    /**
     * Evalúa mercado de próximo córner
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Resultado {probability, confidence}
     */
    evaluateCorner(matchData) {
        // Extraer datos relevantes
        const minute = matchData.minute || 0;

        // Extraer estadísticas
        const stats = this.extractStatistics(matchData);

        // Extraer eventos recientes
        const recentEvents = this.extractRecentEvents(matchData);

        // Factores favorables para córner
        const cornerFactors = [];

        // 1. Ritmo de córners en el partido
        const cornerRate = minute > 0 ? stats.totalCorners / minute : 0;

        if (cornerRate > this.thresholds.corner.cornerRateThreshold) {
            cornerFactors.push({ name: 'ritmoAlto', weight: 3 });
        }

        // 2. Presión ofensiva reciente
        const homeRecentPressure = recentEvents.recentShotsHome + recentEvents.recentCornersHome;
        const awayRecentPressure = recentEvents.recentShotsAway + recentEvents.recentCornersAway;
        const totalRecentPressure = homeRecentPressure + awayRecentPressure;

        if (totalRecentPressure > this.thresholds.corner.pressureThreshold) {
            cornerFactors.push({ name: 'presiónReciente', weight: 2 });
        }

        // 3. Fase del partido
        if ((minute > 35 && minute <= 45) || (minute > 80 && minute <= 90)) {
            // Final de cada parte - más córners
            cornerFactors.push({ name: 'faseFinal', weight: 2 });
        }

        // 4. Calcular probabilidad
        let baseProbability = 0.4; // Base para próximos 10 minutos
        const totalWeight = cornerFactors.reduce((sum, factor) => sum + factor.weight, 0);
        const maxPossibleWeight = 7; // Suma máxima de pesos positivos

        // Ajuste de probabilidad
        let probability = baseProbability + (totalWeight / maxPossibleWeight) * 0.5;

        // Ajuste basado en córner reciente (menos probable justo después de un córner)
        if (recentEvents.lastCornerMinute && minute - recentEvents.lastCornerMinute < 2) {
            probability *= 0.5;
        }

        // Limitar a rango válido
        probability = Math.max(0.1, Math.min(0.9, probability));

        // Confianza basada en cantidad de factores
        let confidence = this.baseConfidence.cornerNext10Min;
        confidence += (Math.abs(totalWeight) / maxPossibleWeight) * 0.3;

        // Limitar confianza
        confidence = Math.max(0.2, Math.min(0.8, confidence));

        return { probability, confidence };
    }

    /**
     * Extrae estadísticas básicas del partido
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Estadísticas extraídas
     */
    extractStatistics(matchData) {
        const stats = {
            possessionHome: 50,
            shotsOnTargetHome: 0,
            shotsOnTargetAway: 0,
            cornersHome: 0,
            cornersAway: 0,
            yellowCardsHome: 0,
            yellowCardsAway: 0,
            totalShots: 0,
            totalCorners: 0
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
     * Extrae eventos recientes para análisis
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Información de eventos recientes
     */
    extractRecentEvents(matchData) {
        const result = {
            recentCornersHome: 0,
            recentCornersAway: 0,
            recentShotsHome: 0,
            recentShotsAway: 0,
            recentCards: 0,
            homeAttacking: 0.5, // 0-1 (neutral = 0.5)
            awayAttacking: 0.5, // 0-1 (neutral = 0.5)
            lastCornerMinute: null
        };

        if (!matchData.events || !matchData.events.length) {
            return result;
        }

        try {
            const currentMinute = matchData.minute || 0;

            // Considerar eventos de los últimos 15 minutos
            const recentEvents = matchData.events.filter(event => {
                const eventMinute = event.time?.elapsed || 0;
                return currentMinute - eventMinute <= 15;
            });

            // Track último córner
            const cornerEvents = matchData.events.filter(event => event.type === 'Corner');
            if (cornerEvents.length > 0) {
                const lastCorner = cornerEvents[cornerEvents.length - 1];
                result.lastCornerMinute = lastCorner.time?.elapsed || null;
            }

            // Contar eventos recientes por equipo
            let homePositiveEvents = 0;
            let awayPositiveEvents = 0;

            recentEvents.forEach(event => {
                const isHomeTeam = event.team?.id === matchData.teams?.home?.id;

                // Contar tipos de eventos
                if (event.type === 'Goal') {
                    if (isHomeTeam) {
                        result.recentShotsHome++;
                        homePositiveEvents += 3;
                    } else {
                        result.recentShotsAway++;
                        awayPositiveEvents += 3;
                    }
                } else if (event.type === 'Card') {
                    result.recentCards++;
                    // Tarjeta es negativa para quien la recibe
                    if (isHomeTeam) {
                        awayPositiveEvents += 1;
                    } else {
                        homePositiveEvents += 1;
                    }
                } else if (event.type === 'Corner') {
                    if (isHomeTeam) {
                        result.recentCornersHome++;
                        homePositiveEvents += 1;
                    } else {
                        result.recentCornersAway++;
                        awayPositiveEvents += 1;
                    }
                } else if (event.detail === 'Shot on Goal') {
                    if (isHomeTeam) {
                        result.recentShotsHome++;
                        homePositiveEvents += 1;
                    } else {
                        result.recentShotsAway++;
                        awayPositiveEvents += 1;
                    }
                }
            });

            // Calcular indicadores de ataque/momentum
            const totalEvents = homePositiveEvents + awayPositiveEvents;
            if (totalEvents > 0) {
                result.homeAttacking = homePositiveEvents / totalEvents;
                result.awayAttacking = awayPositiveEvents / totalEvents;
            }

            return result;
        } catch (error) {
            logger.error(`Error extrayendo eventos recientes: ${error.message}`);
            return result;
        }
    }

    /**
     * Predice resultado para potencial general de momento dorado
     * Usado por match-selector para priorizar partidos
     * @param {Object} match - Datos del partido
     * @returns {Object} - Predicción {score}
     */
    predictPotential(match) {
        try {
            let potentialScore = 5; // Base neutral (0-10)

            // 1. Partidos en vivo tienen más potencial que los programados
            const isLive = match.fixture?.status?.short === '1H' ||
                match.fixture?.status?.short === '2H' ||
                match.fixture?.status?.short === 'HT';

            if (isLive) {
                potentialScore += 2; // Bonus por estar en vivo
            } else {
                potentialScore -= 1; // Penalización leve por no haber comenzado
            }

            // 2. Fase del partido (ciertos minutos tienen más potencial)
            const minute = match.fixture?.status?.elapsed || 0;
            if (minute > 75) potentialScore += 1;    // Últimos 15 minutos
            else if (minute > 60) potentialScore += 0.5; // Último tercio

            // 3. Resultado ajustado = mayor potencial
            if (match.goals) {
                const goalDiff = Math.abs((match.goals.home || 0) - (match.goals.away || 0));
                if (goalDiff <= 1) potentialScore += 1; // Partido ajustado
            }

            // Normalizar a escala 0-1 para devolver
            return {
                score: Math.max(0, Math.min(10, potentialScore)) / 10
            };
        } catch (error) {
            logger.error(`Error prediciendo potencial: ${error.message}`);
            return { score: 0.5 }; // Valor neutro por defecto
        }
    }
}

module.exports = new RuleEngine();