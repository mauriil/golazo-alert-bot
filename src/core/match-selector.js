/**
 * Selector de Partidos para Monitoreo
 * Selecciona los partidos más relevantes para monitorear según criterios
 * combinados de popularidad y potencial de oportunidades
 */
const apiService = require('../api/api-service');
const predictor = require('../ml/predictor');
const ruleEngine = require('../ml/rule-engine');
const matchRepo = require('../db/repositories/match-repo');
const teamRepo = require('../db/repositories/team-repo');
const logger = require('../utils/logger');

class MatchSelector {
    constructor() {
        // Límites de partidos por plan
        this.planLimits = {
            free: 3,       // 3 partidos/día
            insider: 8,    // 8 partidos/día
            estratega: 15  // 15 partidos/día
        };

        // Factores de ponderación para modelo híbrido
        this.weights = {
            relevance: 0.7,   // 70% relevancia cultural/deportiva
            potential: 0.3    // 30% potencial de oportunidades
        };

        // Popularidad de equipos (simulación, en producción vendría de BD)
        this.teamPopularity = {
            // Equipos argentinos
            'Boca Juniors': 10,
            'River Plate': 10,
            'Independiente': 9,
            'Racing Club': 9,
            'San Lorenzo': 8,
            'Estudiantes': 7,
            'Vélez Sarsfield': 7,
            // Equipos internacionales
            'Barcelona': 9,
            'Real Madrid': 9,
            'Manchester United': 8,
            'Liverpool': 8,
            'Bayern Munich': 8,
            'Paris Saint Germain': 7,
            'Manchester City': 7,
            'Chelsea': 7,
            'Juventus': 7,
            'Inter': 6,
            'Milan': 6,
            'Atlético Madrid': 6,
            'Arsenal': 6,
            'Borussia Dortmund': 6
        };

        // Popularidad de ligas
        this.leaguePopularity = {
            // Nacionales
            'Primera División - Argentina': 10,
            'Liga Profesional Argentina': 10,
            // Internacionales élite
            'UEFA Champions League': 9,
            'Copa Libertadores': 9,
            'Premier League': 8,
            'LaLiga': 8,
            'Serie A': 7,
            'Bundesliga': 7,
            'Ligue 1': 6,
            'Copa Sudamericana': 8,
            // Otras relevantes
            'Copa Argentina': 9,
            'Europa League': 7,
            'FIFA World Cup': 10,
            'Copa América': 10,
            'UEFA European Championship': 9
        };
    }

    /**
     * Obtener todos los partidos disponibles
     * @returns {Array} - Lista de partidos disponibles
     */
    async getAvailableMatches() {
        try {
            // 1. Obtener partidos en vivo
            const liveMatches = await apiService.getLiveMatches();
            logger.info(`Obtenidos ${liveMatches?.length || 0} partidos en vivo`);

            // 2. Obtener partidos próximos a empezar (próximas 2 horas)
            const upcomingMatches = await apiService.getUpcomingMatches(2);
            logger.info(`Obtenidos ${upcomingMatches?.length || 0} partidos próximos`);

            // 3. Combinar resultados
            const allMatches = [
                ...(liveMatches || []),
                ...(upcomingMatches || [])
            ];

            // 4. Normalizar datos
            const normalizedMatches = allMatches.map(match => this.normalizeMatchData(match));

            // 5. Guardar en base de datos
            await this.saveMatchesToDb(normalizedMatches);

            return normalizedMatches;
        } catch (error) {
            logger.error(`Error obteniendo partidos disponibles: ${error.message}`);

            // Fallback: intentar recuperar de la base de datos
            logger.info('Intentando recuperar partidos desde la base de datos');
            return this.getMatchesFromDb();
        }
    }

    /**
     * Normalizar datos del partido
     * @param {Object} match - Datos crudos del partido
     * @returns {Object} - Datos normalizados
     */
    normalizeMatchData(match) {
        try {
            return {
                id: match.fixture?.id?.toString() || match.id?.toString(),
                externalId: match.fixture?.id?.toString() || match.id?.toString(),
                league: {
                    id: match.league?.id,
                    name: match.league?.name,
                    country: match.league?.country
                },
                teams: {
                    home: {
                        id: match.teams?.home?.id,
                        name: match.teams?.home?.name
                    },
                    away: {
                        id: match.teams?.away?.id,
                        name: match.teams?.away?.name
                    }
                },
                fixture: {
                    date: match.fixture?.date,
                    status: match.fixture?.status
                },
                // Más campos según sea necesario
            };
        } catch (error) {
            logger.error(`Error normalizando datos: ${error.message}`);
            return match; // Devolver original si falla
        }
    }

