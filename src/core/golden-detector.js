/**
 * Motor de Detección de Momentos Dorados
 * Analiza partidos en tiempo real para detectar oportunidades de apuestas
 * utilizando modelos de ML y reglas heurísticas
 */
const tf = require('@tensorflow/tfjs-node');
const apiService = require('../api/api-service');
const predictor = require('../ml/predictor');
const featureExtractor = require('../ml/feature-extractor');
const ruleEngine = require('../ml/rule-engine');
const matchRepo = require('../db/repositories/match-repo');
const teamRepo = require('../db/repositories/team-repo');
const logger = require('../utils/logger');
const oddsCalculator = require('../utils/odds-calculator');

class GoldenMomentDetector {
    constructor() {
        // Mercados soportados para análisis
        this.markets = [
            'nextGoal',    // Próximo gol
            'over05',      // Más de 0.5 goles 
            'over15',      // Más de 1.5 goles
            'over25',      // Más de 2.5 goles
            'btts',        // Ambos equipos marcan
            'cornerNext10Min' // Córner en próximos 10 minutos
        ];

        // Umbrales de confianza por plan
        this.confidenceThresholds = {
            free: 0.85,      // Solo alertas de muy alta confianza
            insider: 0.75,   // Alertas de alta confianza
            estratega: 0.65  // Incluye alertas de confianza media-alta
        };

        // Valor mínimo esperado (EV) para considerar una oportunidad
        this.minExpectedValue = 0.10; // 10% de valor mínimo

        // Cargar modelos de ML
        this.modelsLoaded = false;
        this.loadModels();
    }

    /**
     * Cargar modelos de ML para cada mercado
     */
    async loadModels() {
        try {
            // Para MVP, no bloqueamos esperando modelos
            // Los cargamos en segundo plano y usamos reglas mientras tanto
            this.modelsLoaded = false;
            logger.info('Cargando modelos de ML...');

            // Señalar a predictor que cargue los modelos
            await predictor.loadModels();

            this.modelsLoaded = true;
            logger.info('Modelos de ML cargados correctamente');
        } catch (error) {
            logger.error(`Error cargando modelos de ML: ${error.message}`);
            logger.warn('Utilizando sistema de reglas como fallback');
        }
    }

