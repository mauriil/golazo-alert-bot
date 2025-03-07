/**
 * Servicio Unificado de APIs
 * Integra los diferentes clientes de API y gestiona la caché y los límites
 * Proporciona una interfaz unificada para el resto del sistema
 */
const NodeCache = require('node-cache');
const footballApi = require('./football-api');
const oddsApi = require('./odds-api');
const logger = require('../utils/logger');
const apiConfig = require('../config/api-config');

class ApiService {
    constructor() {
        // Configuración de caché
        this.cache = new NodeCache({
            stdTTL: apiConfig.cache.defaultTtl || 60, // 60 segundos por defecto
            checkperiod: 120 // Revisar caducidad cada 2 minutos
        });

        // Configurar TTLs específicos para cada tipo de datos
        this.ttlConfig = {
            liveMatches: 30,                // 30 segundos para partidos en vivo
            upcomingMatches: 300,           // 5 minutos para partidos programados
            matchInfo: 60,                  // 1 minuto para info básica de partido
            matchStats: {
                default: 60,                  // 1 minuto por defecto
                firstHalf: 30,                // 30 segundos en primera parte
                secondHalf: 30,               // 30 segundos en segunda parte
                lastMinutes: 15               // 15 segundos en últimos minutos
            },
            matchEvents: {
                default: 60,                  // 1 minuto por defecto 
                duringMatch: 30               // 30 segundos durante el partido
            },
            matchOdds: {
                default: 120,                 // 2 minutos por defecto
                liveMatch: 60,                // 1 minuto durante partido en vivo
                criticalMoment: 30            // 30 segundos en momentos críticos
            },
            teams: 86400,                   // 24 horas para info de equipos
            leagues: 86400                  // 24 horas para info de ligas
        };

        // Contadores de uso de API
        this.apiUsage = {
            football: {
                daily: 0,
                resetTime: new Date().setHours(0, 0, 0, 0) + 24 * 60 * 60 * 1000
            },
            odds: {
                daily: 0,
                monthly: 0,
                resetTimes: {
                    daily: new Date().setHours(0, 0, 0, 0) + 24 * 60 * 60 * 1000,
                    monthly: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
                }
            }
        };

        // Mapa de IDs entre APIs
        this.idMappings = new Map();
    }