    /**
     * Guardar partidos en la base de datos
     * @param {Array} matches - Lista de partidos
     */
    async saveMatchesToDb(matches) {
        try {
            const savePromises = matches.map(match =>
                matchRepo.saveMatch(match)
            );

            await Promise.all(savePromises);
            logger.info(`${matches.length} partidos guardados en la base de datos`);
        } catch (error) {
            logger.error(`Error guardando partidos en BD: ${error.message}`);
        }
    }

    /**
     * Obtener partidos desde la base de datos
     */
    async getMatchesFromDb() {
        try {
            // Obtener partidos en vivo y próximos de la BD
            const liveMatches = await matchRepo.getLiveMatches();
            const upcomingMatches = await matchRepo.getUpcomingMatches(2); // próximas 2 horas

            return [...liveMatches, ...upcomingMatches];
        } catch (error) {
            logger.error(`Error recuperando partidos de BD: ${error.message}`);
            return [];
        }
    }

    /**
     * Seleccionar partidos para monitoreo según plan de usuario
     * @param {string} userPlan - Plan del usuario (free, insider, estratega)
     * @returns {Array} - Lista de partidos seleccionados para monitoreo
     */
    async selectMatchesToMonitor(userPlan = 'free') {
        try {
            // 1. Obtener todos los partidos disponibles
            const availableMatches = await this.getAvailableMatches();
            if (!availableMatches.length) {
                logger.warn('No hay partidos disponibles para monitorear');
                return [];
            }

            logger.info(`Evaluando ${availableMatches.length} partidos disponibles`);

            // 2. Calcular scores para cada partido
            const matchesWithScores = await Promise.all(
                availableMatches.map(async match => {
                    // Calcular score de relevancia (popularidad)
                    const relevanceScore = await this.calculateRelevanceScore(match);

                    // Calcular score de potencial (oportunidades)
                    const potentialScore = await this.calculatePotentialScore(match);

                    // Score final: combinación ponderada
                    const finalScore = (
                        relevanceScore * this.weights.relevance +
                        potentialScore * this.weights.potential
                    );

                    return {
                        ...match,
                        scores: {
                            relevance: relevanceScore,
                            potential: potentialScore,
                            final: finalScore
                        }
                    };
                })
            );

            // 3. Ordenar por score final
            const sortedMatches = matchesWithScores.sort((a, b) =>
                b.scores.final - a.scores.final
            );

            // 4. Seleccionar según límite del plan
            const limit = this.planLimits[userPlan] || this.planLimits.free;
            const selectedMatches = sortedMatches.slice(0, limit);

            logger.info(`Seleccionados ${selectedMatches.length} partidos para plan ${userPlan}`);

            return selectedMatches;
        } catch (error) {
            logger.error(`Error seleccionando partidos: ${error.message}`);
            return [];
        }
    }

    /**
     * Calcular score de relevancia (basado en criterios culturales/deportivos)
     * @param {Object} match - Datos del partido
     * @returns {number} - Score de relevancia (0-10)
     */
    async calculateRelevanceScore(match) {
        try {
            let score = 0;

            // 1. Popularidad de la liga
            const leagueName = match.league?.name || '';
            const leagueCountry = match.league?.country || '';
            const leagueKey = `${leagueName}${leagueCountry ? ' - ' + leagueCountry : ''}`;

            // Buscar coincidencia exacta o parcial
            let leagueScore = this.leaguePopularity[leagueKey] || 0;
            if (leagueScore === 0) {
                // Buscar coincidencia parcial
                Object.entries(this.leaguePopularity).forEach(([name, value]) => {
                    if (leagueKey.includes(name) || name.includes(leagueKey)) {
                        leagueScore = Math.max(leagueScore, value);
                    }
                });
            }

            // Ajustar por país (Argentina tiene prioridad)
            if (leagueCountry === 'Argentina') {
                leagueScore = Math.max(leagueScore, 8); // Mínimo 8 para ligas argentinas
            }

            score += leagueScore * 0.5; // Liga contribuye 50% a la relevancia

            // 2. Popularidad de los equipos
            const homeTeamName = match.teams?.home?.name || '';
            const awayTeamName = match.teams?.away?.name || '';

            let homeTeamScore = 0;
            let awayTeamScore = 0;

            // Buscar coincidencia exacta o parcial para equipo local
            for (const [teamName, popularity] of Object.entries(this.teamPopularity)) {
                if (homeTeamName === teamName || homeTeamName.includes(teamName) || teamName.includes(homeTeamName)) {
                    homeTeamScore = Math.max(homeTeamScore, popularity);
                }
            }

            // Buscar coincidencia exacta o parcial para equipo visitante
            for (const [teamName, popularity] of Object.entries(this.teamPopularity)) {
                if (awayTeamName === teamName || awayTeamName.includes(teamName) || teamName.includes(awayTeamName)) {
                    awayTeamScore = Math.max(awayTeamScore, popularity);
                }
            }

            // Combinar scores de equipos (el más popular tiene más peso)
            const teamsScore = Math.max(homeTeamScore, awayTeamScore) * 0.7 +
                Math.min(homeTeamScore, awayTeamScore) * 0.3;

            score += teamsScore * 0.4; // Equipos contribuyen 40% a la relevancia

            // 3. Estado del partido
            const matchStatus = match.fixture?.status?.short || '';

            // Partidos en vivo tienen mayor prioridad
            if (['1H', '2H', 'HT'].includes(matchStatus)) {
                score += 2; // Bonus por estar en vivo

                // Fase final del partido aún más prioritaria
                if (matchStatus === '2H' && match.fixture?.status?.elapsed > 75) {
                    score += 1; // Bonus adicional para últimos 15 minutos
                }
            }

            // Normalizar a escala 0-10
            return Math.min(10, score);
        } catch (error) {
            logger.error(`Error calculando relevancia: ${error.message}`);
            return 5; // Valor medio por defecto
        }
        /**
           * Calcular score de potencial (basado en probabilidad de oportunidades)
           * @param {Object} match - Datos del partido
           * @returns {number} - Score de potencial (0-10)
           */
    }