    /**
     * Detectar momento dorado en un partido
     * @param {string} matchId - ID del partido
     * @param {string} userPlan - Plan del usuario (determina umbral de confianza)
     * @returns {Object|null} - Momento dorado o null si no se detecta
     */
    async detectGoldenMoment(matchId, userPlan = 'free') {
        try {
            // 1. Obtener datos actualizados del partido
            const matchData = await this.getMatchLiveData(matchId);
            if (!matchData) {
                logger.warn(`No se pudieron obtener datos en vivo para partido ${matchId}`);
                return null;
            }

            // 2. Analizar oportunidades en todos los mercados
            const opportunities = await this.evaluateAllMarkets(matchData);

            // 3. Filtrar según umbral de confianza del plan
            const filteredOpportunities = this.filterByConfidence(opportunities, userPlan);

            // 4. Seleccionar la mejor oportunidad (si existe)
            if (filteredOpportunities.length === 0) {
                return null;
            }

            // Ordenar por valor esperado y tomar la mejor
            filteredOpportunities.sort((a, b) =>
                b.prediction.expectedValue - a.prediction.expectedValue
            );

            const bestOpportunity = filteredOpportunities[0];

            // 5. Enriquecer con contexto
            const enrichedOpportunity = await this.enrichWithContext(bestOpportunity);

            return enrichedOpportunity;
        } catch (error) {
            logger.error(`Error detectando momento dorado para partido ${matchId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener datos en vivo del partido combinando múltiples fuentes
     * @param {string} matchId - ID del partido
     * @returns {Object|null} - Datos del partido o null si no se pueden obtener
     */
    async getMatchLiveData(matchId) {
        try {
            // 1. Verificar si tenemos el partido en la base de datos
            let matchData = await matchRepo.getMatchById(matchId);

            // 2. Obtener información básica actualizada
            const matchInfo = await apiService.getMatchInfo(matchId);
            if (!matchInfo) {
                logger.warn(`No se pudo obtener información básica del partido ${matchId}`);
                return matchData; // Usar datos de cache si no podemos actualizar
            }

            // 3. Obtener estadísticas en vivo
            const matchStats = await apiService.getMatchStats(matchId);

            // 4. Obtener eventos recientes
            const matchEvents = await apiService.getMatchEvents(matchId);

            // 5. Obtener cuotas actuales
            const matchOdds = await apiService.getMatchOdds(matchId);

            // 6. Combinar toda la información
            const combinedData = {
                id: matchId,
                externalId: matchId, // Mantener consistencia para BD
                info: matchInfo,
                teams: matchInfo ? {
                    home: {
                        id: matchInfo.teams.home.id,
                        name: matchInfo.teams.home.name
                    },
                    away: {
                        id: matchInfo.teams.away.id,
                        name: matchInfo.teams.away.name
                    }
                } : (matchData ? matchData.teams : null),
                league: matchInfo ? {
                    id: matchInfo.league.id,
                    name: matchInfo.league.name,
                    country: matchInfo.league.country
                } : (matchData ? matchData.league : null),
                fixture: matchInfo ? {
                    date: matchInfo.fixture.date,
                    status: matchInfo.fixture.status
                } : (matchData ? matchData.fixture : null),
                minute: matchInfo ? matchInfo.fixture.status.elapsed : (matchData ? matchData.minute : 0),
                score: {
                    home: matchInfo ? (matchInfo.goals.home || 0) : (matchData ? matchData.score.home : 0),
                    away: matchInfo ? (matchInfo.goals.away || 0) : (matchData ? matchData.score.away : 0)
                },
                statistics: matchStats || (matchData ? matchData.statistics : null),
                events: matchEvents || (matchData ? matchData.events : null),
                odds: matchOdds || (matchData ? matchData.odds : null),
                timestamp: Date.now()
            };

            // 7. Guardar datos combinados en la base de datos
            await matchRepo.saveMatch(combinedData);

            return combinedData;
        } catch (error) {
            logger.error(`Error obteniendo datos en vivo para partido ${matchId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Evaluar todos los mercados para detectar oportunidades
     * @param {Object} matchData - Datos del partido
     * @returns {Array} - Lista de oportunidades detectadas
     */
    async evaluateAllMarkets(matchData) {
        const opportunities = [];

        // Evaluar cada mercado
        for (const market of this.markets) {
            try {
                // 1. Obtener predicción para este mercado
                const prediction = await this.predictMarket(market, matchData);
                if (!prediction) continue;

                // 2. Obtener cuota para este mercado
                const odds = this.getOddsForMarket(market, matchData);
                if (!odds) continue;

                // 3. Calcular valor esperado
                const expectedValue = oddsCalculator.calculateExpectedValue(
                    prediction.probability,
                    odds
                );

                // 4. Si hay valor positivo significativo, considerar como oportunidad
                if (expectedValue >= this.minExpectedValue) {
                    opportunities.push({
                        market,
                        matchId: matchData.id,
                        teams: matchData.teams,
                        minute: matchData.minute,
                        score: matchData.score,
                        prediction: {
                            probability: prediction.probability,
                            confidence: prediction.confidence,
                            expectedValue
                        },
                        odds
                    });
                }
            } catch (error) {
                logger.error(`Error evaluando mercado ${market}: ${error.message}`);
            }
        }

        return opportunities;
    }

    /**
     * Predecir resultado para un mercado específico
     * @param {string} market - Mercado a predecir
     * @param {Object} matchData - Datos del partido
     * @returns {Object|null} - Predicción {probability, confidence} o null
     */
    async predictMarket(market, matchData) {
        try {
            // Usar predictor (ML o reglas)
            return await predictor.predict(market, matchData);
        } catch (error) {
            logger.error(`Error en predicción para ${market}: ${error.message}`);
            // Fallback a reglas en caso de error
            return ruleEngine.evaluate(market, matchData);
        }
    }

    /**
     * Obtener cuotas para un mercado específico
     * @param {string} market - Mercado a consultar
     * @param {Object} matchData - Datos del partido
     * @returns {Object|null} - Información de cuotas o null
     */
    getOddsForMarket(market, matchData) {
        if (!matchData.odds || !matchData.odds.bookmakers) {
            return null;
        }

        // Mapeo de mercados a nombres/tipos en APIs
        const marketMapping = {
            'nextGoal': { key: 'next_goal', outcome: 'Home' },
            'over05': { key: 'goals_over_under', point: 0.5, outcome: 'Over' },
            'over15': { key: 'goals_over_under', point: 1.5, outcome: 'Over' },
            'over25': { key: 'goals_over_under', point: 2.5, outcome: 'Over' },
            'btts': { key: 'btts', outcome: 'Yes' },
            'cornerNext10Min': { key: 'next_corner', outcome: 'Home' }
        };

        const mapping = marketMapping[market];
        if (!mapping) return null;

        // Buscar el mejor precio entre todas las casas de apuestas
        let bestOdds = null;
        let bookmakers = [];

        for (const bookie of matchData.odds.bookmakers) {
            const marketData = bookie.markets.find(m => m.key === mapping.key);

            if (marketData && marketData.outcomes) {
                let outcome;

                if (mapping.point !== undefined) {
                    // Para mercados con punto específico (over/under)
                    outcome = marketData.outcomes.find(o =>
                        o.name === mapping.outcome && o.point === mapping.point
                    );
                } else {
                    // Para mercados sin punto
                    outcome = marketData.outcomes.find(o => o.name === mapping.outcome);
                }

                if (outcome && outcome.price) {
                    bookmakers.push({
                        name: bookie.name,
                        value: outcome.price
                    });

                    // Actualizar mejor cuota
                    if (!bestOdds || outcome.price > bestOdds) {
                        bestOdds = outcome.price;
                    }
                }
            }
        }

        if (!bestOdds) return null;

        return {
            value: bestOdds,
            bookmakers
        };
    }

    /**
     * Filtrar oportunidades según umbral de confianza del plan
     * @param {Array} opportunities - Lista de oportunidades
     * @param {string} userPlan - Plan del usuario
     * @returns {Array} - Oportunidades filtradas
     */
    filterByConfidence(opportunities, userPlan) {
        // Obtener umbral según plan (o valor por defecto)
        const threshold = this.confidenceThresholds[userPlan] || this.confidenceThresholds.free;

        // Filtrar por umbral de confianza
        return opportunities.filter(opportunity =>
            opportunity.prediction.confidence >= threshold
        );
    }

    /**
     * Enriquecer oportunidad con contexto relevante
     * @param {Object} opportunity - Oportunidad detectada
     * @returns {Object} - Oportunidad enriquecida con contexto
     */
    async enrichWithContext(opportunity) {
        try {
            // Obtener datos completos del partido
            const matchData = await matchRepo.getMatchById(opportunity.matchId);
            if (!matchData) return opportunity;

            // Generar contexto según el mercado
            const context = await this.generateContext(opportunity, matchData);

            // Añadir contexto a la oportunidad
            return {
                ...opportunity,
                context
            };
        } catch (error) {
            logger.error(`Error enriqueciendo contexto: ${error.message}`);
            // Añadir contexto mínimo si hay error
            return {
                ...opportunity,
                context: [
                    `Partido: ${opportunity.teams.home.name} vs ${opportunity.teams.away.name}`,
                    `Minuto: ${opportunity.minute}`,
                    `Resultado: ${opportunity.score.home} - ${opportunity.score.away}`
                ]
            };
        }
    }

    /**
     * Generar contexto explicativo para una oportunidad
     * @param {Object} opportunity - Oportunidad detectada
     * @param {Object} matchData - Datos completos del partido
     * @returns {Array} - Lista de mensajes de contexto
     */
    async generateContext(opportunity, matchData) {
        const { market, teams, minute, score, prediction } = opportunity;
        const context = [];

        // Línea base: datos del partido
        context.push(`${teams.home.name} ${score.home} - ${score.away} ${teams.away.name} (Min ${minute})`);

        // Extraer estadísticas clave
        const stats = this.extractKeyStats(matchData);

        // Contexto específico por mercado
        switch (market) {
            case 'nextGoal':
                return this.generateNextGoalContext(opportunity, matchData, stats, context);

            case 'over05':
            case 'over15':
            case 'over25':
                return this.generateOverContext(opportunity, matchData, stats, context, market);

            case 'btts':
                return this.generateBttsContext(opportunity, matchData, stats, context);

            case 'cornerNext10Min':
                return this.generateCornerContext(opportunity, matchData, stats, context);

            default:
                // Contexto genérico si no hay específico
                context.push(`Probabilidad calculada: ${Math.round(prediction.probability * 100)}%`);
                context.push(`Índice de confianza: ${(prediction.confidence * 10).toFixed(1)}/10`);
                return context;
        }
    }

    /**
     * Extraer estadísticas clave del partido
     * @param {Object} matchData - Datos del partido
     * @returns {Object} - Estadísticas relevantes
     */
    extractKeyStats(matchData) {
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
            stats.shotsPerMin = stats.totalShots / Math.max(1, matchData.minute);
            stats.cornersPerMin = stats.totalCorners / Math.max(1, matchData.minute);

            return stats;
        } catch (error) {
            logger.error(`Error extrayendo estadísticas: ${error.message}`);
            return stats;
        }
    }

    /**
     * Generar contexto para mercado de próximo gol
     */
    generateNextGoalContext(opportunity, matchData, stats, baseContext) {
        const { teams, prediction, minute } = opportunity;
        const context = [...baseContext];

        // Determinar equipo favorecido
        const favTeam = prediction.probability > 0.5 ? teams.home.name : teams.away.name;
        const otherTeam = prediction.probability > 0.5 ? teams.away.name : teams.home.name;

        if (prediction.probability > 0.5) {
            // Contexto para equipo local
            context.push(`${teams.home.name} tiene ${stats.possessionHome}% de posesión`);
            context.push(`${stats.shotsOnTargetHome} tiros a puerta vs ${stats.shotsOnTargetAway} del rival`);

            if (stats.cornersHome > stats.cornersAway) {
                context.push(`Dominio en córners: ${stats.cornersHome} vs ${stats.cornersAway}`);
            }
        } else {
            // Contexto para equipo visitante
            context.push(`${teams.away.name} tiene ${stats.possessionAway}% de posesión`);
            context.push(`${stats.shotsOnTargetAway} tiros a puerta vs ${stats.shotsOnTargetHome} del rival`);

            if (stats.cornersAway > stats.cornersHome) {
                context.push(`Dominio en córners: ${stats.cornersAway} vs ${stats.cornersHome}`);
            }
        }

        // Análisis de momentum reciente
        const recentEvents = this.analyzeRecentEvents(matchData, favTeam);
        if (recentEvents.momentum > 0.5) {
            context.push(`Momentum favorable en los últimos minutos`);
        }

        if (recentEvents.recentCorners > 2) {
            context.push(`${recentEvents.recentCorners} córners en los últimos 15 minutos`);
        }

        if (recentEvents.recentShots > 2) {
            context.push(`${recentEvents.recentShots} disparos recientes`);
        }

        // Fase del partido
        if (minute > 75) {
            context.push(`Fase crítica del partido: últimos minutos`);
        } else if (minute > 60) {
            context.push(`Etapa avanzada del partido`);
        }

        // Histórico (simulado, en producción vendría de BD)
        context.push(`Históricamente, ${favTeam} marca el ${Math.round(prediction.probability * 100)}% de las veces en contextos similares`);

        return context;
    }

    /**
     * Generar contexto para mercados over/under
     */
    generateOverContext(opportunity, matchData, stats, baseContext, market) {
        const { prediction, minute, score } = opportunity;
        const context = [...baseContext];

        // Extraer umbral de goles
        let threshold = 0.5;
        if (market === 'over15') threshold = 1.5;
        if (market === 'over25') threshold = 2.5;

        // Calcular goles actuales y necesarios
        const currentGoals = score.home + score.away;
        const neededGoals = Math.max(0, Math.ceil(threshold - currentGoals));

        // Información base
        context.push(`Total de goles actual: ${currentGoals}`);
        context.push(`Se necesitan ${neededGoals} gol(es) más para superar la línea de ${threshold}`);

        // Estadísticas ofensivas
        context.push(`Total de tiros a puerta: ${stats.shotsOnTargetHome + stats.shotsOnTargetAway}`);

        // Ritmo del partido
        const goalRate = (currentGoals / Math.max(1, minute)) * 90;
        context.push(`Ritmo actual: ${goalRate.toFixed(1)} goles por partido completo`);

        // Actividad ofensiva
        if (stats.totalCorners > 8) {
            context.push(`Alta actividad ofensiva: ${stats.totalCorners} córners en el partido`);
        }

        if (stats.shotsPerMin > 0.2) { // Más de 1 tiro cada 5 minutos
            context.push(`Ritmo ofensivo superior al promedio`);
        }

        // Fase del partido
        const minutesLeft = 90 - minute;
        if (minutesLeft < 15) {
            context.push(`${minutesLeft} minutos restantes para conseguir ${neededGoals} gol(es)`);
        }

        // Histórico
        context.push(`Probabilidad histórica de ${Math.round(prediction.probability * 100)}% para superar los ${threshold} goles en partidos similares`);

        return context;
    }

    /**
     * Generar contexto para mercado BTTS (ambos equipos marcan)
     */
    generateBttsContext(opportunity, matchData, stats, baseContext) {
        const { teams, prediction, score, minute } = opportunity;
        const context = [...baseContext];

        // Estado actual de goles
        const homeScored = score.home > 0;
        const awayScored = score.away > 0;

        if (homeScored && awayScored) {
            context.push(`Ambos equipos ya han marcado`);
            context.push(`Predicción confirmada`);
            return context;
        }

        // Determinar equipo que falta por marcar
        const teamNeeded = !homeScored ? teams.home.name : teams.away.name;
        context.push(`${teamNeeded} necesita marcar para cumplir la predicción`);

        // Estadísticas del equipo que falta marcar
        if (!homeScored) {
            context.push(`${teams.home.name} tiene ${stats.possessionHome}% de posesión`);
            context.push(`${teams.home.name} ha realizado ${stats.shotsOnTargetHome} tiros a puerta`);
            context.push(`${teams.home.name} ha sacado ${stats.cornersHome} córners`);
        } else {
            context.push(`${teams.away.name} tiene ${stats.possessionAway}% de posesión`);
            context.push(`${teams.away.name} ha realizado ${stats.shotsOnTargetAway} tiros a puerta`);
            context.push(`${teams.away.name} ha sacado ${stats.cornersAway} córners`);
        }

        // Minutos restantes
        const minutesLeft = 90 - minute;
        context.push(`Quedan ${minutesLeft} minutos para que ${teamNeeded} consiga su gol`);

        // Histórico
        context.push(`Probabilidad de que ${teamNeeded} marque: ${Math.round(prediction.probability * 100)}% según histórico`);

        return context;
    }

    /**
     * Generar contexto para mercado de próximo córner
     */
    generateCornerContext(opportunity, matchData, stats, baseContext) {
        const { teams, prediction, minute } = opportunity;
        const context = [...baseContext];

        // Estadísticas de córners
        context.push(`Total de córners en el partido: ${stats.totalCorners}`);
        context.push(`Distribución de córners: ${teams.home.name} (${stats.cornersHome}) - ${teams.away.name} (${stats.cornersAway})`);

        // Ritmo de córners
        const cornerRate = stats.totalCorners / Math.max(1, minute);
        const expectedNext10Min = cornerRate * 10;
        context.push(`Ritmo actual: ${cornerRate.toFixed(2)} córners por minuto`);
        context.push(`Proyección: ${expectedNext10Min.toFixed(1)} córners en próximos 10 minutos`);

        // Fase ofensiva
        if (stats.possessionHome > 60) {
            context.push(`${teams.home.name} domina con ${stats.possessionHome}% de posesión`);
        } else if (stats.possessionAway > 60) {
            context.push(`${teams.away.name} domina con ${stats.possessionAway}% de posesión`);
        } else {
            context.push(`Posesión equilibrada: ${stats.possessionHome}% - ${stats.possessionAway}%`);
        }

        // Histórico
        context.push(`Probabilidad de córner próximos 10 min: ${Math.round(prediction.probability * 100)}%`);

        return context;
    }

    /**
     * Analizar eventos recientes del partido
     * @param {Object} matchData - Datos del partido
     * @param {string} favTeam - Nombre del equipo favorecido
     * @returns {Object} - Análisis de eventos recientes
     */
    analyzeRecentEvents(matchData, favTeam) {
        const result = {
            recentCorners: 0,
            recentShots: 0,
            recentCards: 0,
            momentum: 0.5 // 0-1, 0.5 neutral
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

            // Contadores por equipo
            let homePositiveEvents = 0;
            let awayPositiveEvents = 0;

            recentEvents.forEach(event => {
                const isHomeTeam = event.team?.name === matchData.teams.home.name;

                // Contar tipos de eventos
                if (event.type === 'Goal') {
                    if (isHomeTeam) homePositiveEvents += 3;
                    else awayPositiveEvents += 3;
                } else if (event.type === 'Card') {
                    result.recentCards++;
                    if (isHomeTeam) awayPositiveEvents += 1;
                    else homePositiveEvents += 1;
                } else if (event.type === 'Corner') {
                    result.recentCorners++;
                    if (isHomeTeam) homePositiveEvents += 1;
                    else awayPositiveEvents += 1;
                } else if (event.type === 'subst') {
                    // Sustituciones no afectan momentum
                } else {
                    // Otros eventos (disparos, etc)
                    result.recentShots++;
                    if (isHomeTeam) homePositiveEvents += 0.5;
                    else awayPositiveEvents += 0.5;
                }
            });

            // Calcular momentum (0-1)
            const totalEvents = homePositiveEvents + awayPositiveEvents;
            if (totalEvents > 0) {
                // Si equipo favorecido es local
                if (favTeam === matchData.teams.home.name) {
                    result.momentum = homePositiveEvents / totalEvents;
                } else {
                    result.momentum = awayPositiveEvents / totalEvents;
                }
            }

            return result;
        } catch (error) {
            logger.error(`Error analizando eventos recientes: ${error.message}`);
            return result;
        }
    }
}

module.exports = new GoldenMomentDetector();