    /**
     * Obtener partidos en vivo
     * @returns {Promise<Array>} - Lista de partidos en vivo
     */
    async getLiveMatches() {
        const cacheKey = 'liveMatches';

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug('Usando partidos en vivo desde caché');
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const liveMatches = await footballApi.getLiveMatches();

            // Almacenar en caché solo si tenemos datos
            if (liveMatches && liveMatches.length > 0) {
                this.cache.set(cacheKey, liveMatches, this.ttlConfig.liveMatches);
            }

            return liveMatches || [];
        } catch (error) {
            logger.error(`Error en getLiveMatches: ${error.message}`);
            return [];
        }
    }

    /**
     * Obtener partidos programados para próximas horas
     * @param {number} hours - Número de horas a consultar
     * @returns {Promise<Array>} - Lista de partidos programados
     */
    async getUpcomingMatches(hours = 2) {
        const cacheKey = `upcomingMatches_${hours}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando partidos programados (${hours}h) desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const upcomingMatches = await footballApi.getUpcomingMatches(hours);

            // Almacenar en caché solo si tenemos datos
            if (upcomingMatches && upcomingMatches.length > 0) {
                this.cache.set(cacheKey, upcomingMatches, this.ttlConfig.upcomingMatches);
            }

            return upcomingMatches || [];
        } catch (error) {
            logger.error(`Error en getUpcomingMatches: ${error.message}`);
            return [];
        }
    }

    /**
     * Obtener información básica de un partido
     * @param {string|number} matchId - ID del partido
     * @returns {Promise<Object|null>} - Datos del partido
     */
    async getMatchInfo(matchId) {
        const cacheKey = `matchInfo_${matchId}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando info de partido ${matchId} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const matchInfo = await footballApi.getFixture(matchId);

            // Almacenar en caché solo si tenemos datos
            if (matchInfo) {
                // Determinar TTL según estado del partido
                let ttl = this.ttlConfig.matchInfo;
                if (matchInfo.fixture && matchInfo.fixture.status) {
                    const status = matchInfo.fixture.status.short;
                    // Menor TTL si el partido está en vivo
                    if (['1H', '2H', 'HT'].includes(status)) {
                        ttl = Math.min(ttl, 30); // 30 segundos máximo en vivo
                    }
                }

                this.cache.set(cacheKey, matchInfo, ttl);

                // Guardar mapeo de IDs si hay información suficiente
                if (matchInfo.teams && matchInfo.teams.home && matchInfo.teams.away) {
                    this.saveIdMapping(matchId, matchInfo);
                }
            }

            return matchInfo;
        } catch (error) {
            logger.error(`Error en getMatchInfo: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener estadísticas de un partido
     * @param {string|number} matchId - ID del partido
     * @returns {Promise<Object|null>} - Estadísticas del partido
     */
    async getMatchStats(matchId) {
        const cacheKey = `matchStats_${matchId}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando estadísticas de partido ${matchId} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const matchStats = await footballApi.getFixtureStatistics(matchId);

            // Determinar TTL según fase del partido
            let ttl = this.ttlConfig.matchStats.default;

            // Si tenemos información del partido, ajustar TTL según minuto
            const matchInfo = await this.getMatchInfo(matchId);
            if (matchInfo && matchInfo.fixture && matchInfo.fixture.status) {
                const status = matchInfo.fixture.status.short;
                const minute = matchInfo.fixture.status.elapsed || 0;

                if (status === '1H') {
                    ttl = this.ttlConfig.matchStats.firstHalf;
                } else if (status === '2H') {
                    ttl = this.ttlConfig.matchStats.secondHalf;

                    // Últimos minutos
                    if (minute > 75) {
                        ttl = this.ttlConfig.matchStats.lastMinutes;
                    }
                }
            }

            // Almacenar en caché solo si tenemos datos
            if (matchStats) {
                this.cache.set(cacheKey, matchStats, ttl);
            }

            return matchStats;
        } catch (error) {
            logger.error(`Error en getMatchStats: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener eventos de un partido
     * @param {string|number} matchId - ID del partido
     * @returns {Promise<Array|null>} - Lista de eventos
     */
    async getMatchEvents(matchId) {
        const cacheKey = `matchEvents_${matchId}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando eventos de partido ${matchId} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const matchEvents = await footballApi.getFixtureEvents(matchId);

            // Determinar TTL según estado del partido
            let ttl = this.ttlConfig.matchEvents.default;

            // Si tenemos información del partido, ajustar TTL
            const matchInfo = await this.getMatchInfo(matchId);
            if (matchInfo && matchInfo.fixture && matchInfo.fixture.status) {
                const status = matchInfo.fixture.status.short;

                // Menor TTL si el partido está en vivo
                if (['1H', '2H'].includes(status)) {
                    ttl = this.ttlConfig.matchEvents.duringMatch;
                }
            }

            // Almacenar en caché solo si tenemos datos
            if (matchEvents) {
                this.cache.set(cacheKey, matchEvents, ttl);
            }

            return matchEvents;
        } catch (error) {
            logger.error(`Error en getMatchEvents: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener cuotas de un partido
     * @param {string|number} matchId - ID del partido
     * @returns {Promise<Object|null>} - Cuotas del partido
     */
    async getMatchOdds(matchId) {
        const cacheKey = `matchOdds_${matchId}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando cuotas de partido ${matchId} desde caché`);
            return cachedData;
        }

        try {
            // Obtener información del partido para nombres de equipos
            const matchInfo = await this.getMatchInfo(matchId);
            if (!matchInfo || !matchInfo.teams) {
                logger.warn(`No se pudo obtener información para mapear partido ${matchId}`);
                return null;
            }

            // Obtener cuotas usando nombres de equipos
            const homeTeam = matchInfo.teams.home.name;
            const awayTeam = matchInfo.teams.away.name;

            const oddsData = await oddsApi.getMatchOddsByTeams(homeTeam, awayTeam);

            // Determinar TTL según estado del partido
            let ttl = this.ttlConfig.matchOdds.default;

            // Ajustar TTL según fase del partido
            if (matchInfo.fixture && matchInfo.fixture.status) {
                const status = matchInfo.fixture.status.short;
                const minute = matchInfo.fixture.status.elapsed || 0;

                // Menor TTL si el partido está en vivo
                if (['1H', '2H'].includes(status)) {
                    ttl = this.ttlConfig.matchOdds.liveMatch;

                    // Aún menor en momentos críticos
                    if (minute > 75 || (minute > 35 && minute <= 45)) {
                        ttl = this.ttlConfig.matchOdds.criticalMoment;
                    }
                }
            }

            // Almacenar en caché solo si tenemos datos
            if (oddsData) {
                this.cache.set(cacheKey, oddsData, ttl);

                // Guardar mapeo entre IDs
                if (oddsData.id) {
                    this.saveOddsMapping(matchId, oddsData.id);
                }
            }

            return oddsData;
        } catch (error) {
            logger.error(`Error en getMatchOdds: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener alineaciones de un partido
     * @param {string|number} matchId - ID del partido
     * @returns {Promise<Object|null>} - Alineaciones del partido
     */
    async getMatchLineups(matchId) {
        const cacheKey = `matchLineups_${matchId}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando alineaciones de partido ${matchId} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const lineups = await footballApi.getFixtureLineups(matchId);

            // Almacenar en caché solo si tenemos datos (TTL largo porque no cambia)
            if (lineups) {
                this.cache.set(cacheKey, lineups, 900); // 15 minutos
            }

            return lineups;
        } catch (error) {
            logger.error(`Error en getMatchLineups: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener historial de enfrentamientos entre dos equipos
     * @param {string|number} team1Id - ID del primer equipo
     * @param {string|number} team2Id - ID del segundo equipo
     * @returns {Promise<Array|null>} - Historial de enfrentamientos
     */
    async getHeadToHead(team1Id, team2Id) {
        const cacheKey = `h2h_${team1Id}_${team2Id}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando historial h2h entre ${team1Id} y ${team2Id} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const h2hData = await footballApi.getH2H(team1Id, team2Id);

            // Almacenar en caché solo si tenemos datos (TTL largo porque no cambia frecuentemente)
            if (h2hData) {
                this.cache.set(cacheKey, h2hData, 3600); // 1 hora
            }

            return h2hData;
        } catch (error) {
            logger.error(`Error en getHeadToHead: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener información de un equipo
     * @param {string|number} teamId - ID del equipo
     * @returns {Promise<Object|null>} - Información del equipo
     */
    async getTeamInfo(teamId) {
        const cacheKey = `teamInfo_${teamId}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando información de equipo ${teamId} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const teamInfo = await footballApi.getTeam(teamId);

            // Almacenar en caché solo si tenemos datos (TTL largo)
            if (teamInfo) {
                this.cache.set(cacheKey, teamInfo, this.ttlConfig.teams);
            }

            return teamInfo;
        } catch (error) {
            logger.error(`Error en getTeamInfo: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener estadísticas de un equipo en una liga
     * @param {string|number} teamId - ID del equipo
     * @param {string|number} leagueId - ID de la liga
     * @param {string} season - Temporada
     * @returns {Promise<Object|null>} - Estadísticas del equipo
     */
    async getTeamStats(teamId, leagueId, season) {
        const cacheKey = `teamStats_${teamId}_${leagueId}_${season}`;

        // Intentar obtener de caché
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            logger.debug(`Usando estadísticas de equipo ${teamId} desde caché`);
            return cachedData;
        }

        // Obtener datos frescos
        try {
            const teamStats = await footballApi.getTeamStatistics(teamId, leagueId, season);

            // Almacenar en caché solo si tenemos datos (TTL medio)
            if (teamStats) {
                this.cache.set(cacheKey, teamStats, 3600); // 1 hora
            }

            return teamStats;
        } catch (error) {
            logger.error(`Error en getTeamStats: ${error.message}`);
            return null;
        }
    }

    /**
     * Calcular prioridad del partido para actualizaciones
     * @param {Object} match - Datos del partido
     * @returns {Promise<number>} - Prioridad (1-10)
     */
    async calculateMatchPriority(match) {
        try {
            let priority = 5; // Valor base

            // 1. Estado del partido
            const statusCode = match.fixture?.status?.short;
            if (['1H', '2H'].includes(statusCode)) {
                priority += 2; // En juego

                // 2. Minuto del partido
                const minute = match.fixture?.status?.elapsed || 0;
                if (minute > 75) priority += 2; // Últimos 15 minutos
                else if (minute > 60) priority += 1; // Último tercio
            } else if (statusCode === 'HT') {
                priority += 1; // Medio tiempo
            } else {
                priority -= 2; // No ha comenzado
            }

            // 3. Resultado ajustado
            if (match.goals) {
                const goalDiff = Math.abs((match.goals.home || 0) - (match.goals.away || 0));
                if (goalDiff <= 1) priority += 1; // Partido igualado
            }

            // Normalizar a 1-10
            return Math.max(1, Math.min(10, priority));
        } catch (error) {
            logger.error(`Error calculando prioridad: ${error.message}`);
            return 5; // Valor por defecto
        }
    }

    /**
     * Obtener intervalo de actualización según prioridad
     * @param {number} priority - Prioridad del partido (1-10)
     * @returns {number} - Intervalo en milisegundos
     */
    getUpdateInterval(priority) {
        // Intervalos base según prioridad
        const intervals = {
            10: 30 * 1000,    // 30 segundos (máxima prioridad)
            9: 45 * 1000,     // 45 segundos
            8: 60 * 1000,     // 1 minuto
            7: 90 * 1000,     // 1.5 minutos
            6: 120 * 1000,    // 2 minutos
            5: 180 * 1000,    // 3 minutos
            4: 240 * 1000,    // 4 minutos
            3: 300 * 1000,    // 5 minutos
            2: 420 * 1000,    // 7 minutos
            1: 600 * 1000     // 10 minutos (mínima prioridad)
        };

        // Buscar el intervalo más cercano
        for (let i = 10; i >= 1; i--) {
            if (priority >= i) {
                return intervals[i];
            }
        }

        return intervals[5]; // Por defecto, 3 minutos
    }

    /**
     * Guardar mapeo entre IDs de partidos entre diferentes APIs
     * @param {string|number} footballApiId - ID en API-Football
     * @param {Object} matchInfo - Información del partido
     */
    saveIdMapping(footballApiId, matchInfo) {
        const key = `${matchInfo.teams.home.name}_vs_${matchInfo.teams.away.name}`;
        this.idMappings.set(key, {
            footballApiId: footballApiId.toString(),
            homeTeam: matchInfo.teams.home.name,
            awayTeam: matchInfo.teams.away.name,
            date: matchInfo.fixture?.date
        });
    }

    /**
     * Guardar mapeo entre Football API y Odds API
     * @param {string|number} footballApiId - ID en Football API
     * @param {string|number} oddsApiId - ID en Odds API
     */
    saveOddsMapping(footballApiId, oddsApiId) {
        // Buscar mapeo existente
        for (const [key, mapping] of this.idMappings.entries()) {
            if (mapping.footballApiId === footballApiId.toString()) {
                // Actualizar con ID de Odds API
                mapping.oddsApiId = oddsApiId.toString();
                this.idMappings.set(key, mapping);
                logger.debug(`Mapeo actualizado: FootballAPI ${footballApiId} -> OddsAPI ${oddsApiId}`);
                return;
            }
        }
    }

    /**
     * Limpiar caché para un partido específico
     * @param {string|number} matchId - ID del partido
     */
    invalidateMatchCache(matchId) {
        const keysToInvalidate = [
            `matchInfo_${matchId}`,
            `matchStats_${matchId}`,
            `matchEvents_${matchId}`,
            `matchOdds_${matchId}`,
            `matchLineups_${matchId}`
        ];

        keysToInvalidate.forEach(key => {
            if (this.cache.has(key)) {
                this.cache.del(key);
                logger.debug(`Caché invalidada para ${key}`);
            }
        });
    }

    /**
     * Obtener métricas de uso de API y caché
     * @returns {Object} - Métricas de uso
     */
    getApiMetrics() {
        const cacheStats = this.cache.getStats();

        return {
            cache: {
                keys: this.cache.keys().length,
                hits: cacheStats.hits,
                misses: cacheStats.misses,
                hitRate: cacheStats.hits + cacheStats.misses > 0 ?
                    cacheStats.hits / (cacheStats.hits + cacheStats.misses) : 0
            },
            api: {
                football: {
                    daily: this.apiUsage.football.daily,
                    remainingDaily: footballApi.limits.dailyLimit - this.apiUsage.football.daily
                },
                odds: {
                    daily: this.apiUsage.odds.daily,
                    monthly: this.apiUsage.odds.monthly,
                    remainingDaily: oddsApi.limits.dailyTarget - this.apiUsage.odds.daily,
                    remainingMonthly: oddsApi.limits.monthlyLimit - this.apiUsage.odds.monthly
                }
            }
        };
    }
}

module.exports = new ApiService();