    async calculatePotentialScore(match) {
        try {
            // 1. Intentar usar modelo predictivo si está disponible
            try {
                const potentialPrediction = await predictor.predictPotential(match);
                if (potentialPrediction && typeof potentialPrediction.score === 'number') {
                    return potentialPrediction.score * 10; // Convertir a escala 0-10
                }
            } catch (error) {
                logger.warn(`Error en predicción de potencial con ML: ${error.message}`);
                // Continuar con reglas en caso de error con ML
            }

            // 2. Sistema de reglas como fallback
            return this.calculatePotentialWithRules(match);
        } catch (error) {
            logger.error(`Error calculando potencial: ${error.message}`);
            return 5; // Valor medio por defecto
        }
    }

    /**
     * Calcular potencial con sistema de reglas
     * @param {Object} match - Datos del partido
     * @returns {number} - Score de potencial (0-10)
     */
    async calculatePotentialWithRules(match) {
        try {
            let score = 5; // Valor base medio

            // 1. Partidos en vivo tienen más potencial que los programados
            const isLive = match.fixture?.status?.short === '1H' ||
                match.fixture?.status?.short === '2H' ||
                match.fixture?.status?.short === 'HT';

            if (isLive) {
                score += 2; // Bonus por estar en vivo
            } else {
                score -= 1; // Penalización leve por no haber comenzado
            }

            // 2. Calcular igualdad de fuerzas entre equipos
            const homeStrength = await this.getTeamStrength(match.teams?.home?.id);
            const awayStrength = await this.getTeamStrength(match.teams?.away?.id);

            // Equipos de fuerza similar tienen mayor potencial de momento dorado
            const strengthDiff = Math.abs(homeStrength - awayStrength);
            if (strengthDiff < 0.1) score += 2;       // Muy igualado
            else if (strengthDiff < 0.2) score += 1;  // Bastante igualado
            else if (strengthDiff > 0.4) score -= 1;  // Desigual

            // 3. Partidos con mayor volatilidad histórica
            const volatility = await this.getHistoricalVolatility(
                match.teams?.home?.id,
                match.teams?.away?.id
            );
            score += volatility * 3; // 0-1 → 0-3 puntos adicionales

            // 4. Para partidos en vivo, considerar estado actual
            if (isLive) {
                // Recuperar estadísticas si disponibles
                const matchData = await matchRepo.getMatchById(match.id);

                if (matchData) {
                    // Resultado ajustado = mayor potencial
                    const goalDiff = Math.abs(
                        (matchData.goals?.home || 0) - (matchData.goals?.away || 0)
                    );

                    if (goalDiff <= 1) score += 1; // Partido igualado

                    // Minuto avanzado = mayor potencial
                    const minute = matchData.fixture?.status?.elapsed || 0;
                    if (minute > 75) score += 1;    // Últimos 15 minutos
                    else if (minute > 60) score += 0.5; // Último tercio

                    // Alta actividad = mayor potencial
                    // Esto es una simplificación; en un sistema real analizaríamos más estadísticas
                    const totalCorners = this.extractTotalCorners(matchData);
                    const shotsOnTarget = this.extractShotsOnTarget(matchData);

                    if (totalCorners > 10 || shotsOnTarget > 8) {
                        score += 1; // Alta actividad
                    }
                }
            }

            // Normalizar a escala 0-10
            return Math.max(0, Math.min(10, score));
        } catch (error) {
            logger.error(`Error en cálculo con reglas: ${error.message}`);
            return 5; // Valor medio por defecto
        }
    }

    /**
     * Obtener fuerza estimada del equipo (0-1)
     * @param {number} teamId - ID del equipo
     * @returns {number} - Valor de fuerza (0-1)
     */
    async getTeamStrength(teamId) {
        if (!teamId) return 0.5; // Valor por defecto

        try {
            // Intentar obtener de base de datos
            const team = await teamRepo.getTeamById(teamId);
            if (team && typeof team.strength === 'number') {
                return team.strength;
            }

            // Fallback: valor por defecto con pequeña variación aleatoria
            // En producción, esto se calcularía con datos reales
            return 0.5 + (Math.random() * 0.2 - 0.1);
        } catch (error) {
            logger.error(`Error obteniendo fuerza del equipo: ${error.message}`);
            return 0.5;
        }
    }

    /**
     * Obtener volatilidad histórica entre dos equipos (0-1)
     * @param {number} homeTeamId - ID del equipo local
     * @param {number} awayTeamId - ID del equipo visitante
     * @returns {number} - Valor de volatilidad (0-1)
     */
    async getHistoricalVolatility(homeTeamId, awayTeamId) {
        if (!homeTeamId || !awayTeamId) return 0.5;

        try {
            // En un sistema real, esto vendría de un análisis de partidos históricos
            // Para MVP, usamos una simplificación

            // Verificar si tenemos datos históricos
            const h2hData = await matchRepo.getHeadToHeadMatches(homeTeamId, awayTeamId);

            if (h2hData && h2hData.length > 0) {
                // Calcular volatilidad basada en varianza de resultados
                // Esta es una simplificación para el ejemplo
                return Math.min(1, h2hData.length / 10);
            }

            // Fallback: valor por defecto con pequeña variación aleatoria
            return 0.5 + (Math.random() * 0.2 - 0.1);
        } catch (error) {
            logger.error(`Error obteniendo volatilidad histórica: ${error.message}`);
            return 0.5;
        }
    }

    /**
     * Extraer número total de córners de los datos del partido
     * @param {Object} matchData - Datos del partido
     * @returns {number} - Total de córners
     */
    extractTotalCorners(matchData) {
        if (!matchData.statistics || !matchData.statistics.length) {
            return 0;
        }

        try {
            let homeCorners = 0;
            let awayCorners = 0;

            // Buscar estadísticas de córners en equipo local
            const homeStats = matchData.statistics[0]?.statistics || [];
            const homeCornerStat = homeStats.find(stat => stat.type === 'Corner Kicks');
            if (homeCornerStat) {
                homeCorners = parseInt(homeCornerStat.value || '0');
            }

            // Buscar estadísticas de córners en equipo visitante
            const awayStats = matchData.statistics[1]?.statistics || [];
            const awayCornerStat = awayStats.find(stat => stat.type === 'Corner Kicks');
            if (awayCornerStat) {
                awayCorners = parseInt(awayCornerStat.value || '0');
            }

            return homeCorners + awayCorners;
        } catch (error) {
            logger.error(`Error extrayendo córners: ${error.message}`);
            return 0;
        }
    }

    /**
     * Extraer número total de tiros a puerta de los datos del partido
     * @param {Object} matchData - Datos del partido
     * @returns {number} - Total de tiros a puerta
     */
    extractShotsOnTarget(matchData) {
        if (!matchData.statistics || !matchData.statistics.length) {
            return 0;
        }

        try {
            let homeShotsOnTarget = 0;
            let awayShotsOnTarget = 0;

            // Buscar estadísticas de tiros a puerta en equipo local
            const homeStats = matchData.statistics[0]?.statistics || [];
            const homeShotsStat = homeStats.find(stat => stat.type === 'Shots on Goal');
            if (homeShotsStat) {
                homeShotsOnTarget = parseInt(homeShotsStat.value || '0');
            }

            // Buscar estadísticas de tiros a puerta en equipo visitante
            const awayStats = matchData.statistics[1]?.statistics || [];
            const awayShotsStat = awayStats.find(stat => stat.type === 'Shots on Goal');
            if (awayShotsStat) {
                awayShotsOnTarget = parseInt(awayShotsStat.value || '0');
            }

            return homeShotsOnTarget + awayShotsOnTarget;
        } catch (error) {
            logger.error(`Error extrayendo tiros a puerta: ${error.message}`);
            return 0;
        }
    }
}

module.exports = new MatchSelector();